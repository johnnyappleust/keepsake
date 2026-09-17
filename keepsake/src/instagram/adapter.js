// Keepsake Instagram adapter. Classic script; exposes globalThis.KeepsakeInstagram.
//
// Every Instagram-specific selector, URL pattern and heuristic lives here so
// it can be updated in one place when Instagram changes its markup. Semantic
// attributes (hrefs, alt text, aria labels, roles) are preferred over generated
// class names, which change constantly.
//
// This module only reads the DOM it is given. It never touches cookies,
// storage, credentials or network, and it is only ever run on a Saved
// collection page the user opened themselves.

(function keepsakeInstagramAdapter() {
  if (globalThis.KeepsakeInstagram) return;

  const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

  // https://www.instagram.com/<user>/saved/               -> saved overview (not importable)
  // https://www.instagram.com/<user>/saved/all-posts/     -> all saved posts
  // https://www.instagram.com/<user>/saved/<slug>/<id>/   -> one collection
  function parseSavedUrl(url) {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      return null;
    }
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return { isInstagram: false, isSaved: false };
    const parts = u.pathname.split('/').filter(Boolean);
    const savedIdx = parts.indexOf('saved');
    if (savedIdx !== 1 || parts.length < 2) return { isInstagram: true, isSaved: false };
    const username = decodeURIComponent(parts[0]);
    if (parts.length === 2) return { isInstagram: true, isSaved: true, isCollection: false, username, kind: 'overview' };
    const slug = decodeURIComponent(parts[2]);
    if (slug === 'all-posts') return { isInstagram: true, isSaved: true, isCollection: true, username, kind: 'all', collectionSlug: slug, collectionName: 'All posts', collectionId: null };
    const collectionId = parts[3] && /^\d+$/.test(parts[3]) ? parts[3] : null;
    return {
      isInstagram: true, isSaved: true, isCollection: true, username, kind: 'collection',
      collectionSlug: slug, collectionId, collectionName: slugToName(slug),
    };
  }

  function slugToName(slug) {
    return text(String(slug || '').replace(/[-_]+/g, ' ')).replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Post / reel permalink -> { shortcode, type, url }
  function parsePostUrl(href, base) {
    let u;
    try {
      u = new URL(String(href), base || 'https://www.instagram.com/');
    } catch {
      return null;
    }
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(?:[^/]+\/)?(p|reel|reels)\/([A-Za-z0-9_-]{5,})\/?/);
    if (!m) return null;
    const type = m[1] === 'p' ? 'post' : 'reel';
    return { shortcode: m[2], type, url: `https://www.instagram.com/${type === 'post' ? 'p' : 'reel'}/${m[2]}/` };
  }

  function bestImageSrc(img) {
    if (!img) return '';
    const set = img.getAttribute('srcset');
    if (set) {
      const best = set.split(',').map((s) => s.trim().split(/\s+/)).filter((p) => p[0]).map((p) => ({ url: p[0], w: parseFloat(p[1]) || 0 })).sort((a, b) => b.w - a.w)[0];
      if (best) return best.url;
    }
    return img.currentSrc || img.getAttribute('src') || '';
  }

  // Instagram alt text often reads "Photo by Name on January 1, 2025. May be an image of lamp."
  // or "Photo shared by Name on ..." — we pull the creator and the descriptive tail.
  function parseAlt(alt) {
    const a = text(alt);
    if (!a) return { creator: '', caption: '' };
    let creator = '';
    const m = a.match(/^(?:Photo|Video|Reel|Image)\s+(?:by|shared by)\s+(.+?)\s+(?:on|in)\s+/i) || a.match(/^(?:Photo|Video|Reel|Image)\s+(?:by|shared by)\s+(.+?)[.,]/i);
    if (m) creator = text(m[1]).slice(0, 80);
    let caption = a;
    caption = caption.replace(/^(?:Photo|Video|Reel|Image)\s+(?:by|shared by)\s+.+?\s+on\s+[A-Z][a-z]+ \d{1,2}, \d{4}(?:\s+tagging\s+[^.]*)?\.?\s*/i, '');
    caption = caption.replace(/^May be (?:an? )?(?:image|video|graphic) of\s*/i, '');
    caption = caption.replace(/^\(([^)]*)\)$/, '$1');
    return { creator, caption: text(caption).slice(0, 1000) };
  }

  function detectCollectionName(doc, parsed) {
    const scope = doc.querySelector('main') || doc.body || doc;
    const headings = Array.from(scope.querySelectorAll('h1, h2')).map((h) => text(h.textContent)).filter((t) => t && t.length <= 80);
    const username = parsed && parsed.username ? parsed.username.toLowerCase() : '';
    const candidate = headings.find((h) => h.toLowerCase() !== username && !/^saved$/i.test(h) && !/instagram/i.test(h));
    if (candidate) return candidate;
    const title = text(doc.title).replace(/\s*[•|·-]\s*Instagram.*$/i, '');
    if (title && !/instagram/i.test(title) && title.toLowerCase() !== username && !/^saved$/i.test(title)) return title.slice(0, 80);
    return parsed && parsed.collectionName ? parsed.collectionName : '';
  }

  // Collect post/reel links currently in the DOM of the opened collection.
  function collectPosts(doc, baseUrl) {
    const base = baseUrl || (doc.location && doc.location.href) || 'https://www.instagram.com/';
    const scope = doc.querySelector('main') || doc.body || doc;
    const anchors = scope.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    const out = [];
    const seen = new Set();
    for (const a of anchors) {
      const parsed = parsePostUrl(a.getAttribute('href') || '', base);
      if (!parsed || seen.has(parsed.shortcode)) continue;
      // skip links in headers/navigation/comment areas
      if (a.closest('header, nav, [role="navigation"], [role="dialog"]')) continue;
      const img = a.querySelector('img');
      const thumbnail = img ? bestImageSrc(img) : '';
      const alt = img ? text(img.getAttribute('alt')) : '';
      const { creator, caption } = parseAlt(alt);
      const aria = text(a.getAttribute('aria-label'));
      seen.add(parsed.shortcode);
      out.push({
        url: parsed.url, shortcode: parsed.shortcode, type: parsed.type, thumbnail, alt,
        caption: caption || (aria && !/^(post|reel|video)$/i.test(aria) ? aria : ''),
        creator,
      });
    }
    return out;
  }

  globalThis.KeepsakeInstagram = { parseSavedUrl, parsePostUrl, parseAlt, detectCollectionName, collectPosts, slugToName, bestImageSrc };
})();
