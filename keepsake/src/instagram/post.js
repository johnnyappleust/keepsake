// Reads the details of one Instagram post/reel page: full caption, creator,
// date, full-size image, hashtags, links in the caption and any tagged
// products Instagram exposes. Works on either a fetched HTML string (parsed
// with DOMParser) or the compact { meta, scripts } bundle that
// src/instagram/post-page.js collects inside a tab.
//
// Everything here is best-effort and read-only. Instagram's markup changes;
// the meta tags (og:title / og:description / og:image) are the most stable
// source, the embedded JSON the richest.

import { sanitizeText, sanitizeUrl, parsePrice } from '../shared/util.js';

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>()"']+[^\s<>()"'.,!?:;])/gi;
const HASHTAG_RE = /#([\p{L}\p{N}_]{2,60})/gu;
const MENTION_RE = /(?:^|[^\w])@([A-Za-z0-9._]{2,30})/g;

export function postKindFromUrl(url) {
  const m = String(url || '').match(/\/(p|reel|reels)\/([A-Za-z0-9_-]{5,})/);
  return m ? { shortcode: m[2], type: m[1] === 'p' ? 'post' : 'reel' } : { shortcode: '', type: 'post' };
}

// --- HTML -> bundle ----------------------------------------------------------------
export function bundleFromDocument(doc) {
  const meta = {};
  for (const m of doc.querySelectorAll('meta[property], meta[name]')) {
    const key = m.getAttribute('property') || m.getAttribute('name');
    const val = m.getAttribute('content');
    if (key && val && !(key in meta)) meta[key] = val;
  }
  const scripts = [];
  for (const s of doc.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script:not([src])')) {
    const t = s.textContent || '';
    if (t.length < 20 || t.length > 3_000_000) continue;
    if (/"caption"|"product_tags"|"edge_media_to_caption"|"@type"|"owner"|"shortcode"/.test(t)) scripts.push({ type: s.getAttribute('type') || '', text: t });
  }
  const title = doc.title || '';
  const loginWall = !meta['og:description'] && !!doc.querySelector('input[name="username"], form[id*="login" i], [href*="/accounts/login"]');
  return { meta, scripts, title, loginWall };
}

export function bundleFromHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return bundleFromDocument(doc);
}

// --- bundle -> details --------------------------------------------------------------------
function deepFind(obj, pred, out, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 40) return out;
  if (pred(obj)) out.push(obj);
  for (const v of Array.isArray(obj) ? obj : Object.values(obj)) {
    if (v && typeof v === 'object') deepFind(v, pred, out, depth + 1);
  }
  return out;
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  // Inline bootstrap scripts often wrap JSON in a call: ...requireLazy([...], function(){ ... {"...":...} ... })
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* give up */
    }
  }
  return null;
}

function fromMeta(meta) {
  const out = { caption: '', creator: '', image: '', likes: null, postedAt: '' };
  const og = String(meta['og:description'] || meta.description || '');
  // "1,234 likes, 56 comments - creator on March 3, 2025: "caption text""
  // "creator on Instagram: "caption text""
  let m = og.match(/^(?:([\d.,]+[KM]?)\s+likes?,\s*[\d.,]+[KM]?\s+comments?\s*-\s*)?([A-Za-z0-9._]{2,30})\s+on\s+(?:Instagram|([A-Z][a-z]+ \d{1,2}, \d{4})):\s*["“]?([\s\S]*?)["”]?\s*$/);
  if (m) {
    out.likes = m[1] ? Number(m[1].replace(/,/g, '')) || null : null;
    out.creator = m[2];
    out.postedAt = m[3] || '';
    out.caption = m[4] || '';
  } else if (og) {
    out.caption = og.replace(/^["“]|["”]$/g, '');
  }
  const t = String(meta['og:title'] || '');
  // "Creator Name on Instagram: "caption""  |  "Creator Name | Instagram"
  const tm = t.match(/^(.+?)\s+on Instagram:\s*["“]?([\s\S]*?)["”]?\s*$/);
  if (tm) {
    if (!out.caption) out.caption = tm[2] || '';
    if (!out.creator) {
      const um = tm[1].match(/\(@?([A-Za-z0-9._]{2,30})\)/) || tm[1].match(/^@?([A-Za-z0-9._]{2,30})$/);
      if (um) out.creator = um[1];
    }
  }
  out.image = meta['og:image'] || '';
  return out;
}

function fromScripts(scripts) {
  const out = { caption: '', creator: '', image: '', postedAt: '', products: [], location: '' };
  for (const s of scripts) {
    const data = parseJsonLoose(s.text);
    if (!data) continue;
    // LD+JSON: VideoObject / ImageObject with author.identifier
    if (s.type === 'application/ld+json') {
      const nodes = deepFind(data, (o) => typeof o['@type'] === 'string' && /Video|Image|Social|Article/i.test(o['@type']), []);
      for (const n of nodes) {
        const cap = n.articleBody || n.caption || n.description || '';
        if (cap && !out.caption) out.caption = String(cap);
        const author = n.author?.identifier?.value || n.author?.alternateName || n.author?.name || '';
        if (author && !out.creator) out.creator = String(author).replace(/^@/, '');
        if (!out.image) out.image = (Array.isArray(n.thumbnailUrl) ? n.thumbnailUrl[0] : n.thumbnailUrl) || n.contentUrl || '';
        if (!out.postedAt && (n.uploadDate || n.datePublished)) out.postedAt = String(n.uploadDate || n.datePublished);
      }
      continue;
    }
    // Instagram's own JSON: caption.text, owner.username, taken_at, image_versions2, product_tags
    if (!out.caption) {
      const caps = deepFind(data, (o) => typeof o.text === 'string' && o.text.length > 0 && ('created_at' in o || 'pk' in o || 'user' in o || 'id' in o) && !('username' in o), []);
      const best = caps.sort((a, b) => b.text.length - a.text.length)[0];
      if (best) out.caption = best.text;
      if (!out.caption) {
        const edges = deepFind(data, (o) => Array.isArray(o.edge_media_to_caption?.edges), []);
        const e = edges[0]?.edge_media_to_caption?.edges?.[0]?.node?.text;
        if (e) out.caption = String(e);
      }
    }
    if (!out.creator) {
      const owners = deepFind(data, (o) => o.owner && typeof o.owner === 'object' && typeof o.owner.username === 'string', []);
      if (owners[0]) out.creator = owners[0].owner.username;
      else {
        const users = deepFind(data, (o) => o.user && typeof o.user === 'object' && typeof o.user.username === 'string' && ('caption' in o || 'code' in o || 'taken_at' in o), []);
        if (users[0]) out.creator = users[0].user.username;
      }
    }
    if (!out.postedAt) {
      const times = deepFind(data, (o) => typeof o.taken_at === 'number' || typeof o.taken_at_timestamp === 'number', []);
      const t = times[0]?.taken_at ?? times[0]?.taken_at_timestamp;
      if (t) out.postedAt = new Date(t * 1000).toISOString();
    }
    if (!out.image) {
      const imgs = deepFind(data, (o) => Array.isArray(o.image_versions2?.candidates) || typeof o.display_url === 'string', []);
      const first = imgs[0];
      if (first) out.image = first.display_url || first.image_versions2?.candidates?.[0]?.url || '';
    }
    if (!out.location) {
      const locs = deepFind(data, (o) => o.location && typeof o.location === 'object' && typeof o.location.name === 'string', []);
      if (locs[0]) out.location = locs[0].location.name;
    }
    const tags = deepFind(data, (o) => Array.isArray(o.product_tags) && o.product_tags.length, []);
    for (const holder of tags) {
      for (const tag of holder.product_tags) {
        const p = tag.product || tag.product_item || tag;
        if (!p || typeof p !== 'object') continue;
        const name = p.name || p.title || '';
        if (!name) continue;
        const priceRaw = p.current_price || p.price || p.full_price || p.current_price_amount || '';
        const parsed = priceRaw ? parsePrice(String(priceRaw), p.price_currency || p.currency || '') : null;
        out.products.push({
          name: String(name),
          price: parsed ? parsed.amount : null,
          currency: parsed ? parsed.currency : String(p.price_currency || p.currency || ''),
          url: p.external_url || p.checkout_url || p.product_url || p.merchant?.external_url || '',
          retailer: p.merchant?.username || p.merchant?.name || p.brand || '',
        });
      }
    }
  }
  return out;
}

export function parsePostBundle(bundle, url) {
  const b = bundle || {};
  const meta = b.meta || {};
  const m = fromMeta(meta);
  const j = fromScripts(b.scripts || []);
  const { shortcode, type } = postKindFromUrl(url);
  const caption = sanitizeText(j.caption || m.caption, 2200);
  const creator = sanitizeText(j.creator || m.creator, 80).replace(/^@/, '');
  const links = [];
  for (const mm of caption.matchAll(URL_RE)) {
    const raw = mm[1].startsWith('www.') ? `https://${mm[1]}` : mm[1];
    const u = sanitizeUrl(raw);
    if (u && !links.some((l) => l.url === u) && !/instagram\.com/i.test(u)) links.push({ url: u, label: u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80) });
  }
  const hashtags = [...new Set([...caption.matchAll(HASHTAG_RE)].map((x) => x[1].toLowerCase()))].slice(0, 30);
  const mentions = [...new Set([...caption.matchAll(MENTION_RE)].map((x) => x[1].toLowerCase()))].filter((u) => u !== creator.toLowerCase()).slice(0, 20);
  const products = j.products.slice(0, 10).map((p) => ({
    name: sanitizeText(p.name, 160), price: Number.isFinite(p.price) ? p.price : null, currency: sanitizeText(p.currency, 8).toUpperCase(), url: sanitizeUrl(p.url), retailer: sanitizeText(p.retailer, 80),
  }));
  const image = sanitizeUrl(j.image || m.image);
  const ok = !!(caption || creator || image || products.length);
  return {
    url: `https://www.instagram.com/${type === 'post' ? 'p' : 'reel'}/${shortcode}/`,
    shortcode, type, ok,
    loginWall: !!b.loginWall,
    caption, creator, image, hashtags, mentions, links, products,
    postedAt: sanitizeText(j.postedAt || m.postedAt, 40),
    likes: m.likes,
    location: sanitizeText(j.location, 120),
    linkInBio: /link in (?:my )?bio|link in profile|shop (?:my|the) (?:link|bio)/i.test(caption),
    title: titleFromCaption(caption, creator, type),
    readAt: new Date().toISOString(),
  };
}

export function parsePostHtml(html, url) {
  return parsePostBundle(bundleFromHtml(html), url);
}

// A short, human title from a caption: first sentence, no leading emoji/hashtags.
export function titleFromCaption(caption, creator, type = 'post') {
  let c = sanitizeText(caption, 600);
  c = c.replace(/^(?:[#@][\w.]+[\s,]*)+/u, '').replace(/^[\s\p{Extended_Pictographic}\p{P}\uFE0F\u200D]+/u, '').trim();
  const first = c.split(/\n|(?<=[.!?…])\s+|\s+[|•·]\s+|\s+-\s+/)[0] || '';
  let t = first.replace(/\s*#[\w]+\s*$/g, '').trim();
  if (t.length > 80) t = t.slice(0, 79).replace(/\s+\S*$/, '') + '…';
  if (t.replace(/[#@\s\p{P}]/gu, '').length >= 4) return t;
  if (creator) return `${type === 'reel' ? 'Reel' : 'Post'} by @${creator}`;
  return type === 'reel' ? 'Instagram reel' : 'Instagram post';
}
