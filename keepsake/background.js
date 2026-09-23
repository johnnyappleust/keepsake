// Keepsake background service worker (MV3, ES module).
// It only wakes up for: install/startup, context-menu clicks, messages from
// the popup/dashboard/content scripts, permission changes and settings changes.
// It has no timers and no alarms. Its only network access is the optional AI
// provider call during a save, when the user has turned Optional AI on.

import { createStore, chromeBackend } from './src/shared/storage.js';
import { classify, learnFromCorrection, AUTO_FILE_CONFIDENCE } from './src/shared/categorizer.js';
import { parsePrice, sanitizeText } from './src/shared/util.js';
import { isRestrictedUrl, openableUrl } from './src/shared/url.js';
import { MSG, SESSION_KEYS } from './src/shared/messages.js';
import { cleanupWithAI } from './src/ai/provider.js';

const store = createStore(chromeBackend());
const CONTENT_SCRIPT_ID = 'keepsake-floating';
const CONTEXT_MENU_ID = 'keepsake-save';

// --- lifecycle -----------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  const { fresh } = await store.init();
  await createContextMenu();
  await syncContentScripts();
  if (details.reason === 'install' && fresh) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html#welcome') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await store.init();
  await createContextMenu();
  await syncContentScripts();
});

async function createContextMenu() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
  chrome.contextMenus.create({ id: CONTEXT_MENU_ID, title: 'Save to Keepsake', contexts: ['page', 'image', 'link', 'selection'] }, () => void chrome.runtime.lastError);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab || !tab.id) return;
  const pageUrl = info.pageUrl || tab.url || '';
  if (isRestrictedUrl(pageUrl)) return;
  try {
    const hints = { imageUrl: info.srcUrl || '', linkUrl: info.linkUrl || '', selectionText: info.selectionText || '' };
    // Right-clicked an image or link inside a product card (listing pages):
    // read just that card, the same way the on-page buttons do.
    const card = (info.srcUrl || info.linkUrl) ? await extractCardFromTab(tab.id, info.srcUrl || '', info.linkUrl || '') : null;
    if (card && card.url && card.title) {
      if (info.srcUrl && !card.images.includes(info.srcUrl)) card.images.unshift(info.srcUrl);
      if (info.srcUrl) card.image = info.srcUrl;
      const res = await saveProduct(card, { source: 'context-menu', instant: true });
      await showPageToast(tab.id, res, card);
      return;
    }
    const product = await extractFromTab(tab.id, hints);
    if (!product) throw new Error('Keepsake could not read this page.');
    if (info.linkUrl && !info.srcUrl && info.linkText && info.linkUrl !== pageUrl) {
      // Right-clicked a product link: save the link target, titled by the link text.
      product.url = info.linkUrl;
      product.canonicalUrl = info.linkUrl;
      product.title = sanitizeText(info.linkText, 200) || product.title;
      product.image = '';
      product.images = [];
      product.price = null;
      product.priceText = '';
    }
    const res = await saveProduct(product, { source: 'context-menu', instant: true });
    await showPageToast(tab.id, res, product);
  } catch (e) {
    await showPageToast(tab.id, { ok: false, error: friendlyError(e) });
  }
});

// --- extraction ----------------------------------------------------------------------------

async function extractFromTab(tabId, hints = {}) {
  await chrome.scripting.executeScript({ target: { tabId }, func: (h) => { globalThis.__keepsakeHints = h; }, args: [hints] });
  const results = await chrome.scripting.executeScript({ target: { tabId }, files: ['src/extract/extract.js'] });
  let product = results && results[0] ? results[0].result : null;
  if (!product || typeof product !== 'object') {
    const again = await chrome.scripting.executeScript({ target: { tabId }, func: () => (globalThis.__keepsakeExtract ? globalThis.__keepsakeExtract() : null) });
    product = again && again[0] ? again[0].result : null;
  }
  return product && typeof product === 'object' ? product : null;
}

// Find the card around a right-clicked image/link and extract only that card.
async function extractCardFromTab(tabId, srcUrl, linkUrl) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/detector.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [srcUrl, linkUrl],
      func: (src, link) => {
        const det = globalThis.__keepsakeDetector;
        if (!det) return null;
        let node = null;
        if (src) node = Array.from(document.images).find((i) => i.currentSrc === src || i.src === src) || null;
        if (!node && link) node = Array.from(document.querySelectorAll('a[href]')).find((a) => a.href === link) || null;
        if (!node) return null;
        det.resetCache();
        const card = det.resolveCard(node);
        if (!card || card.kind !== 'card') return null;
        return det.extractCard(card);
      },
    });
    const card = results && results[0] ? results[0].result : null;
    return card && typeof card === 'object' ? card : null;
  } catch {
    return null;
  }
}

function friendlyError(e) {
  const m = String((e && e.message) || e || '');
  if (/cannot access|cannot be scripted|extensions gallery|chrome:\/\/|Missing host permission|The extensions gallery/i.test(m)) {
    return 'Chrome does not let extensions read this page (browser pages, the Web Store and some protected sites). Try a regular website.';
  }
  if (/No tab with id|Receiving end does not exist|message port closed/i.test(m)) return 'The page changed before Keepsake could finish. Try again.';
  return m || 'Something went wrong.';
}

// --- saving --------------------------------------------------------------------------------------

function normalizeProduct(raw) {
  const p = { ...(raw || {}) };
  if (p.price === null || p.price === undefined || p.price === '' || Number.isNaN(Number(p.price))) {
    const parsed = parsePrice(p.priceText || p.price, p.currency);
    if (parsed) {
      p.price = parsed.amount;
      p.currency = p.currency || parsed.currency;
    } else {
      p.price = null;
    }
  } else if (typeof p.price === 'string') {
    const parsed = parsePrice(p.price, p.currency);
    p.price = parsed ? parsed.amount : null;
    p.currency = p.currency || (parsed ? parsed.currency : '');
  }
  p.currency = sanitizeText(p.currency, 8).toUpperCase();
  return p;
}

// instant: saved with no preview (on-page button, right-click). Then a local pick below
// AUTO_FILE_CONFIDENCE goes to Review with that pick as the suggestion, like the toolbar.
async function saveProduct(rawProduct, { collectionId = null, force = false, source = 'toolbar', classification: given = null, note = '', learn = 'light', instant = false } = {}) {
  const product = normalizeProduct(rawProduct);
  if (!force) {
    const existing = await store.findByUrl(product.canonicalUrl || product.url);
    if (existing) {
      const col = existing.collectionId ? await store.getCollection(existing.collectionId) : null;
      return { ok: true, duplicate: true, existing: { id: existing.id, title: existing.title, collectionId: existing.collectionId, collectionName: col ? col.name : '' } };
    }
  }
  const [collections, prefs, settings] = await Promise.all([store.getCollections(), store.getPrefs(), store.getSettings()]);
  let classification = given || classify(product, { collections, prefs, settings });
  let categorizationSource = 'local';

  const threshold = prefs.confidenceThreshold || 0.6;

  // With AI on, saves are instant: the AI tidies the title and picks the collection. Its pick wins
  // when it is confident; otherwise a confident local pick stands, and anything
  // else waits in Review. If the call fails, the save goes ahead as it would without AI.
  if (!collectionId && settings.ai?.on) {
    try {
      const key = await store.getSecret('aiApiKey');
      if (key) {
        const res = await cleanupWithAI([{ ref: 'new', item: product, live: null }], collections, settings, key);
        const ai = res.get('new');
        if (ai && ai.title && !product.isInstagram && product.type !== 'instagram') product.title = ai.title;
        if (ai && ai.collectionId && ai.confidence >= threshold) {
          classification = { ...classification, collectionId: ai.collectionId, collectionName: ai.collectionName, confidence: ai.confidence, reason: `AI: ${ai.reason || 'best match'}`, isNew: false, isInbox: false, taxonomyKey: null };
          categorizationSource = 'ai';
        }
      }
    } catch {
      /* fall back to the local result */
    }
  }

  if (instant && !collectionId && categorizationSource === 'local' && !classification.isInbox && classification.confidence < AUTO_FILE_CONFIDENCE) {
    const pick = { collectionId: classification.collectionId, collectionName: classification.collectionName, taxonomyKey: classification.taxonomyKey, isNew: classification.isNew };
    classification = { ...classification, collectionId: null, collectionName: 'Review', taxonomyKey: null, isNew: false, isInbox: true, suggested: pick, reason: `Not sure (${Math.round(classification.confidence * 100)}%) — maybe ${pick.collectionName}: ${classification.reason}` };
  }

  let targetId = collectionId;
  if (typeof targetId === 'string' && targetId.startsWith('new:')) {
    const col = await store.ensureCollectionForTaxonomy(targetId.slice(4));
    targetId = col ? col.id : null;
  }
  const userChose = !!targetId && targetId !== classification.collectionId;
  if (!targetId) {
    if (classification.isNew) {
      const col = await store.ensureCollectionForTaxonomy(classification.taxonomyKey);
      targetId = col ? col.id : null;
      if (col) classification = { ...classification, collectionId: col.id, collectionName: col.name };
    } else {
      targetId = classification.collectionId;
    }
  }
  const item = await store.addItem({
    ...product,
    note,
    collectionId: targetId,
    confidence: userChose ? 1 : classification.confidence,
    categorizationSource: userChose ? 'manual' : categorizationSource,
    categorizationReason: userChose ? 'Chosen by you' : classification.reason,
    needsReview: !userChose && classification.isInbox,
  });
  const collection = targetId ? await store.getCollection(targetId) : null;
  if (userChose && learn && product.title) {
    // Overriding the suggestion is a correction worth learning from.
    const prefs2 = await store.getPrefs();
    await store.setPrefs(learnFromCorrection(item, classification.isInbox ? null : classification.collectionId, targetId, prefs2, { strong: learn === 'strong' }));
  }
  if (collection && !collection.coverImage && item.image) {
    await store.updateCollection(collection.id, { coverImage: item.image });
  }
  return { ok: true, item, collection, classification: { ...classification, collectionId: targetId, collectionName: collection ? collection.name : classification.collectionName } };
}

async function showPageToast(tabId, res, product) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/toast.js'] });
    const payload = res.ok
      ? res.duplicate
        ? { kind: 'duplicate', existing: res.existing, title: (product && product.title) || '' }
        : { kind: 'saved', itemId: res.item.id, title: res.item.title, collectionName: res.collection ? res.collection.name : 'Keepsake', isInbox: !!res.classification?.isInbox }
      : { kind: 'error', error: res.error || 'Something went wrong.' };
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [payload, MSG],
      func: (p, M) => {
        const t = globalThis.__keepsakeToast;
        if (!t) return;
        const send = (m) => chrome.runtime.sendMessage(m, () => void chrome.runtime.lastError);
        const cut = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));
        if (p.kind === 'error') t.show({ title: 'Couldn’t save', message: p.error });
        else if (p.kind === 'duplicate') t.show({ title: 'Already in Keepsake', message: `“${cut(p.existing.title || p.title, 60)}” is ${p.existing.collectionName ? 'in ' + p.existing.collectionName : 'already saved'}.`, actions: [{ label: 'Open', primary: true, onClick: () => send({ type: M.OPEN_DASHBOARD, hash: `#item/${p.existing.id}` }) }] });
        else t.show({
          title: p.isInbox ? 'Not sure — saved for review' : `Saved to ${p.collectionName}`,
          message: p.isInbox ? `Not sure where “${cut(p.title, 50)}” belongs — sort it from the Review queue.` : cut(p.title, 70),
          actions: [
            { label: 'Undo', onClick: () => send({ type: M.UNDO_SAVE, itemId: p.itemId }) },
            { label: 'Edit', quiet: true, onClick: () => send({ type: M.OPEN_DASHBOARD, hash: `#item/${p.itemId}` }) },
          ],
        });
      },
    });
  } catch {
    /* page may not be scriptable; the save still happened */
  }
}

// --- floating-button content scripts --------------------------------------------------------------

async function grantedOrigins() {
  const perms = await chrome.permissions.getAll();
  return perms.origins || [];
}

function patternGranted(pattern, granted) {
  return granted.includes('<all_urls>') || granted.includes('*://*/*') || granted.includes(pattern) || granted.includes(pattern.replace(/^\*:\/\//, 'https://')) || granted.includes(pattern.replace(/^\*:\/\//, 'http://'));
}

export async function syncContentScripts() {
  const settings = await store.getSettings();
  const mode = settings.floating.mode;
  const granted = await grantedOrigins();
  let matches = [];
  if (mode === 'all') matches = granted.includes('<all_urls>') || granted.includes('*://*/*') ? ['*://*/*'] : granted.filter((p) => p.startsWith('*://') || p.startsWith('http'));
  else if (mode === 'selected') matches = (settings.floating.sites || []).filter((p) => patternGranted(p, granted));
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => []);
  if (mode === 'off' || !matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => {});
    return { registered: false, matches: [] };
  }
  const script = { id: CONTENT_SCRIPT_ID, js: ['src/content/toast.js', 'src/content/detector.js', 'src/content/floating.js'], matches, runAt: 'document_idle', persistAcrossSessions: true, allFrames: false };
  try {
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch (e) {
    // A stale registration can reference a revoked origin; start over.
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => {});
    await chrome.scripting.registerContentScripts([script]).catch(() => {});
  }
  return { registered: true, matches };
}

async function broadcastFloatingRefresh() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const t of tabs) {
    if (!t.id) continue;
    chrome.tabs.sendMessage(t.id, { type: MSG.FLOATING_REFRESH }, () => void chrome.runtime.lastError);
  }
}

chrome.permissions.onRemoved.addListener(async () => {
  await syncContentScripts();
  await broadcastFloatingRefresh();
});
chrome.permissions.onAdded.addListener(async () => {
  await syncContentScripts();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.keepsake_settings) {
    syncContentScripts().then(broadcastFloatingRefresh);
  }
});

async function floatingConfig(host) {
  const settings = await store.getSettings();
  const f = settings.floating;
  const hidden = (f.hiddenSites || []).map((h) => h.toLowerCase());
  const hostLc = String(host || '').toLowerCase().replace(/^www\./, '');
  const enabled = f.mode !== 'off' && !hidden.includes(hostLc) && !hidden.includes('www.' + hostLc);
  const collections = (await store.getCollections()).map((c) => ({ id: c.id, name: c.name }));
  const prefs = await store.getPrefs();
  const instantSave = !!settings.ai?.on && !!(await store.getSecret('aiApiKey'));
  return { ok: true, enabled, settings: f, collections, threshold: prefs.confidenceThreshold, instantSave };
}

// --- Instagram scan state ------------------------------------------------------------------------------

async function getScan() {
  const raw = await chrome.storage.session.get(SESSION_KEYS.igScan);
  return raw[SESSION_KEYS.igScan] || null;
}

async function setScan(scan) {
  await chrome.storage.session.set({ [SESSION_KEYS.igScan]: scan });
}

async function startInstagramScan(tabId) {
  const settings = await store.getSettings();
  const ig = settings.instagram;
  await setScan({ tabId, status: 'starting', posts: [], collectionName: '', startedAt: Date.now() });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (o) => { globalThis.__keepsakeIgScanOptions = o; if (globalThis.__keepsakeIgScan) { globalThis.__keepsakeIgScan.running = false; } },
    args: [{ safetyLimit: ig.safetyLimit, idleTimeoutMs: ig.idleTimeoutMs, storeThumbnails: ig.storeThumbnails, autoScroll: true }],
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/instagram/adapter.js', 'src/instagram/scan.js'] });
  return { ok: true };
}

function sanitizePost(p) {
  const str = (v, n) => (typeof v === 'string' ? sanitizeText(v, n) : '');
  const list = (v, n, f) => (Array.isArray(v) ? v.slice(0, n).map(f).filter(Boolean) : []);
  return {
    url: str(p.url, 300), shortcode: str(p.shortcode, 40), type: p.type === 'reel' ? 'reel' : 'post',
    thumbnail: typeof p.thumbnail === 'string' && (p.thumbnail.startsWith('data:image/') || /^https:\/\//.test(p.thumbnail)) ? p.thumbnail.slice(0, 600000) : '',
    originalThumbnail: str(p.originalThumbnail, 2000), originalImage: str(p.originalImage, 2000),
    caption: str(p.caption, 2200), creator: str(p.creator, 80), alt: str(p.alt, 300), captured: !!p.captured,
    title: str(p.title, 200), postedAt: str(p.postedAt, 40), location: str(p.location, 120), likes: Number.isFinite(p.likes) ? p.likes : null,
    hashtags: list(p.hashtags, 30, (h) => str(h, 60)), mentions: list(p.mentions, 20, (h) => str(h, 40)),
    links: list(p.links, 10, (l) => (l && typeof l === 'object' && l.url ? { url: str(l.url, 2000), label: str(l.label, 80) } : null)),
    products: list(p.products, 10, (x) => (x && typeof x === 'object' && x.name ? { name: str(x.name, 160), price: Number.isFinite(x.price) ? x.price : null, currency: str(x.currency, 8), url: str(x.url, 2000), retailer: str(x.retailer, 80) } : null)),
    linkInBio: !!p.linkInBio, details: !!p.details, detailsVia: str(p.detailsVia, 10), detailsError: str(p.detailsError, 200),
  };
}

// --- reading one post in a background tab (fallback when a fetch hits a login wall) ---------------------
let readQueue = Promise.resolve();
function readPostInTab(url) {
  const u = sanitizeText(url, 300);
  if (!/^https:\/\/www\.instagram\.com\/(p|reel|reels)\/[A-Za-z0-9_-]+\/?/.test(u)) throw new Error('Not an Instagram post URL.');
  const job = readQueue.then(() => readPostInTabNow(u));
  readQueue = job.catch(() => {});
  return job;
}

async function readPostInTabNow(url) {
  // /p/ form: a logged-in /reel/ tab gets rerouted into the reels feed and would read the wrong post.
  const tab = await chrome.tabs.create({ url: openableUrl(url), active: false });
  const tabId = tab.id;
  try {
    await waitForTabLoad(tabId, 20000);
    await new Promise((r) => setTimeout(r, 1500));
    const results = await chrome.scripting.executeScript({ target: { tabId }, files: ['src/instagram/post-page.js'] });
    const bundle = results && results[0] ? results[0].result : null;
    if (!bundle || typeof bundle !== 'object') throw new Error('The post page could not be read.');
    return { ok: true, bundle };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  } finally {
    chrome.tabs.remove(tabId).catch(() => {});
  }
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      fn(v);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(resolve);
    };
    const timer = setTimeout(() => finish(reject, new Error('The post page took too long to load.')), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => { if (t && t.status === 'complete') finish(resolve); }).catch(() => {});
  });
}

// --- message hub -----------------------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
  handleMessage(msg, sender)
    .then((res) => sendResponse(res))
    .catch((e) => sendResponse({ ok: false, error: friendlyError(e) }));
  return true; // async
});

async function handleMessage(msg, sender) {
  const fromExtensionPage = !!sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
  switch (msg.type) {
    case MSG.EXTRACT_TAB: {
      const tabId = msg.tabId || (sender.tab && sender.tab.id);
      if (!tabId) throw new Error('No tab to read.');
      const product = await extractFromTab(tabId, msg.hints || {});
      if (!product) throw new Error('Keepsake could not read this page.');
      return { ok: true, product };
    }
    case MSG.CLASSIFY: {
      const [collections, prefs, settings] = await Promise.all([store.getCollections(), store.getPrefs(), store.getSettings()]);
      return { ok: true, classification: classify(normalizeProduct(msg.product), { collections, prefs, settings }) };
    }
    case MSG.SAVE_ITEM: {
      if (!msg.product || typeof msg.product !== 'object') throw new Error('Nothing to save.');
      return saveProduct(msg.product, { collectionId: msg.collectionId || null, force: !!msg.force, source: msg.source || (sender.tab ? 'floating' : 'toolbar'), classification: msg.classification || null, note: msg.note || '', learn: msg.learn === 'strong' ? 'strong' : 'light', instant: !!msg.instant });
    }
    case MSG.UPDATE_ITEM: {
      const item = await store.getItem(msg.itemId);
      if (!item) throw new Error('That item no longer exists.');
      const patch = { ...(msg.patch || {}) };
      if (patch.collectionId && patch.collectionId !== item.collectionId) {
        await store.moveItems([item.id], patch.collectionId, { learn: msg.learn === false ? false : msg.learn === 'strong' ? 'strong' : 'light' });
        delete patch.collectionId;
      }
      if (Object.keys(patch).length) {
        const normalized = normalizeProduct({ ...item, ...patch, priceText: patch.priceText || '' });
        // Only carry over fields we allow the page to update.
        const allowed = ['title', 'price', 'currency', 'image', 'images', 'description', 'note', 'favorite', 'archived', 'purchased', 'imageAspect'];
        const safePatch = {};
        for (const k of allowed) if (k in patch || (k === 'price' && 'priceText' in patch)) safePatch[k] = normalized[k];
        if (safePatch.price === undefined || safePatch.price === null) delete safePatch.price;
        if (!safePatch.image) delete safePatch.image;
        await store.updateItem(item.id, safePatch);
      }
      return { ok: true, item: await store.getItem(item.id) };
    }
    case MSG.UNDO_SAVE: {
      await store.deleteItems([msg.itemId]);
      return { ok: true };
    }
    case MSG.OPEN_DASHBOARD: {
      const hash = typeof msg.hash === 'string' && /^#[\w/.-]*$/.test(msg.hash) ? msg.hash : '';
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') + hash });
      return { ok: true };
    }
    case MSG.FLOATING_CONFIG:
      return floatingConfig(msg.host || (sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : ''));
    case MSG.FLOATING_REFRESH: {
      await syncContentScripts();
      await broadcastFloatingRefresh();
      return { ok: true };
    }
    case MSG.IG_START_SCAN: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      return startInstagramScan(msg.tabId);
    }
    case MSG.IG_STOP_SCAN: {
      const scan = await getScan();
      const tabId = msg.tabId || (scan && scan.tabId);
      if (tabId) chrome.tabs.sendMessage(tabId, { type: MSG.IG_STOP_SCAN }, () => void chrome.runtime.lastError);
      return { ok: true };
    }
    case MSG.IG_SCAN_UPDATE: {
      if (!sender.tab || !/(^|\.)instagram\.com$/.test(new URL(sender.tab.url || sender.url || 'https://invalid/').hostname)) return { ok: false };
      const posts = (Array.isArray(msg.posts) ? msg.posts : []).slice(0, 2000).map(sanitizePost);
      await setScan({
        tabId: sender.tab.id, status: msg.status === 'done' ? 'done' : msg.status === 'error' ? 'error' : 'scanning',
        error: msg.error ? sanitizeText(msg.error, 300) : '', reason: sanitizeText(msg.reason, 40), collectionName: sanitizeText(msg.collectionName, 80),
        collectionUrl: sanitizeText(msg.collectionUrl, 300), username: sanitizeText(msg.username, 80), posts, updatedAt: Date.now(),
      });
      return { ok: true };
    }
    case MSG.IG_SCAN_STATE:
      return { ok: true, scan: await getScan() };
    case MSG.IG_SCAN_SET_POSTS: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      const scan = await getScan();
      if (!scan) throw new Error('There is no scan to update.');
      const posts = (Array.isArray(msg.posts) ? msg.posts : []).slice(0, 2000).map(sanitizePost);
      await setScan({ ...scan, posts, updatedAt: Date.now() });
      return { ok: true };
    }
    case MSG.IG_READ_POST: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      return readPostInTab(msg.url);
    }
    case MSG.IG_SCAN_CLEAR:
      await chrome.storage.session.remove(SESSION_KEYS.igScan);
      return { ok: true };
    default:
      return { ok: false, error: `Unknown message ${msg.type}` };
  }
}
