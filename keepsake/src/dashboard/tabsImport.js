// Tab import: read every tab open in the current browser window, extract
// whatever product each page exposes (the same reader the toolbar popup
// uses), and offer a review screen before anything is saved. Like the
// Instagram importer, nothing is sent anywhere and nothing is saved until
// the user presses Import.

import { MSG } from '../shared/messages.js';
import { el, clear, pluralize, formatPrice, parsePrice } from '../shared/util.js';
import { classify } from '../shared/categorizer.js';
import { isRestrictedUrl } from '../shared/url.js';
import * as UI from './ui.js';

const ALL_SITES = '*://*/*';
const NONE = '__none'; // leave uncategorized, for Review

// selection persists across re-renders within the same dashboard session:
// tabId -> { selected, collectionId, defaultChoice, touched }
const selection = new Map();
const scan = { rows: null, scanning: false, progress: null, error: '' };

async function hasAllSitesAccess() {
  try {
    const p = await chrome.permissions.getAll();
    const o = p.origins || [];
    return o.includes(ALL_SITES) || o.includes('<all_urls>');
  } catch {
    return false;
  }
}

async function requestAllSitesAccess() {
  try {
    return await chrome.permissions.request({ origins: [ALL_SITES] });
  } catch {
    return false;
  }
}

export function renderTabsImport(ctx, view) {
  const page = el('div', { class: 'page page-wide' });
  view.append(page);
  draw(ctx, page);
}

function draw(ctx, page) {
  clear(page);
  if (scan.scanning) {
    page.append(scanningSection());
    return;
  }
  if (!scan.rows) {
    page.append(instructions(ctx, page));
    return;
  }
  reviewScreen(ctx, page);
}

function instructions(ctx, page) {
  return UI.section('Import from open tabs', 'Read every tab in this browser window and offer to save anything that looks like a product, filed into the collection it best matches.', [
    el('div', { class: 'steps' }, [
      stepNode(1, 'Open the tabs you want', 'Have the product pages you want to save open as tabs in this browser window — any number, any sites.'),
      stepNode(2, 'Scan this window', 'Keepsake reads the title, price and image on each tab, one at a time, without switching tabs or sending anything anywhere.'),
      stepNode(3, 'Review here', 'Deselect anything that isn’t a product, adjust collections, and import.'),
    ]),
    scan.error ? el('div', { class: 'notice notice-danger' }, [scan.error]) : null,
    el('div', { class: 'prose' }, [
      el('p', {}, [el('strong', {}, ['What Keepsake reads: ']), 'the title, price, image and page text of every readable tab in this window, right now. ', el('strong', {}, ['What it never reads: ']), 'your logins, cookies, form fields, or anything you haven’t got open as a tab.']),
      el('p', {}, ['This needs one-time permission to read other tabs — Chrome will ask you to confirm. You can revoke it any time from Settings → On-page save buttons or chrome://extensions.']),
    ]),
    el('div', { class: 'actions-row' }, [el('button', { type: 'button', class: 'btn btn-primary', onClick: () => startScan(ctx, page) }, ['Scan this window’s tabs'])]),
  ]);
}

function stepNode(n, title, text) {
  return el('div', { class: 'step' }, [el('div', { class: 'step-num' }, [String(n)]), el('h3', {}, [title]), el('p', {}, [text])]);
}

function scanningSection() {
  const pr = scan.progress || { done: 0, total: 0 };
  const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(pr.total), 'aria-valuenow': String(pr.done) });
  const fill = el('div', { class: 'progress-fill' });
  fill.style.width = `${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%`;
  bar.append(fill);
  return UI.section('Scanning this window’s tabs…', 'Keep the window open. This only takes a moment.', [
    el('div', { class: 'stat-grid' }, [el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [`${pr.done} / ${pr.total}`]), el('div', { class: 'stat-label' }, ['tabs read'])])]),
    bar,
  ]);
}

async function startScan(ctx, page) {
  scan.error = '';
  if (!(await hasAllSitesAccess())) {
    const granted = await requestAllSitesAccess();
    if (!granted) {
      UI.toast('Keepsake needs permission to read other tabs to do this.', { kind: 'danger', duration: 6000 });
      return;
    }
  }
  scan.scanning = true;
  scan.progress = { done: 0, total: 0 };
  draw(ctx, page);

  const selfTab = await chrome.tabs.getCurrent().catch(() => null);
  const tabs = await chrome.tabs.query({ currentWindow: true }).catch(() => []);
  const extPrefix = chrome.runtime.getURL('');
  const candidates = tabs.filter((t) => t.id && (!selfTab || t.id !== selfTab.id) && !isRestrictedUrl(t.url || '') && !(t.url || '').startsWith(extPrefix));

  scan.progress.total = candidates.length;
  const found = [];
  const CONCURRENCY = 4;
  let next = 0;
  async function worker() {
    while (next < candidates.length) {
      const tab = candidates[next++];
      const res = await ctx.send({ type: MSG.EXTRACT_TAB, tabId: tab.id }).catch(() => null);
      if (res && res.ok && res.product) found.push({ tab, product: res.product });
      scan.progress = { done: scan.progress.done + 1, total: candidates.length };
      if (page.isConnected) {
        const bar = page.querySelector('.progress-fill');
        const stat = page.querySelector('.stat-value');
        if (bar) bar.style.width = `${Math.round((scan.progress.done / scan.progress.total) * 100)}%`;
        if (stat) stat.textContent = `${scan.progress.done} / ${scan.progress.total}`;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, candidates.length)) }, worker));

  await buildRows(ctx, found);
  scan.scanning = false;
  if (!scan.rows.length) scan.error = candidates.length ? 'None of the open tabs looked like a product page.' : 'No readable tabs were found in this window.';
  draw(ctx, page);
}

async function buildRows(ctx, found) {
  const context = { collections: ctx.state.collections, prefs: ctx.state.prefs, settings: ctx.state.settings };
  const rows = [];
  for (const { tab, product } of found) {
    const cls = classify(product, context);
    const dupe = await ctx.store.findByUrl(product.canonicalUrl || product.url);
    const key = String(tab.id);
    const def = cls.isNew ? `new:${cls.taxonomyKey}` : cls.collectionId || NONE;
    const existing = selection.get(key);
    if (!existing) selection.set(key, { selected: !dupe && !product.sparse, collectionId: def, defaultChoice: def, touched: false });
    else if (!existing.touched) Object.assign(existing, { collectionId: def, defaultChoice: def });
    rows.push({ tab, product, cls, alreadyImported: !!dupe, key });
  }
  scan.rows = rows;
}

function reviewScreen(ctx, page) {
  const regular = ctx.regularCollections();
  const rows = scan.rows;

  const counts = () => rows.filter((r) => selection.get(r.key).selected).length;
  const head = el('div', { class: 'import-head' });
  const summary = el('span', { class: 'muted' });
  const updateSummary = () => { summary.textContent = `${counts()} of ${rows.length} selected · ${rows.filter((r) => r.alreadyImported).length} already saved · ${rows.filter((r) => r.product.sparse).length} sparse`; };
  updateSummary();

  const bulkSel = UI.selectInput({
    value: '',
    options: [{ value: '', label: 'Set collection for all selected…' }, ...regular.map((c) => ({ value: c.id, label: c.name })), { value: NONE, label: 'Leave uncategorized (Review)' }],
    onChange: (v) => {
      if (!v) return;
      for (const r of rows) if (selection.get(r.key).selected) Object.assign(selection.get(r.key), { collectionId: v, touched: true });
      bulkSel.value = '';
      grid.querySelectorAll('select[data-key]').forEach((s) => { if (selection.get(s.dataset.key).selected) s.value = v; });
    },
    label: 'Set collection for all selected',
  });

  const importBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: () => doImport(ctx, page) }, [`Import ${pluralize(counts(), 'item', 'items')}`]);
  const refreshImportBtn = () => { importBtn.textContent = `Import ${pluralize(counts(), 'item', 'items')}`; importBtn.disabled = counts() === 0; };
  refreshImportBtn();

  head.append(
    el('div', {}, [el('h2', { class: 'card-section-title' }, ['Tabs in this window']), summary]),
    el('div', { class: 'actions-row' }, [
      el('button', { type: 'button', class: 'btn btn-sm', onClick: () => setAll(true) }, ['Select all']),
      el('button', { type: 'button', class: 'btn btn-sm', onClick: () => setAll(false) }, ['Select none']),
      bulkSel,
      el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: () => { scan.rows = null; scan.error = ''; selection.clear(); draw(ctx, page); } }, ['Scan again']),
      importBtn,
    ]),
  );
  page.append(head);
  page.append(el('p', { class: 'help' }, ['Sparse extractions (no price or image found) start unchecked — check the confidence note before including one. Duplicates you already saved are skipped automatically.']));

  const grid = el('div', { class: 'import-grid' });
  const cardMap = new Map();
  for (const r of rows) {
    const sel = selection.get(r.key);
    const card = el('div', { class: `post-card ${sel.selected ? '' : 'deselected'} ${r.alreadyImported ? 'imported' : ''}` });
    const cb = el('input', { type: 'checkbox', class: 'card-check', 'aria-label': `Import ${r.product.title}` });
    cb.checked = sel.selected;
    cb.addEventListener('change', () => {
      sel.selected = cb.checked;
      card.classList.toggle('deselected', !cb.checked);
      updateSummary();
      refreshImportBtn();
    });
    const options = [...regular.map((c) => ({ value: c.id, label: c.name }))];
    if (r.cls.isNew && r.cls.taxonomyKey) options.push({ value: `new:${r.cls.taxonomyKey}`, label: `${r.cls.collectionName} (new)` });
    options.push({ value: NONE, label: 'Leave uncategorized (Review)' });
    const colSel = UI.selectInput({ value: sel.collectionId, options, onChange: (v) => { sel.collectionId = v; sel.touched = true; }, label: `Collection for ${r.product.title}` });
    colSel.dataset.key = r.key;
    if (colSel.value !== sel.collectionId) { colSel.value = NONE; sel.collectionId = NONE; }
    const price = priceLabel(r.product);
    const conf = r.cls.isInbox ? 'Not sure — leave uncategorized' : `${Math.round(r.cls.confidence * 100)}% · ${r.cls.reason}`;
    card.append(
      cb,
      UI.pictureNode({ src: r.product.image, title: r.product.title }),
      el('div', { class: 'post-body' }, [
        r.alreadyImported ? el('span', { class: 'pill pill-warn' }, ['Already saved']) : r.product.sparse ? el('span', { class: 'pill pill-warn' }, ['Sparse — check this one']) : null,
        el('div', { class: 'post-caption' }, [r.product.title]),
        el('div', { class: 'post-creator' }, [[price, r.product.retailer || r.product.host].filter(Boolean).join(' · ')]),
        colSel,
        el('div', { class: 'post-conf', title: r.cls.reason }, [conf]),
        el('button', { type: 'button', class: 'btn btn-sm btn-link', onClick: () => goToTab(r.tab) }, ['Go to tab']),
      ]),
    );
    cardMap.set(r.key, { card, cb });
    grid.append(card);
  }
  page.append(grid);

  function setAll(on) {
    for (const r of rows) selection.get(r.key).selected = on;
    for (const r of rows) {
      const { card, cb } = cardMap.get(r.key);
      cb.checked = on;
      card.classList.toggle('deselected', !on);
    }
    updateSummary();
    refreshImportBtn();
  }
}

function priceLabel(product) {
  if (product.price !== null && product.price !== undefined && product.price !== '' && Number.isFinite(Number(product.price))) return formatPrice(product.price, product.currency);
  if (product.priceText) {
    const parsed = parsePrice(product.priceText, product.currency);
    if (parsed) return formatPrice(parsed.amount, parsed.currency || product.currency);
  }
  return '';
}

function goToTab(tab) {
  chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  if (tab.windowId !== undefined) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function doImport(ctx, page) {
  const rows = scan.rows;
  const chosen = rows.filter((r) => selection.get(r.key).selected);
  if (!chosen.length) return;
  let added = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of chosen) {
    const sel = selection.get(r.key);
    const userChose = sel.collectionId !== sel.defaultChoice;
    const toNone = sel.collectionId === NONE;
    try {
      const res = await ctx.send({
        type: MSG.SAVE_ITEM,
        product: r.product,
        collectionId: userChose && !toNone ? sel.collectionId : null,
        classification: toNone
          ? { collectionId: null, collectionName: 'Review', taxonomyKey: null, confidence: 0, reason: 'You chose to leave this uncategorized', isNew: false, isInbox: true }
          : userChose ? null : r.cls,
        source: 'tabs-import',
        learn: 'light',
      });
      if (!res.ok) { failed++; continue; }
      if (res.duplicate) { skipped++; continue; }
      added++;
    } catch {
      failed++;
    }
  }
  scan.rows = null;
  scan.error = '';
  selection.clear();
  UI.toast(`Imported ${pluralize(added, 'item', 'items')}${skipped ? ` (${skipped} already saved)` : ''}${failed ? `, ${failed} failed` : ''}.`, { duration: 6000 });
  ctx.navigate('#all');
}
