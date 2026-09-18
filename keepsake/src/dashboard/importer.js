// Instagram Saved-collection import: review screen for a scan captured by the
// popup. Posts become "inspiration" cards — Keepsake makes no claim about which
// product a post shows unless the optional AI feature is used explicitly.

import { MSG } from '../shared/messages.js';
import { el, clear, sanitizeText, pluralize, formatPrice } from '../shared/util.js';
import { classify, learnFromCorrection, findSimilarCollection } from '../shared/categorizer.js';
import { normalizeUrl } from '../shared/url.js';
import { titleFromCaption } from '../instagram/post.js';
import { enrichPosts, hasInstagramAccess, requestInstagramAccess } from '../instagram/enrich.js';
import * as UI from './ui.js';

const selection = new Map(); // post url -> { selected, collectionId, defaultChoice, touched }
const enrich = { running: false, stop: false, progress: null, lastResult: null, autoTried: false };

function postTitle(post) {
  return titleFromCaption(post.caption, post.creator, post.type);
}

export function productFor(post, scan) {
  const caption = sanitizeText(post.caption, 2200);
  return {
    title: post.title && post.details ? sanitizeText(post.title, 200) : postTitle(post),
    description: caption.slice(0, 1000),
    alt: sanitizeText(post.alt, 300),
    host: 'instagram.com',
    retailer: 'Instagram',
    instagram: {
      collectionName: scan.collectionName || '', caption, creator: post.creator || '', postType: post.type || 'post',
      hashtags: post.hashtags || [], links: post.links || [], products: post.products || [], postedAt: post.postedAt || '',
      location: post.location || '', originalImage: post.originalImage || '', linkInBio: !!post.linkInBio, details: !!post.details,
    },
  };
}

export function renderImport(ctx, view) {
  const page = el('div', { class: 'page page-wide' });
  view.append(page);
  page.append(el('p', { class: 'help' }, ['Loading…']));
  ctx.send({ type: MSG.IG_SCAN_STATE }).then((res) => {
    ctx.state.scan = res.ok ? res.scan : null;
    clear(page);
    draw(ctx, page);
    maybeAutoEnrich(ctx);
  });
}

function draw(ctx, page) {
  const scan = ctx.state.scan;
  if (!scan || !scan.posts) {
    page.append(instructions(ctx));
    return;
  }
  if (scan.status === 'scanning' || scan.status === 'starting') {
    page.append(UI.section(`Scanning “${scan.collectionName || 'collection'}”…`, 'Keep the Instagram tab open. Posts appear here when the scan finishes.', [
      el('div', { class: 'stat-grid' }, [el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [String(scan.posts.length)]), el('div', { class: 'stat-label' }, ['posts found so far'])])]),
      el('div', { class: 'actions-row' }, [el('button', { type: 'button', class: 'btn', onClick: () => ctx.send({ type: MSG.IG_STOP_SCAN, tabId: scan.tabId }) }, ['Stop scan'])]),
    ]));
    return;
  }
  if (scan.status === 'error') {
    page.append(UI.section('The scan hit a problem', '', [el('div', { class: 'notice notice-danger' }, [scan.error || 'Unknown error']), el('div', { class: 'actions-row' }, [clearBtn(ctx)])]));
    page.append(instructions(ctx));
    return;
  }
  if (!scan.posts.length) {
    page.append(UI.section('No posts were found', 'The collection may still have been loading, or Instagram changed its layout. Reload the Instagram tab, wait for the grid to appear, then start the import again from the popup.', [el('div', { class: 'actions-row' }, [clearBtn(ctx)])]));
    page.append(instructions(ctx));
    return;
  }
  reviewScreen(ctx, page, scan);
}

function instructions(ctx) {
  return UI.section('Import a Saved collection', 'Bring the posts you saved on Instagram into Keepsake as inspiration cards.', [
    el('div', { class: 'steps' }, [
      stepNode(1, 'Open Instagram', 'Go to your profile → Saved, and open one collection (or “All posts”).'),
      stepNode(2, 'Click Keepsake', 'The popup recognizes the Saved collection and offers “Import this collection”.'),
      stepNode(3, 'Let it scroll', 'Keepsake scrolls the collection to load posts, then stops at the end, when nothing new appears, or at the safety limit. You can stop any time.'),
      stepNode(4, 'Review here', 'Deselect anything you don’t want, adjust collections, and import.'),
    ]),
    el('div', { class: 'prose' }, [
      el('p', {}, [el('strong', {}, ['What Keepsake reads: ']), 'post links, thumbnails, captions and creator names visible in the collection you opened. ', el('strong', {}, ['What it never reads: ']), 'your login, cookies, messages, or any other page.']),
      el('p', {}, ['Instagram changes its layout often. If a scan finds nothing, reload the page and try again — and know that the importer may need an update when Instagram changes.']),
    ]),
    el('div', { class: 'actions-row' }, [el('a', { class: 'btn', href: 'https://www.instagram.com/', target: '_blank', rel: 'noopener noreferrer' }, ['Open Instagram'])]),
  ]);
}

function stepNode(n, title, text) {
  return el('div', { class: 'step' }, [el('div', { class: 'step-num' }, [String(n)]), el('h3', {}, [title]), el('p', {}, [text])]);
}

function clearBtn(ctx) {
  return el('button', { type: 'button', class: 'btn btn-quiet', onClick: async () => {
    await ctx.send({ type: MSG.IG_SCAN_CLEAR });
    ctx.state.scan = null;
    selection.clear();
    ctx.render();
  } }, ['Discard scan']);
}

async function reviewScreen(ctx, page, scan) {
  const regular = ctx.regularCollections();
  const context = { collections: ctx.state.collections, prefs: ctx.state.prefs, settings: ctx.state.settings };
  const history = (ctx.state.importHistory && ctx.state.importHistory.instagram) || {};
  const itemsById = new Map(ctx.state.items.map((i) => [i.id, i]));

  const igName = scan.collectionName || 'collection';
  const nameMatch = regular.find((c) => c.name.toLowerCase() === igName.toLowerCase()) || findSimilarCollection(igName, regular, 0.85);
  // When the Instagram collection has a name we don't know yet, offer to create
  // a Keepsake collection with that name (default for posts Keepsake otherwise
  // can't place) — the name is the strongest signal we have.
  const canCreate = !nameMatch && !!scan.collectionName && !/^all posts$/i.test(igName) && ctx.state.prefs?.autoCreateCollections !== false;
  const createValue = `newname:${igName}`;
  const NONE = '__none'; // leave uncategorized, for Review

  // Classify each post once; the Instagram collection name is a strong signal.
  const rows = scan.posts.map((post) => {
    const product = productFor(post, scan);
    const cls = classify(product, context);
    const rememberedId = history[normalizeUrl(post.url)];
    const alreadyImported = (!!rememberedId && itemsById.has(rememberedId)) || ctx.state.items.some((i) => i.type === 'instagram' && i.sourceUrl === post.url);
    let def = cls.isNew ? `new:${cls.taxonomyKey}` : cls.collectionId || NONE;
    if (cls.isInbox && canCreate) def = createValue;
    const existing = selection.get(post.url);
    if (!existing) selection.set(post.url, { selected: !alreadyImported, collectionId: def, defaultChoice: def, touched: false });
    else if (!existing.touched) Object.assign(existing, { collectionId: def, defaultChoice: def });
    return { post, product, cls, alreadyImported };
  });

  const counts = () => rows.filter((r) => selection.get(r.post.url).selected).length;
  const head = el('div', { class: 'import-head' });
  const summary = el('span', { class: 'muted' });
  const updateSummary = () => { summary.textContent = `${counts()} of ${scan.posts.length} selected · ${rows.filter((r) => r.alreadyImported).length} already imported`; };
  updateSummary();

  const bulkSel = UI.selectInput({ value: '', options: [{ value: '', label: 'Set collection for all selected…' }, ...regular.map((c) => ({ value: c.id, label: c.name })), canCreate ? { value: createValue, label: `Create “${igName}” (new)` } : null, { value: NONE, label: 'Leave uncategorized (Review)' }].filter(Boolean), onChange: (v) => {
    if (!v) return;
    for (const r of rows) if (selection.get(r.post.url).selected) { Object.assign(selection.get(r.post.url), { collectionId: v, touched: true }); }
    bulkSel.value = '';
    grid.querySelectorAll('select[data-post]').forEach((s) => { if (selection.get(s.dataset.post).selected) s.value = v; });
  }, label: 'Set collection for all selected' });

  const importBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: () => doImport() }, [`Import ${pluralize(counts(), 'post', 'posts')}`]);
  const refreshImportBtn = () => { importBtn.textContent = `Import ${pluralize(counts(), 'post', 'posts')}`; importBtn.disabled = counts() === 0; };
  refreshImportBtn();

  head.append(
    el('div', {}, [
      el('h2', { class: 'card-section-title' }, [`“${igName}”`, scan.username ? el('span', { class: 'muted small' }, [` · @${scan.username}`]) : null]),
      summary,
    ]),
    el('div', { class: 'actions-row' }, [
      el('button', { type: 'button', class: 'btn btn-sm', onClick: () => setAll(true) }, ['Select all']),
      el('button', { type: 'button', class: 'btn btn-sm', onClick: () => setAll(false) }, ['Select none']),
      el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { for (const r of rows) selection.get(r.post.url).selected = !r.alreadyImported; syncChecks(); } }, ['Skip already imported']),
      bulkSel,
      clearBtn(ctx),
      importBtn,
    ]),
  );
  page.append(head);
  page.append(detailsBanner(ctx, scan));
  page.append(el('p', { class: 'help' }, [
    nameMatch ? `Your Instagram collection name matches your “${nameMatch.name}” collection, so posts default there. ` : canCreate ? `Posts Keepsake can’t place from their captions will go into a new “${igName}” collection (change this per post or for all). ` : `Keepsake uses the collection name “${igName}” plus each caption to suggest a collection. `,
    'Posts are saved as inspiration cards with a link back to the original. ',
    scan.reason === 'limit' ? `The scan stopped at the safety limit (${scan.posts.length}); scroll further on Instagram and scan again to get more.` : '',
  ]));

  const grid = el('div', { class: 'import-grid' });
  const cardMap = new Map();
  for (const r of rows) {
    const sel = selection.get(r.post.url);
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
    if (canCreate) options.push({ value: createValue, label: `Create “${igName}” (new)` });
    options.push({ value: NONE, label: 'Leave uncategorized (Review)' });
    const colSel = UI.selectInput({ value: sel.collectionId, options, onChange: (v) => { sel.collectionId = v; sel.touched = true; }, label: `Collection for ${r.product.title}` });
    colSel.dataset.post = r.post.url;
    if (colSel.value !== sel.collectionId) { colSel.value = NONE; sel.collectionId = NONE; }
    const conf = r.cls.isInbox ? 'Not sure — leave uncategorized' : `${Math.round(r.cls.confidence * 100)}% · ${r.cls.reason}`;
    card.append(
      cb,
      UI.pictureNode({ src: r.post.thumbnail || r.post.originalThumbnail, title: r.product.title }),
      el('div', { class: 'post-body' }, [
        r.alreadyImported ? el('span', { class: 'pill pill-warn' }, ['Already imported']) : null,
        el('div', { class: 'post-caption' }, [r.product.title]),
        el('div', { class: 'post-creator' }, [[r.post.creator ? `@${r.post.creator}` : '', r.post.type === 'reel' ? 'Reel' : '', r.post.details ? '' : r.post.detailsError ? 'details unavailable' : ''].filter(Boolean).join(' · ')]),
        r.post.products && r.post.products.length ? el('div', { class: 'post-products' }, r.post.products.slice(0, 3).map((p) => el('span', { class: 'pill pill-ok', title: p.url || '' }, [p.name, p.price !== null && p.price !== undefined ? ` · ${formatPrice(p.price, p.currency || 'USD')}` : '']))) : null,
        r.post.links && r.post.links.length ? el('div', { class: 'post-links' }, r.post.links.slice(0, 2).map((l) => el('a', { class: 'small', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, [l.label || l.url]))) : null,
        colSel,
        el('div', { class: 'post-conf', title: r.cls.reason }, [conf]),
        el('a', { class: 'small', href: r.post.url, target: '_blank', rel: 'noopener noreferrer' }, ['Open on Instagram']),
      ]),
    );
    cardMap.set(r.post.url, { card, cb });
    grid.append(card);
  }
  page.append(grid);

  function setAll(on) {
    for (const r of rows) selection.get(r.post.url).selected = on;
    syncChecks();
  }
  function syncChecks() {
    for (const r of rows) {
      const { card, cb } = cardMap.get(r.post.url);
      cb.checked = selection.get(r.post.url).selected;
      card.classList.toggle('deselected', !cb.checked);
    }
    updateSummary();
    refreshImportBtn();
  }

  async function doImport() {
    const chosen = rows.filter((r) => selection.get(r.post.url).selected);
    if (!chosen.length) return;
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';
    const created = [];
    const entries = [];
    const collectionCache = new Map();
    let skipped = 0;
    let prefs = await ctx.store.getPrefs();
    let learned = false;
    try {
      for (const r of chosen) {
        const sel = selection.get(r.post.url);
        const resolve = async (value) => {
          if (typeof value !== 'string' || value === NONE) return null;
          if (value.startsWith('new:')) {
            if (!collectionCache.has(value)) collectionCache.set(value, (await ctx.store.ensureCollectionForTaxonomy(value.slice(4)))?.id || null);
            return collectionCache.get(value);
          }
          if (value.startsWith('newname:')) {
            if (!collectionCache.has(value)) collectionCache.set(value, (await ctx.store.createCollection({ name: sanitizeText(value.slice(8), 80) })).collection.id);
            return collectionCache.get(value);
          }
          return value;
        };
        const dupe = await ctx.store.findByUrl(r.post.url);
        if (dupe) {
          skipped++;
          continue;
        }
        const targetId = await resolve(sel.collectionId);
        const userChose = sel.collectionId !== sel.defaultChoice;
        const namedDefault = !userChose && sel.collectionId === createValue;
        const isUncategorized = !targetId;
        const item = await ctx.store.addItem({
          ...r.product,
          type: 'instagram',
          url: r.post.url,
          sourceUrl: r.post.url,
          canonicalUrl: r.post.url,
          image: r.post.thumbnail || r.post.originalThumbnail || r.post.originalImage || '',
          images: [r.post.thumbnail, r.post.originalImage, r.post.originalThumbnail].filter(Boolean),
          imageAspect: 1,
          collectionId: targetId,
          confidence: userChose ? 1 : namedDefault ? 0.9 : r.cls.confidence,
          categorizationSource: userChose ? 'manual' : 'local',
          categorizationReason: userChose ? 'Chosen by you during import' : namedDefault ? `Instagram collection “${igName}”` : r.cls.reason,
          needsReview: !userChose && isUncategorized,
        });
        created.push(item);
        entries.push([r.post.url, item.id]);
        if (userChose && !isUncategorized) {
          // A correction during review is a lesson worth keeping.
          prefs = learnFromCorrection(item, r.cls.isInbox ? null : r.cls.collectionId, targetId, prefs);
          learned = true;
        }
      }
      if (learned) await ctx.store.setPrefs(prefs);
      await ctx.store.markImported(entries);
      // Set covers for collections that lack one.
      for (const item of created) {
        const col = await ctx.store.getCollection(item.collectionId);
        if (col && !col.coverImage && item.image) await ctx.store.updateCollection(col.id, { coverImage: item.image });
      }
      await ctx.send({ type: MSG.IG_SCAN_CLEAR });
      ctx.state.scan = null;
      selection.clear();
      UI.toast(`Imported ${pluralize(created.length, 'post', 'posts')}${skipped ? ` (${skipped} already saved)` : ''}.`, { duration: 6000 });
      ctx.navigate(created.length && created.every((i) => !i.collectionId) ? '#review' : '#all');
    } catch (e) {
      UI.toast(String((e && e.message) || e), { kind: 'danger', duration: 8000 });
      importBtn.disabled = false;
      refreshImportBtn();
    }
  }
}


// --- "Read post details" ---------------------------------------------------------------------------------

function detailsBanner(ctx, scan) {
  const box = el('div', { class: 'notice details-banner' });
  const missing = scan.posts.filter((p) => !p.details);
  const draw = () => {
    clear(box);
    if (enrich.running) {
      const pr = enrich.progress || { done: 0, total: scan.posts.length, failed: 0 };
      const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(pr.total), 'aria-valuenow': String(pr.done + pr.failed) });
      const fill = el('div', { class: 'progress-fill' });
      fill.style.width = `${Math.round(((pr.done + pr.failed) / Math.max(1, pr.total)) * 100)}%`;
      bar.append(fill);
      box.append(
        el('div', { class: 'row' }, [
          el('strong', { class: 'grow' }, [`Reading post details… ${pr.done + pr.failed} of ${pr.total}`]),
          el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { enrich.stop = true; } }, ['Stop']),
        ]),
        bar,
        el('div', { class: 'help' }, ['Keepsake opens each post’s page with your own Instagram session, one at a time with a short pause, and reads the caption, creator, links and any tagged products. Nothing is sent anywhere.']),
      );
      return;
    }
    if (!missing.length) {
      const withLinks = scan.posts.filter((p) => (p.links && p.links.length) || (p.products && p.products.length)).length;
      box.className = 'notice notice-ok details-banner';
      box.append(el('div', {}, [el('strong', {}, ['Post details read. ']), `Captions and creators are filled in${withLinks ? `; ${pluralize(withLinks, 'post has', 'posts have')} product links or tags` : ''}.`]));
      return;
    }
    const last = enrich.lastResult;
    box.className = `notice ${last && last.failed && !last.done ? 'notice-warn' : ''} details-banner`;
    box.append(
      el('div', { class: 'row' }, [
        el('div', { class: 'grow' }, [
          el('strong', {}, [`${pluralize(missing.length, 'post is', 'posts are')} missing details. `]),
          'Instagram’s grid only exposes thumbnails. Reading each post’s page fills in the caption (used as the title), creator, hashtags, links and any tagged products — about ',
          el('strong', {}, [`${Math.ceil((missing.length * 2.3) / 60)} min`]), ' for this many posts.',
        ]),
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => startEnrichment(ctx, scan) }, ['Read post details']),
      ]),
      last && last.failed ? el('div', { class: 'help' }, [`${pluralize(last.failed, 'post', 'posts')} could not be read${last.loginWalls ? ' (Instagram showed a login page — make sure you are logged in, then try again)' : ''}. You can still import with what was found.`]) : null,
      el('div', { class: 'help' }, ['Needs one-time permission for instagram.com so Keepsake can read post pages. You can revoke it under Settings → Instagram.']),
    );
  };
  draw();
  box._redraw = draw;
  return box;
}

async function startEnrichment(ctx, scan) {
  if (enrich.running) return;
  if (!(await hasInstagramAccess())) {
    const ok = await requestInstagramAccess();
    if (!ok) {
      UI.toast('Keepsake needs permission for instagram.com to read post pages.', { kind: 'danger', duration: 6000 });
      return;
    }
  }
  enrich.running = true;
  enrich.stop = false;
  enrich.progress = { done: 0, total: scan.posts.length, failed: 0 };
  const banner = document.querySelector('.details-banner');
  if (banner && banner._redraw) banner._redraw();
  const settings = ctx.state.settings.instagram || {};
  let lastSave = Date.now();
  try {
    const result = await enrichPosts(scan.posts, {
      send: ctx.send,
      delayMs: Math.max(500, Number(settings.readDelayMs) || 1500),
      shouldStop: () => enrich.stop,
      onProgress: async (pr) => {
        enrich.progress = pr;
        const b = document.querySelector('.details-banner');
        if (b && b._redraw) b._redraw();
        // Persist partial progress so a reload keeps what was read.
        if (Date.now() - lastSave > 5000) {
          lastSave = Date.now();
          const posts = scan.posts.map((p, i) => (i <= pr.current && pr.post && pr.post.url === p.url ? pr.post : p));
          await ctx.send({ type: MSG.IG_SCAN_SET_POSTS, posts });
        }
      },
    });
    enrich.lastResult = result;
    await ctx.send({ type: MSG.IG_SCAN_SET_POSTS, posts: result.posts });
    ctx.state.scan = { ...scan, posts: result.posts };
    UI.toast(result.stopped ? `Stopped after ${result.done} of ${result.posts.length} posts.` : `Read ${result.done} of ${result.posts.length} posts${result.failed ? ` (${result.failed} unavailable)` : ''}.`, { duration: 5000 });
  } catch (e) {
    UI.toast(String((e && e.message) || e), { kind: 'danger', duration: 8000 });
  } finally {
    enrich.running = false;
    enrich.stop = false;
    ctx.render();
  }
}

// Called by the dashboard when the review screen opens: read details
// automatically when the user already granted instagram.com access.
export async function maybeAutoEnrich(ctx) {
  const scan = ctx.state.scan;
  if (!scan || scan.status !== 'done' || !scan.posts?.length || enrich.running) return;
  const key = `${scan.collectionUrl || ''}|${scan.posts.length}`;
  if (enrich.autoTried === key) return;
  if (ctx.state.settings?.instagram?.readPostDetails === false) return;
  if (!scan.posts.some((p) => !p.details)) return;
  enrich.autoTried = key;
  if (await hasInstagramAccess()) startEnrichment(ctx, scan);
}
