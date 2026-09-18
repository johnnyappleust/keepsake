// Keepsake categorization engine.
//
// Public interface (stable — other modules only depend on these):
//   classify(product, context)              -> Classification
//   learnFromCorrection(product, fromId, toId, prefs, options) -> prefs
//   findSimilarCollection(name, collections) -> collection | null
//   salientTerms(product)                   -> string[]
//   nameSimilarity(a, b)                    -> 0..1
//
// Classification = {
//   collectionId: string | null,     // null when a new collection is recommended
//   collectionName: string,
//   taxonomyKey: string | null,      // set when recommending a default collection
//   confidence: 0..1,
//   reason: string,                  // short internal explanation
//   isNew: boolean,                  // true if we recommend creating a collection
//   isInbox: boolean,
//   alternatives: [{ collectionId, collectionName, score }]
// }
//
// The engine is deterministic, runs entirely locally and never touches the network.
// An optional AI provider (src/ai/provider.js) can be layered on top by callers.

import { DEFAULT_TAXONOMY, STOPWORDS } from './taxonomy.js';

const FIELD_WEIGHTS = {
  title: 3,
  instagramCollection: 4,
  schemaCategory: 2.5,
  breadcrumbs: 2.5,
  alt: 1.5,
  cardText: 1,
  description: 1,
  caption: 1.2,
  retailer: 1,
};
const KW_WEIGHT = { strong: 3, regular: 1, user: 3, rule: 5, name: 3 };
const MAX_LEARNED_WEIGHT = 6;

// --- text helpers ------------------------------------------------------------

export function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[^\p{L}\p{N}'&+\-.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stem(word) {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('es') && /(sh|ch|x|z|o)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is|as|os)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  return normalizeText(text)
    .split(/[\s/,;:()[\]{}"!?]+/)
    .map((t) => t.replace(/^[-.&+']+|[-.&+']+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+([.,]\d+)?$/.test(t));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const regexCache = new Map();
function keywordRegex(keyword) {
  let re = regexCache.get(keyword);
  if (re) return re;
  const prefix = keyword.endsWith('*');
  const body = escapeRegex(normalizeText(prefix ? keyword.slice(0, -1) : keyword)).replace(/\s+/g, '[\\s-]+');
  re = new RegExp(`(?<![\\p{L}\\p{N}])${body}${prefix ? '[\\p{L}]*' : ''}(?![\\p{L}\\p{N}])`, 'iu');
  regexCache.set(keyword, re);
  return re;
}

// Matches a keyword (phrase, optional trailing * prefix wildcard) in text.
// Returns the matched text or null.
export function matchKeyword(keyword, text) {
  if (!keyword || !text) return null;
  const m = keywordRegex(keyword).exec(text);
  return m ? m[0] : null;
}

// --- collection name similarity ----------------------------------------------

export function normalizeName(name) {
  return normalizeText(name)
    .replace(/&/g, ' and ')
    .replace(/\band\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t && !['the', 'my', 'a', 'of', 'for', 'to', 'stuff', 'things', 'items', 'ideas', 'list', 'wishlist', 'collection'].includes(t))
    .map(stem)
    .join(' ')
    .trim();
}

export function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  const containment = inter / Math.min(ta.size, tb.size);
  // "Home" vs "Home Decor" => containment 1, jaccard .5
  return Math.max(jaccard, containment * 0.85);
}

// Returns an existing collection that means the same thing as `name`, if any.
export function findSimilarCollection(name, collections, threshold = 0.8) {
  if (!name) return null;
  const target = normalizeName(name);
  let best = null;
  let bestScore = 0;
  for (const c of collections) {
    const candidates = [c.name, ...(c.aliases || [])];
    const tax = resolveTaxonomy(c);
    if (tax) candidates.push(tax.name, ...(tax.aliases || []));
    for (const cand of candidates) {
      const score = normalizeName(cand) === target ? 1 : nameSimilarity(cand, name);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  return bestScore >= threshold ? best : null;
}

// Map a user collection onto a default taxonomy entry so it inherits keywords.
export function resolveTaxonomy(collection) {
  if (!collection) return null;
  if (collection.taxonomyKey) {
    const t = DEFAULT_TAXONOMY.find((x) => x.key === collection.taxonomyKey);
    if (t) return t;
  }
  let best = null;
  let bestScore = 0;
  for (const t of DEFAULT_TAXONOMY) {
    for (const cand of [t.name, ...t.aliases]) {
      const s = nameSimilarity(cand, collection.name);
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
      for (const alias of collection.aliases || []) {
        const s2 = nameSimilarity(cand, alias);
        if (s2 > bestScore) {
          bestScore = s2;
          best = t;
        }
      }
    }
  }
  return bestScore >= 0.8 ? best : null;
}

// --- product text assembly ----------------------------------------------------

function fieldsOf(product) {
  const p = product || {};
  const ig = p.instagram || {};
  const fields = {
    title: normalizeText(p.title),
    description: normalizeText(p.description).slice(0, 1500),
    schemaCategory: normalizeText(p.schemaCategory || p.category),
    breadcrumbs: normalizeText(Array.isArray(p.breadcrumbs) ? p.breadcrumbs.join(' ') : p.breadcrumbs),
    alt: normalizeText(p.imageAlt || p.alt),
    cardText: normalizeText(p.cardText).slice(0, 600),
    caption: normalizeText(ig.caption).slice(0, 1000),
    instagramCollection: normalizeText(ig.collectionName),
    retailer: normalizeText([p.retailer, p.host, p.brand].filter(Boolean).join(' ')),
  };
  return fields;
}

export function salientTerms(product, max = 12) {
  const title = product?.title || '';
  const toks = tokenize(title).map(stem).filter((t) => t.length >= 3);
  const terms = [];
  const seen = new Set();
  for (let i = 0; i < toks.length; i++) {
    if (i < toks.length - 1) {
      const bi = `${toks[i]} ${toks[i + 1]}`;
      if (!seen.has(bi)) {
        seen.add(bi);
        terms.push(bi);
      }
    }
    if (!seen.has(toks[i])) {
      seen.add(toks[i]);
      terms.push(toks[i]);
    }
  }
  const alt = tokenize(product?.imageAlt || '').map(stem).filter((t) => t.length >= 4 && !seen.has(t));
  for (const t of alt.slice(0, 3)) {
    seen.add(t);
    terms.push(t);
  }
  return terms.slice(0, max);
}

// --- scoring ---------------------------------------------------------------------

function buildCandidates(collections, prefs, settings) {
  const candidates = [];
  const covered = new Set();
  for (const c of collections) {
    const tax = resolveTaxonomy(c);
    if (tax) covered.add(tax.key);
    candidates.push({
      id: c.id,
      name: c.name,
      taxonomyKey: tax ? tax.key : null,
      virtual: false,
      strong: tax ? tax.strong : [],
      regular: tax ? tax.keywords : [],
      user: c.keywords || [],
      nameTokens: [c.name, ...(c.aliases || [])].map(normalizeName).filter(Boolean),
    });
  }
  const autoCreate = settings?.autoCreateCollections !== false && prefs?.autoCreateCollections !== false;
  if (autoCreate) {
    for (const t of DEFAULT_TAXONOMY) {
      if (covered.has(t.key)) continue;
      candidates.push({
        id: null,
        name: t.name,
        taxonomyKey: t.key,
        virtual: true,
        strong: t.strong,
        regular: t.keywords,
        user: [],
        nameTokens: [t.name, ...t.aliases].map(normalizeName).filter(Boolean),
      });
    }
  }
  return candidates;
}

function collectMatches(candidate, candidateIndex, fields, prefs) {
  const matches = [];
  const add = (field, keyword, matched, weight, kind) => matches.push({ candidateIndex, field, keyword, matched, weight, kind });
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    if (field === 'retailer') continue; // handled by retailer preferences
    for (const kw of candidate.strong) {
      const m = matchKeyword(kw, text);
      if (m) add(field, kw, m, KW_WEIGHT.strong, 'strong');
    }
    for (const kw of candidate.regular) {
      const m = matchKeyword(kw, text);
      if (m) add(field, kw, m, KW_WEIGHT.regular, 'regular');
    }
    for (const kw of candidate.user) {
      const m = matchKeyword(kw, text);
      if (m) add(field, kw, m, KW_WEIGHT.user, 'user');
    }
    // Collection name / alias tokens appearing in the text ("Lamps" vs "table lamp")
    if (!candidate.virtual) {
      const textStems = new Set(tokenize(text).map(stem));
      for (const nt of candidate.nameTokens) {
        const parts = nt.split(' ');
        if (parts.every((p) => textStems.has(p))) add(field, nt, nt, KW_WEIGHT.name * Math.min(2, parts.length), 'name');
      }
    }
    // Learned keyword → collection weights (from the user's corrections)
    const learned = prefs?.learnedKeywords || {};
    if (candidate.id && Object.keys(learned).length) {
      const stems = tokenize(text).map(stem);
      const grams = new Set(stems);
      for (let i = 0; i < stems.length - 1; i++) grams.add(`${stems[i]} ${stems[i + 1]}`);
      for (const g of grams) {
        const entry = learned[g];
        const w = entry && entry[candidate.id];
        if (w > 0) add(field, g, g, Math.min(MAX_LEARNED_WEIGHT, w), 'learned');
      }
    }
  }
  // Explicit user rules
  for (const rule of prefs?.rules || []) {
    if (!rule || rule.collectionId !== candidate.id) continue;
    for (const kw of rule.keywords || []) {
      for (const field of ['title', 'description', 'cardText', 'caption', 'breadcrumbs', 'instagramCollection', 'alt']) {
        const m = matchKeyword(kw, fields[field]);
        if (m) {
          add(field, kw, m, KW_WEIGHT.rule, 'rule');
          break;
        }
      }
    }
  }
  return matches;
}

// Longer phrase matches dominate shorter ones in the same field ("camp chair" beats "chair").
function applyDominance(matches) {
  const dominable = new Set(['strong', 'regular', 'name']);
  return matches.filter((m) => {
    if (!dominable.has(m.kind)) return true; // user words and learned terms always count
    for (const n of matches) {
      if (n === m || n.field !== m.field) continue;
      if (n.matched.length <= m.matched.length) continue;
      if (n.candidateIndex === m.candidateIndex && n.kind === m.kind) continue;
      if (matchKeyword(m.matched, n.matched)) return false;
    }
    return true;
  });
}

export function classify(product, context = {}) {
  const collections = context.collections || [];
  const prefs = context.prefs || {};
  const settings = context.settings || {};
  const threshold = Number.isFinite(Number(prefs.confidenceThreshold)) ? Number(prefs.confidenceThreshold) : 0.6;

  const fields = fieldsOf(product);
  const candidates = buildCandidates(collections, prefs, settings);

  // 1. Instagram collection name that matches an existing collection => direct hit.
  const igName = product?.instagram?.collectionName;
  if (igName) {
    const direct = findSimilarCollection(igName, collections, 0.85);
    if (direct) {
      return finish({
        collectionId: direct.id, collectionName: direct.name, taxonomyKey: direct.taxonomyKey || null,
        confidence: 0.92, reason: `Instagram collection “${igName}” matches “${direct.name}”`, isNew: false, isInbox: false, alternatives: [],
      });
    }
  }

  // 2. Keyword scoring.
  let all = [];
  candidates.forEach((cand, i) => {
    all = all.concat(collectMatches(cand, i, fields, prefs));
  });
  all = applyDominance(all);

  const scores = candidates.map(() => 0);
  const explain = candidates.map(() => []);
  const seen = new Set();
  for (const m of all) {
    const key = `${m.candidateIndex}|${m.field}|${m.keyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fw = FIELD_WEIGHTS[m.field] || 1;
    scores[m.candidateIndex] += fw * m.weight;
    if (explain[m.candidateIndex].length < 4) explain[m.candidateIndex].push(m);
  }

  // 3. Retailer preferences learned from past behaviour.
  const host = product?.host || product?.retailerHost || '';
  const retailerPrefs = (prefs.retailerPrefs || {})[host] || null;
  if (retailerPrefs) {
    candidates.forEach((cand, i) => {
      const count = cand.id ? retailerPrefs[cand.id] : 0;
      if (count >= 2) {
        scores[i] += Math.min(8, count * 2);
        explain[i].push({ field: 'retailer', keyword: host, matched: host, weight: count, kind: 'retailer' });
      }
    });
  }

  const ranked = candidates
    .map((cand, i) => ({ cand, score: scores[i], why: explain[i] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.cand.virtual === b.cand.virtual ? 0 : a.cand.virtual ? 1 : -1));

  const alternatives = ranked.slice(0, 4).map((r) => ({
    collectionId: r.cand.id, collectionName: r.cand.name, taxonomyKey: r.cand.taxonomyKey, score: Math.round(r.score * 10) / 10, isNew: r.cand.virtual,
  }));

  if (!ranked.length) {
    return finish({
      collectionId: null, collectionName: 'Review', taxonomyKey: null,
      confidence: 0, reason: 'No category signals found in the product text', isNew: false, isInbox: true, alternatives,
    });
  }

  const top = ranked[0];
  const second = ranked[1] ? ranked[1].score : 0;
  let confidence = (top.score - 0.5 * second) / (top.score + 3);
  confidence = Math.max(0, Math.min(0.98, confidence));
  // A single low-weight regular keyword should never look confident.
  if (top.score < 3) confidence = Math.min(confidence, 0.35);
  // Explicit user rules and per-collection keywords are the user's own words:
  // when one matched the winner, trust it.
  if (top.why.some((w) => w.kind === 'rule' || w.kind === 'user')) confidence = Math.max(confidence, 0.85);

  const reason = describeWhy(top.why);
  if (confidence < threshold) {
    return finish({
      collectionId: null, collectionName: 'Review', taxonomyKey: null,
      confidence, reason: `Low confidence (${Math.round(confidence * 100)}%) for “${top.cand.name}”: ${reason}`,
      isNew: false, isInbox: true, alternatives, suggested: alternatives[0] || null,
    });
  }

  return finish({
    collectionId: top.cand.id, collectionName: top.cand.name, taxonomyKey: top.cand.taxonomyKey,
    confidence, reason, isNew: top.cand.virtual, isInbox: false, alternatives,
  });

  function finish(result) {
    result.confidence = Math.round(result.confidence * 100) / 100;
    return result;
  }
}

function describeWhy(why) {
  if (!why || !why.length) return 'no matching signals';
  const parts = [];
  const byField = new Map();
  for (const w of why) {
    if (w.kind === 'retailer') {
      parts.push(`you usually file items from ${w.matched} here`);
      continue;
    }
    const label = { title: 'title', description: 'description', schemaCategory: 'category', breadcrumbs: 'breadcrumbs', alt: 'image text', cardText: 'card text', caption: 'caption', instagramCollection: 'Instagram collection' }[w.field] || w.field;
    if (!byField.has(label)) byField.set(label, []);
    const tag = w.kind === 'learned' ? ' (learned)' : w.kind === 'rule' || w.kind === 'user' ? ' (your rule)' : '';
    byField.get(label).push(`“${w.matched}”${tag}`);
  }
  for (const [label, kws] of byField) parts.push(`${kws.join(', ')} in ${label}`);
  return parts.join('; ');
}

// --- learning -------------------------------------------------------------------

export function emptyPrefs() {
  return {
    rules: [],
    learnedKeywords: {},
    retailerPrefs: {},
    corrections: [],
    confidenceThreshold: 0.6,
    autoCreateCollections: true,
  };
}

// Record a manual move so future similar items land in `toId`.
// options.strong => the user explicitly asked to use this choice for similar items.
export function learnFromCorrection(product, fromId, toId, prefs, options = {}) {
  const next = { ...emptyPrefs(), ...(prefs || {}) };
  next.learnedKeywords = { ...(next.learnedKeywords || {}) };
  next.retailerPrefs = { ...(next.retailerPrefs || {}) };
  next.corrections = [...(next.corrections || [])];
  if (!toId) return next;
  const terms = salientTerms(product);
  const inc = options.strong ? 3 : 1;
  for (const term of terms) {
    const entry = { ...(next.learnedKeywords[term] || {}) };
    entry[toId] = Math.min(MAX_LEARNED_WEIGHT, (entry[toId] || 0) + inc);
    if (fromId && fromId !== toId && entry[fromId]) entry[fromId] = Math.max(0, entry[fromId] - 0.5 * inc);
    for (const k of Object.keys(entry)) if (!entry[k]) delete entry[k];
    next.learnedKeywords[term] = entry;
  }
  const host = product?.host || '';
  if (host) {
    const hp = { ...(next.retailerPrefs[host] || {}) };
    hp[toId] = (hp[toId] || 0) + 1;
    next.retailerPrefs[host] = hp;
  }
  next.corrections.push({ at: new Date().toISOString(), itemId: product?.id || null, title: String(product?.title || '').slice(0, 120), from: fromId || null, to: toId, terms, strong: !!options.strong });
  if (next.corrections.length > 200) next.corrections = next.corrections.slice(-200);
  return next;
}

// Drop every learned reference to a collection that no longer exists (or was merged).
export function forgetCollection(prefs, collectionId, replacementId = null) {
  const next = { ...emptyPrefs(), ...(prefs || {}) };
  const lk = {};
  for (const [term, entry] of Object.entries(next.learnedKeywords || {})) {
    const e = { ...entry };
    if (e[collectionId]) {
      if (replacementId) e[replacementId] = Math.min(MAX_LEARNED_WEIGHT, (e[replacementId] || 0) + e[collectionId]);
      delete e[collectionId];
    }
    if (Object.keys(e).length) lk[term] = e;
  }
  next.learnedKeywords = lk;
  const rp = {};
  for (const [host, entry] of Object.entries(next.retailerPrefs || {})) {
    const e = { ...entry };
    if (e[collectionId]) {
      if (replacementId) e[replacementId] = (e[replacementId] || 0) + e[collectionId];
      delete e[collectionId];
    }
    if (Object.keys(e).length) rp[host] = e;
  }
  next.retailerPrefs = rp;
  next.rules = (next.rules || []).map((r) => (r.collectionId === collectionId ? (replacementId ? { ...r, collectionId: replacementId } : null) : r)).filter(Boolean);
  next.corrections = (next.corrections || [])
    .map((c) => {
      if (c.to === collectionId) return replacementId ? { ...c, to: replacementId } : null;
      if (c.from === collectionId) return { ...c, from: replacementId || null };
      return c;
    })
    .filter(Boolean);
  return next;
}
