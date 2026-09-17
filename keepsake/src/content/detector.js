// Keepsake product-card detector. Classic script; exposes globalThis.__keepsakeDetector.
//
// Detection is on-demand: floating.js calls resolveCard(element) for whatever
// the pointer is over, so the page is never scanned wholesale. Results are
// cached per element in a WeakMap that the (throttled) MutationObserver resets.
//
// Signals used, roughly in order of strength:
//   schema.org Product microdata, product data-* attributes, product-ish class
//   names, a link + image + nearby price, image size and prominence,
//   add-to-cart controls, repeated grid structures, and page-level metadata.

(function keepsakeDetectorModule() {
  if (globalThis.__keepsakeDetector) return;

  const PRICE_RE = /(?:(?:US|CA|AU|NZ|HK|S|R|MX)?\$|€|£|¥|₹|₩|₺|₽|₪|฿)\s?\d{1,3}(?:[ .,\u202f]?\d{3})*(?:[.,]\d{1,2})?|\d{1,3}(?:[ .,\u202f]?\d{3})*(?:[.,]\d{1,2})?\s?(?:€|£|zł|kr|CHF|USD|EUR|GBP|CAD|AUD)\b/;
  const BAD_IMG_RE = /(logo|sprite|icon|favicon|avatar|pixel|badge|spinner|loading|placeholder|blank\.|1x1|tracking|\/ads?\/|banner|flag|payment|visa|mastercard|paypal|\.svg(\?|$)|\.gif(\?|$))/i;
  const BAD_CONTAINER = 'header, nav, footer, aside[class*="nav"], [role="navigation"], [role="banner"], [role="contentinfo"], [role="dialog"], [class*="logo"], [id*="logo"], [class*="cookie"], [class*="newsletter"], [class*="site-header"], [class*="site-footer"], [class*="mega-menu"], [class*="megamenu"], [class*="breadcrumb"], [class*="avatar"], [class*="profile-pic"], [class*="advert"], [id*="advert"], [class*="sponsored"], [data-ad], [id^="google_ads"], iframe';
  const STRONG_CARD = '[itemtype*="schema.org/Product" i], [itemtype*="schema.org/IndividualProduct" i], [data-product-id], [data-productid], [data-sku], [data-asin], [data-product], [data-product-card], [data-testid*="product-card" i], [data-testid*="product-tile" i], [data-testid*="productcard" i], [data-component*="product" i], [class*="product-card" i], [class*="productcard" i], [class*="product-tile" i], [class*="producttile" i], [class*="product-item" i], [class*="productitem" i], [class*="product-grid-item" i], [class*="listing-card" i], [class*="item-card" i], [class*="plp-card" i], [class*="search-result-item" i], [class*="s-result-item"], [class*="grid-product" i], [class*="grid__item" i], li.product, article[class*="product" i]';
  const PRODUCT_LINK_RE = /\/(dp|gp\/product|products?|item|items|listing|p|pd|prod|shop|buy|goods|sku|itm|ip|detail|details|pdp)\/|[?&](product|sku|pid|productid|itemid|asin|variant)=/i;
  const MIN_IMG = 96;

  const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
  const abs = (u) => {
    if (!u || typeof u !== 'string') return '';
    try {
      const url = new URL(u.trim(), location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href.split('#')[0] : '';
    } catch {
      return '';
    }
  };

  let cache = new WeakMap();
  let pageSignalsCache = null;

  function resetCache() {
    cache = new WeakMap();
    pageSignalsCache = null;
  }

  // Page-level: does this look like a product-detail page?
  function pageSignals() {
    if (pageSignalsCache) return pageSignalsCache;
    let jsonldProduct = false;
    try {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        if (/"@type"\s*:\s*"?(\[[^\]]*)?"?(Product|ProductGroup|IndividualProduct)"/i.test(s.textContent || '')) {
          jsonldProduct = true;
          break;
        }
      }
    } catch {
      /* ignore */
    }
    const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content') || '';
    const addToCart = !!document.querySelector('button[name*="add" i][name*="cart" i], [id*="add-to-cart" i], [id*="addtocart" i], [class*="add-to-cart" i], [class*="addtocart" i], [data-testid*="add-to-cart" i], button[aria-label*="add to cart" i], button[aria-label*="add to bag" i], input[name="add"], form[action*="/cart/add"]');
    const priceMeta = !!document.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"], [itemprop="price"]');
    const structured = jsonldProduct || /product/i.test(ogType) || priceMeta;
    pageSignalsCache = { pdp: structured || addToCart, structured, jsonldProduct, addToCart };
    return pageSignalsCache;
  }

  function bestSrc(img) {
    const cur = img.currentSrc || '';
    if (cur && !cur.startsWith('data:')) return abs(cur);
    const set = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (set) {
      const best = set.split(',').map((s) => s.trim().split(/\s+/)).filter((p) => p[0]).map((p) => ({ url: p[0], w: parseFloat(p[1]) || 0 })).sort((a, b) => b.w - a.w)[0];
      if (best) return abs(best.url);
    }
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.getAttribute('data-image');
    if (lazy && !lazy.startsWith('data:')) return abs(lazy);
    const src = img.getAttribute('src') || '';
    return src.startsWith('data:') ? '' : abs(src);
  }

  function imageOk(img) {
    if (!img || img.tagName !== 'IMG') return false;
    const src = bestSrc(img);
    if (!src || BAD_IMG_RE.test(src)) return false;
    if (/logo|icon|avatar|badge/i.test(img.getAttribute('alt') || '')) return false;
    const r = img.getBoundingClientRect();
    const w = r.width || img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const h = r.height || img.naturalHeight || Number(img.getAttribute('height')) || 0;
    if (w < MIN_IMG || h < MIN_IMG) return false;
    if (w / Math.max(h, 1) > 4 || h / Math.max(w, 1) > 4) return false; // banners / strips
    if (img.closest(BAD_CONTAINER)) return false;
    return true;
  }

  function qualifyingImages(el, limit = 6) {
    const out = [];
    for (const img of el.querySelectorAll('img')) {
      if (imageOk(img)) {
        out.push(img);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  function productLink(el) {
    const links = el.querySelectorAll('a[href]');
    let fallback = null;
    for (const a of links) {
      const href = abs(a.getAttribute('href'));
      if (!href) continue;
      if (PRODUCT_LINK_RE.test(href)) return a;
      if (!fallback && !/^(javascript:|#|mailto:)/i.test(a.getAttribute('href') || '') && a.querySelector('img')) fallback = a;
    }
    if (fallback) return fallback;
    const self = el.closest('a[href]');
    if (self && abs(self.getAttribute('href'))) return self;
    return links[0] && abs(links[0].getAttribute('href')) ? links[0] : null;
  }

  function priceText(el) {
    const priceEls = el.querySelectorAll('[itemprop="price"], [data-price], [class*="price" i]:not([class*="strike" i]):not([class*="was" i]):not([class*="old" i]):not([class*="compare" i]):not([class*="rrp" i]), [data-testid*="price" i]');
    for (const p of priceEls) {
      const attr = p.getAttribute('content') || p.getAttribute('data-price');
      if (attr && /^\d/.test(attr)) return attr;
      const t = text(p.textContent);
      const m = t.match(PRICE_RE);
      if (m && !p.closest('del, s, strike')) return m[0];
    }
    const t = text(el.textContent).slice(0, 600);
    const m = t.match(PRICE_RE);
    return m ? m[0] : '';
  }

  function isBadContainer(el) {
    return !!el.closest(BAD_CONTAINER);
  }

  function rectOf(el) {
    return el.getBoundingClientRect();
  }

  // Evaluate whether `el` is itself a product card.
  function scoreCard(el) {
    if (!(el instanceof Element) || isBadContainer(el)) return null;
    if (/^(MAIN|BODY|HTML|HEADER|FOOTER|NAV|FORM|TABLE|UL|OL)$/.test(el.tagName) || el.getAttribute('role') === 'main') return null;
    const r = rectOf(el);
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    if (r.width < 110 || r.height < 110) return null;
    if (r.width > vw * 0.92 && r.height > vh * 1.6) return null; // page-sized wrappers
    const imgs = qualifyingImages(el, 4);
    if (!imgs.length) return null;
    const strong = el.matches(STRONG_CARD);
    // grid wrappers contain many product images; a card has one or a few
    if (imgs.length > 3 && !strong) return null;
    const link = productLink(el);
    const price = priceText(el);
    const textLen = text(el.textContent).length;
    if (textLen > 1500 && !strong) return null;
    let score = 0;
    if (strong) score += 4;
    if (link) score += 2;
    if (price) score += 2;
    if (link && PRODUCT_LINK_RE.test(link.href || '')) score += 1;
    if (el.querySelector('h2, h3, h4, [class*="title" i], [class*="name" i], [itemprop="name"]')) score += 1;
    if (el.querySelector('[class*="add-to-cart" i], [class*="addtocart" i], button[aria-label*="add to" i], [class*="quick-add" i], [class*="quickadd" i], [class*="wishlist" i]')) score += 1;
    if (el.parentElement && Array.from(el.parentElement.children).filter((c) => c !== el && c.tagName === el.tagName && c.className === el.className).length >= 2) score += 1; // repeated siblings
    if (score < 3) return null;
    return { el, img: imgs[0], link, price, score, kind: 'card' };
  }

  // Walk up from the hovered element and pick the smallest ancestor that looks like a card.
  function resolveCard(target) {
    if (!(target instanceof Element)) return null;
    if (cache.has(target)) return cache.get(target);
    // On pages with structured product data a large gallery image wins over
    // any wrapper; looser signals (an add-to-cart button) only apply when no
    // card was found, because listing pages have quick-add buttons too.
    let result = resolveMainImage(target, true);
    let node = target;
    let depth = 0;
    while (!result && node && node !== document.body && depth < 10) {
      if (cache.has(node) && cache.get(node) !== undefined && depth > 0) {
        result = cache.get(node);
        break;
      }
      const hit = scoreCard(node);
      if (hit) {
        result = hit;
        // The first hit is often just the image link; keep climbing a few
        // levels while an ancestor scores higher (title + price + card class).
        let up = node.parentElement;
        let extra = 0;
        while (up && up !== document.body && extra < 4) {
          const better = scoreCard(up);
          if (better && better.score > result.score) result = better;
          else if (!better) break;
          up = up.parentElement;
          extra++;
        }
        break;
      }
      node = node.parentElement;
      depth++;
    }
    if (!result) result = resolveMainImage(target, false);
    if (result) {
      result.key = (result.kind === 'main' ? location.href.split('#')[0] : (result.link && abs(result.link.getAttribute('href'))) || bestSrc(result.img)) || '';
    }
    cache.set(target, result);
    return result;
  }

  // Product-detail page: hovering the main product image (large, prominent) counts.
  function resolveMainImage(target, strict) {
    const img = target.tagName === 'IMG' ? target : target.querySelector?.(':scope > img') || target.closest('picture, [class*="gallery" i], [class*="product-image" i], [class*="media" i]')?.querySelector('img');
    if (!img || !imageOk(img)) return null;
    const r = rectOf(img);
    if (r.width < 260 || r.height < 260) return null;
    const signals = pageSignals();
    if (strict ? !signals.structured : !signals.pdp) return null;
    if (r.top > (window.innerHeight || 800) * 1.5 && !img.closest('[class*="gallery" i], [class*="product-image" i], [class*="pdp" i], main')) return null;
    return { el: img.closest('picture, figure, [class*="gallery" i], [class*="product-image" i], [class*="media" i]') || img, img, link: null, price: '', score: 5, kind: 'main' };
  }

  function siteName() {
    return text(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')) || '';
  }

  // Build a product description for one card (never the whole page).
  function extractCard(card) {
    const el = card.el;
    const img = card.img;
    const link = card.link;
    const headingEl = el.querySelector('h1, h2, h3, h4, [itemprop="name"], [class*="product-title" i], [class*="product-name" i], [class*="producttitle" i], [class*="productname" i], [class*="title" i], [class*="name" i], [data-testid*="title" i], [data-testid*="name" i]');
    let title = text(headingEl?.textContent);
    if (!title || title.length < 3 || title.length > 200) title = text(img?.getAttribute('alt'));
    if (!title || title.length < 3) title = text(link?.getAttribute('title') || link?.getAttribute('aria-label'));
    if (!title || title.length < 3) title = text(link?.textContent).slice(0, 160);
    if (!title || title.length < 3) title = text(document.title);
    const brandEl = el.querySelector('[class*="brand" i], [itemprop="brand"], [data-testid*="brand" i]');
    const rawPrice = card.price || priceText(el);
    const href = link ? abs(link.getAttribute('href')) : '';
    const images = [];
    for (const i of qualifyingImages(el, 6)) {
      const s = bestSrc(i);
      if (s && !images.includes(s)) images.push(s);
    }
    const main = bestSrc(img);
    const ordered = [main, ...images.filter((s) => s !== main)].filter(Boolean);
    const aspect = img && img.naturalWidth && img.naturalHeight ? Math.round((img.naturalWidth / img.naturalHeight) * 100) / 100 : null;
    return {
      title: title.slice(0, 200),
      description: '',
      image: ordered[0] || '',
      images: ordered.slice(0, 6),
      imageAlt: text(img?.getAttribute('alt')).slice(0, 200),
      imageAspect: aspect,
      priceText: rawPrice,
      price: null,
      currency: text(el.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') || ''),
      brand: text(brandEl?.textContent).slice(0, 80),
      cardText: text(el.textContent).slice(0, 500),
      url: href || location.href.split('#')[0],
      canonicalUrl: href || '',
      sourceUrl: location.href.split('#')[0],
      pageUrl: location.href.split('#')[0],
      host: location.hostname.replace(/^www\./, ''),
      retailer: siteName(),
      source: 'card',
      kind: card.kind,
    };
  }

  function observe(onChange) {
    if (!document.documentElement) return () => {};
    let timer = null;
    const observer = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        resetCache();
        onChange && onChange();
      }, 600);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }

  globalThis.__keepsakeDetector = { resolveCard, extractCard, scoreCard, imageOk, pageSignals, resetCache, observe, bestSrc };
})();
