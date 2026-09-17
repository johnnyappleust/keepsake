// Keepsake storage. Everything lives in chrome.storage.local under a handful of
// keys. The store takes an injectable backend so tests can run in Node.
//
// Keys:
//   keepsake_meta          { schemaVersion, installedAt, updatedAt }
//   keepsake_collections   { [id]: Collection }
//   keepsake_items         { [id]: Item }
//   keepsake_prefs         categorization preferences (rules, learned keywords…)
//   keepsake_settings      UI + feature settings
//   keepsake_importHistory { instagram: { [normalizedUrl]: itemId } }
//   keepsake_secrets       { aiApiKey } — never exported

import { uid, nowIso, sanitizeText, sanitizeUrl, deepMerge, hostnameOf, prettyRetailer } from './util.js';
import { normalizeUrl, cleanUrl } from './url.js';
import { DEFAULT_TAXONOMY, INBOX_COLLECTION, INBOX_KEY } from './taxonomy.js';
import { emptyPrefs, findSimilarCollection, learnFromCorrection, forgetCollection } from './categorizer.js';

export const SCHEMA_VERSION = 1;
export const KEYS = {
  meta: 'keepsake_meta',
  collections: 'keepsake_collections',
  items: 'keepsake_items',
  prefs: 'keepsake_prefs',
  settings: 'keepsake_settings',
  importHistory: 'keepsake_importHistory',
  secrets: 'keepsake_secrets',
};
const EXPORTABLE = [KEYS.meta, KEYS.collections, KEYS.items, KEYS.prefs, KEYS.settings, KEYS.importHistory];
export const LIMITS = { maxItems: 20000, maxCollections: 500, maxImportBytes: 25 * 1024 * 1024, maxImageBytes: 400 * 1024 };

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark
  floating: {
    mode: 'off', // off | all | selected
    sites: [], // origin patterns like *://www.example.com/*
    hiddenSites: [], // hostnames where buttons are hidden even if permitted
    size: 'medium', // small | medium | large
    position: 'top-right', // top-right | top-left | bottom-right | bottom-left
    requireConfirm: false,
    autoSaveHighConfidence: true,
    uncertainToInbox: true,
  },
  instagram: {
    storeThumbnails: true,
    safetyLimit: 300,
    idleTimeoutMs: 6000,
    readPostDetails: true, // after a scan, read each post's page for caption/creator/links (needs instagram.com access)
    readDelayMs: 1500,
  },
  ai: {
    enabled: false, // "Find products in Instagram saves" (beta)
    webLookup: false, // "Find products": also run the provider's web search for listings
    useForCategorization: false,
    provider: 'openai', // openai | anthropic | custom
    baseUrl: '',
    model: '',
  },
  onboardingDone: false,
};

// --- backends -------------------------------------------------------------------

export function memoryBackend(initial = {}) {
  const data = { ...initial };
  const listeners = new Set();
  return {
    async get(keys) {
      const out = {};
      const list = keys === null || keys === undefined ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = structuredClone(v);
      }
      listeners.forEach((fn) => fn(changes));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
    onChanged(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function chromeBackend() {
  const area = globalThis.chrome?.storage?.local;
  if (!area) return null;
  return {
    get: (keys) => area.get(keys),
    set: (obj) => area.set(obj),
    remove: (keys) => area.remove(keys),
    clear: () => area.clear(),
    onChanged(fn) {
      const handler = (changes, areaName) => {
        if (areaName === 'local') fn(changes);
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}

// --- migrations ------------------------------------------------------------------
// Each migration transforms the full record set from version N to N+1.
const MIGRATIONS = {
  // 0 -> 1: initial schema. Nothing stored before v1 (kept as the pattern for later).
  0: (data) => data,
};

export function migrate(data) {
  let version = Number(data[KEYS.meta]?.schemaVersion || 0);
  let out = data;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break;
    out = step(out);
    version += 1;
  }
  out[KEYS.meta] = { ...(out[KEYS.meta] || {}), schemaVersion: SCHEMA_VERSION };
  return out;
}

// --- record factories ----------------------------------------------------------------

export function makeCollection(input = {}) {
  const now = nowIso();
  return {
    id: input.id || uid(),
    name: sanitizeText(input.name, 80) || 'Untitled',
    description: sanitizeText(input.description, 300),
    coverImage: sanitizeUrl(input.coverImage, { allowData: true }),
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#8A9A88',
    keywords: uniqStrings(input.keywords, 40).map((k) => sanitizeText(k, 40).toLowerCase()).filter(Boolean),
    aliases: uniqStrings(input.aliases, 20).map((k) => sanitizeText(k, 40)).filter(Boolean),
    taxonomyKey: typeof input.taxonomyKey === 'string' ? input.taxonomyKey : null,
    sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : 0,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function makeItem(input = {}) {
  const now = nowIso();
  const url = sanitizeUrl(input.url || input.sourceUrl);
  const sourceUrl = sanitizeUrl(input.sourceUrl || input.url);
  const canonicalUrl = sanitizeUrl(input.canonicalUrl) || cleanUrl(url) || url;
  const host = hostnameOf(canonicalUrl || url);
  const price = input.price === '' || input.price === null || input.price === undefined ? null : Number(input.price);
  const type = ['product', 'inspiration', 'instagram'].includes(input.type) ? input.type : /instagram\.com/.test(host) ? 'instagram' : 'product';
  return {
    id: input.id || uid(),
    collectionId: input.collectionId || null,
    type,
    title: sanitizeText(input.title, 200) || (type === 'instagram' ? 'Instagram post' : 'Untitled item'),
    description: sanitizeText(input.description, 1000),
    note: sanitizeText(input.note, 1000),
    price: Number.isFinite(price) && price >= 0 ? price : null,
    currency: sanitizeText(input.currency, 8).toUpperCase(),
    retailer: sanitizeText(input.retailer, 80) || (type === 'instagram' ? 'Instagram' : prettyRetailer(host)),
    host,
    url: canonicalUrl || url,
    canonicalUrl,
    sourceUrl,
    urlKey: normalizeUrl(canonicalUrl || sourceUrl || url),
    image: sanitizeUrl(input.image, { allowData: true }),
    images: uniqStrings(input.images, 8).map((u) => sanitizeUrl(u, { allowData: true })).filter(Boolean),
    imageAspect: Number.isFinite(input.imageAspect) && input.imageAspect > 0.2 && input.imageAspect < 5 ? input.imageAspect : null,
    favorite: !!input.favorite,
    archived: !!input.archived,
    purchased: !!input.purchased,
    confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : null,
    categorizationSource: sanitizeText(input.categorizationSource, 40) || 'local',
    categorizationReason: sanitizeText(input.categorizationReason, 300),
    needsReview: !!input.needsReview,
    previousCollections: uniqStrings(input.previousCollections, 20),
    instagram: input.instagram && typeof input.instagram === 'object' ? sanitizeInstagram(input.instagram, now) : null,
    ai: input.ai && typeof input.ai === 'object' ? sanitizeAi(input.ai) : null,
    relatedItemId: typeof input.relatedItemId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(input.relatedItemId) ? input.relatedItemId : null,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function sanitizeInstagram(ig, now) {
  const priceOf = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    collectionName: sanitizeText(ig.collectionName, 80),
    creator: sanitizeText(ig.creator, 80),
    caption: sanitizeText(ig.caption, 2200),
    postType: sanitizeText(ig.postType, 20),
    importedAt: ig.importedAt || now,
    postedAt: sanitizeText(ig.postedAt, 40),
    location: sanitizeText(ig.location, 120),
    originalImage: sanitizeUrl(ig.originalImage),
    hashtags: uniqStrings(ig.hashtags, 30).map((h) => sanitizeText(h, 60)),
    links: (Array.isArray(ig.links) ? ig.links : []).slice(0, 10)
      .map((l) => (l && typeof l === 'object' ? { url: sanitizeUrl(l.url), label: sanitizeText(l.label, 80) } : null))
      .filter((l) => l && l.url),
    products: (Array.isArray(ig.products) ? ig.products : []).slice(0, 10)
      .map((p) => (p && typeof p === 'object' && p.name ? { name: sanitizeText(p.name, 160), price: priceOf(p.price), currency: sanitizeText(p.currency, 8).toUpperCase(), url: sanitizeUrl(p.url), retailer: sanitizeText(p.retailer, 80) } : null))
      .filter(Boolean),
    linkInBio: !!ig.linkInBio,
    details: !!ig.details,
  };
}

function sanitizeAi(ai) {
  const priceOf = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    provider: sanitizeText(ai.provider, 40),
    model: sanitizeText(ai.model, 80),
    analyzedAt: ai.analyzedAt || nowIso(),
    suggestions: (Array.isArray(ai.suggestions) ? ai.suggestions : []).slice(0, 8).map((s) => ({
      name: sanitizeText(s.name, 120),
      category: sanitizeText(s.category, 60),
      brand: sanitizeText(s.brand, 60),
      searchPhrases: uniqStrings(s.searchPhrases, 6).map((p) => sanitizeText(p, 100)),
      note: sanitizeText(s.note, 200),
    })),
    // "Found online" candidates: links only ever come from the provider's real search results.
    candidates: (Array.isArray(ai.candidates) ? ai.candidates : []).slice(0, 8).map((c) => ({
      name: sanitizeText(c.name, 160),
      brand: sanitizeText(c.brand, 60),
      retailer: sanitizeText(c.retailer, 80),
      price: priceOf(c.price),
      currency: sanitizeText(c.currency, 8).toUpperCase(),
      url: sanitizeUrl(c.url),
      note: sanitizeText(c.note, 200),
      confidence: Number.isFinite(Number(c.confidence)) ? Math.max(0, Math.min(1, Number(c.confidence))) : null,
      verified: !!c.verified,
    })).filter((c) => c.name),
    searchedAt: ai.searchedAt || null,
  };
}

function uniqStrings(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// --- the store ---------------------------------------------------------------------

export function createStore(backend) {
  const be = backend;
  let writeQueue = Promise.resolve();
  const serial = (fn) => {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
  };

  async function readAll() {
    const raw = await be.get(Object.values(KEYS));
    return {
      meta: raw[KEYS.meta] || null,
      collections: raw[KEYS.collections] || {},
      items: raw[KEYS.items] || {},
      prefs: { ...emptyPrefs(), ...(raw[KEYS.prefs] || {}) },
      settings: deepMerge(DEFAULT_SETTINGS, raw[KEYS.settings] || {}),
      importHistory: raw[KEYS.importHistory] || { instagram: {} },
      secrets: raw[KEYS.secrets] || {},
    };
  }

  const api = {
    backend: be,

    async init() {
      return serial(async () => {
        const raw = await be.get(Object.values(KEYS));
        const hadMeta = !!raw[KEYS.meta];
        const migrated = migrate({ ...raw });
        const now = nowIso();
        const meta = { installedAt: now, ...(migrated[KEYS.meta] || {}), schemaVersion: SCHEMA_VERSION, updatedAt: now };
        const write = { [KEYS.meta]: meta };
        for (const k of Object.values(KEYS)) if (k !== KEYS.meta && migrated[k] && migrated[k] !== raw[k]) write[k] = migrated[k];
        if (!raw[KEYS.collections] || !Object.keys(raw[KEYS.collections]).length) {
          write[KEYS.collections] = defaultCollections();
        }
        if (!raw[KEYS.prefs]) write[KEYS.prefs] = emptyPrefs();
        if (!raw[KEYS.settings]) write[KEYS.settings] = structuredClone(DEFAULT_SETTINGS);
        if (!raw[KEYS.items]) write[KEYS.items] = {};
        if (!raw[KEYS.importHistory]) write[KEYS.importHistory] = { instagram: {} };
        await be.set(write);
        return { fresh: !hadMeta };
      });
    },

    async getAll() {
      const d = await readAll();
      delete d.secrets;
      return d;
    },

    // -- collections --
    async getCollections() {
      const { collections } = await readAll();
      return sortCollections(Object.values(collections));
    },

    async getCollection(id) {
      const { collections } = await readAll();
      return collections[id] || null;
    },

    async getInbox() {
      const cols = await api.getCollections();
      return cols.find((c) => c.taxonomyKey === INBOX_KEY) || null;
    },

    // Creates a collection unless a similar one exists (returns the existing one then).
    async createCollection(input, { allowSimilar = false } = {}) {
      return serial(async () => {
        const { collections } = await readAll();
        const list = Object.values(collections);
        if (list.length >= LIMITS.maxCollections) throw new Error('Collection limit reached');
        if (!allowSimilar) {
          const similar = findSimilarCollection(input.name, list);
          if (similar) return { collection: similar, existed: true };
        }
        const maxOrder = list.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
        const col = makeCollection({ ...input, sortOrder: input.sortOrder ?? maxOrder + 1 });
        collections[col.id] = col;
        await be.set({ [KEYS.collections]: collections });
        return { collection: col, existed: false };
      });
    },

    async ensureCollectionForTaxonomy(taxonomyKey) {
      const tax = DEFAULT_TAXONOMY.find((t) => t.key === taxonomyKey) || (taxonomyKey === INBOX_KEY ? INBOX_COLLECTION : null);
      if (!tax) return null;
      const cols = await api.getCollections();
      const exact = cols.find((c) => c.taxonomyKey === tax.key);
      if (exact) return exact;
      const similar = findSimilarCollection(tax.name, cols);
      if (similar) return similar;
      const { collection } = await api.createCollection({ name: tax.name, description: tax.description, color: tax.color, aliases: tax.aliases, taxonomyKey: tax.key }, { allowSimilar: true });
      return collection;
    },

    async updateCollection(id, patch) {
      return serial(async () => {
        const { collections } = await readAll();
        const existing = collections[id];
        if (!existing) throw new Error('Collection not found');
        const merged = makeCollection({ ...existing, ...patch, id, createdAt: existing.createdAt });
        collections[id] = merged;
        await be.set({ [KEYS.collections]: collections });
        return merged;
      });
    },

    async reorderCollections(orderedIds) {
      return serial(async () => {
        const { collections } = await readAll();
        // Listed ids come first in the given order; anything not listed keeps
        // its current relative order behind them. Inbox always stays last.
        const listed = orderedIds.filter((id) => collections[id] && collections[id].taxonomyKey !== INBOX_KEY);
        const rest = sortCollections(Object.values(collections))
          .filter((c) => !listed.includes(c.id) && c.taxonomyKey !== INBOX_KEY)
          .map((c) => c.id);
        [...listed, ...rest].forEach((id, i) => {
          collections[id].sortOrder = i + 1;
          collections[id].updatedAt = nowIso();
        });
        await be.set({ [KEYS.collections]: collections });
      });
    },

    // Deleting moves items to Inbox (or `moveTo`) unless deleteItems is true.
    async deleteCollection(id, { moveTo = null, deleteItems = false } = {}) {
      return serial(async () => {
        const data = await readAll();
        const col = data.collections[id];
        if (!col) return;
        if (col.taxonomyKey === INBOX_KEY) throw new Error('The Inbox cannot be deleted');
        const inbox = Object.values(data.collections).find((c) => c.taxonomyKey === INBOX_KEY);
        const target = moveTo && data.collections[moveTo] ? moveTo : inbox ? inbox.id : null;
        for (const item of Object.values(data.items)) {
          if (item.collectionId !== id) continue;
          if (deleteItems) delete data.items[item.id];
          else {
            item.collectionId = target;
            item.previousCollections = [...(item.previousCollections || []), id].slice(-20);
            item.updatedAt = nowIso();
          }
        }
        delete data.collections[id];
        const prefs = forgetCollection(data.prefs, id, target);
        await be.set({ [KEYS.collections]: data.collections, [KEYS.items]: data.items, [KEYS.prefs]: prefs });
      });
    },

    async mergeCollections(sourceId, targetId) {
      return serial(async () => {
        const data = await readAll();
        const source = data.collections[sourceId];
        const target = data.collections[targetId];
        if (!source || !target || sourceId === targetId) throw new Error('Pick two different collections');
        if (source.taxonomyKey === INBOX_KEY) throw new Error('The Inbox cannot be merged away');
        for (const item of Object.values(data.items)) {
          if (item.collectionId === sourceId) {
            item.collectionId = targetId;
            item.previousCollections = [...(item.previousCollections || []), sourceId].slice(-20);
            item.updatedAt = nowIso();
          }
        }
        target.aliases = uniqStrings([...(target.aliases || []), source.name, ...(source.aliases || [])], 20);
        target.keywords = uniqStrings([...(target.keywords || []), ...(source.keywords || [])], 40);
        if (!target.coverImage && source.coverImage) target.coverImage = source.coverImage;
        if (!target.taxonomyKey && source.taxonomyKey) target.taxonomyKey = source.taxonomyKey;
        target.updatedAt = nowIso();
        delete data.collections[sourceId];
        const prefs = forgetCollection(data.prefs, sourceId, targetId);
        await be.set({ [KEYS.collections]: data.collections, [KEYS.items]: data.items, [KEYS.prefs]: prefs });
        return target;
      });
    },

    // -- items --
    async getItems() {
      const { items } = await readAll();
      return Object.values(items).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    async getItem(id) {
      const { items } = await readAll();
      return items[id] || null;
    },

    async findByUrl(url) {
      const key = normalizeUrl(url);
      if (!key) return null;
      const { items } = await readAll();
      return Object.values(items).find((i) => i.urlKey === key) || null;
    },

    async addItem(input) {
      return serial(async () => {
        const { items } = await readAll();
        if (Object.keys(items).length >= LIMITS.maxItems) throw new Error('Item limit reached');
        const item = makeItem(input);
        items[item.id] = item;
        await be.set({ [KEYS.items]: items });
        return item;
      });
    },

    async updateItem(id, patch) {
      return serial(async () => {
        const { items } = await readAll();
        const existing = items[id];
        if (!existing) throw new Error('Item not found');
        const next = makeItem({ ...existing, ...patch, id, createdAt: existing.createdAt });
        items[id] = next;
        await be.set({ [KEYS.items]: items });
        return next;
      });
    },

    async deleteItems(ids) {
      return serial(async () => {
        const { items, importHistory } = await readAll();
        for (const id of ids) {
          const it = items[id];
          if (it && it.type === 'instagram' && importHistory.instagram) {
            for (const [k, v] of Object.entries(importHistory.instagram)) if (v === id) delete importHistory.instagram[k];
          }
          delete items[id];
        }
        await be.set({ [KEYS.items]: items, [KEYS.importHistory]: importHistory });
      });
    },

    // Move items; optionally learn from the correction. `learn`: 'light' | 'strong' | false
    async moveItems(ids, collectionId, { learn = 'light' } = {}) {
      return serial(async () => {
        const data = await readAll();
        if (!data.collections[collectionId]) throw new Error('Collection not found');
        let prefs = data.prefs;
        for (const id of ids) {
          const item = data.items[id];
          if (!item || item.collectionId === collectionId) continue;
          if (learn) prefs = learnFromCorrection(item, item.collectionId, collectionId, prefs, { strong: learn === 'strong' });
          item.previousCollections = [...(item.previousCollections || []), item.collectionId].filter(Boolean).slice(-20);
          item.collectionId = collectionId;
          item.needsReview = false;
          item.categorizationSource = 'manual';
          item.confidence = 1;
          item.updatedAt = nowIso();
        }
        await be.set({ [KEYS.items]: data.items, [KEYS.prefs]: prefs });
      });
    },

    // -- prefs & settings --
    async getPrefs() {
      return (await readAll()).prefs;
    },
    async setPrefs(prefs) {
      return serial(() => be.set({ [KEYS.prefs]: { ...emptyPrefs(), ...prefs } }));
    },
    async updatePrefs(patch) {
      return serial(async () => {
        const { prefs } = await readAll();
        const next = { ...prefs, ...patch };
        await be.set({ [KEYS.prefs]: next });
        return next;
      });
    },
    async getSettings() {
      return (await readAll()).settings;
    },
    async updateSettings(patch) {
      return serial(async () => {
        const { settings } = await readAll();
        const next = deepMerge(settings, patch);
        await be.set({ [KEYS.settings]: next });
        return next;
      });
    },
    async getSecret(name) {
      const { secrets } = await readAll();
      return secrets[name] || '';
    },
    async setSecret(name, value) {
      return serial(async () => {
        const { secrets } = await readAll();
        if (value) secrets[name] = String(value);
        else delete secrets[name];
        await be.set({ [KEYS.secrets]: secrets });
      });
    },

    // -- import history (Instagram) --
    async getImportHistory() {
      return (await readAll()).importHistory;
    },
    async markImported(entries) {
      return serial(async () => {
        const { importHistory } = await readAll();
        importHistory.instagram = importHistory.instagram || {};
        for (const [url, itemId] of entries) {
          const key = normalizeUrl(url);
          if (key) importHistory.instagram[key] = itemId;
        }
        await be.set({ [KEYS.importHistory]: importHistory });
      });
    },
    async importedItemIdFor(url) {
      const { importHistory, items } = await readAll();
      const id = (importHistory.instagram || {})[normalizeUrl(url)];
      return id && items[id] ? id : null;
    },

    // -- export / import --
    async exportJSON() {
      const raw = await be.get(EXPORTABLE);
      return {
        format: 'keepsake-export',
        schemaVersion: SCHEMA_VERSION,
        exportedAt: nowIso(),
        collections: raw[KEYS.collections] || {},
        items: raw[KEYS.items] || {},
        prefs: raw[KEYS.prefs] || emptyPrefs(),
        settings: raw[KEYS.settings] || DEFAULT_SETTINGS,
        importHistory: raw[KEYS.importHistory] || { instagram: {} },
      };
    },

    async importJSON(payload, { mode = 'merge' } = {}) {
      const validated = validateExport(payload);
      return serial(async () => {
        const data = await readAll();
        let collections = mode === 'replace' ? {} : data.collections;
        let items = mode === 'replace' ? {} : data.items;
        let prefs = mode === 'replace' ? emptyPrefs() : data.prefs;
        let importHistory = mode === 'replace' ? { instagram: {} } : data.importHistory;
        const idMap = new Map();
        let addedCollections = 0;
        let addedItems = 0;
        let skippedItems = 0;
        for (const col of Object.values(validated.collections)) {
          const existingById = collections[col.id];
          const similar = existingById || findSimilarCollection(col.name, Object.values(collections));
          if (similar) {
            idMap.set(col.id, similar.id);
            continue;
          }
          collections[col.id] = col;
          idMap.set(col.id, col.id);
          addedCollections++;
        }
        const existingKeys = new Set(Object.values(items).map((i) => i.urlKey).filter(Boolean));
        const inbox = Object.values(collections).find((c) => c.taxonomyKey === INBOX_KEY);
        for (const item of Object.values(validated.items)) {
          if (items[item.id] || (item.urlKey && existingKeys.has(item.urlKey))) {
            skippedItems++;
            continue;
          }
          item.collectionId = idMap.get(item.collectionId) || (collections[item.collectionId] ? item.collectionId : inbox ? inbox.id : null);
          items[item.id] = item;
          if (item.urlKey) existingKeys.add(item.urlKey);
          addedItems++;
        }
        if (validated.prefs) {
          prefs = mergePrefs(prefs, validated.prefs, idMap);
        }
        if (validated.importHistory?.instagram) {
          importHistory.instagram = { ...(importHistory.instagram || {}) };
          for (const [k, v] of Object.entries(validated.importHistory.instagram)) if (items[v]) importHistory.instagram[k] = v;
        }
        const settings = mode === 'replace' && validated.settings ? deepMerge(DEFAULT_SETTINGS, validated.settings) : data.settings;
        if (!Object.values(collections).some((c) => c.taxonomyKey === INBOX_KEY)) {
          const inboxCol = makeCollection({ ...INBOX_COLLECTION, taxonomyKey: INBOX_KEY, sortOrder: 999 });
          collections[inboxCol.id] = inboxCol;
        }
        await be.set({
          [KEYS.collections]: collections, [KEYS.items]: items, [KEYS.prefs]: prefs, [KEYS.settings]: settings, [KEYS.importHistory]: importHistory,
          [KEYS.meta]: { ...(data.meta || {}), schemaVersion: SCHEMA_VERSION, updatedAt: nowIso() },
        });
        return { addedCollections, addedItems, skippedItems };
      });
    },

    async loadSampleData() {
      const cols = await api.getCollections();
      const byKey = (k) => cols.find((c) => c.taxonomyKey === k) || cols[0];
      const samples = sampleItems(byKey);
      for (const s of samples) await api.addItem(s);
      return samples.length;
    },

    async clearAll() {
      return serial(async () => {
        await be.remove(Object.values(KEYS));
      });
    },

    onChanged(fn) {
      return be.onChanged ? be.onChanged(fn) : () => {};
    },
  };
  return api;
}

function sortCollections(list) {
  return list.sort((a, b) => {
    const ai = a.taxonomyKey === INBOX_KEY ? 1 : 0;
    const bi = b.taxonomyKey === INBOX_KEY ? 1 : 0;
    if (ai !== bi) return ai - bi; // Inbox last
    return (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name);
  });
}

export function defaultCollections() {
  const out = {};
  DEFAULT_TAXONOMY.forEach((t, i) => {
    const c = makeCollection({ name: t.name, description: t.description, color: t.color, aliases: t.aliases, taxonomyKey: t.key, sortOrder: i + 1 });
    out[c.id] = c;
  });
  const inbox = makeCollection({ name: INBOX_COLLECTION.name, description: INBOX_COLLECTION.description, color: INBOX_COLLECTION.color, aliases: INBOX_COLLECTION.aliases, taxonomyKey: INBOX_KEY, sortOrder: 999 });
  out[inbox.id] = inbox;
  return out;
}

function mergePrefs(base, incoming, idMap) {
  const out = { ...emptyPrefs(), ...base };
  const map = (id) => idMap.get(id) || id;
  out.rules = [...(out.rules || [])];
  for (const r of incoming.rules || []) {
    const mapped = { ...r, collectionId: map(r.collectionId) };
    if (!out.rules.some((x) => x.id === mapped.id)) out.rules.push(mapped);
  }
  out.learnedKeywords = { ...(out.learnedKeywords || {}) };
  for (const [term, entry] of Object.entries(incoming.learnedKeywords || {})) {
    const e = { ...(out.learnedKeywords[term] || {}) };
    for (const [cid, w] of Object.entries(entry)) e[map(cid)] = Math.min(6, (e[map(cid)] || 0) + Number(w));
    out.learnedKeywords[term] = e;
  }
  out.retailerPrefs = { ...(out.retailerPrefs || {}) };
  for (const [host, entry] of Object.entries(incoming.retailerPrefs || {})) {
    const e = { ...(out.retailerPrefs[host] || {}) };
    for (const [cid, n] of Object.entries(entry)) e[map(cid)] = (e[map(cid)] || 0) + Number(n);
    out.retailerPrefs[host] = e;
  }
  out.corrections = [...(out.corrections || []), ...(incoming.corrections || [])].slice(-200);
  if (Number.isFinite(Number(incoming.confidenceThreshold))) out.confidenceThreshold = Number(incoming.confidenceThreshold);
  if (typeof incoming.autoCreateCollections === 'boolean') out.autoCreateCollections = incoming.autoCreateCollections;
  return out;
}

// Validates and sanitizes an export payload. Throws with a readable message.
export function validateExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('This file is not a Keepsake export.');
  if (payload.format !== 'keepsake-export') throw new Error('This file is not a Keepsake export (missing format marker).');
  const version = Number(payload.schemaVersion);
  if (!Number.isFinite(version) || version < 1 || version > SCHEMA_VERSION) throw new Error(`Unsupported export version ${payload.schemaVersion}.`);
  const rawCollections = payload.collections && typeof payload.collections === 'object' ? payload.collections : {};
  const rawItems = payload.items && typeof payload.items === 'object' ? payload.items : {};
  const colEntries = Object.values(rawCollections);
  const itemEntries = Object.values(rawItems);
  if (colEntries.length > LIMITS.maxCollections) throw new Error(`Too many collections (${colEntries.length}).`);
  if (itemEntries.length > LIMITS.maxItems) throw new Error(`Too many items (${itemEntries.length}).`);
  const collections = {};
  for (const raw of colEntries) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') continue;
    const c = makeCollection({ ...raw, id: safeId(raw.id) });
    collections[c.id] = c;
  }
  const items = {};
  for (const raw of itemEntries) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.image === 'string' && raw.image.startsWith('data:') && raw.image.length > LIMITS.maxImageBytes * 1.4) raw.image = '';
    const it = makeItem({ ...raw, id: safeId(raw.id) });
    if (!it.url && !it.sourceUrl && !it.image && it.title === 'Untitled item') continue;
    items[it.id] = it;
  }
  let prefs = null;
  if (payload.prefs && typeof payload.prefs === 'object') {
    const p = payload.prefs;
    prefs = {
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 500).filter((r) => r && typeof r === 'object' && typeof r.collectionId === 'string').map((r) => ({
        id: safeId(r.id), collectionId: r.collectionId, keywords: uniqStrings(r.keywords, 20).map((k) => sanitizeText(k, 40).toLowerCase()),
      })),
      learnedKeywords: {},
      retailerPrefs: {},
      corrections: (Array.isArray(p.corrections) ? p.corrections : []).slice(-200).filter((c) => c && typeof c === 'object'),
      confidenceThreshold: Number.isFinite(Number(p.confidenceThreshold)) ? Math.max(0.2, Math.min(0.95, Number(p.confidenceThreshold))) : 0.6,
      autoCreateCollections: p.autoCreateCollections !== false,
    };
    const lk = p.learnedKeywords && typeof p.learnedKeywords === 'object' ? p.learnedKeywords : {};
    let n = 0;
    for (const [term, entry] of Object.entries(lk)) {
      if (n++ > 5000 || typeof term !== 'string' || !entry || typeof entry !== 'object') continue;
      const e = {};
      for (const [cid, w] of Object.entries(entry)) if (typeof cid === 'string' && Number.isFinite(Number(w))) e[cid] = Math.max(0, Math.min(6, Number(w)));
      if (Object.keys(e).length) prefs.learnedKeywords[sanitizeText(term, 60).toLowerCase()] = e;
    }
    const rp = p.retailerPrefs && typeof p.retailerPrefs === 'object' ? p.retailerPrefs : {};
    for (const [host, entry] of Object.entries(rp).slice(0, 2000)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = {};
      for (const [cid, c] of Object.entries(entry)) if (Number.isFinite(Number(c))) e[cid] = Math.max(0, Number(c));
      prefs.retailerPrefs[sanitizeText(host, 120).toLowerCase()] = e;
    }
  }
  let settings = null;
  if (payload.settings && typeof payload.settings === 'object') {
    const s = deepMerge(DEFAULT_SETTINGS, payload.settings);
    delete s.apiKey;
    settings = s;
  }
  let importHistory = null;
  if (payload.importHistory && typeof payload.importHistory === 'object' && payload.importHistory.instagram && typeof payload.importHistory.instagram === 'object') {
    importHistory = { instagram: {} };
    for (const [k, v] of Object.entries(payload.importHistory.instagram).slice(0, 20000)) {
      if (typeof k === 'string' && typeof v === 'string') importHistory.instagram[k.slice(0, 200)] = v.slice(0, 64);
    }
  }
  return { collections, items, prefs, settings, importHistory };
}

function safeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : uid();
}

function sampleItems(byKey) {
  const d = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
  const S = (key, o, days) => ({ ...o, collectionId: byKey(key)?.id || null, createdAt: d(days), confidence: o.confidence ?? 0.82, categorizationSource: 'sample' });
  return [
    S('home', { title: 'Hand-thrown ceramic bedside lamp with linen shade', price: 148, currency: 'USD', retailer: 'Studio Fenne', url: 'https://example.com/lamps/ceramic-bedside', image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800', imageAspect: 0.8, favorite: true, description: 'Matte glaze, dimmable warm bulb included.' }, 1),
    S('camping', { title: 'Two-person ultralight backpacking tent', price: 329, currency: 'USD', retailer: 'North Ridge Outfitters', url: 'https://example.com/tents/ultralight-2p', image: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800', imageAspect: 1.5, description: 'Trail weight 2 lb 3 oz. Two doors, two vestibules.' }, 2),
    S('clothing', { title: 'Waxed cotton field jacket, olive', price: 245, currency: 'USD', retailer: 'Harbor & Hale', url: 'https://example.com/jackets/waxed-field', image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800', imageAspect: 0.75 }, 3),
    S('tech', { title: 'Noise-cancelling over-ear headphones', price: 279, currency: 'USD', retailer: 'Soundfield', url: 'https://example.com/audio/over-ear-anc', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800', imageAspect: 1, purchased: true }, 5),
    S('kitchen', { title: 'Enameled cast iron Dutch oven, 5.5 qt', price: 199, currency: 'USD', retailer: 'Copper Lane Kitchen', url: 'https://example.com/cookware/dutch-oven', image: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=800', imageAspect: 1.2, note: 'Wait for the autumn sale.' }, 6),
    S('van', { title: '12V roof fan with rain sensor, fits ProMaster', price: 289, currency: 'USD', retailer: 'Overland Supply Co.', url: 'https://example.com/van/roof-fan-12v', image: '', imageAspect: null }, 8),
    S('care', { title: 'Mineral SPF 40 daily moisturizer', price: 32, currency: 'USD', retailer: 'Clearwater Skin', url: 'https://example.com/skin/spf40', image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800', imageAspect: 1.25 }, 9),
    S('inbox', { title: 'Morning light, kitchen corner', type: 'instagram', retailer: 'Instagram', url: 'https://www.instagram.com/p/sample000001/', image: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=800', imageAspect: 0.9, confidence: 0.2, needsReview: true, categorizationReason: 'No category signals found in the caption', instagram: { collectionName: 'Kitchen ideas', creator: 'slowmornings', caption: 'Morning light in the kitchen corner ✨', postType: 'post' } }, 10),
    S('books', { title: 'A Pattern Language — hardcover, 1977 edition', price: 68, currency: 'USD', retailer: 'Riverbend Books', url: 'https://example.com/books/a-pattern-language', image: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=800', imageAspect: 0.7 }, 12),
    S('tools', { title: 'Cordless brushless drill driver kit, 18V', price: 159, currency: 'USD', retailer: 'Workbench Depot', url: 'https://example.com/tools/drill-18v', image: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800', imageAspect: 1.4 }, 14),
    S('travel', { title: 'Carry-on suitcase with front laptop pocket', price: 275, currency: 'USD', retailer: 'Northline Luggage', url: 'https://example.com/travel/carry-on-front-pocket', image: 'https://images.unsplash.com/photo-1553531384-cc64ac80f931?w=800', imageAspect: 0.8 }, 20),
    S('home', { title: 'This title is intentionally very long to test how the dashboard wraps and truncates titles that run on and on without a natural break point in sight', price: null, retailer: 'Example Store', url: 'https://example.com/long-title', image: 'https://example.invalid/broken.jpg', imageAspect: 1 }, 25),
  ];
}
