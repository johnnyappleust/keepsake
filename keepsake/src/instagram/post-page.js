// Keepsake Instagram post reader (tab fallback). Injected into a post/reel tab
// that Keepsake opened in the background, only during "Read post details".
// Collects meta tags and the embedded JSON blobs that describe the post and
// returns them; parsing happens in the extension (src/instagram/post.js).
// Reads nothing else: no cookies, storage, messages or other pages.

(function keepsakePostPage() {
  const meta = {};
  for (const m of document.querySelectorAll('meta[property], meta[name]')) {
    const key = m.getAttribute('property') || m.getAttribute('name');
    const val = m.getAttribute('content');
    if (key && val && !(key in meta)) meta[key] = val;
  }
  const scripts = [];
  let total = 0;
  for (const s of document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script:not([src])')) {
    const t = s.textContent || '';
    if (t.length < 20) continue;
    if (!/"caption"|"product_tags"|"edge_media_to_caption"|"@type"|"owner"|"shortcode"/.test(t)) continue;
    if (total + t.length > 4_000_000) break;
    total += t.length;
    scripts.push({ type: s.getAttribute('type') || '', text: t });
  }
  // Visible caption as a last resort (post pages render it in an h1 or a span under the article).
  let visibleCaption = '';
  try {
    const h1 = document.querySelector('article h1, main h1');
    if (h1 && h1.textContent.trim().length > 3) visibleCaption = h1.textContent.trim().slice(0, 2200);
  } catch {
    /* ignore */
  }
  const loginWall = !meta['og:description'] && !!document.querySelector('input[name="username"], form[id*="login" i]');
  return { meta, scripts, title: document.title, loginWall, visibleCaption, url: location.href.split('#')[0] };
})();
