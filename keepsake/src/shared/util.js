// Shared utilities used by the popup, dashboard, background worker and tests.
// Nothing here touches the network. Everything that renders page-provided text
// goes through textContent (see `el`), never innerHTML.

export function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function nowIso() {
  return new Date().toISOString();
}

// Remove control characters, collapse whitespace, clamp length. Applied to every
// string that originates from a web page or an import file before it is stored.
export function sanitizeText(value, max = 2000) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max).trim();
  return s;
}

// Only allow http(s) URLs (and data: images for locally captured thumbnails).
export function sanitizeUrl(value, { allowData = false, max = 4000 } = {}) {
  if (!value) return '';
  const s = String(value).trim();
  if (s.length > (allowData ? 2_000_000 : max)) return '';
  if (allowData && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    /* not a URL */
  }
  return '';
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait) {
  let last = 0;
  let pending = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      clearTimeout(pending);
      pending = null;
      last = now;
      fn(...args);
    } else if (!pending) {
      pending = setTimeout(() => {
        last = Date.now();
        pending = null;
        fn(...args);
      }, remaining);
    }
  };
}

// --- DOM helper (safe by construction) ------------------------------------
// el('div', { class: 'card', 'aria-label': 'x', onClick: fn }, ['text', childEl])
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key in node && typeof value !== 'string' && key !== 'value') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// --- Price parsing ----------------------------------------------------------
const CURRENCY_SYMBOLS = [
  ['CA$', 'CAD'], ['C$', 'CAD'], ['AU$', 'AUD'], ['A$', 'AUD'], ['NZ$', 'NZD'], ['HK$', 'HKD'], ['S$', 'SGD'], ['US$', 'USD'],
  ['R$', 'BRL'], ['MX$', 'MXN'], ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'], ['₩', 'KRW'],
  ['₺', 'TRY'], ['₽', 'RUB'], ['zł', 'PLN'], ['kr', 'SEK'], ['Fr.', 'CHF'], ['CHF', 'CHF'], ['฿', 'THB'], ['₪', 'ILS'],
];
const CURRENCY_CODES = /\b(USD|EUR|GBP|CAD|AUD|NZD|JPY|CNY|INR|KRW|CHF|SEK|NOK|DKK|PLN|CZK|HUF|BRL|MXN|SGD|HKD|ZAR|TRY|RUB|ILS|THB|AED)\b/i;
const CURRENCY_DISPLAY = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹', KRW: '₩', CAD: 'CA$', AUD: 'A$', NZD: 'NZ$', BRL: 'R$', MXN: 'MX$',
  SGD: 'S$', HKD: 'HK$', CHF: 'CHF ', SEK: 'kr ', NOK: 'kr ', DKK: 'kr ', PLN: 'zł ', TRY: '₺', ILS: '₪', THB: '฿', ZAR: 'R ', RUB: '₽', AED: 'AED ',
};

export function parsePrice(text, fallbackCurrency = '') {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number' && Number.isFinite(text)) {
    return { amount: text, currency: fallbackCurrency || '' };
  }
  const s = String(text).replace(/\u00a0/g, ' ').trim();
  if (!s) return null;
  let currency = '';
  const codeMatch = s.match(CURRENCY_CODES);
  if (codeMatch) currency = codeMatch[1].toUpperCase();
  if (!currency) {
    for (const [symbol, code] of CURRENCY_SYMBOLS) {
      if (s.includes(symbol)) { currency = code; break; }
    }
  }
  // First number-looking token (supports 1,299.00 / 1.299,00 / 1 299,00 / 45).
  const m = s.match(/(\d{1,3}(?:[ .,\u202f]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let raw = m[1].replace(/[ \u202f]/g, '');
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // whichever comes last is the decimal separator
    raw = lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (lastComma > -1) {
    const after = raw.length - lastComma - 1;
    raw = after === 3 && (raw.match(/,/g) || []).length >= 1 && !/,\d{1,2}$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.');
  } else if (lastDot > -1) {
    const after = raw.length - lastDot - 1;
    if (after === 3 && (raw.match(/\./g) || []).length > 1) raw = raw.replace(/\./g, '');
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) return null;
  return { amount, currency: currency || fallbackCurrency || '' };
}

export function formatPrice(amount, currency) {
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(Number(amount))) return '';
  const n = Number(amount);
  const code = (currency || '').toUpperCase();
  if (code && /^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(n);
    } catch {
      /* unknown code, fall through */
    }
  }
  const sym = CURRENCY_DISPLAY[code] || (code ? code + ' ' : '');
  return sym + n.toLocaleString(undefined, { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// "shop.example.co.uk" -> "Example"
export function prettyRetailer(host) {
  if (!host) return '';
  const parts = host.replace(/^www\./, '').split('.');
  const generic = new Set(['com', 'net', 'org', 'co', 'uk', 'de', 'fr', 'ca', 'au', 'shop', 'store', 'www', 'us', 'io', 'eu', 'es', 'it', 'nl', 'jp']);
  const meaningful = parts.filter((p) => !generic.has(p));
  const base = meaningful[meaningful.length - 1] || parts[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function deepMerge(target, patch) {
  const out = Array.isArray(target) ? [...target] : { ...(target || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function pluralize(n, one, many) {
  return n === 1 ? `${n} ${one}` : `${n} ${many || one + 's'}`;
}
