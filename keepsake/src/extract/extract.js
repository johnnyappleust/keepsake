// Keepsake page extraction. Injected on demand (toolbar click / context menu)
// into the active tab and returns a plain object describing the product on the
// page. Runs in the isolated world; never sends anything anywhere itself.
//
// Fallback order:
//   1. Schema.org JSON-LD Product
//   2. Open Graph metadata
//   3. Twitter card metadata
//   4. Common product price meta tags
//   5. Prominent headings, images and visible price patterns
//   6. document.title + location.href
//
// Every technique is wrapped so one failure never breaks the result.

(function keepsakeExtractModule() {
  const PRICE_RE = /(?:(?:US|CA|AU|NZ|HK|S|R|MX)?\$|€|£|¥|₹|₩|₺|₽|₪|฿|\b(?:USD|EUR|GBP|CAD|AUD|CHF|SEK|NOK|DKK|PLN|JPY|INR)\b)\s?\d{1,3}(?:[ .,\u202f]?\d{3})*(?:[.,]\d{1,2})?|\d{1,3}(?:[ .,\u202f]?\d{3})*(?:[.,]\d{1,2})?\s?(?:€|£|zł|kr|CHF|USD|EUR|GBP)\b/;
  const BAD_IMG_RE = /(logo|sprite|icon|favicon|avatar|pixel|badge|spinner|loading|placeholder|blank\.|1x1|tracking|banner-ad|\/ads?\/|flag|payment|visa|mastercard|paypal|star|rating)/i;
  const BAD_CONTAINER = 'header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], [class*="logo"], [id*="logo"], [class*="cookie"], [class*="newsletter"], [class*="footer"], [class*="header"]:not([class*="product"]), iframe';

  const safe = (fn, fallback = null) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
  const abs = (u) => {
    if (!u || typeof u !== 'string') return '';
    try {
      const url = new URL(u.trim(), location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  };
  const meta = (selector) => safe(() => text(document.querySelector(selector)?.getAttribute('content')), '');
  const metaAll = (selector) => safe(() => Array.from(document.querySelectorAll(selector)).map((m) => text(m.getAttribute('content'))).filter(Boolean), []);

  // ---- 1. JSON-LD ------------------------------------------------------------
  function readJsonLd() {
    const out = { product: null, breadcrumbs: [] };
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 25);
    const nodes = [];
    for (const s of scripts) {
      const raw = s.textContent || '';
      if (!raw.trim() || raw.length > 400000) continue;
      let parsed = safe(() => JSON.parse(raw));
      if (parsed === null) parsed = safe(() => JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')));
      if (parsed === null) continue;
      collect(parsed, nodes, 0);
    }
    const types = (n) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).map((t) => String(t || '').toLowerCase());
    const products = nodes.filter((n) => types(n).some((t) => t === 'product' || t === 'productgroup' || t === 'individualproduct' || t === 'productmodel'));
    if (products.length) {
      // Prefer the product matching the current URL, otherwise the richest one.
      const here = location.href.split('#')[0];
      const scored = products.map((p) => ({ p, s: (p.url && here.startsWith(String(p.url).split('#')[0]) ? 10 : 0) + (p.offers ? 2 : 0) + (p.image ? 1 : 0) + (p.name ? 1 : 0) }));
      scored.sort((a, b) => b.s - a.s);
      out.product = scored[0].p;
    }
    const crumbs = nodes.find((n) => types(n).includes('breadcrumblist'));
    if (crumbs && Array.isArray(crumbs.itemListElement)) {
      out.breadcrumbs = crumbs.itemListElement
        .map((e) => text(e?.name || e?.item?.name || (typeof e?.item === 'string' ? '' : e?.item?.['@id'] ? '' : '')))
        .filter(Boolean)
        .slice(0, 8);
    }
    return out;

    function collect(node, acc, depth) {
      if (!node || depth > 6 || acc.length > 200) return;
      if (Array.isArray(node)) return node.forEach((n) => collect(n, acc, depth + 1));
      if (typeof node !== 'object') return;
      if (node['@type']) acc.push(node);
      if (node['@graph']) collect(node['@graph'], acc, depth + 1);
      for (const key of ['mainEntity', 'mainEntityOfPage', 'hasVariant', 'itemListElement', 'offers', 'item']) if (node[key]) collect(node[key], acc, depth + 1);
    }
  }

  function offerFrom(product) {
    if (!product) return {};
    let offers = product.offers;
    if (Array.isArray(offers)) offers = offers.find((o) => o && (o.price || o.lowPrice || o.priceSpecification)) || offers[0];
    if (!offers || typeof offers !== 'object') return {};
    const spec = Array.isArray(offers.priceSpecification) ? offers.priceSpecification[0] : offers.priceSpecification;
    const price = offers.price ?? offers.lowPrice ?? spec?.price ?? spec?.minPrice ?? null;
    const currency = offers.priceCurrency || spec?.priceCurrency || '';
    const availability = text(offers.availability || '').replace(/.*\//, '');
    return { price, currency: text(currency), availability };
  }

  function imagesFrom(value, acc) {
    if (!value) return;
    if (typeof value === 'string') acc.push(abs(value));
    else if (Array.isArray(value)) value.forEach((v) => imagesFrom(v, acc));
    else if (typeof value === 'object') imagesFrom(value.url || value.contentUrl || value['@id'], acc);
  }

  // ---- Store's own product type and tags ---------------------------------------
  // Shopify pages embed the product as JSON ("vendor":"…","type":"Hoodie","tags":[…]);
  // WooCommerce puts product_cat-<slug> / product_tag-<slug> classes on the product.
  // These say what the store thinks the item is, so they are strong category clues.
  const GENERIC_TYPES = /^(product|products|default|simple|variable|grouped|external|variant|item|general|misc|other|all|none|n\/a)$/i;
  function cleanTags(list) {
    const out = [];
    for (const raw of list) {
      const t = text(raw).replace(/[-_]+/g, ' ');
      // Skip merchandising and filter tags: "sale", "new", "size:M", "YGroup_x", ids.
      if (!t || t.length > 30 || /[:=\d]/.test(t) || /^(sale|new|new ?arrivals?|bestsellers?|best sellers?|featured|clearance|gift card|exclusive|limited|online only|hidden|default)$/i.test(t)) continue;
      if (/\b(feed|feeds|bundle|bundles|guide|module|slider|eligible|bfcm|black friday|cyber monday|aftership|storelocator|include|exclude|badge|promo|discount|filter|template|hide|hidden|campaign)\b/i.test(t)) continue;
      if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
      if (out.length >= 12) break;
    }
    return out;
  }
  function readStoreTaxonomy() {
    const out = { productType: '', tags: [] };
    const isShopify = !!document.querySelector('meta[name="shopify-digital-wallet"], meta[name="shopify-checkout-api-token"], script[src*="cdn.shopify.com"], link[href*="cdn.shopify.com"], script[src*="/cdn/shop/"], link[href*="/cdn/shop/"]');
    if (isShopify) {
      const unq = (v) => safe(() => JSON.parse(`"${v}"`), v);
      const scripts = Array.from(document.querySelectorAll('script:not([src])')).slice(0, 120);
      for (const s of scripts) {
        const raw = s.textContent || '';
        if (raw.length > 800000 || !raw.includes('"vendor"')) continue;
        const m = raw.match(/"vendor":"(?:[^"\\]|\\.)*","type":"((?:[^"\\]|\\.){1,80})"(?:,"tags":\[((?:"(?:[^"\\]|\\.)*",?){0,60})\])?/);
        if (!m) continue;
        const type = text(unq(m[1]));
        if (!out.productType && type && !GENERIC_TYPES.test(type)) out.productType = type;
        if (!out.tags.length && m[2]) out.tags = cleanTags([...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => unq(x[1])));
        if (out.productType && out.tags.length) break;
      }
    }
    if (!out.productType) {
      const woo = document.querySelector('.type-product[class*="product_cat-"]');
      if (woo) {
        const slugs = (prefix) => Array.from(woo.classList).filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length));
        const cats = slugs('product_cat-').filter((c) => c !== 'uncategorized').map((c) => c.replace(/-/g, ' '));
        out.productType = cats.slice(0, 3).join(', ');
        if (!out.tags.length) out.tags = cleanTags(slugs('product_tag-'));
      }
    }
    return out;
  }

  // ---- 5. Visible page heuristics ----------------------------------------------
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }

  function imageCandidates(limit = 12) {
    const imgs = Array.from(document.images || []);
    const scored = [];
    const seen = new Set();
    const vh = window.innerHeight || 800;
    const titleWords = tokenizeTitle(pageTitle());
    for (const img of imgs) {
      const src = bestSrc(img);
      if (!src || seen.has(src) || BAD_IMG_RE.test(src) || /\.(svg|gif)(\?|$)/i.test(src)) continue;
      if (img.closest(BAD_CONTAINER)) continue;
      const rect = img.getBoundingClientRect();
      const w = rect.width || img.naturalWidth || Number(img.getAttribute('width')) || 0;
      const h = rect.height || img.naturalHeight || Number(img.getAttribute('height')) || 0;
      if (w < 150 || h < 150) continue;
      if (rect.width && !isVisible(img)) continue;
      const alt = text(img.getAttribute('alt'));
      if (/logo|icon|avatar/i.test(alt)) continue;
      let score = Math.min(w * h, 1_200_000) / 1000;
      if (rect.top >= 0 && rect.top < vh) score *= 1.5; // in the initial viewport
      if (img.closest('[class*="gallery"], [class*="product-image"], [class*="productimage"], [class*="pdp"], [data-testid*="image"], [class*="carousel"], [class*="slider"], [class*="media"], picture, main')) score *= 1.3;
      if (alt && titleWords.some((wd) => alt.toLowerCase().includes(wd))) score *= 1.4;
      seen.add(src);
      scored.push({ src, score, alt, w: img.naturalWidth || w, h: img.naturalHeight || h });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  function bestSrc(img) {
    const srcset = img.currentSrc || '';
    if (srcset && !srcset.startsWith('data:')) return abs(srcset);
    const set = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (set) {
      const best = set.split(',').map((s) => s.trim().split(/\s+/)).filter((p) => p[0]).map((p) => ({ url: p[0], w: parseFloat(p[1]) || 0 })).sort((a, b) => b.w - a.w)[0];
      if (best) return abs(best.url);
    }
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.getAttribute('data-zoom-image') || img.getAttribute('data-image');
    if (lazy && !lazy.startsWith('data:')) return abs(lazy);
    const src = img.getAttribute('src') || '';
    return src.startsWith('data:') ? '' : abs(src);
  }

  function pageTitle() {
    return text(document.title);
  }

  function tokenizeTitle(t) {
    return t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 8);
  }

  function visibleHeading() {
    const candidates = Array.from(document.querySelectorAll('h1, [itemprop="name"], [data-testid*="product-title"], [class*="product-title"], [class*="product-name"], [class*="productTitle"], [class*="productName"], [id*="productTitle"], [id*="product-title"]'));
    for (const c of candidates) {
      if (c.closest(BAD_CONTAINER)) continue;
      const t = text(c.textContent);
      if (t.length >= 3 && t.length <= 250 && isVisible(c)) return t;
    }
    return '';
  }

  function visiblePrice() {
    const preferred = Array.from(document.querySelectorAll('[itemprop="price"], [data-testid*="price"], [class*="price"]:not([class*="strike"]):not([class*="was"]):not([class*="old"]):not([class*="compare"]), [id*="price"]')).slice(0, 60);
    for (const p of preferred) {
      if (p.closest(BAD_CONTAINER)) continue;
      const attr = p.getAttribute('content') || p.getAttribute('data-price') || p.getAttribute('data-amount');
      if (attr && /^\d/.test(attr)) return { text: attr, currency: text(p.getAttribute('data-currency') || '') };
      const t = text(p.textContent);
      const m = t.match(PRICE_RE);
      if (m && t.length < 80 && (rectOk(p))) return { text: m[0], currency: '' };
    }
    // Scan the main area text for a price near the top of the page.
    const main = document.querySelector('main') || document.body;
    if (!main) return null;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let count = 0;
    while (walker.nextNode() && count++ < 4000) {
      const node = walker.currentNode;
      const t = text(node.nodeValue);
      if (t.length < 2 || t.length > 60) continue;
      const m = t.match(PRICE_RE);
      if (!m) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest(BAD_CONTAINER) || parent.closest('script, style, noscript, del, s, strike')) continue;
      if (rectOk(parent)) return { text: m[0], currency: '' };
    }
    return null;
  }

  function rectOk(el) {
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0 ? true : r.top < (window.innerHeight || 800) * 2.5;
  }

  function breadcrumbsFromDom() {
    const nav = document.querySelector('nav[aria-label*="readcrumb" i], [class*="breadcrumb" i], [id*="breadcrumb" i], ol[itemtype*="BreadcrumbList"]');
    if (!nav) return [];
    return Array.from(nav.querySelectorAll('a, li, span[itemprop="name"]'))
      .map((n) => text(n.textContent))
      .filter((t) => t && t.length < 60 && !/^(home|›|>|\/|»)$/i.test(t))
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 8);
  }

  function siteName() {
    return meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || '';
  }

  function canonical() {
    const link = document.querySelector('link[rel="canonical"]');
    const href = link ? abs(link.getAttribute('href')) : '';
    if (href) {
      try {
        if (new URL(href).hostname === location.hostname) return href;
      } catch {
        /* ignore */
      }
    }
    return meta('meta[property="og:url"]') && abs(meta('meta[property="og:url"]')) || location.href;
  }

  // ---- assemble ----------------------------------------------------------------
  function extract(hints) {
    const h = hints || safe(() => globalThis.__keepsakeHints) || {};
    const result = {
      title: '', description: '', image: '', images: [], imageAlt: '', price: null, currency: '', priceText: '',
      retailer: '', siteName: '', brand: '', schemaCategory: '', productType: '', tags: [], breadcrumbs: [], availability: '',
      url: location.href, canonicalUrl: '', host: location.hostname.replace(/^www\./, ''), source: 'fallback', signals: [], imageAspect: null,
      isInstagram: /(^|\.)instagram\.com$/.test(location.hostname), sparse: false,
    };
    const images = [];

    const ld = safe(readJsonLd, { product: null, breadcrumbs: [] });
    if (ld?.product) {
      const p = ld.product;
      result.title = text(p.name);
      result.description = text(typeof p.description === 'string' ? p.description : '').slice(0, 1000);
      imagesFrom(p.image, images);
      result.brand = text(typeof p.brand === 'string' ? p.brand : p.brand?.name);
      result.schemaCategory = text(typeof p.category === 'string' ? p.category : p.category?.name);
      const offer = offerFrom(p);
      if (offer.price !== null && offer.price !== undefined && offer.price !== '') {
        result.price = offer.price;
        result.currency = offer.currency;
        result.availability = offer.availability;
      }
      if (result.title) {
        result.source = 'jsonld';
        result.signals.push('jsonld');
      }
    }
    if (ld?.breadcrumbs?.length) result.breadcrumbs = ld.breadcrumbs;

    const ogTitle = meta('meta[property="og:title"]');
    const ogDesc = meta('meta[property="og:description"]') || meta('meta[name="description"]');
    const ogImages = metaAll('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"]').map(abs).filter(Boolean);
    if (ogImages.length) result.signals.push('og');
    if (!result.title && ogTitle) {
      result.title = ogTitle;
      result.source = 'og';
    }
    if (!result.description && ogDesc) result.description = ogDesc.slice(0, 1000);
    images.push(...ogImages);

    const twTitle = meta('meta[name="twitter:title"]');
    const twImage = abs(meta('meta[name="twitter:image"], meta[name="twitter:image:src"]'));
    if (!result.title && twTitle) {
      result.title = twTitle;
      result.source = 'twitter';
    }
    if (twImage) images.push(twImage);

    if (result.price === null || result.price === '') {
      const amount = meta('meta[property="product:price:amount"], meta[property="og:price:amount"], meta[itemprop="price"], meta[name="price"], meta[property="product:sale_price:amount"]');
      const currency = meta('meta[property="product:price:currency"], meta[property="og:price:currency"], meta[itemprop="priceCurrency"], meta[name="currency"]');
      if (amount) {
        result.price = amount;
        result.currency = currency;
        result.signals.push('price-meta');
        if (result.source === 'fallback') result.source = 'price-meta';
      }
    }
    if (!result.brand) result.brand = meta('meta[property="product:brand"], meta[property="og:brand"]');
    if (!result.schemaCategory) result.schemaCategory = meta('meta[property="product:category"]') || safe(() => text(document.querySelector('[itemprop="category"]')?.getAttribute('content') || ''), '');
    const store = safe(readStoreTaxonomy, { productType: '', tags: [] });
    result.productType = store.productType.slice(0, 80);
    result.tags = store.tags;

    const heading = safe(visibleHeading, '');
    if (!result.title || result.title.length < 3) {
      result.title = heading || pageTitle();
      if (result.source === 'fallback' && heading) result.source = 'heading';
    }
    if (result.price === null || result.price === '') {
      const vp = safe(visiblePrice);
      if (vp) {
        result.priceText = vp.text;
        result.currency = result.currency || vp.currency;
        result.signals.push('visible-price');
      }
    } else {
      result.priceText = String(result.price);
      const n = Number(String(result.price).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, ''));
      result.price = Number.isFinite(n) ? n : null;
    }
    if (!result.breadcrumbs.length) result.breadcrumbs = safe(breadcrumbsFromDom, []);

    // Images: hints first, then structured, then visible heuristics.
    if (h.imageUrl) images.unshift(abs(h.imageUrl));
    const visible = safe(() => imageCandidates(12), []);
    const visibleSrcs = visible.map((v) => v.src);
    const ordered = [];
    const seen = new Set();
    for (const src of [...images, ...visibleSrcs]) {
      if (!src || seen.has(src) || BAD_IMG_RE.test(src)) continue;
      seen.add(src);
      ordered.push(src);
    }
    result.images = ordered.slice(0, 6);
    result.image = result.images[0] || '';
    const main = visible.find((v) => v.src === result.image);
    if (main) {
      result.imageAlt = main.alt || '';
      if (main.w && main.h) result.imageAspect = Math.round((main.w / main.h) * 100) / 100;
    }
    if (!result.imageAlt && visible[0]) result.imageAlt = visible[0].alt || '';

    result.siteName = safe(siteName, '');
    result.retailer = result.siteName || '';
    result.canonicalUrl = safe(canonical, location.href);
    if (!result.title) result.title = pageTitle() || location.hostname;
    result.sparse = (result.source === 'fallback' || result.source === 'heading') && !result.priceText && !result.image;
    if (h.selectionText && !result.description) result.description = text(h.selectionText).slice(0, 500);
    if (h.linkUrl) result.linkUrl = abs(h.linkUrl);
    result.pageTitle = pageTitle();
    return result;
  }

  globalThis.__keepsakeExtract = extract;
  return extract();
})();
