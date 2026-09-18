// Keepsake dashboard (full-tab page). Talks to chrome.storage.local directly
// through the shared store and to the background worker only for a couple of
// helpers (opening tabs, refreshing floating buttons). No network access.

import { createStore, chromeBackend } from '../shared/storage.js';
import { MSG } from '../shared/messages.js';
import { el, clear, formatPrice, formatDate, sanitizeText, parsePrice, debounce, pluralize, hostnameOf, prettyRetailer } from '../shared/util.js';
import { classify } from '../shared/categorizer.js';
import * as UI from './ui.js';
import { renderSettings, renderAI, renderPrivacy, analyzeItems } from './settings.js';
import { renderImport } from './importer.js';
import { renderTabsImport } from './tabsImport.js';

const store = createStore(chromeBackend());
const $ = (id) => document.getElementById(id);

const state = {
  route: { name: 'all', id: '' },
  collections: [],
  items: [],
  prefs: null,
  settings: null,
  importHistory: null,
  search: '',
  sort: 'newest',
  retailer: '',
  selecting: false,
  selected: new Set(),
  shown: 120,
  scan: null,
};

const send = (msg) => new Promise((resolve) => {
  try {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res || { ok: false, error: 'No response.' });
    });
  } catch (e) {
    resolve({ ok: false, error: String(e && e.message) });
  }
});

const ctx = {
  store, state, send,
  toast: UI.toast,
  reload: () => reload(),
  render: () => render(),
  navigate: (hash) => navigate(hash),
  openItem: (id) => openItem(id),
  regularCollections: () => state.collections,
  collectionById: (id) => state.collections.find((c) => c.id === id) || null,
  applyTheme: () => applyTheme(),
};

// --- boot ------------------------------------------------------------------------

async function boot() {
  await store.init();
  await reload();
  applyTheme();
  bindChrome();
  window.addEventListener('hashchange', () => {
    state.route = parseHash();
    state.shown = 120;
    if (!['all', 'favorites', 'archive', 'c', 'item'].includes(state.route.name)) exitSelection(false);
    render();
  });
  state.route = parseHash();
  render();
  store.onChanged(debounce(async (changes) => {
    const keys = Object.keys(changes);
    if (!keys.some((k) => k.startsWith('keepsake_'))) return;
    await reload();
    if (changes.keepsake_settings) applyTheme();
    render();
  }, 150));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.keepsake_igScan && state.route.name === 'import') {
      state.scan = changes.keepsake_igScan.newValue || null;
      render();
    }
  });
}

async function reload() {
  const data = await store.getAll();
  state.collections = sortCollections(Object.values(data.collections || {}));
  state.items = Object.values(data.items || {}).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  state.prefs = data.prefs;
  state.settings = data.settings;
  state.importHistory = data.importHistory;
  for (const id of [...state.selected]) if (!data.items[id]) state.selected.delete(id);
}

function sortCollections(list) {
  return list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
}

function applyTheme() {
  const theme = state.settings?.theme || 'system';
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const btn = $('themeToggle');
  if (btn) btn.title = `Theme: ${theme}`;
}

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!h) return { name: 'all', id: '' };
  const [name, ...rest] = h.split('/');
  return { name: name || 'all', id: rest.join('/') };
}

function navigate(hash) {
  if (location.hash === hash) {
    state.route = parseHash();
    render();
  } else location.hash = hash;
}

function bindChrome() {
  $('menuToggle').addEventListener('click', () => toggleNav());
  $('scrim').addEventListener('click', () => toggleNav(false));
  $('newCollectionBtn').addEventListener('click', () => newCollection());
  $('searchInput').addEventListener('input', debounce(() => {
    state.search = $('searchInput').value.trim();
    state.shown = 120;
    renderView();
  }, 120));
  $('sortSelect').addEventListener('change', () => {
    state.sort = $('sortSelect').value;
    renderView();
  });
  $('retailerSelect').addEventListener('change', () => {
    state.retailer = $('retailerSelect').value;
    renderView();
  });
  $('selectToggle').addEventListener('click', () => (state.selecting ? exitSelection(true) : enterSelection()));
  $('themeToggle').addEventListener('click', async () => {
    const order = ['system', 'light', 'dark'];
    const cur = state.settings?.theme || 'system';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    await store.updateSettings({ theme: next });
    UI.toast(`Theme: ${next}`, { duration: 1800 });
  });
  $('bulkAll').addEventListener('click', () => {
    const visible = currentGridItems();
    const all = visible.every((i) => state.selected.has(i.id));
    for (const i of visible) all ? state.selected.delete(i.id) : state.selected.add(i.id);
    renderView();
    updateBulkbar();
  });
  $('bulkMove').addEventListener('click', () => bulkMove());
  $('bulkFav').addEventListener('click', () => bulkPatch((items) => ({ favorite: !items.every((i) => i.favorite) })));
  $('bulkArchive').addEventListener('click', () => bulkPatch((items) => ({ archived: !items.every((i) => i.archived) })));
  $('bulkDelete').addEventListener('click', () => bulkDelete());
  $('bulkAi').addEventListener('click', () => bulkAi());
  $('bulkCancel').addEventListener('click', () => exitSelection(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '') && !document.body.classList.contains('modal-open')) {
      e.preventDefault();
      $('searchInput').focus();
    }
    if (e.key === 'Escape' && state.selecting && !document.body.classList.contains('modal-open')) exitSelection(true);
  });
}

function toggleNav(force) {
  const app = $('app');
  const open = force === undefined ? !app.classList.contains('nav-open') : force;
  app.classList.toggle('nav-open', open);
  $('scrim').hidden = !open;
  $('menuToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
}

// --- rendering -------------------------------------------------------------------------

const GRID_ROUTES = new Set(['all', 'favorites', 'archive', 'c', 'item']);

function render() {
  renderNav();
  renderSidebarCollections();
  renderToolbar();
  renderView();
  updateBulkbar();
  toggleNav(false);
}

function renderNav() {
  const r = state.route;
  document.querySelectorAll('.nav-item').forEach((a) => {
    const route = a.dataset.route;
    a.classList.toggle('active', route === r.name || (r.name === 'item' && route === 'all'));
  });
  const live = state.items.filter((i) => !i.archived);
  setCount('countAll', live.length);
  setCount('countFav', live.filter((i) => i.favorite).length);
  setCount('countReview', live.filter((i) => !i.collectionId).length);
  setCount('countArchive', state.items.filter((i) => i.archived).length);
  setCount('countImport', state.scan && state.scan.posts && state.scan.status === 'done' ? state.scan.posts.length : 0);
}

function setCount(id, n) {
  const node = $(id);
  if (node) node.textContent = n ? String(n) : '';
}

function renderSidebarCollections() {
  const list = $('collectionList');
  clear(list);
  const counts = new Map();
  for (const i of state.items) if (!i.archived) counts.set(i.collectionId, (counts.get(i.collectionId) || 0) + 1);
  const covers = new Map();
  for (const i of state.items) if (i.image && !i.archived && !covers.has(i.collectionId)) covers.set(i.collectionId, i.image);
  for (const c of state.collections) {
    const active = state.route.name === 'c' && state.route.id === c.id;
    const cover = c.coverImage || covers.get(c.id) || '';
    const coverNode = el('span', { class: 'collection-cover' }, cover ? [el('img', { src: cover, alt: '', loading: 'lazy', onError: (e) => { e.target.remove(); } })] : [UI.initialFor(c.name)]);
    if (!cover) coverNode.style.background = c.color || '#8A9A88';
    const li = el('li', {
      class: `collection-item ${active ? 'active' : ''}`,
      draggable: true,
      tabindex: '0',
      role: 'link',
      dataset: { id: c.id },
      onClick: () => navigate(`#c/${c.id}`),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`#c/${c.id}`);
        } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          moveCollectionBy(c.id, e.key === 'ArrowUp' ? -1 : 1).then(() => {
            const again = list.querySelector(`[data-id="${c.id}"]`);
            if (again) again.focus();
          });
        }
      },
    }, [coverNode, el('span', { class: 'collection-name' }, [c.name]), el('span', { class: 'collection-count' }, [String(counts.get(c.id) || '')])]);
    bindDrag(li, list);
    list.append(li);
  }
  markListScrolled(list);
}

// Shows a hairline under the "Collections" heading while the list is scrolled,
// and keeps the active collection in view when the list is long.
function markListScrolled(list) {
  const section = list.closest('.sidebar-section');
  if (!section) return;
  const update = () => section.classList.toggle('scrolled', list.scrollTop > 2);
  if (!list.dataset.scrollBound) {
    list.dataset.scrollBound = '1';
    list.addEventListener('scroll', update, { passive: true });
  }
  update();
  const active = list.querySelector('.collection-item.active');
  if (active && typeof active.scrollIntoView === 'function') {
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) active.scrollIntoView({ block: 'nearest' });
  }
}

let dragId = null;
function bindDrag(li, list) {
  li.addEventListener('dragstart', (e) => {
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch { /* ignore */ }
  });
  li.addEventListener('dragend', () => {
    dragId = null;
    li.classList.remove('dragging');
    list.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  });
  li.addEventListener('dragover', (e) => {
    if (!dragId || dragId === li.dataset.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    li.classList.toggle('drop-before', before);
    li.classList.toggle('drop-after', !before);
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragId || dragId === li.dataset.id) return;
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const ids = ctx.regularCollections().map((c) => c.id).filter((id) => id !== dragId);
    const idx = ids.indexOf(li.dataset.id);
    ids.splice(before ? idx : idx + 1, 0, dragId);
    await store.reorderCollections(ids);
  });
}

async function moveCollectionBy(id, delta) {
  const ids = ctx.regularCollections().map((c) => c.id);
  const idx = ids.indexOf(id);
  const to = idx + delta;
  if (idx < 0 || to < 0 || to >= ids.length) return;
  ids.splice(idx, 1);
  ids.splice(to, 0, id);
  await store.reorderCollections(ids);
  await reload();
  render();
}

function renderToolbar() {
  const r = state.route;
  const controls = $('toolbarControls');
  const isGrid = GRID_ROUTES.has(r.name);
  controls.classList.toggle('hidden-controls', !isGrid);
  $('bulkbar').classList.toggle('hidden', !(isGrid && state.selecting));
  let title = 'All saves';
  if (r.name === 'favorites') title = 'Favorites';
  else if (r.name === 'archive') title = 'Archive';
  else if (r.name === 'review') title = 'Review queue';
  else if (r.name === 'import') title = 'Instagram import';
  else if (r.name === 'tabsimport') title = 'Import from tabs';
  else if (r.name === 'settings') title = 'Settings';
  else if (r.name === 'privacy') title = 'Privacy';
  else if (r.name === 'ai') title = 'Optional AI';
  else if (r.name === 'welcome') title = 'Welcome';
  else if (r.name === 'c') title = ctx.collectionById(r.id)?.name || 'Collection';
  $('viewTitle').textContent = title;
  document.title = `${title} · Keepsake`;
  if (isGrid) {
    const base = baseItems();
    const retailers = [...new Set(base.map((i) => i.retailer).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const sel = $('retailerSelect');
    const cur = state.retailer;
    clear(sel);
    sel.append(el('option', { value: '', text: 'All retailers' }));
    for (const rname of retailers) sel.append(el('option', { value: rname, text: rname }));
    sel.value = retailers.includes(cur) ? cur : '';
    if (!retailers.includes(cur)) state.retailer = '';
    $('sortSelect').value = state.sort;
    $('searchInput').value = state.search;
    $('selectToggle').setAttribute('aria-pressed', state.selecting ? 'true' : 'false');
    $('selectToggle').textContent = state.selecting ? 'Done' : 'Select';
    $('bulkAi').classList.toggle('hidden', !state.settings?.ai?.enabled);
  }
}

function renderView() {
  const view = $('view');
  clear(view);
  view.scrollTop = 0;
  const r = state.route;
  switch (r.name) {
    case 'settings':
      renderSettings(ctx, view);
      break;
    case 'ai':
      renderAI(ctx, view);
      break;
    case 'privacy':
      renderPrivacy(ctx, view);
      break;
    case 'import':
      renderImport(ctx, view);
      break;
    case 'tabsimport':
      renderTabsImport(ctx, view);
      break;
    case 'review':
      renderReview(view);
      break;
    case 'welcome':
      renderWelcome(view);
      break;
    case 'item':
      renderGrid(view);
      if (r.id && !document.body.classList.contains('modal-open')) {
        openItem(r.id).then(() => {
          if (location.hash === `#item/${r.id}`) {
            history.replaceState(null, '', '#all');
            state.route = parseHash();
            renderNav();
            renderToolbar();
          }
        });
      }
      break;
    default:
      renderGrid(view);
  }
  if (isGridRoute()) $('viewCount').textContent = pluralize(currentGridItems().length, 'item', 'items');
  else $('viewCount').textContent = '';
}

function isGridRoute() {
  return GRID_ROUTES.has(state.route.name);
}

// --- grid --------------------------------------------------------------------------------

function baseItems() {
  const r = state.route;
  const live = state.items.filter((i) => !i.archived);
  if (r.name === 'favorites') return live.filter((i) => i.favorite);
  if (r.name === 'archive') return state.items.filter((i) => i.archived);
  if (r.name === 'c') return live.filter((i) => i.collectionId === r.id);
  return live;
}

function currentGridItems() {
  let list = baseItems();
  if (state.retailer) list = list.filter((i) => i.retailer === state.retailer);
  const q = state.search.toLowerCase();
  if (q) {
    list = list.filter((i) => {
      const col = ctx.collectionById(i.collectionId);
      const hay = [i.title, i.retailer, i.host, i.note, i.description, i.price !== null ? String(i.price) : '', formatPrice(i.price, i.currency), col?.name, i.instagram?.creator, i.instagram?.caption, i.instagram?.collectionName]
        .filter(Boolean).join(' \n ').toLowerCase();
      return hay.includes(q);
    });
  }
  const byPrice = (dir) => (a, b) => {
    const ap = a.price === null || a.price === undefined ? null : a.price;
    const bp = b.price === null || b.price === undefined ? null : b.price;
    if (ap === null && bp === null) return 0;
    if (ap === null) return 1;
    if (bp === null) return -1;
    return dir * (ap - bp);
  };
  if (state.sort === 'oldest') list = [...list].sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  else if (state.sort === 'price-asc') list = [...list].sort(byPrice(1));
  else if (state.sort === 'price-desc') list = [...list].sort(byPrice(-1));
  return list;
}

function renderGrid(view) {
  const r = state.route;
  if (r.name === 'c') {
    const col = ctx.collectionById(r.id);
    if (!col) {
      view.append(UI.emptyState({ title: 'Collection not found', message: 'It may have been deleted or merged.', actions: [el('button', { type: 'button', class: 'btn', onClick: () => navigate('#all') }, ['Back to all saves'])] }));
      return;
    }
    view.append(collectionHero(col));
  }
  const items = currentGridItems();
  if (!items.length) {
    view.append(gridEmptyState());
    return;
  }
  const grid = el('div', { class: 'grid', role: 'list' });
  const slice = items.slice(0, state.shown);
  for (const item of slice) grid.append(cardNode(item));
  view.append(grid);
  if (items.length > state.shown) {
    view.append(el('div', { class: 'load-more' }, [
      el('button', { type: 'button', class: 'btn', onClick: () => { state.shown += 120; renderView(); } }, [`Show more (${items.length - state.shown} left)`]),
    ]));
  }
}

function gridEmptyState() {
  const r = state.route;
  if (state.search || state.retailer) {
    return UI.emptyState({
      title: 'No matches', message: 'Nothing here matches your search or filter.',
      actions: [el('button', { type: 'button', class: 'btn', onClick: () => { state.search = ''; state.retailer = ''; $('searchInput').value = ''; renderToolbar(); renderView(); } }, ['Clear search'])],
      icon: UI.folderIcon(),
    });
  }
  if (r.name === 'favorites') return UI.emptyState({ title: 'No favorites yet', message: 'Tap the star on any card to keep it close.', icon: UI.starIcon(true) });
  if (r.name === 'archive') return UI.emptyState({ title: 'Nothing archived', message: 'Archive items you’ve bought or moved on from. They stay searchable here.', icon: UI.folderIcon() });
  if (r.name === 'c') return UI.emptyState({ title: 'This collection is empty', message: 'Save something from a product page and Keepsake will file it here when it fits.', icon: UI.folderIcon() });
  return UI.emptyState({
    title: 'Nothing saved yet',
    message: 'Open a product page, click the Keepsake icon in your toolbar (or press Alt+Shift+K) and save. Everything you keep lives only in this browser.',
    icon: UI.bagIcon(),
    actions: [
      el('button', { type: 'button', class: 'btn btn-primary', onClick: () => loadSample() }, ['Load sample data']),
      el('button', { type: 'button', class: 'btn', onClick: () => navigate('#settings') }, ['Turn on on-page buttons']),
    ],
  });
}

async function loadSample() {
  const n = await store.loadSampleData();
  UI.toast(`Added ${pluralize(n, 'sample item', 'sample items')}. Delete them any time.`);
}

function cardNode(item) {
  const col = ctx.collectionById(item.collectionId);
  const selected = state.selected.has(item.id);
  const price = formatPrice(item.price, item.currency);
  const card = el('article', { class: `card ${selected ? 'selected' : ''} ${item.archived ? 'archived' : ''} ${state.selecting ? 'selecting' : ''}`, role: 'listitem', 'aria-label': item.title });
  if (state.selecting) {
    const cb = el('input', { type: 'checkbox', class: 'card-check', 'aria-label': `Select ${item.title}` });
    cb.checked = selected;
    cb.addEventListener('change', () => {
      cb.checked ? state.selected.add(item.id) : state.selected.delete(item.id);
      card.classList.toggle('selected', cb.checked);
      updateBulkbar();
    });
    card.append(cb);
  }
  const hit = el('button', { type: 'button', class: 'card-hit', onClick: () => {
    if (state.selecting) {
      const cb = card.querySelector('.card-check');
      if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      }
      return;
    }
    openQuickView(item.id);
  } }, [
    UI.pictureNode({ src: item.image, aspect: item.imageAspect, title: item.title }),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'card-title' }, [item.title]),
      el('div', { class: 'card-meta' }, [
        price ? el('span', { class: 'card-price' }, [price]) : el('span', { class: 'card-price muted' }, [item.type === 'instagram' ? '' : 'No price']),
        el('span', { class: 'card-retailer', title: item.url || '' }, [item.type === 'instagram' && item.instagram?.creator ? `@${item.instagram.creator}` : item.retailer || item.host || '']),
      ]),
      item.note ? el('div', { class: 'card-note' }, [item.note]) : null,
      state.route.name !== 'c' && col ? el('div', { class: 'card-meta' }, [el('span', { class: 'muted small' }, [col.name])]) : null,
    ]),
  ]);
  const badges = el('div', { class: 'card-badges' }, [
    item.favorite ? el('span', { class: 'badge badge-brass', title: 'Favorite' }, [UI.starIcon(true)]) : null,
    item.purchased ? el('span', { class: 'badge' }, ['Purchased']) : null,
    item.type === 'instagram' || item.instagram ? el('span', { class: 'badge badge-sage' }, [UI.instagramIcon(), 'Instagram']) : null,
    item.type === 'inspiration' && !item.instagram ? el('span', { class: 'badge badge-sage' }, ['Inspiration']) : null,
    !item.collectionId && !item.archived ? el('span', { class: 'badge' }, ['Needs sorting']) : null,
  ]);
  const favBtn = el('button', { type: 'button', class: `btn btn-icon ${item.favorite ? 'is-on' : ''}`, 'aria-label': item.favorite ? 'Remove from favorites' : 'Add to favorites', 'aria-pressed': item.favorite ? 'true' : 'false', onClick: async (e) => {
    e.stopPropagation();
    await store.updateItem(item.id, { favorite: !item.favorite });
  } }, [UI.starIcon(item.favorite)]);
  const moreBtn = el('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'More actions', 'aria-haspopup': 'menu', onClick: (e) => {
    e.stopPropagation();
    openMenu(moreBtn, itemMenu(item));
  } }, [UI.moreIcon()]);
  const actions = el('div', { class: 'card-actions' }, state.selecting ? [] : [favBtn, moreBtn]);
  card.append(hit, badges, actions);
  return el('div', { class: 'grid-item' }, [card]);
}

function itemMenu(item) {
  const entries = [
    { label: 'Edit details', icon: UI.pencilIcon(), onClick: () => openItem(item.id) },
    { label: 'Move to…', icon: UI.folderIcon(), onClick: () => moveDialog([item]) },
    { label: item.favorite ? 'Remove favorite' : 'Favorite', icon: UI.starIcon(item.favorite), onClick: () => store.updateItem(item.id, { favorite: !item.favorite }) },
    { label: item.purchased ? 'Mark as not purchased' : 'Mark as purchased', icon: UI.checkIcon(), onClick: () => store.updateItem(item.id, { purchased: !item.purchased }) },
    { label: item.archived ? 'Unarchive' : 'Archive', icon: UI.folderIcon(), onClick: () => store.updateItem(item.id, { archived: !item.archived }) },
  ];
  if (item.url) entries.push({ label: item.type === 'instagram' ? 'Open on Instagram' : 'Visit page', icon: UI.externalIcon(), onClick: () => window.open(item.url, '_blank', 'noopener') });
  entries.push({ sep: true });
  entries.push({ label: 'Delete', icon: UI.trashIcon(), danger: true, onClick: () => deleteItems([item]) });
  return entries;
}

// A small floating menu anchored to a button.
let activeMenu = null;
function openMenu(anchor, entries) {
  closeMenu();
  const menu = el('div', { class: 'menu', role: 'menu' });
  for (const e of entries) {
    if (e.sep) {
      menu.append(el('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    menu.append(el('button', { type: 'button', role: 'menuitem', class: `menu-item ${e.danger ? 'danger' : ''}`, onClick: () => {
      closeMenu();
      e.onClick();
    } }, [e.icon || null, e.label]));
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 200;
  let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  const onDoc = (ev) => {
    if (!menu.contains(ev.target)) closeMenu();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      closeMenu();
      anchor.focus();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const items = [...menu.querySelectorAll('.menu-item')];
      const idx = items.indexOf(document.activeElement);
      const next = ev.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next].focus();
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
  }, 0);
  activeMenu = { menu, cleanup: () => {
    document.removeEventListener('mousedown', onDoc);
    document.removeEventListener('keydown', onKey);
  } };
  const first = menu.querySelector('.menu-item');
  if (first) first.focus();
}

function closeMenu() {
  if (!activeMenu) return;
  activeMenu.cleanup();
  activeMenu.menu.remove();
  activeMenu = null;
}

// --- selection & bulk actions ----------------------------------------------------------------

function enterSelection() {
  state.selecting = true;
  state.selected.clear();
  renderToolbar();
  renderView();
  updateBulkbar();
}

function exitSelection(rerender) {
  state.selecting = false;
  state.selected.clear();
  if (rerender) {
    renderToolbar();
    renderView();
  }
  updateBulkbar();
}

function updateBulkbar() {
  const n = state.selected.size;
  $('bulkCount').textContent = `${n} selected`;
  for (const id of ['bulkMove', 'bulkFav', 'bulkArchive', 'bulkDelete', 'bulkAi']) $(id).disabled = n === 0;
  const visible = currentGridItems();
  $('bulkAll').textContent = visible.length && visible.every((i) => state.selected.has(i.id)) ? 'Select none' : 'Select all';
  $('bulkArchive').textContent = state.route.name === 'archive' ? 'Unarchive' : 'Archive';
  $('bulkbar').classList.toggle('hidden', !(isGridRoute() && state.selecting));
}

function selectedItems() {
  return state.items.filter((i) => state.selected.has(i.id));
}

async function bulkPatch(patchFor) {
  const items = selectedItems();
  if (!items.length) return;
  const patch = patchFor(items);
  for (const it of items) await store.updateItem(it.id, patch);
  UI.toast(`Updated ${pluralize(items.length, 'item', 'items')}.`);
  exitSelection(true);
}

async function bulkMove() {
  const items = selectedItems();
  if (!items.length) return;
  const moved = await moveDialog(items);
  if (moved) exitSelection(true);
}

async function bulkDelete() {
  const items = selectedItems();
  if (!items.length) return;
  const ok = await deleteItems(items);
  if (ok) exitSelection(true);
}

async function bulkAi() {
  const items = selectedItems();
  if (!items.length) return;
  await analyzeItems(ctx, items);
  exitSelection(true);
}

// Items created from a post (or the post an item came from) are shown together.
function relatedNode(item) {
  const related = item.relatedItemId ? state.items.find((i) => i.id === item.relatedItemId) : null;
  const children = state.items.filter((i) => i.relatedItemId === item.id);
  if (!related && !children.length) return null;
  return el('div', { class: 'category-box' }, [
    related ? el('div', {}, ['From the Instagram post ', el('button', { type: 'button', class: 'btn btn-link', onClick: () => openItem(related.id) }, [cut(related.title, 50)])]) : null,
    children.length ? el('div', {}, [`${pluralize(children.length, 'product', 'products')} saved from this post: `, ...children.map((c) => el('button', { type: 'button', class: 'btn btn-link', onClick: () => openItem(c.id) }, [cut(c.title, 40)]))]) : null,
  ]);
}

// Move one or more items with a collection picker. Resolves true when moved.
async function moveDialog(items) {
  const options = [...ctx.regularCollections().map((c) => ({ value: c.id, label: c.name })), { value: '__new', label: '＋ New collection…' }];
  const current = items.length === 1 ? items[0].collectionId : '';
  const select = UI.selectInput({ value: current || options[0].value, options, onChange: (v) => { newRow.classList.toggle('hidden', v !== '__new'); if (v === '__new') newInput.focus(); }, label: 'Collection' });
  const newInput = el('input', { class: 'input', placeholder: 'New collection name', maxlength: '80', 'aria-label': 'New collection name' });
  const newRow = el('div', { class: 'field hidden' }, [newInput]);
  const learnCheck = el('input', { type: 'checkbox' });
  learnCheck.checked = false;
  const body = [
    el('p', { class: 'modal-text' }, [items.length === 1 ? `Move “${cut(items[0].title, 70)}” to:` : `Move ${pluralize(items.length, 'item', 'items')} to:`]),
    select,
    newRow,
    el('label', { class: 'check' }, [learnCheck, el('span', {}, ['Use this choice for similar items in the future'])]),
    el('p', { class: 'help' }, ['Keepsake always learns a little from moves. Ticking this makes the lesson stronger.']),
  ];
  const result = await UI.openModal({
    title: 'Move to collection',
    body,
    actions: [
      { label: 'Cancel', quiet: true, value: false },
      { label: 'Move', primary: true, onClick: async (close) => {
        let target = select.value;
        if (target === '__new') {
          const name = sanitizeText(newInput.value, 80);
          if (!name) {
            newInput.focus();
            throw new Error('Give the new collection a name.');
          }
          const { collection, existed } = await store.createCollection({ name });
          target = collection.id;
          if (existed) UI.toast(`Using existing collection “${collection.name}”.`);
        }
        await store.moveItems(items.map((i) => i.id), target, { learn: learnCheck.checked ? 'strong' : 'light' });
        const col = await store.getCollection(target);
        UI.toast(`Moved to ${col ? col.name : 'collection'}.`);
        close(true);
        return false;
      } },
    ],
  });
  return result === true;
}

async function deleteItems(items) {
  const ok = await UI.confirmDialog({
    title: items.length === 1 ? 'Delete this item?' : `Delete ${pluralize(items.length, 'item', 'items')}?`,
    message: items.length === 1 ? `“${cut(items[0].title, 80)}” will be removed from Keepsake. This can’t be undone.` : 'They will be removed from Keepsake. This can’t be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return false;
  await store.deleteItems(items.map((i) => i.id));
  UI.toast(items.length === 1 ? 'Item deleted.' : `Deleted ${pluralize(items.length, 'item', 'items')}.`);
  return true;
}

function cut(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// --- item detail ---------------------------------------------------------------------------------

// A lightweight look at an item — image, title, price, and a link out. The
// full editor (title/price/note/collection/etc.) is one click away via
// "Edit details", both here and in each card's overflow menu.
async function openQuickView(id) {
  const item = await store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const price = formatPrice(item.price, item.currency);
  const body = el('div', { class: 'quickview' }, [
    UI.pictureNode({ src: item.image, aspect: item.imageAspect, title: item.title, className: 'quickview-pic' }),
    el('div', { class: 'quickview-title' }, [item.title]),
    price ? el('div', { class: 'quickview-price' }, [price]) : null,
  ]);
  await UI.openModal({
    title: 'Quick view',
    body,
    actions: [
      { label: 'Close', value: false },
      { label: 'Edit details', quiet: true, closes: false, onClick: async (close) => { close(false); await openItem(item.id); } },
      item.url ? { label: item.type === 'instagram' ? 'Open post' : 'Visit page', href: item.url, primary: true, icon: UI.externalIcon() } : null,
    ].filter(Boolean),
  });
}

async function openItem(id) {
  const item = await store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const collections = ctx.regularCollections();
  let chosenImage = item.image || '';

  const titleInput = el('textarea', { class: 'textarea', rows: '2', maxlength: '200', 'aria-label': 'Title' });
  titleInput.value = item.title;
  const priceInput = el('input', { class: 'input', inputmode: 'decimal', placeholder: 'Price', 'aria-label': 'Price' });
  priceInput.value = item.price !== null && item.price !== undefined ? String(item.price) : '';
  const currencyInput = el('input', { class: 'input', maxlength: '4', placeholder: 'USD', 'aria-label': 'Currency' });
  currencyInput.value = item.currency || '';
  const noteInput = el('textarea', { class: 'textarea', rows: '3', maxlength: '1000', placeholder: 'Add a note', 'aria-label': 'Note' });
  noteInput.value = item.note || '';
  // An uncategorized item (still waiting in Review) gets a placeholder option so
  // saving other edits doesn't silently file it into whatever collection sorts first.
  const colOptions = [...(item.collectionId ? [] : [{ value: '', label: 'Not sorted yet' }]), ...collections.map((c) => ({ value: c.id, label: c.name }))];
  const colSelect = UI.selectInput({ value: item.collectionId || '', options: colOptions, onChange: () => learnRow.classList.toggle('hidden', colSelect.value === item.collectionId), label: 'Collection' });
  const learnCheck = el('input', { type: 'checkbox' });
  const learnRow = el('label', { class: 'check hidden' }, [learnCheck, el('span', {}, ['Use this choice for similar items in the future'])]);

  const flags = { favorite: !!item.favorite, purchased: !!item.purchased, archived: !!item.archived };
  const toggle = (key, label, icon) => {
    const b = el('button', { type: 'button', class: `toggle-chip ${flags[key] ? 'on' : ''}`, 'aria-pressed': flags[key] ? 'true' : 'false', onClick: () => {
      flags[key] = !flags[key];
      b.classList.toggle('on', flags[key]);
      b.setAttribute('aria-pressed', flags[key] ? 'true' : 'false');
    } }, [icon, label]);
    return b;
  };

  const pic = UI.pictureNode({ src: chosenImage, title: item.title, className: 'detail-pic' });
  const picWrap = el('div', {}, [pic]);
  const thumbs = (item.images || []).filter(Boolean).slice(0, 6);
  const thumbRow = thumbs.length > 1 ? el('div', { class: 'thumb-row', role: 'radiogroup', 'aria-label': 'Choose the main image' }, thumbs.map((src, i) => {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': src === chosenImage ? 'true' : 'false', 'aria-label': `Image ${i + 1}`, onClick: () => {
      chosenImage = src;
      clear(picWrap);
      picWrap.append(UI.pictureNode({ src, title: item.title, className: 'detail-pic' }));
      thumbRow.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
    } }, [el('img', { src, alt: '', loading: 'lazy', onError: () => b.remove() })]);
    return b;
  })) : null;

  const source = el('div', { class: 'item-source' }, [
    el('span', {}, [item.type === 'instagram' ? 'Instagram' : item.retailer || item.host || 'Saved page']),
    el('span', {}, [`Saved ${formatDate(item.createdAt)}`]),
  ]);

  // The exact page this item came from: always visible, selectable, copyable,
  // and editable in case the extractor grabbed a listing rather than the product.
  const urlInput = el('input', { class: 'input mono', type: 'url', spellcheck: 'false', 'aria-label': 'Item URL', placeholder: 'https://…' });
  urlInput.value = item.url || '';
  const openLink = el('a', { class: 'btn btn-sm', href: item.url || '#', target: '_blank', rel: 'noopener noreferrer', title: item.url || '' }, [UI.externalIcon(), item.type === 'instagram' ? 'Open post' : 'Visit page']);
  if (!item.url) openLink.classList.add('hidden');
  const copyBtn = el('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'Copy link', onClick: async () => {
    const value = urlInput.value.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      UI.toast('Link copied.', { duration: 1500 });
    } catch {
      urlInput.focus();
      urlInput.select();
      UI.toast('Press Ctrl/Cmd+C to copy.', { duration: 2500 });
    }
  } }, ['Copy']);
  urlInput.addEventListener('input', () => {
    const v = urlInput.value.trim();
    const valid = /^https?:\/\//i.test(v);
    openLink.href = valid ? v : '#';
    openLink.title = v;
    openLink.classList.toggle('hidden', !valid);
  });
  const urlField = el('div', { class: 'field' }, [
    el('label', { class: 'label' }, ['Link']),
    el('div', { class: 'url-row' }, [urlInput, copyBtn, openLink]),
    el('p', { class: 'help' }, [item.type === 'instagram' ? 'The original post. Editing this changes where “Open post” goes.' : 'The page this was saved from. Edit it if Keepsake grabbed the wrong page.']),
  ]);

  const col = ctx.collectionById(item.collectionId);
  const confidencePct = item.confidence !== null && item.confidence !== undefined ? `${Math.round(item.confidence * 100)}%` : '';
  const catText = item.categorizationSource === 'manual' ? 'Filed by you.' : item.categorizationSource === 'sample' ? 'Sample item.' : item.categorizationSource === 'ai' ? `Filed with AI assist${confidencePct ? ` (${confidencePct} confidence)` : ''}.` : `Filed automatically${confidencePct ? ` (${confidencePct} confidence)` : ''}${item.categorizationReason ? ` — ${item.categorizationReason}` : '.'}`;

  const ig = item.instagram;
  const igInfo = ig ? el('div', { class: 'category-box' }, [
    ig.creator ? el('div', {}, [el('strong', {}, ['Creator: ']), `@${ig.creator}`]) : null,
    ig.collectionName ? el('div', {}, [el('strong', {}, ['Saved collection: ']), ig.collectionName]) : null,
    ig.postedAt ? el('div', {}, [el('strong', {}, ['Posted: ']), formatDate(ig.postedAt)]) : null,
    ig.location ? el('div', {}, [el('strong', {}, ['Location: ']), ig.location]) : null,
    ig.caption ? el('div', {}, [el('strong', {}, ['Caption: ']), cut(ig.caption, 600)]) : null,
    ig.hashtags?.length ? el('div', { class: 'chips' }, ig.hashtags.slice(0, 12).map((h) => el('span', { class: 'pill' }, [`#${h}`]))) : null,
    ig.products?.length ? el('div', {}, [
      el('strong', {}, ['Tagged by the creator: ']),
      el('div', { class: 'found-list' }, ig.products.map((p) => foundRow(item, { name: p.name, retailer: p.retailer, price: p.price, currency: p.currency, url: p.url, verified: true, note: 'Product tag from the post itself.' }))),
    ]) : null,
    ig.links?.length ? el('div', {}, [
      el('strong', {}, ['Links in the caption: ']),
      el('div', { class: 'found-list' }, ig.links.map((l) => foundRow(item, { name: l.label || l.url, url: l.url, verified: true, note: 'Link the creator put in the caption.' }))),
    ]) : null,
    ig.linkInBio && !ig.links?.length ? el('div', { class: 'help' }, ['The caption says “link in bio” — Keepsake can’t follow that, but the creator’s profile may have it.']) : null,
    !ig.details ? el('div', { class: 'help' }, ['Only the grid thumbnail was read for this post. Re-run the import and use “Read post details” to fill in the caption, links and tagged products.']) : null,
  ]) : null;

  const aiBox = el('div', {});
  renderAiBox(aiBox, item);

  const side = el('div', { class: 'item-detail-side' }, [
    source,
    el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Title']), titleInput]),
    urlField,
    el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Price']), el('div', { class: 'price-inline' }, [priceInput, currencyInput])]),
    el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Collection']), colSelect, learnRow]),
    el('div', { class: 'category-box' }, [catText]),
    el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Note']), noteInput]),
    el('div', { class: 'toggles' }, [toggle('favorite', 'Favorite', UI.starIcon(true)), toggle('purchased', 'Purchased', UI.checkIcon()), toggle('archived', 'Archived', UI.folderIcon())]),
    igInfo,
    aiBox,
    relatedNode(item),
  ]);

  const body = el('div', { class: 'item-detail' }, [el('div', {}, [picWrap, thumbRow]), side]);

  await UI.openModal({
    title: 'Item details',
    body,
    wide: true,
    actions: [
      { label: 'Delete', danger: true, closes: false, onClick: async (close) => {
        const ok = await deleteItems([item]);
        if (ok) close(true);
        return false;
      } },
      { label: 'Cancel', quiet: true, value: false },
      { label: 'Save changes', primary: true, onClick: async (close) => {
        const patch = {
          title: sanitizeText(titleInput.value, 200) || item.title,
          note: sanitizeText(noteInput.value, 1000),
          favorite: flags.favorite,
          purchased: flags.purchased,
          archived: flags.archived,
        };
        const priceText = priceInput.value.trim();
        if (!priceText) {
          patch.price = null;
          patch.currency = sanitizeText(currencyInput.value, 4).toUpperCase();
        } else {
          const parsed = parsePrice(priceText, currencyInput.value);
          if (!parsed) throw new Error('That price doesn’t look like a number.');
          patch.price = parsed.amount;
          patch.currency = sanitizeText(currencyInput.value, 4).toUpperCase() || parsed.currency || '';
        }
        const nextUrl = urlInput.value.trim();
        if (nextUrl !== (item.url || '')) {
          if (nextUrl && !/^https?:\/\//i.test(nextUrl)) throw new Error('A link has to start with http:// or https://.');
          const clash = nextUrl ? await store.findByUrl(nextUrl) : null;
          if (clash && clash.id !== item.id) throw new Error(`Another item (“${cut(clash.title, 40)}”) already has that link.`);
          patch.url = nextUrl;
          patch.canonicalUrl = nextUrl;
          patch.sourceUrl = nextUrl;
          // Let an auto-derived retailer follow the new host; a name you set stays.
          if (!item.retailer || item.retailer === prettyRetailer(hostnameOf(item.url))) patch.retailer = prettyRetailer(hostnameOf(nextUrl));
        }
        if (chosenImage && chosenImage !== item.image) {
          patch.image = chosenImage;
          patch.images = [chosenImage, ...(item.images || []).filter((u) => u !== chosenImage)];
        }
        await store.updateItem(item.id, patch);
        if (colSelect.value && colSelect.value !== item.collectionId) {
          await store.moveItems([item.id], colSelect.value, { learn: learnCheck.checked ? 'strong' : 'light' });
        }
        UI.toast('Saved.', { duration: 1800 });
        close(true);
        return false;
      } },
    ],
  });
}

// One "where to buy" row: name, retailer, price, open link, and an action that
// turns it into a real product item linked back to the post.
function foundRow(item, c) {
  const price = c.price !== null && c.price !== undefined ? formatPrice(c.price, c.currency || 'USD') : '';
  return el('div', { class: 'found-row' }, [
    el('div', { class: 'grow' }, [
      el('div', { class: 'found-name' }, [c.name || c.url || 'Unnamed']),
      el('div', { class: 'found-meta' }, [[c.brand, c.retailer || (c.url ? hostOf(c.url) : ''), price].filter(Boolean).join(' · ') || (c.url ? hostOf(c.url) : '')]),
      c.note ? el('div', { class: 'found-meta muted' }, [c.note]) : null,
    ]),
    c.url ? el('a', { class: 'btn btn-sm', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, [UI.externalIcon(), 'Open']) : null,
    c.url ? el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => saveCandidateAsItem(item, c) }, ['Save as product']) : null,
  ]);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Turn a found listing into its own product item, kept next to the post it came from.
async function saveCandidateAsItem(post, c) {
  const existing = await store.findByUrl(c.url);
  if (existing) {
    UI.toast('That link is already saved.', { action: { label: 'Open', onClick: () => openItem(existing.id) } });
    return;
  }
  const item = await store.addItem({
    title: c.name || hostOf(c.url),
    url: c.url,
    price: c.price ?? null,
    currency: c.currency || '',
    retailer: c.retailer || hostOf(c.url),
    description: post.instagram?.caption ? cut(post.instagram.caption, 300) : '',
    image: post.image || '',
    images: post.images || [],
    type: 'product',
    collectionId: post.collectionId,
    relatedItemId: post.id,
    confidence: 1,
    categorizationSource: 'manual',
    categorizationReason: `Found from the Instagram post “${cut(post.title, 40)}”`,
  });
  UI.toast(`Saved “${cut(item.title, 40)}” as a product.`, { action: { label: 'Open', onClick: () => openItem(item.id) } });
}

function renderAiBox(box, item) {
  clear(box);
  const ai = state.settings?.ai;
  const eligible = item.type === 'instagram' || item.type === 'inspiration';
  if (!eligible) return;
  if (!ai?.enabled) {
    box.append(el('div', { class: 'help' }, ['Want Keepsake to work out what product this post shows and find where to buy it? Turn on “Find products in Instagram saves” under Optional AI (it uses your own API key).']));
    return;
  }
  const s = item.ai;
  const runBtn = el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: async () => {
    const results = await analyzeItems(ctx, [item], { web: true });
    if (results && results[0]) renderAiBox(box, { ...item, ai: results[0] });
  } }, [s ? 'Search again' : 'Find this product online']);
  const idBtn = el('button', { type: 'button', class: 'btn btn-sm', onClick: async () => {
    const results = await analyzeItems(ctx, [item], { web: false });
    if (results && results[0]) renderAiBox(box, { ...item, ai: results[0] });
  } }, ['Identify only']);
  const children = [el('div', { class: 'row' }, [el('strong', { class: 'grow' }, ['Find the product']), idBtn, runBtn])];
  const who = s?.provider === 'anthropic' ? 'Anthropic' : s?.provider === 'openai' ? 'OpenAI' : 'your AI provider';
  if (s && s.candidates?.length) {
    children.push(el('p', { class: 'help' }, [`Found by ${who} via web search on ${formatDate(s.searchedAt || s.analyzedAt)}. These are the model’s best matches and may be the wrong item — check the listing before buying. Links come from its search results; any it invented were dropped.`]));
    children.push(el('div', { class: 'found-list' }, s.candidates.map((c) => foundRow(item, c))));
  }
  if (s && s.suggestions?.length) {
    children.push(el('p', { class: 'help' }, [s.candidates?.length ? 'What it thinks the item is:' : `Suggested by ${who} on ${formatDate(s.analyzedAt)}. Guesses, not verified listings.`]));
    for (const g of s.suggestions) {
      const phrases = g.searchPhrases && g.searchPhrases.length ? g.searchPhrases : [g.name].filter(Boolean);
      children.push(el('div', { class: 'suggestion' }, [
        el('div', { class: 'suggestion-name' }, [g.name || 'Unnamed suggestion']),
        el('div', { class: 'suggestion-meta' }, [[g.brand, g.category].filter(Boolean).join(' · ')]),
        g.note ? el('div', { class: 'suggestion-meta' }, [g.note]) : null,
        el('div', { class: 'suggestion-actions' }, phrases.slice(0, 3).map((p) => el('a', { class: 'btn btn-sm', href: `https://www.google.com/search?q=${encodeURIComponent(p)}`, target: '_blank', rel: 'noopener noreferrer' }, [UI.externalIcon(), `Search the web: ${cut(p, 32)}`]))),
      ]));
    }
  }
  if (!s || (!s.candidates?.length && !s.suggestions?.length)) {
    children.push(el('p', { class: 'help' }, ['Sends this post’s stored thumbnail and caption to your AI provider, asks it what the product is, and (with web search on) looks for real listings with names, prices and links. You’ll see exactly what leaves the browser before it’s sent.']));
  }
  box.append(el('div', { class: 'category-box' }, children));
}

// --- collections ---------------------------------------------------------------------------------

function collectionHero(col) {
  const count = state.items.filter((i) => i.collectionId === col.id && !i.archived).length;
  const cover = col.coverImage || state.items.find((i) => i.collectionId === col.id && i.image && !i.archived)?.image || '';
  const coverNode = el('div', { class: 'cover' }, cover ? [el('img', { src: cover, alt: '', onError: (e) => e.target.remove() })] : [UI.initialFor(col.name)]);
  coverNode.style.background = col.color || '#8A9A88';
  const actions = [
    el('button', { type: 'button', class: 'btn btn-sm', onClick: () => renameCollection(col) }, ['Rename']),
    el('button', { type: 'button', class: 'btn btn-sm', onClick: () => editCollection(col) }, ['Keywords & color']),
    el('button', { type: 'button', class: 'btn btn-sm', onClick: () => mergeCollection(col) }, ['Merge into…']),
    el('button', { type: 'button', class: 'btn btn-sm btn-danger', onClick: () => deleteCollection(col) }, ['Delete']),
  ];
  const keywords = col.keywords || [];
  return el('div', { class: 'collection-hero' }, [
    coverNode,
    el('div', { class: 'collection-hero-text' }, [
      el('h2', {}, [col.name]),
      el('p', {}, [col.description || 'No description yet.', ` · ${pluralize(count, 'item', 'items')}`]),
      keywords.length ? el('div', { class: 'chips' }, keywords.slice(0, 12).map((k) => el('span', { class: 'pill' }, [k]))) : null,
      el('div', { class: 'collection-hero-actions' }, actions),
    ]),
  ]);
}

async function newCollection() {
  const name = await UI.promptDialog({ title: 'New collection', label: 'Name', placeholder: 'e.g. Garden', confirmLabel: 'Create' });
  if (!name) return;
  const { collection, existed } = await store.createCollection({ name });
  if (existed) UI.toast(`“${collection.name}” already exists — opening it.`);
  navigate(`#c/${collection.id}`);
}

async function renameCollection(col) {
  const name = await UI.promptDialog({ title: 'Rename collection', label: 'Name', value: col.name, confirmLabel: 'Rename' });
  if (!name || name === col.name) return;
  await store.updateCollection(col.id, { name });
  UI.toast('Renamed.', { duration: 1500 });
}

const SWATCHES = ['#8A9A88', '#5F6F5E', '#B9924F', '#A6503F', '#6B7C9B', '#8C6B8F', '#4F6F57', '#9C7A5B', '#6A6A6A', '#C97B4A'];

async function editCollection(col) {
  const desc = el('textarea', { class: 'textarea', rows: '2', maxlength: '300', placeholder: 'Description (optional)', 'aria-label': 'Description' });
  desc.value = col.description || '';
  const kw = el('textarea', { class: 'textarea', rows: '3', placeholder: 'One keyword or phrase per line — e.g. lamp, side table, throw pillow', 'aria-label': 'Keywords' });
  kw.value = (col.keywords || []).join('\n');
  let color = col.color || SWATCHES[0];
  const swatches = el('div', { class: 'color-swatches', role: 'radiogroup', 'aria-label': 'Color' }, SWATCHES.map((c) => {
    const b = el('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': c.toLowerCase() === color.toLowerCase() ? 'true' : 'false', 'aria-label': c, onClick: () => {
      color = c;
      swatches.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
    } });
    b.style.background = c;
    return b;
  }));
  const coverInput = el('input', { class: 'input', type: 'url', placeholder: 'https://… (leave empty to use the newest item’s image)', 'aria-label': 'Cover image URL' });
  coverInput.value = col.coverImage || '';
  await UI.openModal({
    title: `Edit “${col.name}”`,
    body: [
      el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Description']), desc]),
      el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Keywords']), kw, el('p', { class: 'help' }, ['Items whose title or page text contains one of these are filed here with high confidence.'])]),
      el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Color']), swatches]),
      el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Cover image']), coverInput]),
    ],
    actions: [
      { label: 'Cancel', quiet: true },
      { label: 'Save', primary: true, onClick: async () => {
        const keywords = kw.value.split(/\n|,/).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 40);
        await store.updateCollection(col.id, { description: desc.value, keywords, color, coverImage: coverInput.value.trim() });
        UI.toast('Collection updated.', { duration: 1500 });
      } },
    ],
  });
}

async function mergeCollection(col) {
  const others = ctx.regularCollections().filter((c) => c.id !== col.id);
  if (!others.length) {
    UI.toast('There is no other collection to merge into.');
    return;
  }
  const select = UI.selectInput({ value: others[0].id, options: others.map((c) => ({ value: c.id, label: c.name })), onChange: () => {}, label: 'Merge into' });
  const ok = await UI.openModal({
    title: `Merge “${col.name}”`,
    body: [
      el('p', { class: 'modal-text' }, [`Everything in “${col.name}” moves into the collection you pick, its name becomes an alias there, and “${col.name}” is removed. Learned preferences follow.`]),
      el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Merge into']), select]),
    ],
    actions: [{ label: 'Cancel', quiet: true, value: false }, { label: 'Merge', primary: true, value: true }],
  });
  if (ok !== true) return;
  const target = await store.mergeCollections(col.id, select.value);
  UI.toast(`Merged into ${target.name}.`);
  navigate(`#c/${target.id}`);
}

async function deleteCollection(col) {
  const count = state.items.filter((i) => i.collectionId === col.id).length;
  const deleteItemsCheck = el('input', { type: 'checkbox' });
  const extra = count ? el('label', { class: 'check' }, [deleteItemsCheck, el('span', {}, [`Also delete the ${pluralize(count, 'item', 'items')} inside (otherwise they'll be uncategorized, waiting in Review)`])]) : null;
  const ok = await UI.confirmDialog({ title: `Delete “${col.name}”?`, message: count ? `This collection holds ${pluralize(count, 'item', 'items')}.` : 'This collection is empty.', confirmLabel: 'Delete collection', danger: true, extra });
  if (!ok) return;
  await store.deleteCollection(col.id, { deleteItems: !!deleteItemsCheck.checked });
  UI.toast('Collection deleted.');
  navigate('#all');
}

// --- review queue --------------------------------------------------------------------------------

function renderReview(view) {
  const items = state.items.filter((i) => !i.collectionId && !i.archived);
  const page = el('div', { class: 'page page-wide' });
  page.append(el('p', { class: 'page-intro' }, ['Keepsake wasn’t confident enough to file these automatically. Pick a collection for each and it learns for next time.']));
  if (!items.length) {
    page.append(UI.emptyState({ title: 'Nothing to review', message: 'Uncategorized saves show up here. You’re all caught up.', icon: UI.checkIcon() }));
    view.append(page);
    return;
  }
  const list = el('div', { class: 'review-list' });
  const regular = ctx.regularCollections();
  for (const item of items) {
    const cls = classify(item, { collections: state.collections, prefs: state.prefs, settings: state.settings });
    const suggestions = (cls.alternatives || []).filter((a) => !a.isNew && a.collectionId).slice(0, 3);
    const select = UI.selectInput({
      value: '',
      options: [
        { value: '', label: 'Other collection…' },
        ...regular.map((c) => ({ value: c.id, label: c.name })),
        { value: '__new', label: '+ New collection…' },
      ],
      onChange: async (v) => {
        if (!v) return;
        if (v === '__new') {
          select.value = '';
          const name = await UI.promptDialog({ title: 'New collection', label: 'Name', placeholder: 'e.g. Garden', confirmLabel: 'Create' });
          if (!name) return;
          const { collection, existed } = await store.createCollection({ name });
          if (existed) UI.toast(`“${collection.name}” already exists — using it.`);
          await fileItem(item, collection.id);
          return;
        }
        await fileItem(item, v);
      },
      label: `Collection for ${item.title}`,
    });
    const row = el('div', { class: 'review-row' }, [
      UI.pictureNode({ src: item.image, title: item.title, className: 'review-pic' }),
      el('div', {}, [
        el('div', { class: 'review-title' }, [item.title]),
        el('div', { class: 'review-reason' }, [[item.retailer || item.host, item.categorizationReason || cls.reason].filter(Boolean).join(' · ')]),
        el('div', { class: 'review-actions' }, [
          ...suggestions.map((s) => el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => fileItem(item, s.collectionId) }, [`Move to ${s.collectionName}`])),
          select,
          el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: () => openQuickView(item.id) }, ['Details']),
          el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: () => deleteItems([item]) }, ['Delete']),
        ]),
      ]),
    ]);
    list.append(row);
  }
  page.append(list);
  view.append(page);
}

async function fileItem(item, collectionId) {
  await store.moveItems([item.id], collectionId, { learn: 'light' });
  const col = await store.getCollection(collectionId);
  UI.toast(`Moved to ${col ? col.name : 'collection'}.`);
}

// --- welcome ---------------------------------------------------------------------------------------

function renderWelcome(view) {
  if (state.settings && !state.settings.onboardingDone) store.updateSettings({ onboardingDone: true });
  const w = el('div', { class: 'welcome' }, [
    el('div', { class: 'welcome-hero' }, [
      el('h2', {}, ['Keep what catches your eye.']),
      el('p', {}, ['Keepsake saves products from any site into collections that sort themselves. Everything stays in this browser — no account, no cloud, no tracking.']),
      el('div', { class: 'actions-row', style: { marginTop: '18px' } }, [
        el('button', { type: 'button', class: 'btn btn-primary', onClick: () => navigate('#all') }, ['Start saving']),
        el('button', { type: 'button', class: 'btn', onClick: async () => { await loadSample(); navigate('#all'); } }, ['Load sample data']),
        el('button', { type: 'button', class: 'btn btn-quiet', onClick: () => navigate('#privacy') }, ['Read the privacy promise']),
      ]),
    ]),
    el('div', { class: 'steps' }, [
      step(1, 'Pin the icon', 'Click the puzzle-piece in Chrome’s toolbar and pin Keepsake so it’s one click away. Alt+Shift+K opens it too.'),
      step(2, 'Save from any page', 'On a product page, click the icon. Keepsake reads the title, price and image, picks a collection and shows you before saving.'),
      step(3, 'Let it learn', 'Move an item and Keepsake remembers. Unsure saves wait in Review instead of guessing.'),
      step(4, 'Optional extras', 'On-page save buttons for product grids, and an Instagram Saved-collection importer — both off until you turn them on.'),
    ]),
  ]);
  view.append(w);
}

function step(n, title, text) {
  return el('div', { class: 'step' }, [el('div', { class: 'step-num' }, [String(n)]), el('h3', {}, [title]), el('p', {}, [text])]);
}

boot().catch((e) => {
  console.error(e);
  const view = $('view');
  if (view) view.append(UI.emptyState({ title: 'Keepsake couldn’t start', message: String((e && e.message) || e) }));
});
