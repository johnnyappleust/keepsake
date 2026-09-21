// URL normalization used only to produce a comparison key for duplicate
// detection. The original URL is always stored untouched.

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'igshid', 'igsh',
  'mc_cid', 'mc_eid', '_ga', '_gl', 'srsltid', 'ref', 'ref_', 'refid', 'referrer', 'affid', 'aff', 'tag',
  'cmpid', 'cid', 'sscid', 'irclickid', 'irgwc', 'spm', 'scm', 'pf_rd_p', 'pf_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pd_rd_r',
  'psc', 'th', 'qid', 'sr', 'keywords', 's', 'sprefix', 'crid', 'linkcode', 'linkid', 'camp', 'creative', 'ascsubtag',
  'share', 'si', 'feature', 'source', 'campaign', 'trk', 'trkid', 'epik', 'ncid', 'ocid', 'oly_enc_id', 'oly_anon_id',
  'vero_id', 'wickedid', 'yhsclid', 'zanpid',
]);

const PARAMS_THAT_IDENTIFY_PRODUCTS = new Set(['variant', 'sku', 'productid', 'product_id', 'pid', 'id', 'p', 'itemid', 'item', 'asin', 'color', 'size']);

export function normalizeUrl(input) {
  if (!input) return '';
  let u;
  try {
    u = new URL(String(input));
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  let host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let path = u.pathname.replace(/\/+$/, '') || '/';
  let search = '';

  // Amazon: /gp/product/ASIN, /Some-Title/dp/ASIN -> /dp/ASIN
  const asin = path.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  if (/(^|\.)amazon\./.test(host) && asin) {
    path = `/dp/${asin[1].toUpperCase()}`;
    return `${host}${path}`;
  }
  // Etsy: /listing/ID/slug -> /listing/ID
  const etsy = path.match(/^\/listing\/(\d+)/);
  if (/(^|\.)etsy\.com$/.test(host) && etsy) return `${host}/listing/${etsy[1]}`;
  // eBay: /itm/slug/ID or /itm/ID -> /itm/ID
  const ebay = path.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/);
  if (/(^|\.)ebay\./.test(host) && ebay) return `${host}/itm/${ebay[1]}`;
  // Instagram posts and reels: keep the shortcode only
  const ig = path.match(/^\/(?:[^/]+\/)?(p|reel|reels)\/([A-Za-z0-9_-]+)/);
  if (/(^|\.)instagram\.com$/.test(host) && ig) return `instagram.com/${ig[1] === 'reels' ? 'reel' : ig[1]}/${ig[2]}`;

  const params = [];
  for (const [key, value] of u.searchParams.entries()) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || k.startsWith('utm_') || k.startsWith('mkt_') || k.startsWith('pk_')) continue;
    if (PARAMS_THAT_IDENTIFY_PRODUCTS.has(k)) params.push([k, value]);
    else if (params.length < 8 && value.length < 80 && !/^(\d{10,}|[a-f0-9]{24,})$/i.test(value)) params.push([k, value]);
  }
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (params.length) search = '?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${host}${path.toLowerCase()}${search}`;
}

// Strip tracking params but keep everything else, for a tidy "canonical" URL to
// display and open. Falls back to the input if parsing fails.
export function cleanUrl(input) {
  try {
    const u = new URL(String(input));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (TRACKING_PARAMS.has(k) || k.startsWith('utm_')) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.href;
  } catch {
    return '';
  }
}

// The link to actually open for a saved URL. A logged-in Instagram session
// reroutes /reel/<code>/ into its reels feed viewer, which lands on other
// reels; /p/<code>/ serves the same post without that redirect. The stored
// URL is left alone (it's the duplicate-detection key); use this for display
// and for anything the user clicks.
export function openableUrl(input) {
  try {
    const u = new URL(String(input));
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return input;
    const m = u.pathname.match(/^\/(?:[^/]+\/)?(?:reel|reels)\/([A-Za-z0-9_-]{5,})/);
    return m ? `https://www.instagram.com/p/${m[1]}/` : input;
  } catch {
    return input;
  }
}

export function isRestrictedUrl(url) {
  if (!url) return true;
  return !/^https?:\/\//i.test(url) || /^https?:\/\/chrome\.google\.com\/webstore/i.test(url) || /^https?:\/\/chromewebstore\.google\.com/i.test(url);
}

export function originPattern(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `*://${u.hostname}/*`;
  } catch {
    return '';
  }
}

export function hostFromPattern(pattern) {
  const m = String(pattern).match(/^\*?:?\/\/(?:\*\.)?([^/]+)\/\*$/) || String(pattern).match(/^(?:https?|\*):\/\/([^/]+)\//);
  return m ? m[1] : String(pattern);
}
