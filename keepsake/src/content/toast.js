// Keepsake in-page toast. Classic script; exposes globalThis.__keepsakeToast.
// Rendered inside a closed Shadow DOM with adopted stylesheets so host page CSS
// cannot leak in and ours cannot leak out. All text is set via textContent.

(function keepsakeToastModule() {
  if (globalThis.__keepsakeToast) return;

  const CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; max-width: min(380px, calc(100vw - 40px));
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 13.5px; line-height: 1.4;
      color: #2A2926; pointer-events: none;
    }
    .toast {
      pointer-events: auto; background: #F7F3EC; border: 1px solid #E1DACE; border-radius: 12px; padding: 12px 14px 12px 14px;
      box-shadow: 0 10px 30px rgba(42,41,38,.16), 0 1px 2px rgba(42,41,38,.08); display: grid; gap: 8px; min-width: 240px;
      transform: translateY(8px); opacity: 0; transition: transform .18s ease, opacity .18s ease;
    }
    .toast.in { transform: none; opacity: 1; }
    .row { display: flex; align-items: flex-start; gap: 10px; }
    .mark { width: 22px; height: 22px; flex: none; border-radius: 6px; background: #8A9A88; display: grid; place-items: center; margin-top: 1px; }
    .mark svg { width: 13px; height: 13px; }
    .title { font-weight: 600; letter-spacing: -.01em; }
    .msg { color: #5D5A54; margin-top: 2px; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; padding-left: 32px; }
    button, select {
      font: inherit; font-size: 12.5px; border-radius: 8px; border: 1px solid #D8D1C5; background: #FFFDF9; color: #2A2926; padding: 5px 10px; cursor: pointer;
    }
    button:hover { background: #F0EBE2; }
    button:focus-visible, select:focus-visible { outline: 2px solid #5F6F5E; outline-offset: 1px; }
    button.primary { background: #5F6F5E; border-color: #5F6F5E; color: #FBF8F2; }
    button.primary:hover { background: #4F5E4E; }
    button.quiet { border-color: transparent; background: transparent; color: #5D5A54; }
    button.quiet:hover { background: #EEE8DE; }
    select { max-width: 200px; }
    .close { position: absolute; top: 6px; right: 6px; border: 0; background: transparent; width: 26px; height: 26px; padding: 0; border-radius: 6px; color: #8B867C; }
    .toast { position: relative; }
    @media (prefers-color-scheme: dark) {
      .wrap { color: #EFEAE1; }
      .toast { background: #26251F; border-color: #3A382F; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
      .msg { color: #B5AFA3; }
      button, select { background: #2F2E27; border-color: #46443B; color: #EFEAE1; }
      button:hover { background: #3A382F; }
      button.primary { background: #8A9A88; border-color: #8A9A88; color: #1C1B19; }
      button.primary:hover { background: #9BAB99; }
      button.quiet { color: #B5AFA3; }
      button.quiet:hover { background: #33322B; }
      .close { color: #9A948A; }
    }
    @media (prefers-reduced-motion: reduce) { .toast { transition: none; transform: none; } }
  `;

  let host = null;
  let shadow = null;
  let wrap = null;
  let current = null;
  let hideTimer = null;

  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('keepsake-toast');
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.setAttribute('aria-live', 'polite');
    shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.append(style);
    }
    wrap = document.createElement('div');
    wrap.className = 'wrap';
    shadow.append(wrap);
    (document.documentElement || document.body).append(host);
  }

  function markSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.2L5 21V4.5a1 1 0 0 1 1-1z');
    path.setAttribute('fill', '#FBF8F2');
    svg.append(path);
    return svg;
  }

  function hide() {
    clearTimeout(hideTimer);
    if (!current) return;
    const node = current;
    current = null;
    node.classList.remove('in');
    setTimeout(() => node.remove(), 200);
  }

  // show({ title, message, actions: [{ label, primary, quiet, onClick }], picker: { options: [{id,name}], selectedId, label }, duration })
  function show(opts) {
    ensure();
    hide();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    const row = document.createElement('div');
    row.className = 'row';
    const mark = document.createElement('div');
    mark.className = 'mark';
    mark.append(markSvg());
    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = opts.title || 'Keepsake';
    body.append(title);
    if (opts.message) {
      const msg = document.createElement('div');
      msg.className = 'msg';
      msg.textContent = opts.message;
      body.append(msg);
    }
    row.append(mark, body);
    toast.append(row);

    let pickerEl = null;
    if (opts.picker && Array.isArray(opts.picker.options) && opts.picker.options.length) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      pickerEl = document.createElement('select');
      pickerEl.setAttribute('aria-label', opts.picker.label || 'Collection');
      for (const o of opts.picker.options) {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name;
        if (o.id === opts.picker.selectedId) opt.selected = true;
        pickerEl.append(opt);
      }
      actions.append(pickerEl);
      toast.append(actions);
    }
    if (Array.isArray(opts.actions) && opts.actions.length) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      for (const a of opts.actions) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = a.label;
        if (a.primary) b.classList.add('primary');
        if (a.quiet) b.classList.add('quiet');
        b.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          try {
            a.onClick && a.onClick({ pickedId: pickerEl ? pickerEl.value : null, close: hide });
          } finally {
            if (!a.keepOpen) hide();
          }
        });
        actions.append(b);
      }
      toast.append(actions);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', hide);
    toast.append(close);

    wrap.append(toast);
    current = toast;
    requestAnimationFrame(() => toast.classList.add('in'));
    const duration = Number.isFinite(opts.duration) ? opts.duration : 6500;
    if (duration > 0) {
      hideTimer = setTimeout(hide, duration);
      toast.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      toast.addEventListener('mouseleave', () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 2500);
      });
    }
    if (opts.focus && pickerEl) pickerEl.focus();
    return { close: hide };
  }

  globalThis.__keepsakeToast = { show, hide };
})();
