// "Read post details": for each scanned Instagram post, fetch the post page
// (using the browser's own Instagram session) and pull out caption, creator,
// full-size image, links and tagged products. If a fetch comes back as a
// login wall, fall back to opening the post in a background tab for a moment
// and reading it there. Runs one post at a time with a polite delay.
//
// Needs the optional host permission https://www.instagram.com/* — requested
// from the button in the review screen, never at install.

import { MSG } from '../shared/messages.js';
import { openableUrl } from '../shared/url.js';
import { parsePostHtml, parsePostBundle, titleFromCaption } from './post.js';

export const INSTAGRAM_ORIGIN = 'https://www.instagram.com/*';

export async function hasInstagramAccess() {
  try {
    const p = await chrome.permissions.getAll();
    const o = p.origins || [];
    return o.includes(INSTAGRAM_ORIGIN) || o.includes('*://www.instagram.com/*') || o.includes('*://*.instagram.com/*') || o.includes('*://*/*') || o.includes('<all_urls>');
  } catch {
    return false;
  }
}

export async function requestInstagramAccess() {
  try {
    return await chrome.permissions.request({ origins: [INSTAGRAM_ORIGIN] });
  } catch {
    return false;
  }
}

export async function revokeInstagramAccess() {
  try {
    await chrome.permissions.remove({ origins: [INSTAGRAM_ORIGIN] });
  } catch {
    /* fine */
  }
}

async function readViaFetch(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetchImpl(openableUrl(url), { credentials: 'include', redirect: 'follow', signal: controller.signal, headers: { accept: 'text/html,application/xhtml+xml' } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    const html = await res.text();
    const details = parsePostHtml(html, url);
    if (details.loginWall) return { ...details, ok: false, error: 'login-wall' };
    return details;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function readViaTab(url, send) {
  const res = await send({ type: MSG.IG_READ_POST, url });
  if (!res || !res.ok || !res.bundle) return { ok: false, error: (res && res.error) || 'Could not read the post in a tab.' };
  const details = parsePostBundle(res.bundle, url);
  if (!details.caption && res.bundle.visibleCaption) {
    details.caption = res.bundle.visibleCaption;
    details.title = titleFromCaption(details.caption, details.creator, details.type);
  }
  return details;
}

// Read one post. Strategy: fetch, then tab if the fetch gave nothing useful.
export async function readPost(url, { send, fetchImpl = globalThis.fetch.bind(globalThis), allowTab = true } = {}) {
  const first = await readViaFetch(url, fetchImpl);
  if (first.ok) return { ...first, via: 'fetch' };
  if (!allowTab || !send) return first;
  const second = await readViaTab(url, send);
  return second.ok ? { ...second, via: 'tab' } : { ...second, error: second.error || first.error };
}

export function mergeDetails(post, d) {
  if (!d || !d.ok) return { ...post, details: false, detailsError: (d && d.error) || 'unknown' };
  const caption = d.caption && d.caption.length >= (post.caption || '').length ? d.caption : post.caption || d.caption || '';
  const creator = d.creator || post.creator || '';
  return {
    ...post,
    caption,
    creator,
    originalThumbnail: post.originalThumbnail || post.thumbnail || '',
    originalImage: d.image || post.originalImage || '',
    hashtags: d.hashtags || [],
    mentions: d.mentions || [],
    links: d.links || [],
    products: d.products || [],
    postedAt: d.postedAt || '',
    likes: d.likes ?? null,
    location: d.location || '',
    linkInBio: !!d.linkInBio,
    title: titleFromCaption(caption, creator, post.type),
    details: true,
    detailsVia: d.via || '',
    detailsError: '',
  };
}

// Enrich a list of posts in place-order. Calls onProgress({ done, total, failed, current, post }).
export async function enrichPosts(posts, { read = readPost, send, fetchImpl, onProgress = () => {}, shouldStop = () => false, delayMs = 1500, jitterMs = 1500, skipDone = true } = {}) {
  const out = posts.slice();
  let done = 0;
  let failed = 0;
  let loginWalls = 0;
  let allowTab = true;
  for (let i = 0; i < out.length; i++) {
    if (shouldStop()) return { posts: out, done, failed, stopped: true };
    const post = out[i];
    if (skipDone && post.details) {
      done++;
      continue;
    }
    onProgress({ done, total: out.length, failed, current: i, post });
    const d = await read(post.url, { send, fetchImpl, allowTab });
    if (d && d.error === 'login-wall') loginWalls++;
    out[i] = mergeDetails(post, d);
    if (out[i].details) done++;
    else failed++;
    onProgress({ done, total: out.length, failed, current: i, post: out[i] });
    if (i < out.length - 1 && !shouldStop()) {
      const wait = delayMs + Math.floor(Math.random() * jitterMs);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return { posts: out, done, failed, stopped: false, loginWalls };
}
