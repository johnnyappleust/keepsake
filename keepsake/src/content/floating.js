// Keepsake floating save button. Classic content script registered only on
// sites the user permitted. Depends on detector.js and toast.js being loaded
// first. Renders a single button in a closed Shadow DOM that follows whichever
// product card is hovered or focused. Nothing on the page is modified.

(function keepsakeFloatingModule() {
  if (globalThis.__keepsakeFloating) return;
  const detector = globalThis.__keepsakeDetector;
  const toast = globalThis.__keepsakeToast;
  if (!detector || !toast || !globalThis.chrome?.runtime?.id) return;

  const MSG = {
    SAVE_ITEM: 'keepsake:save-item', UPDATE_ITEM: 'keepsake:update-item', UNDO_SAVE: 'keepsake:undo-save', CLASSIFY: 'keepsake:classify',
    OPEN_DASHBOARD: 'keepsake:open-dashboard', FLOATING_CONFIG: 'keepsake:floating-config', FLOATING_REFRESH: 'keepsake:floating-refresh',
    EXTRACT_TAB: 'keepsake:extract-tab', PAGE_TOAST: 'keepsake:page-toast',
  };
  const SIZES = { small: 28, medium: 34, large: 42 };
  const CSS = `
    :host { all: initial; }
    .btn {
      position: fixed; z-index: 2147483646; display: inline-flex; align-items: center; gap: 6px; height: var(--h, 34px); padding: 0 12px 0 9px;
      border-radius: 999px; border: 1px solid rgba(42,41,38,.12); background: rgba(250,247,241,.96); color: #2A2926; cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: calc(var(--h, 34px) * .38); font-weight: 600; letter-spacing: -.01em; line-height: 1;
      box-shadow: 0 4px 14px rgba(42,41,38,.18), 0 1px 2px rgba(42,41,38,.08); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      opacity: 0; transform: translateY(-4px) scale(.96); transition: opacity .14s ease, transform .14s ease, background .14s ease; pointer-events: none; white-space: nowrap;
    }
    .btn.show { opacity: 1; transform: none; pointer-events: auto; }
    .btn:hover { background: #FFFFFF; }
    .btn:active { transform: scale(.97); }
    .btn:focus-visible { outline: 2px solid #5F6F5E; outline-offset: 2px; }
    .btn.busy { pointer-events: none; opacity: .7; }
    .mark { width: calc(var(--h, 34px) * .56); height: calc(var(--h, 34px) * .56); border-radius: 30%; background: #5F6F5E; display: grid; place-items: center; flex: none; }
    .mark svg { width: 58%; height: 58%; }
    .btn.compact { padding: 0; width: var(--h, 34px); justify-content: center; gap: 0; }
    .btn.compact .label { display: none; }
    @media (prefers-color-scheme: dark) {
      .btn { background: rgba(38,37,31,.96); color: #EFEAE1; border-color: rgba(255,255,255,.1); box-shadow: 0 4px 14px rgba(0,0,0,.4); }
      .btn:hover { background: #33322B; }
      .mark { background: #8A9A88; }
    }
    @media (prefers-reduced-motion: reduce) { .btn { transition: opacity .01s; transform: none !important; } }
  `;

  let config = null; // { enabled, settings: floating settings, collections: [{id,name}], threshold }
  let host = null;
  let button = null;
  let label = null;
  let activeCard = null; // { el, img, link, kind, key }
  let hideTimer = null;
  let rafPending = false;
  let stopObserving = null;
  let listenersBound = false;

  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res || { ok: false, error: 'No response' });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message || e) });
    }
  });

  // ---- setup ------------------------------------------------------------------
  async function loadConfig() {
    const res = await send({ type: MSG.FLOATING_CONFIG, host: location.hostname });
    if (!res || !res.ok) return null;
    return res;
  }

  function ensureButton() {
    if (host && host.isConnected) return;
    host = document.createElement('keepsake-save');
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.zIndex = '2147483646';
    const shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.append(style);
    }
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.setAttribute('aria-label', 'Save to Keepsake');
    button.setAttribute('title', 'Save to Keepsake (Alt+Shift+S)');
    const mark = document.createElement('span');
    mark.className = 'mark';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.2L5 21V4.5a1 1 0 0 1 1-1z');
    path.setAttribute('fill', '#FBF8F2');
    svg.append(path);
    mark.append(svg);
    label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Save';
    button.append(mark, label);
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (activeCard) saveCard(activeCard);
    });
    button.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    button.addEventListener('mouseleave', scheduleHide);
    button.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') hideButton();
    });
    shadow.append(button);
    (document.documentElement || document.body).append(host);
    applySize();
  }

  function applySize() {
    if (!button || !config) return;
    const h = SIZES[config.settings.size] || SIZES.medium;
    button.style.setProperty('--h', `${h}px`);
    button.classList.toggle('compact', config.settings.size === 'small');
  }

  // ---- positioning ----------------------------------------------------------------
  function positionButton() {
    rafPending = false;
    if (!activeCard || !button) return;
    const el = activeCard.kind === 'main' ? activeCard.img : activeCard.el;
    if (!el || !el.isConnected) return hideButton();
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return hideButton();
    const bw = button.offsetWidth || 90;
    const bh = button.offsetHeight || 34;
    const inset = 8;
    const pos = config.settings.position || 'top-right';
    let top = pos.startsWith('top') ? r.top + inset : r.bottom - bh - inset;
    let left = pos.endsWith('right') ? r.right - bw - inset : r.left + inset;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    top = Math.max(4, Math.min(vh - bh - 4, top));
    left = Math.max(4, Math.min(vw - bw - 4, left));
    button.style.top = `${Math.round(top)}px`;
    button.style.left = `${Math.round(left)}px`;
  }

  function requestPosition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(positionButton);
  }

  function showFor(card) {
    clearTimeout(hideTimer);
    ensureButton();
    if (activeCard && activeCard.el === card.el) {
      requestPosition();
      return;
    }
    activeCard = card;
    button.classList.remove('busy');
    positionButton();
    button.classList.add('show');
    window.addEventListener('scroll', requestPosition, { passive: true, capture: true });
    window.addEventListener('resize', requestPosition, { passive: true });
  }

  function hideButton() {
    clearTimeout(hideTimer);
    if (button) button.classList.remove('show');
    activeCard = null;
    window.removeEventListener('scroll', requestPosition, { capture: true });
    window.removeEventListener('resize', requestPosition);
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideButton, 260);
  }

  // ---- pointer + keyboard tracking ----------------------------------------------------
  function onPointerOver(ev) {
    if (!config || !config.enabled) return;
    const target = ev.target;
    if (!(target instanceof Element) || target === host) return;
    const card = detector.resolveCard(target);
    if (card) {
      showFor(card);
    } else if (activeCard) {
      // Still inside the active card? (e.g. hovering a child that resolves to nothing)
      if (activeCard.el.contains(target)) {
        clearTimeout(hideTimer);
        return;
      }
      scheduleHide();
    }
  }

  function onFocusIn(ev) {
    if (!config || !config.enabled) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const card = detector.resolveCard(target);
    if (card) showFor(card);
    else if (activeCard && !activeCard.el.contains(target)) scheduleHide();
  }

  function onKeyDown(ev) {
    if (!config || !config.enabled) return;
    if (ev.altKey && ev.shiftKey && (ev.key === 'S' || ev.key === 's' || ev.code === 'KeyS')) {
      if (!activeCard) {
        const focused = document.activeElement;
        const card = focused ? detector.resolveCard(focused) : null;
        if (card) showFor(card);
      }
      if (activeCard) {
        ev.preventDefault();
        saveCard(activeCard);
      }
    }
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    document.addEventListener('mouseover', onPointerOver, { passive: true, capture: true });
    document.addEventListener('focusin', onFocusIn, { passive: true });
    document.addEventListener('keydown', onKeyDown, true);
    stopObserving = detector.observe(() => {
      if (activeCard && !activeCard.el.isConnected) hideButton();
    });
  }

  function unbindListeners() {
    if (!listenersBound) return;
    listenersBound = false;
    document.removeEventListener('mouseover', onPointerOver, { capture: true });
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('keydown', onKeyDown, true);
    if (stopObserving) stopObserving();
    hideButton();
  }

  // ---- saving ----------------------------------------------------------------------
  async function productFor(card) {
    if (card.kind === 'main') {
      const res = await send({ type: MSG.EXTRACT_TAB });
      if (res && res.ok && res.product) {
        const p = res.product;
        const hovered = detector.bestSrc(card.img);
        if (hovered && p.image !== hovered) p.images = [hovered, ...(p.images || []).filter((s) => s !== hovered)].slice(0, 6);
        return p;
      }
    }
    return detector.extractCard(card);
  }

  function collectionOptions() {
    return (config.collections || []).map((c) => ({ id: c.id, name: c.name }));
  }

  async function saveCard(card) {
    if (!button) return;
    button.classList.add('busy');
    label.textContent = 'Saving…';
    try {
      const product = await productFor(card);
      const s = config.settings;
      if (s.requireConfirm) {
        const cls = await send({ type: MSG.CLASSIFY, product });
        return askConfirm(product, cls && cls.ok ? cls.classification : null);
      }
      const res = await send({ type: MSG.SAVE_ITEM, product, source: 'floating' });
      handleSaveResult(product, res);
    } finally {
      button.classList.remove('busy');
      label.textContent = 'Save';
      hideButton();
    }
  }

  function askConfirm(product, classification, existing) {
    const options = collectionOptions();
    const suggested = classification && !classification.isInbox ? classification.collectionId : (classification?.suggested?.collectionId || options[0]?.id);
    const isNew = classification && classification.isNew && !classification.isInbox;
    if (isNew) options.unshift({ id: `new:${classification.taxonomyKey}`, name: `${classification.collectionName} (new collection)` });
    toast.show({
      title: `Save “${shorten(product.title, 60)}”?`,
      message: classification ? `Suggested: ${classification.collectionName}${classification.isInbox ? ' (not sure where this belongs)' : ''}` : 'Choose a collection',
      picker: { options, selectedId: isNew ? `new:${classification.taxonomyKey}` : suggested, label: 'Collection' },
      duration: 20000,
      actions: [
        { label: 'Save', primary: true, onClick: async ({ pickedId }) => {
          const res = await send({ type: MSG.SAVE_ITEM, product, collectionId: pickedId, source: 'floating', force: !!existing });
          handleSaveResult(product, res, { manual: true });
        } },
        { label: 'Cancel', quiet: true },
      ],
    });
  }

  function handleSaveResult(product, res, { manual = false } = {}) {
    if (!res || !res.ok) {
      toast.show({ title: 'Couldn’t save', message: res && res.error ? res.error : 'Keepsake could not reach its storage. Try reloading the page.' });
      return;
    }
    if (res.duplicate) {
      const ex = res.existing;
      toast.show({
        title: 'Already in Keepsake',
        message: `Saved ${ex.collectionName ? 'in ' + ex.collectionName : 'earlier'}. Update it with the current price and image, or save another copy.`,
        duration: 12000,
        actions: [
          { label: 'Update existing', primary: true, onClick: async () => {
            const up = await send({ type: MSG.UPDATE_ITEM, itemId: ex.id, patch: { price: product.price, priceText: product.priceText, currency: product.currency, image: product.image, images: product.images, title: product.title } });
            toast.show({ title: up && up.ok ? 'Updated' : 'Couldn’t update', message: up && up.ok ? `“${shorten(ex.title || product.title, 60)}” now has the latest details.` : (up && up.error) || '' });
          } },
          { label: 'Save another copy', onClick: async () => {
            const again = await send({ type: MSG.SAVE_ITEM, product, source: 'floating', force: true });
            handleSaveResult(product, again);
          } },
          { label: 'Open', quiet: true, onClick: () => send({ type: MSG.OPEN_DASHBOARD, hash: `#item/${ex.id}` }) },
        ],
      });
      return;
    }
    const item = res.item;
    const col = res.collection;
    const cls = res.classification || {};
    const options = collectionOptions();
    if (cls.isInbox && !manual) {
      toast.show({
        title: 'Not sure — saved for review',
        message: cls.suggested ? `Not sure where this belongs — maybe ${cls.suggested.collectionName}? Pick a collection or sort it later.` : 'Not sure where this belongs. Pick a collection now or sort it later.',
        picker: { options, selectedId: cls.suggested?.collectionId || options[0]?.id, label: 'Move to collection' },
        duration: 12000,
        actions: [
          { label: 'Move', primary: true, onClick: async ({ pickedId }) => {
            const up = await send({ type: MSG.UPDATE_ITEM, itemId: item.id, patch: { collectionId: pickedId }, learn: 'light' });
            toast.show({ title: up && up.ok ? `Moved to ${nameOf(pickedId)}` : 'Couldn’t move', message: up && up.ok ? 'Keepsake will remember this for similar items.' : (up && up.error) || '' });
          } },
          { label: 'Undo', quiet: true, onClick: () => send({ type: MSG.UNDO_SAVE, itemId: item.id }) },
        ],
      });
      return;
    }
    toast.show({
      title: `Saved to ${col ? col.name : 'Keepsake'}`,
      message: shorten(item.title, 70),
      actions: [
        { label: 'Undo', onClick: async () => {
          const r = await send({ type: MSG.UNDO_SAVE, itemId: item.id });
          toast.show({ title: r && r.ok ? 'Removed' : 'Couldn’t undo', message: r && r.ok ? 'The item was removed from Keepsake.' : (r && r.error) || '', duration: 3000 });
        } },
        { label: 'Edit', quiet: true, onClick: () => send({ type: MSG.OPEN_DASHBOARD, hash: `#item/${item.id}` }) },
      ],
    });
  }

  function nameOf(id) {
    const c = (config.collections || []).find((x) => x.id === id);
    return c ? c.name : 'collection';
  }

  function shorten(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ---- lifecycle -----------------------------------------------------------------------
  async function start() {
    config = await loadConfig();
    if (!config || !config.enabled) {
      unbindListeners();
      return;
    }
    ensureButton();
    applySize();
    bindListeners();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === MSG.FLOATING_REFRESH) {
      start();
      sendResponse({ ok: true });
    } else if (msg.type === MSG.PAGE_TOAST && msg.toast) {
      toast.show(sanitizeToast(msg.toast));
      sendResponse({ ok: true });
    }
  });

  function sanitizeToast(t) {
    return { title: String(t.title || 'Keepsake').slice(0, 120), message: String(t.message || '').slice(0, 300), duration: Number(t.duration) || 6000 };
  }

  globalThis.__keepsakeFloating = { start, stop: unbindListeners };
  start();
})();
