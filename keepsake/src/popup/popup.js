// Keepsake toolbar popup.
// Reads the active tab on demand (activeTab + scripting), previews the local
// classification, lets the user adjust anything, and saves through the
// background worker. Nothing here touches the network.

import { createStore, chromeBackend } from '../shared/storage.js';
import { MSG, SESSION_KEYS } from '../shared/messages.js';
import { el, clear, parsePrice, sanitizeText, pluralize } from '../shared/util.js';
import { isRestrictedUrl } from '../shared/url.js';
import { learnFromCorrection, nearMatchCollection, AUTO_FILE_CONFIDENCE } from '../shared/categorizer.js';

const store = createStore(chromeBackend());
const $ = (id) => document.getElementById(id);
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

const state = {
  tab: null,
  product: null,
  classification: null,
  collections: [],
  threshold: 0.6,
  duplicate: null,
  chosenImage: '',
  userOverride: false,
  savedItem: null,
  savedMode: 'saved', // saved | updated
  instant: false, // saved straight away (AI, or a confident local pick), without the preview
  ig: null,
  igScanListener: null,
};

const STATES = ['state-loading', 'state-restricted', 'state-instagram', 'state-product', 'state-saved'];
function show(id) {
  for (const s of STATES) $(s).classList.toggle('hidden', s !== id);
  $('state-loading').setAttribute('aria-busy', id === 'state-loading' ? 'true' : 'false');
  // The title box can only be measured once its section is visible; sized while
  // hidden it collapsed to 2px.
  if (id === 'state-product') autosize($('titleInput'));
}

function openDashboard(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') + hash });
  window.close();
}

async function applyTheme() {
  try {
    const settings = await store.getSettings();
    const theme = settings?.theme || 'system';
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  } catch {
    /* defaults */
  }
}

// --- boot --------------------------------------------------------------------------------------

async function boot() {
  $('openDashboard').addEventListener('click', () => openDashboard('#home'));
  $('importTabsBtn').addEventListener('click', () => openDashboard('#tabsimport'));
  $('openDashboardBrand').addEventListener('click', (e) => {
    e.preventDefault();
    openDashboard('#home');
  });
  $('restrictedDashboard').addEventListener('click', () => openDashboard('#home'));
  $('floatingLink').addEventListener('click', () => openDashboard('#settings'));
  await applyTheme();

  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = null;
  }
  state.tab = tab;
  if (!tab || !tab.id || isRestrictedUrl(tab.url || '')) {
    restricted(tab && tab.url && /^file:/i.test(tab.url)
      ? 'Keepsake can’t read local files. Open a product page on a website and try again.'
      : 'Chrome doesn’t let extensions read this kind of page (browser pages, the Web Store and some protected sites). Open a product page on a regular website and try again.');
    return;
  }

  const ig = globalThis.KeepsakeInstagram ? globalThis.KeepsakeInstagram.parseSavedUrl(tab.url) : null;
  if (ig && ig.isSaved) {
    state.ig = ig;
    await instagramPanel(ig);
    return;
  }
  await loadProduct();
}

function restricted(message) {
  $('restrictedMessage').textContent = message;
  show('state-restricted');
}

// --- product flow --------------------------------------------------------------------------------

async function loadProduct() {
  show('state-loading');
  const [extracted, collections, prefs] = await Promise.all([
    send({ type: MSG.EXTRACT_TAB, tabId: state.tab.id }),
    store.getCollections().catch(() => []),
    store.getPrefs().catch(() => ({})),
  ]);
  state.collections = collections;
  state.threshold = Number(prefs?.confidenceThreshold) || 0.6;
  if (!extracted.ok || !extracted.product) {
    restricted(extracted.error || 'Keepsake could not read this page.');
    return;
  }
  state.product = extracted.product;
  state.chosenImage = state.product.image || '';
  // Pages already saved always get the preview, with its "update existing" option.
  if (!(await store.findByUrl(state.product.canonicalUrl || state.product.url).catch(() => null))) {
    if (await instantSaveOn()) {
      if (await instantSave({ label: 'Saving with AI…' })) return;
    } else {
      const cls = await send({ type: MSG.CLASSIFY, product: state.product });
      const c = cls.ok ? cls.classification : null;
      if (c && !c.isInbox && c.confidence >= AUTO_FILE_CONFIDENCE && await instantSave({ label: 'Saving…', classification: c })) return;
    }
  }
  await showPreview();
}

// With AI on (and a key saved), the popup always saves straight away: the AI
// tidies the title and picks the collection in the background worker.
async function instantSaveOn() {
  try {
    const settings = await store.getSettings();
    return !!settings.ai?.on && !!(await store.getSecret('aiApiKey'));
  } catch {
    return false;
  }
}

async function instantSave({ label, classification = null }) {
  $('loadingText').textContent = label;
  const res = await send({ type: MSG.SAVE_ITEM, product: state.product, source: 'toolbar', classification });
  if (!res.ok || res.duplicate) return false;
  state.instant = true;
  state.collections = await store.getCollections().catch(() => state.collections); // may include one the save just created
  state.savedItem = res.item;
  state.savedMode = 'saved';
  showSaved(res.item, res.collection);
  return true;
}

// The editable preview: shown normally, for pages already saved, and after undoing an instant save.
async function showPreview() {
  $('loadingText').textContent = 'Looking at this page…';
  show('state-loading');
  const [cls, dup] = await Promise.all([
    send({ type: MSG.CLASSIFY, product: state.product }),
    store.findByUrl(state.product.canonicalUrl || state.product.url).catch(() => null),
  ]);
  state.classification = cls.ok ? cls.classification : { collectionId: null, collectionName: 'Review', confidence: 0, reason: '', isInbox: true, isNew: false };
  state.duplicate = dup;
  renderProduct();
  show('state-product');
}

function renderProduct() {
  const p = state.product;
  $('sparseNotice').classList.toggle('hidden', !p.sparse);

  // Retailer + host
  $('retailer').textContent = p.retailer || p.host || '';
  $('host').textContent = p.host || '';
  $('host').title = p.canonicalUrl || p.url || '';

  // Title
  const title = $('titleInput');
  title.value = p.title || '';
  autosize(title);
  title.addEventListener('input', () => autosize(title));
  $('heroInitial').textContent = (p.title || p.host || 'K').trim().charAt(0).toUpperCase() || 'K';

  // Price
  const priceInput = $('priceInput');
  const curInput = $('currencyInput');
  if (p.price !== null && p.price !== undefined && p.price !== '' && Number.isFinite(Number(p.price))) {
    priceInput.value = String(p.price);
    curInput.value = p.currency || '';
  } else if (p.priceText) {
    const parsed = parsePrice(p.priceText, p.currency);
    priceInput.value = parsed ? String(parsed.amount) : '';
    curInput.value = parsed ? parsed.currency || p.currency || '' : p.currency || '';
  } else {
    priceInput.value = '';
    curInput.value = p.currency || '';
  }
  priceInput.addEventListener('input', () => {
    const parsed = parsePrice(priceInput.value, curInput.value);
    if (parsed && parsed.currency && !curInput.value) curInput.value = parsed.currency;
  });

  // Images
  setHeroImage(state.chosenImage);
  const cands = (p.images || []).filter(Boolean).slice(0, 6);
  const candBox = $('candidates');
  clear(candBox);
  if (cands.length > 1) {
    cands.forEach((src, i) => {
      const b = el('button', {
        type: 'button', class: 'candidate', role: 'radio', 'aria-checked': src === state.chosenImage ? 'true' : 'false', 'aria-label': `Image ${i + 1}`,
        onClick: () => {
          state.chosenImage = src;
          setHeroImage(src);
          candBox.querySelectorAll('.candidate').forEach((c) => c.setAttribute('aria-checked', c === b ? 'true' : 'false'));
        },
      }, [el('img', { src, alt: '', loading: 'lazy', onError: () => b.remove() })]);
      candBox.append(b);
    });
    candBox.classList.remove('hidden');
  } else {
    candBox.classList.add('hidden');
  }

  renderCollectionPicker();
  renderDuplicate();

  $('saveBtn').addEventListener('click', () => save({ force: false }));
  $('dupCopy').addEventListener('click', () => save({ force: true }));
  $('dupUpdate').addEventListener('click', () => updateExisting());
  $('newCollectionCancel').addEventListener('click', () => {
    $('newCollectionRow').classList.add('hidden');
    $('nearMatchRow').classList.add('hidden');
    $('collectionSelect').value = state.classification.isNew ? `new:${state.classification.taxonomyKey}` : state.classification.collectionId || '';
    state.userOverride = false;
    updateConfidencePill();
  });
  $('newCollectionInput').addEventListener('input', () => $('nearMatchRow').classList.add('hidden'));
  $('newCollectionInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save({ force: !!state.duplicate });
    }
  });
  setTimeout(() => $('saveBtn').focus(), 30);
}

function setHeroImage(src) {
  const img = $('heroImg');
  const ph = $('heroPlaceholder');
  if (!src) {
    img.hidden = true;
    img.removeAttribute('src');
    ph.hidden = false;
    return;
  }
  img.onload = () => {
    img.hidden = false;
    ph.hidden = true;
  };
  img.onerror = () => {
    img.hidden = true;
    ph.hidden = false;
  };
  img.src = src;
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(96, ta.scrollHeight + 2) + 'px';
}

function renderCollectionPicker() {
  const sel = $('collectionSelect');
  clear(sel);
  const cls = state.classification;
  if (cls.isInbox) sel.append(el('option', { value: '', text: 'Not sure — leave for Review' }));
  for (const c of state.collections) sel.append(el('option', { value: c.id, text: c.name }));
  if (cls.isNew && cls.taxonomyKey) {
    sel.append(el('option', { value: `new:${cls.taxonomyKey}`, text: `${cls.collectionName} (new collection)` }));
  }
  sel.append(el('option', { value: '__new', text: '＋ New collection…' }));
  const initial = cls.isNew ? `new:${cls.taxonomyKey}` : cls.collectionId || '';
  sel.value = initial;
  if (sel.value !== initial) sel.value = sel.options[0]?.value || '';
  sel.onchange = () => {
    if (sel.value === '__new') {
      $('newCollectionRow').classList.remove('hidden');
      $('newCollectionInput').focus();
      state.userOverride = true;
    } else {
      $('newCollectionRow').classList.add('hidden');
      state.userOverride = sel.value !== initial;
    }
    updateConfidencePill();
  };
  updateConfidencePill();
}

function updateConfidencePill() {
  const pill = $('confidencePill');
  const cls = state.classification;
  const reason = $('reason');
  pill.className = 'pill';
  if (state.userOverride) {
    pill.textContent = 'Your choice';
    pill.classList.add('pill-ok');
    pill.title = 'Keepsake will learn from this';
    reason.textContent = 'Keepsake will remember choices like this for similar items.';
    return;
  }
  const pct = Math.round((cls.confidence || 0) * 100);
  if (cls.isInbox) {
    pill.textContent = 'Needs sorting';
    pill.classList.add('pill-warn');
    pill.title = cls.reason || '';
    reason.textContent = cls.suggested ? `Not sure — maybe ${cls.suggested.collectionName}? You can pick a collection above or sort it later.` : 'Not enough signals to place this automatically. Pick a collection above or sort it later from Review.';
  } else {
    const level = cls.confidence >= 0.75 ? 'High' : cls.confidence >= state.threshold ? 'Good' : 'Low';
    pill.textContent = `${level} · ${pct}%`;
    pill.classList.add(level === 'Low' ? 'pill-warn' : 'pill-ok');
    pill.title = cls.reason || '';
    reason.textContent = cls.reason ? capitalize(cls.reason) : '';
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function renderDuplicate() {
  const row = $('dupRow');
  const dup = state.duplicate;
  if (!dup) {
    row.classList.add('hidden');
    $('saveActions').classList.remove('hidden');
    return;
  }
  const col = state.collections.find((c) => c.id === dup.collectionId);
  $('dupText').textContent = `“${cut(dup.title, 60)}” is already in ${col ? col.name : 'Keepsake'}.`;
  row.classList.remove('hidden');
  $('saveActions').classList.add('hidden');
}

function cut(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function collectEdits() {
  const p = { ...state.product };
  p.title = sanitizeText($('titleInput').value, 200) || p.title;
  p.price = null;
  p.priceText = $('priceInput').value.trim();
  p.currency = sanitizeText($('currencyInput').value, 4).toUpperCase();
  if (state.chosenImage) {
    p.image = state.chosenImage;
    p.images = [state.chosenImage, ...(p.images || []).filter((u) => u !== state.chosenImage)];
  }
  return p;
}

async function resolveCollectionChoice() {
  const sel = $('collectionSelect');
  if (sel.value === '__new') {
    const name = sanitizeText($('newCollectionInput').value, 80);
    if (!name) {
      $('newCollectionInput').focus();
      throw new Error('Give the new collection a name.');
    }
    // A name close to an existing collection ("Food" vs Kitchen, which covers food):
    // ask which one was meant instead of quietly using the existing one.
    const near = state.confirmedNewName === name ? null : nearMatchCollection(name, state.collections);
    if (near) {
      askNearMatch(name, near);
      throw ASKED;
    }
    const { collection, existed } = await store.createCollection({ name });
    if (existed) {
      state.collections = await store.getCollections();
      renderCollectionPicker();
      sel.value = collection.id;
      state.userOverride = collection.id !== state.classification.collectionId;
    }
    return collection.id;
  }
  return sel.value;
}

// Thrown to stop a save while the near-match question is showing; not an error.
const ASKED = new Error('asked');

function askNearMatch(name, near) {
  const other = near.collection.name;
  $('nearMatchText').textContent = near.matched
    ? `You already have “${other}”, which also covers “${near.matched}”.`
    : `You already have a collection with a similar name, “${other}”.`;
  const create = $('nearMatchCreate');
  const use = $('nearMatchUse');
  create.textContent = `Create “${cut(name, 24)}”`;
  use.textContent = `Use “${cut(other, 24)}”`;
  const retry = state.retry;
  create.onclick = () => {
    state.confirmedNewName = name;
    $('nearMatchRow').classList.add('hidden');
    if (retry) retry();
  };
  use.onclick = () => {
    $('collectionSelect').value = near.collection.id;
    $('newCollectionRow').classList.add('hidden');
    $('nearMatchRow').classList.add('hidden');
    state.userOverride = near.collection.id !== state.classification.collectionId;
    updateConfidencePill();
    if (retry) retry();
  };
  $('nearMatchRow').classList.remove('hidden');
  create.focus();
}

function setBusy(busy) {
  for (const id of ['saveBtn', 'dupUpdate', 'dupCopy']) {
    const b = $(id);
    b.disabled = busy;
  }
  $('saveBtn').textContent = busy ? 'Saving…' : 'Save item';
}

async function save({ force }) {
  const err = $('saveError');
  err.classList.add('hidden');
  setBusy(true);
  state.retry = () => save({ force });
  try {
    const chosen = await resolveCollectionChoice();
    const product = collectEdits();
    const note = sanitizeText($('noteInput').value, 1000);
    const res = await send({
      type: MSG.SAVE_ITEM, product, force, note, source: 'toolbar',
      collectionId: state.userOverride ? chosen : null,
      classification: state.userOverride ? null : state.classification,
      learn: 'light',
    });
    if (!res.ok) throw new Error(res.error || 'Could not save.');
    if (res.duplicate) {
      state.duplicate = res.existing;
      renderDuplicate();
      return;
    }
    state.savedItem = res.item;
    state.savedMode = 'saved';
    // The save may have created a collection (typed in, or a default one on demand);
    // reload so the "Move to" menu lists it and shows it selected.
    if (res.collection && !state.collections.some((c) => c.id === res.collection.id)) state.collections = await store.getCollections();
    showSaved(res.item, res.collection);
  } catch (e) {
    if (e === ASKED) return;
    err.textContent = String((e && e.message) || e);
    err.classList.remove('hidden');
  } finally {
    setBusy(false);
  }
}

async function updateExisting() {
  const err = $('saveError');
  err.classList.add('hidden');
  setBusy(true);
  state.retry = () => updateExisting();
  try {
    const chosen = await resolveCollectionChoice();
    const product = collectEdits();
    const patch = { title: product.title, priceText: product.priceText, currency: product.currency, image: product.image, images: product.images };
    const note = sanitizeText($('noteInput').value, 1000);
    if (note) patch.note = note;
    if (state.userOverride && chosen && chosen !== state.duplicate.collectionId) patch.collectionId = chosen;
    const res = await send({ type: MSG.UPDATE_ITEM, itemId: state.duplicate.id, patch, learn: 'light' });
    if (!res.ok) throw new Error(res.error || 'Could not update.');
    state.savedItem = res.item;
    state.savedMode = 'updated';
    const col = state.collections.find((c) => c.id === res.item.collectionId);
    showSaved(res.item, col);
  } catch (e) {
    if (e === ASKED) return;
    err.textContent = String((e && e.message) || e);
    err.classList.remove('hidden');
  } finally {
    setBusy(false);
  }
}

function showSaved(item, collection) {
  const isInbox = !collection;
  const name = collection ? collection.name : 'Keepsake';
  $('savedTitle').textContent = state.savedMode === 'updated' ? 'Updated' : isInbox ? 'Not sure — saved for review' : `Saved to ${name}`;
  $('savedSubtitle').textContent = cut(item.title, 80);
  const thumb = $('savedThumb');
  clear(thumb);
  if (item.image) thumb.append(el('img', { src: item.image, alt: '', onError: () => clear(thumb) }));
  $('savedInboxHint').textContent = isInbox ? 'Keepsake wasn’t sure where this belongs. You’ll find it in Review, ready to sort.' : '';
  $('savedUndo').classList.toggle('hidden', state.savedMode === 'updated');
  const learnRow = $('learnRow');
  const learnCheck = $('learnCheck');
  learnCheck.checked = false;
  learnRow.classList.toggle('hidden', !(state.userOverride && state.savedMode === 'saved' && !isInbox));
  learnCheck.onchange = async () => {
    if (!learnCheck.checked) return;
    try {
      const prefs = await store.getPrefs();
      await store.setPrefs(learnFromCorrection(item, state.classification?.collectionId || null, item.collectionId, prefs, { strong: true }));
    } catch {
      /* best effort */
    }
  };
  renderSavedMove(item);
  $('savedUndo').onclick = async () => {
    $('savedUndo').disabled = true;
    await send({ type: MSG.UNDO_SAVE, itemId: item.id });
    state.duplicate = null;
    if (state.instant) {
      // Nothing was previewed yet: undoing an instant save opens the editable preview instead.
      state.instant = false;
      await showPreview();
    } else {
      renderDuplicate();
      show('state-product');
    }
    $('savedUndo').disabled = false;
  };
  // Show the item where it landed: its collection, or Review if it wasn't filed.
  $('savedOpen').onclick = () => openDashboard(state.savedItem?.collectionId ? `#c/${state.savedItem.collectionId}` : '#review');
  show('state-saved');
  setTimeout(() => $('savedOpen').focus(), 30);
}

// After every save: a one-step "Move to", so a wrong collection is easy to spot and fix.
function renderSavedMove(item) {
  const row = $('savedMoveRow');
  row.classList.toggle('hidden', state.savedMode !== 'saved');
  if (state.savedMode !== 'saved') return;
  const sel = $('savedMove');
  clear(sel);
  if (!item.collectionId) sel.append(el('option', { value: '', text: 'Review (not sorted)' }));
  for (const c of state.collections) sel.append(el('option', { value: c.id, text: c.name }));
  sel.value = item.collectionId || '';
  sel.onchange = async () => {
    if (!sel.value) return;
    sel.disabled = true;
    const res = await send({ type: MSG.UPDATE_ITEM, itemId: item.id, patch: { collectionId: sel.value }, learn: 'light' });
    sel.disabled = false;
    if (!res.ok) return;
    state.savedItem = res.item;
    const col = state.collections.find((c) => c.id === sel.value);
    $('savedTitle').textContent = `Moved to ${col ? col.name : 'collection'}`;
    $('savedInboxHint').textContent = '';
    const placeholder = sel.querySelector('option[value=""]');
    if (placeholder) placeholder.remove();
  };
}

// --- Instagram import ------------------------------------------------------------------------------

async function instagramPanel(ig) {
  show('state-instagram');
  const nameGuess = ig.isCollection ? ig.collectionName || 'this collection' : '';
  if (!ig.isCollection) {
    $('igTitle').textContent = 'Open a Saved collection';
    $('igSubtitle').textContent = 'You’re on the Saved overview. Open one of your collections (or “All posts”), then click Keepsake again.';
    $('igIdle').classList.add('hidden');
    $('igRunning').classList.add('hidden');
    $('igDone').classList.add('hidden');
    $('igError').classList.add('hidden');
    return;
  }
  $('igTitle').textContent = `“${nameGuess}”`;
  $('igSubtitle').textContent = ig.username ? `Saved collection · @${ig.username}` : 'Saved collection';
  $('igName').textContent = nameGuess;

  $('igStart').addEventListener('click', startScan);
  $('igRetry').addEventListener('click', startScan);
  $('igAgain').addEventListener('click', async () => {
    await send({ type: MSG.IG_SCAN_CLEAR });
    startScan();
  });
  $('igStop').addEventListener('click', async () => {
    $('igStop').disabled = true;
    $('igStatus').textContent = 'Stopping…';
    await send({ type: MSG.IG_STOP_SCAN, tabId: state.tab.id });
  });
  $('igReview').addEventListener('click', () => openDashboard('#import'));

  const res = await send({ type: MSG.IG_SCAN_STATE });
  const scan = res.ok ? res.scan : null;
  if (scan && scan.tabId === state.tab.id && scan.status !== 'error') renderScan(scan);
  else if (scan && scan.posts && scan.posts.length && scan.status === 'done') {
    // A finished scan from another tab is waiting for review.
    igView('idle');
    $('igIdle').append(el('p', { class: 'help' }, [
      `A previous scan (${pluralize(scan.posts.length, 'post', 'posts')}) is waiting. `,
      el('button', { type: 'button', class: 'btn-link small', onClick: () => openDashboard('#import') }, ['Review it']),
    ]));
  } else igView('idle');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes[SESSION_KEYS.igScan]) return;
    const next = changes[SESSION_KEYS.igScan].newValue;
    if (next && next.tabId === state.tab.id) renderScan(next);
  });
}

function igView(which) {
  for (const v of ['idle', 'running', 'done', 'error']) {
    $('ig' + v.charAt(0).toUpperCase() + v.slice(1)).classList.toggle('hidden', v !== which);
  }
}

async function startScan() {
  igView('running');
  $('igStop').disabled = false;
  $('igCount').textContent = '0';
  $('igStatus').textContent = 'Starting…';
  const res = await send({ type: MSG.IG_START_SCAN, tabId: state.tab.id });
  if (!res.ok) {
    $('igErrorNotice').textContent = res.error || 'Could not start the scan. Reload the Instagram tab and try again.';
    igView('error');
  }
}

function renderScan(scan) {
  const n = scan.posts ? scan.posts.length : 0;
  if (scan.collectionName) {
    $('igTitle').textContent = `“${scan.collectionName}”`;
    $('igName').textContent = scan.collectionName;
  }
  if (scan.status === 'scanning' || scan.status === 'starting') {
    igView('running');
    $('igCount').textContent = String(n);
    $('igStatus').textContent = n ? 'Scrolling to load more…' : 'Looking for posts…';
  } else if (scan.status === 'done') {
    igView('done');
    const why = { end: 'reached the end of the collection', limit: 'reached the safety limit', idle: 'no new posts appeared', stopped: 'stopped by you' }[scan.reason] || 'finished';
    $('igDoneNotice').textContent = n ? `Found ${pluralize(n, 'post', 'posts')} — ${why}.` : `No posts were found (${why}). Make sure the collection has loaded, then try again.`;
    $('igReview').textContent = n ? `Review ${pluralize(n, 'post', 'posts')}` : 'Open import';
  } else if (scan.status === 'error') {
    igView('error');
    $('igErrorNotice').textContent = scan.error || 'The scan failed.';
  }
}

boot().catch((e) => restricted(String((e && e.message) || e)));
