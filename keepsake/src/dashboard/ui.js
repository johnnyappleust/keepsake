// Dashboard UI primitives: modal dialogs, toasts and a few helpers.
// Everything is built with el() — no HTML strings, no innerHTML.

import { el, clear } from '../shared/util.js';

const modalRoot = () => document.getElementById('modalRoot');
const toastRoot = () => document.getElementById('toasts');

let openModals = 0;
let lastFocus = null;

// Opens a modal. `body` is a node or array of nodes; `actions` is a list of
// { label, primary, danger, quiet, onClick(close), autofocus } definitions,
// or { label, href, icon, target, rel } to render a real link (e.g. "Visit page").
// Resolves when the modal closes with whatever value close() was given.
export function openModal({ title, body, actions = [], wide = false, onClose = null, closeOnScrim = true, describedBy = '' }) {
  return new Promise((resolve) => {
    const root = modalRoot();
    if (openModals === 0) lastFocus = document.activeElement;
    openModals++;
    const id = `modal-${Date.now()}-${openModals}`;
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      openModals = Math.max(0, openModals - 1);
      overlay.remove();
      if (openModals === 0) {
        root.hidden = true;
        document.body.classList.remove('modal-open');
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
      }
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose(value);
      resolve(value);
    };
    const onKey = (e) => {
      if (overlay !== root.lastElementChild) return; // a dialog opened on top handles its own keys
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(undefined);
      } else if (e.key === 'Tab') {
        const focusables = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const actionNodes = actions.map((a) => (a.href
      ? el('a', {
        class: `btn ${a.primary ? 'btn-primary' : ''} ${a.quiet ? 'btn-quiet' : ''}`.trim(),
        href: a.href,
        target: a.target || '_blank',
        rel: a.rel || 'noopener noreferrer',
      }, a.icon ? [a.icon, a.label] : [a.label])
      : el('button', {
        type: 'button',
        class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''} ${a.quiet ? 'btn-quiet' : ''}`.trim(),
        disabled: !!a.disabled,
        onClick: async (ev) => {
          if (a.onClick) {
            const btn = ev.currentTarget;
            btn.disabled = true;
            try {
              const r = await a.onClick(close, btn);
              if (r !== false && !closed && a.closes !== false) close(a.value);
            } catch (err) {
              showModalError(dialog, err);
            } finally {
              if (!closed) btn.disabled = false;
            }
          } else close(a.value);
        },
      }, [a.label])));
    const dialog = el('div', { class: `modal ${wide ? 'modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-title`, 'aria-describedby': describedBy || null }, [
      el('div', { class: 'modal-head' }, [
        el('h2', { id: `${id}-title`, class: 'modal-title' }, [title]),
        el('button', { type: 'button', class: 'btn btn-icon btn-quiet modal-close', 'aria-label': 'Close', onClick: () => close(undefined) }, [closeIcon()]),
      ]),
      el('div', { class: 'modal-body' }, Array.isArray(body) ? body : [body]),
      el('div', { class: 'modal-error notice notice-danger hidden', role: 'alert' }),
      actionNodes.length ? el('div', { class: 'modal-actions' }, actionNodes) : null,
    ]);
    const overlay = el('div', { class: 'modal-overlay', onClick: (e) => { if (closeOnScrim && e.target === overlay) close(undefined); } }, [dialog]);
    root.hidden = false;
    document.body.classList.add('modal-open');
    root.append(overlay);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
      const auto = actions.findIndex((a) => a.autofocus);
      const target = auto >= 0 ? actionNodes[auto] : dialog.querySelector('input, textarea, select') || actionNodes.find((n) => n.classList.contains('btn-primary')) || actionNodes[0] || dialog.querySelector('.modal-close');
      if (target) target.focus();
    });
    dialog.close = close;
  });
}

function showModalError(dialog, err) {
  const box = dialog.querySelector('.modal-error');
  if (!box) return;
  box.textContent = String((err && err.message) || err || 'Something went wrong.');
  box.classList.remove('hidden');
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel', extra = null }) {
  const body = [el('p', { class: 'modal-text' }, [message])];
  if (extra) body.push(extra);
  return openModal({
    title,
    body,
    actions: [
      { label: cancelLabel, quiet: true, value: false },
      { label: confirmLabel, primary: !danger, danger, value: true, autofocus: !danger },
    ],
  }).then((v) => v === true);
}

// A confirmation that requires typing a word (used for "Delete all local data").
export function typedConfirm({ title, message, word, confirmLabel = 'Delete' }) {
  const input = el('input', { class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Type ${word} to confirm` });
  const body = [
    el('p', { class: 'modal-text' }, [message]),
    el('label', { class: 'label' }, [`Type ${word} to confirm`]),
    input,
  ];
  return openModal({
    title,
    body,
    actions: [
      { label: 'Cancel', quiet: true, value: false },
      { label: confirmLabel, danger: true, value: true, onClick: (close) => {
        if (input.value.trim() !== word) {
          input.focus();
          throw new Error(`Type ${word} exactly to continue.`);
        }
        close(true);
        return false;
      } },
    ],
  }).then((v) => v === true);
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save', maxlength = 80, help = '' }) {
  const input = el('input', { class: 'input', type: 'text', placeholder, maxlength: String(maxlength), 'aria-label': label });
  input.value = value;
  const body = [el('label', { class: 'label' }, [label]), input, help ? el('p', { class: 'help' }, [help]) : null];
  const p = openModal({
    title,
    body,
    actions: [
      { label: 'Cancel', quiet: true, value: null },
      { label: confirmLabel, primary: true, onClick: (close) => {
        const v = input.value.trim();
        if (!v) {
          input.focus();
          throw new Error('Please enter a value.');
        }
        close(v);
        return false;
      } },
    ],
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const primary = input.closest('.modal').querySelector('.modal-actions .btn-primary');
      if (primary) primary.click();
    }
  });
  return p;
}

// Toasts ---------------------------------------------------------------------------
// Every toast stays up this much longer than the duration it asks for.
const TOAST_TIME_SCALE = 1.25;

export function toast(message, { action = null, duration = 5000, kind = '' } = {}) {
  const root = toastRoot();
  if (!root) return;
  let timer = null;
  const node = el('div', { class: `toast ${kind ? 'toast-' + kind : ''}`, role: 'status' }, [
    el('span', { class: 'toast-text' }, [message]),
    action ? el('button', { type: 'button', class: 'btn btn-sm toast-action', onClick: async () => {
      clearTimeout(timer);
      try {
        await action.onClick();
      } finally {
        dismiss();
      }
    } }, [action.label]) : null,
    el('button', { type: 'button', class: 'btn btn-icon btn-quiet toast-close', 'aria-label': 'Dismiss', onClick: () => dismiss() }, [closeIcon()]),
  ]);
  const dismiss = () => {
    node.classList.add('toast-out');
    setTimeout(() => node.remove(), 180);
  };
  root.append(node);
  while (root.children.length > 3) root.firstChild.remove();
  timer = setTimeout(dismiss, duration * TOAST_TIME_SCALE);
  return dismiss;
}

// Icons ----------------------------------------------------------------------------
function svg(paths, { size = 24, stroke = true } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${size} ${size}`);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', stroke ? 'none' : 'currentColor');
  if (stroke) {
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
  }
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

export function closeIcon() {
  return svg(['M6 6l12 12M18 6 6 18']);
}
export function starIcon(filled = false) {
  const s = svg(['m12 3.8 2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.8l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7L12 3.8Z'], { stroke: true });
  s.setAttribute('stroke-width', '1.8');
  if (filled) s.setAttribute('fill', 'currentColor');
  return s;
}
export function moreIcon() {
  return svg(['M5 12h.01M12 12h.01M19 12h.01']);
}
export function checkIcon() {
  return svg(['m5 12.5 4.5 4.5L19 7.5']);
}
export function externalIcon() {
  return svg(['M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5']);
}
export function bagIcon() {
  return svg(['M6 8h12l1 12H5L6 8ZM9 8V6a3 3 0 0 1 6 0v2']);
}
export function instagramIcon() {
  return svg(['M4 4h16v16H4z', 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z', 'M17 7h.01']);
}
export function pencilIcon() {
  return svg(['M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z', 'm13.5 6.5 3 3']);
}
export function trashIcon() {
  return svg(['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6']);
}
export function pinIcon(filled = false) {
  const s = svg(['M9 4h6l-1 6 3 3v1.5H7V13l3-3-1-6Z', 'M12 14.5V20']);
  if (filled) s.querySelector('path').setAttribute('fill', 'currentColor');
  return s;
}
export function folderIcon() {
  return svg(['M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V7Z']);
}
export function expandIcon() {
  return svg(['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7']);
}
export function collapseIcon() {
  return svg(['M4 14h6v6', 'M20 10h-6V4', 'M14 10l7-7', 'M3 21l7-7']);
}

// Helpers --------------------------------------------------------------------------
export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileText(file, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected.'));
    if (file.size > maxBytes) return reject(new Error(`That file is too large (${Math.round(file.size / 1048576)} MB). The limit is ${Math.round(maxBytes / 1048576)} MB.`));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsText(file);
  });
}

export function initialFor(text) {
  const t = String(text || '').trim();
  const m = t.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '·';
}

// Image with graceful fallback to a text placeholder.
export function pictureNode({ src, alt = '', aspect = null, title = '', className = '' }) {
  const box = el('div', { class: `pic ${className}`.trim() });
  if (aspect) box.style.aspectRatio = String(Math.max(0.5, Math.min(2.2, aspect)));
  const placeholder = el('div', { class: 'pic-placeholder', 'aria-hidden': 'true' }, [
    el('span', { class: 'pic-initial' }, [initialFor(title)]),
    el('span', { class: 'pic-title' }, [String(title || '').slice(0, 90)]),
  ]);
  if (!src) {
    box.classList.add('pic-empty');
    box.append(placeholder);
    return box;
  }
  const img = el('img', { src, alt, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => {
    img.remove();
    box.classList.add('pic-empty');
    box.append(placeholder);
  });
  img.addEventListener('load', () => {
    if (!aspect && img.naturalWidth && img.naturalHeight) box.style.aspectRatio = String(Math.max(0.5, Math.min(2.2, img.naturalWidth / img.naturalHeight)));
  });
  box.append(img);
  return box;
}

export function section(title, description, children, { id = '' } = {}) {
  return el('section', { class: 'card-section', id: id || null }, [
    el('div', { class: 'card-section-head' }, [
      el('h2', { class: 'card-section-title' }, [title]),
      description ? el('p', { class: 'card-section-desc' }, [description]) : null,
    ]),
    el('div', { class: 'card-section-body' }, children),
  ]);
}

export function settingRow(label, control, help = '') {
  return el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-text' }, [
      el('div', { class: 'setting-label' }, [label]),
      help ? el('div', { class: 'help' }, [help]) : null,
    ]),
    el('div', { class: 'setting-control' }, Array.isArray(control) ? control : [control]),
  ]);
}

export function switchInput({ checked, onChange, label }) {
  const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked, input));
  return el('label', { class: 'switch' }, [input]);
}

export function selectInput({ value, options, onChange, label }) {
  const sel = el('select', { class: 'select', 'aria-label': label });
  for (const o of options) sel.append(el('option', { value: o.value, text: o.label }));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value, sel));
  return sel;
}

export function emptyState({ title, message, actions = [], icon = null }) {
  return el('div', { class: 'empty-state' }, [
    icon ? el('div', { class: 'empty-state-icon' }, [icon]) : null,
    el('h2', { class: 'empty-state-title' }, [title]),
    message ? el('p', { class: 'empty-state-text' }, [message]) : null,
    actions.length ? el('div', { class: 'empty-state-actions' }, actions) : null,
  ]);
}

export { clear };
