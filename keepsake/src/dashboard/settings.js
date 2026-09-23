// Settings, Optional AI and Privacy views for the dashboard.

import { LIMITS } from '../shared/storage.js';
import { MSG } from '../shared/messages.js';
import { el, clear, sanitizeText, pluralize } from '../shared/util.js';
import { originPattern, hostFromPattern } from '../shared/url.js';
import { emptyPrefs } from '../shared/categorizer.js';
import { PROVIDERS, providerConfig, originFor, describePayload, analyzePost, testConnection, findProductOnline, supportsWebLookup } from '../ai/provider.js';
import * as UI from './ui.js';
import { cleanupSection } from './aiCleanup.js';
import { hasInstagramAccess, revokeInstagramAccess } from '../instagram/enrich.js';

const ALL_SITES = '*://*/*';

async function grantedOrigins() {
  try {
    const p = await chrome.permissions.getAll();
    return p.origins || [];
  } catch {
    return [];
  }
}

function hasAllSites(origins) {
  return origins.includes(ALL_SITES) || origins.includes('<all_urls>');
}

async function requestOrigin(pattern) {
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch (e) {
    UI.toast(`Chrome refused the permission request: ${String((e && e.message) || e)}`, { kind: 'danger' });
    return false;
  }
}

async function removeOrigin(pattern) {
  try {
    await chrome.permissions.remove({ origins: [pattern] });
  } catch {
    /* already gone */
  }
}

// --- Settings --------------------------------------------------------------------------------------

export function renderSettings(ctx, view) {
  const page = el('div', { class: 'page' });
  page.append(el('p', { class: 'page-intro' }, ['Everything here is stored in this browser only. Nothing is sent to a server unless you turn on the optional AI feature with your own key.']));
  page.append(appearanceSection(ctx));
  page.append(floatingSection(ctx));
  page.append(categorizationSection(ctx));
  page.append(collectionsSection(ctx));
  page.append(instagramSection(ctx));
  page.append(aiSummarySection(ctx));
  page.append(dataSection(ctx));
  page.append(aboutSection());
  view.append(page);
}

function appearanceSection(ctx) {
  const s = ctx.state.settings;
  return UI.section('Appearance', '', [
    UI.settingRow('Theme', UI.selectInput({ value: s.theme || 'system', options: [{ value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], onChange: (v) => ctx.store.updateSettings({ theme: v }), label: 'Theme' }), 'Also toggled from the sun icon in the toolbar.'),
    UI.settingRow('Keyboard shortcut', el('span', {}, [el('span', { class: 'kbd' }, ['Alt']), ' + ', el('span', { class: 'kbd' }, ['Shift']), ' + ', el('span', { class: 'kbd' }, ['K'])]), 'Opens Keepsake for the current page. Change it at chrome://extensions/shortcuts.'),
  ]);
}

function floatingSection(ctx) {
  const box = el('div', {});
  const draw = async () => {
    clear(box);
    const s = ctx.state.settings.floating;
    const origins = await grantedOrigins();
    const all = hasAllSites(origins);

    const radio = (value, title, text) => {
      const input = el('input', { type: 'radio', name: 'floatingMode', value });
      input.checked = s.mode === value;
      const label = el('label', { class: `radio ${s.mode === value ? 'checked' : ''}` }, [input, el('div', { class: 'radio-text' }, [el('strong', {}, [title]), el('span', {}, [text])])]);
      input.addEventListener('change', async () => {
        if (!input.checked) return;
        const all = hasAllSites(await grantedOrigins());
        if (value === 'all' && !all) {
          const ok = await requestOrigin(ALL_SITES);
          if (!ok) {
            UI.toast('Keepsake needs permission to run on sites to show buttons there. No permission was granted.', { duration: 6000 });
            await draw();
            return;
          }
        }
        // Leaving "all sites" gives the broad permission back: Keepsake keeps
        // only what the current mode needs.
        let revoked = false;
        if (value !== 'all' && all) revoked = await removeOrigin(ALL_SITES);
        await ctx.store.updateSettings({ floating: { mode: value } });
        await ctx.send({ type: MSG.FLOATING_REFRESH });
        UI.toast(value === 'off' ? `On-page buttons are off everywhere.${revoked ? ' All-site access was revoked.' : ''}` : 'On-page buttons updated.', { duration: 2500 });
      });
      return label;
    };

    box.append(el('div', { class: 'radio-group' }, [
      radio('off', 'Off (toolbar only)', 'The toolbar popup, keyboard shortcut and right-click menu always work. No scripts run on any site.'),
      radio('selected', 'Only on sites I choose', 'Grant access per site below. Chrome asks you once per site.'),
      radio('all', 'On all sites', 'Chrome will ask you to allow Keepsake to read and change data on all sites — that’s what it takes to show a button on product cards. Keepsake still only reads product data when you hover a card, and never sends anything anywhere.'),
    ]));

    if (s.mode === 'all') {
      box.append(el('div', { class: `notice ${all ? 'notice-ok' : 'notice-warn'}` }, [all ? 'Access to all sites is granted. You can revoke it below or from chrome://extensions.' : 'Access to all sites is not currently granted, so buttons won’t appear. Choose this option again to re-request.']));
      if (all) box.append(el('div', { class: 'actions-row' }, [el('button', { type: 'button', class: 'btn btn-sm', onClick: async () => { await removeOrigin(ALL_SITES); await ctx.store.updateSettings({ floating: { mode: 'off' } }); await ctx.send({ type: MSG.FLOATING_REFRESH }); UI.toast('Site access revoked. On-page buttons are off.'); draw(); } }, ['Revoke all-site access'])]));
    }

    // Selected sites: only meaningful when buttons run on sites the user picks.
    const siteList = el('ul', { class: 'site-list' });
    const sites = s.sites || [];
    if (!sites.length) siteList.append(el('li', { class: 'help' }, ['No sites yet. Add a site to grant access there.']));
    for (const pattern of sites) {
      const granted = all || origins.includes(pattern) || origins.some((o) => o.replace(/^https?:/, '*:') === pattern);
      siteList.append(el('li', { class: 'site-row' }, [
        el('span', { class: 'mono' }, [hostFromPattern(pattern)]),
        el('span', { class: `pill ${granted ? 'pill-ok' : 'pill-warn'}` }, [granted ? 'Access granted' : 'Not granted']),
        !granted ? el('button', { type: 'button', class: 'btn btn-sm', onClick: async () => { if (await requestOrigin(pattern)) { await ctx.send({ type: MSG.FLOATING_REFRESH }); draw(); } } }, ['Grant']) : null,
        el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: async () => {
          await removeOrigin(pattern);
          await ctx.store.updateSettings({ floating: { sites: sites.filter((p) => p !== pattern) } });
          await ctx.send({ type: MSG.FLOATING_REFRESH });
          draw();
        } }, ['Remove']),
      ]));
    }
    const siteInput = el('input', { class: 'input', placeholder: 'shop.example.com', 'aria-label': 'Site to add', spellcheck: 'false' });
    const addBtn = el('button', { type: 'button', class: 'btn', onClick: async () => {
      let host = siteInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
        UI.toast('Enter a hostname like shop.example.com', { kind: 'danger' });
        siteInput.focus();
        return;
      }
      const pattern = originPattern(`https://${host}/`);
      const next = [...new Set([...sites, pattern])];
      const ok = await requestOrigin(pattern);
      await ctx.store.updateSettings({ floating: { sites: next, mode: s.mode === 'off' ? 'selected' : s.mode } });
      await ctx.send({ type: MSG.FLOATING_REFRESH });
      siteInput.value = '';
      UI.toast(ok ? `Buttons will appear on ${host}.` : `Added ${host}, but access wasn’t granted yet.`);
      draw();
    } }, ['Add site']);
    siteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } });
    if (s.mode === 'selected') box.append(el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Sites with on-page buttons']), siteList, el('div', { class: 'inline-form' }, [siteInput, addBtn])]));

    // Hidden sites: the way to opt individual sites out when buttons run everywhere.
    const hidden = s.hiddenSites || [];
    const hiddenChips = el('div', { class: 'chips' }, hidden.length ? hidden.map((h) => el('span', { class: 'chip' }, [h, el('button', { type: 'button', 'aria-label': `Show buttons on ${h} again`, onClick: async () => { await ctx.store.updateSettings({ floating: { hiddenSites: hidden.filter((x) => x !== h) } }); await ctx.send({ type: MSG.FLOATING_REFRESH }); draw(); } }, [UI.closeIcon()])])) : [el('span', { class: 'help' }, ['None. Add a site here to keep buttons off it.'])]);
    const hideInput = el('input', { class: 'input', placeholder: 'news.example.com', 'aria-label': 'Site to hide buttons on', spellcheck: 'false' });
    const hideBtn = el('button', { type: 'button', class: 'btn', onClick: async () => {
      const host = hideInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (!host) return;
      await ctx.store.updateSettings({ floating: { hiddenSites: [...new Set([...hidden, host])] } });
      await ctx.send({ type: MSG.FLOATING_REFRESH });
      hideInput.value = '';
      draw();
    } }, ['Hide here']);
    hideInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hideBtn.click(); } });
    // Hidden sites apply in every mode, so in "selected" mode the list still shows while it has entries (so they can be removed).
    if (s.mode === 'all' || (s.mode === 'selected' && hidden.length)) box.append(el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Hidden on these sites']), hiddenChips, el('div', { class: 'inline-form' }, [hideInput, hideBtn])]));

    const rows = el('div', {}, [
      UI.settingRow('Button size', UI.selectInput({ value: s.size, options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }], onChange: (v) => ctx.store.updateSettings({ floating: { size: v } }), label: 'Button size' })),
      UI.settingRow('Button position', UI.selectInput({ value: s.position, options: [{ value: 'top-right', label: 'Top right of card' }, { value: 'top-left', label: 'Top left' }, { value: 'bottom-right', label: 'Bottom right' }, { value: 'bottom-left', label: 'Bottom left' }], onChange: (v) => ctx.store.updateSettings({ floating: { position: v } }), label: 'Button position' })),
    ]);
    if (s.mode !== 'off') {
      box.append(rows);
      box.append(el('p', { class: 'help' }, ['Pressing Alt+Shift+S on a page with buttons enabled saves the card you are hovering or focused on.']));
    }
  };
  draw();
  return UI.section('On-page save buttons', 'A small “Save” button on product cards and main product images. Off by default; runs only on sites you allow.', [box]);
}

function categorizationSection(ctx) {
  const box = el('div', {});
  const draw = () => {
    clear(box);
    const prefs = ctx.state.prefs || emptyPrefs();
    const cols = ctx.regularCollections();
    const threshold = Number(prefs.confidenceThreshold) || 0.6;
    const range = el('input', { type: 'range', min: '0.3', max: '0.9', step: '0.05', 'aria-label': 'Confidence threshold' });
    range.value = String(threshold);
    const val = el('span', { class: 'slider-value' }, [`${Math.round(threshold * 100)}%`]);
    range.addEventListener('input', () => { val.textContent = `${Math.round(Number(range.value) * 100)}%`; });
    range.addEventListener('change', () => ctx.store.updatePrefs({ confidenceThreshold: Number(range.value) }));
    box.append(UI.settingRow('Confidence needed to auto-file', el('div', { class: 'slider-row' }, [range, val]), 'Below this, saves are left uncategorized and wait in Review. Higher = more items in Review, fewer mistakes.'));
    box.append(UI.settingRow('Create default collections on demand', UI.switchInput({ checked: prefs.autoCreateCollections !== false, onChange: (v) => ctx.store.updatePrefs({ autoCreateCollections: v }), label: 'Create default collections on demand' }), 'If you deleted a default collection and a matching item shows up later, Keepsake can recreate it instead of leaving the item uncategorized.'));

    // Rules
    const rules = prefs.rules || [];
    const table = el('table', { class: 'table' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Keywords']), el('th', {}, ['Collection']), el('th', {}, [''])])]),
      el('tbody', {}, rules.length ? rules.map((r) => el('tr', {}, [
        el('td', {}, [r.keywords.join(', ')]),
        el('td', {}, [ctx.collectionById(r.collectionId)?.name || 'Unknown collection']),
        el('td', {}, [el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: () => ctx.store.updatePrefs({ rules: rules.filter((x) => x.id !== r.id) }) }, ['Remove'])]),
      ])) : [el('tr', {}, [el('td', { colspan: '3', class: 'help' }, ['No rules yet. Rules beat every other signal.'])])]),
    ]);
    const kwInput = el('input', { class: 'input', placeholder: 'keywords, comma separated', 'aria-label': 'Rule keywords' });
    const colSel = UI.selectInput({ value: cols[0]?.id || '', options: cols.map((c) => ({ value: c.id, label: c.name })), onChange: () => {}, label: 'Rule collection' });
    const addRule = el('button', { type: 'button', class: 'btn', disabled: !cols.length, onClick: async () => {
      const keywords = kwInput.value.split(',').map((s) => sanitizeText(s, 40).toLowerCase()).filter(Boolean).slice(0, 20);
      if (!keywords.length) {
        kwInput.focus();
        return;
      }
      await ctx.store.updatePrefs({ rules: [...rules, { id: `rule_${Date.now().toString(36)}`, keywords, collectionId: colSel.value }].slice(0, 500) });
      kwInput.value = '';
    } }, ['Add rule']);
    box.append(el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Always file these keywords into…']), el('div', { class: 'table-wrap' }, [table]), el('div', { class: 'inline-form' }, [kwInput, colSel, addRule])]));

    // Learned preferences
    const learned = Object.entries(prefs.learnedKeywords || {});
    const top = learned.map(([term, entry]) => {
      const [cid, w] = Object.entries(entry).sort((a, b) => b[1] - a[1])[0] || [];
      return { term, cid, w: Number(w) || 0 };
    }).filter((x) => x.cid).sort((a, b) => b.w - a.w).slice(0, 25);
    const retailers = Object.entries(prefs.retailerPrefs || {}).map(([host, entry]) => {
      const [cid, n] = Object.entries(entry).sort((a, b) => b[1] - a[1])[0] || [];
      return { host, cid, n: Number(n) || 0 };
    }).filter((x) => x.cid).sort((a, b) => b.n - a.n).slice(0, 15);
    const learnedBox = el('div', { class: 'field' }, [
      el('label', { class: 'label' }, [`Learned from your corrections (${learned.length} ${learned.length === 1 ? 'term' : 'terms'}, ${(prefs.corrections || []).length} moves)`]),
      top.length ? el('div', { class: 'chips' }, top.map((x) => el('span', { class: 'chip', title: `weight ${x.w}` }, [`${x.term} → ${ctx.collectionById(x.cid)?.name || '?'}`]))) : el('p', { class: 'help' }, ['Nothing learned yet. Move an item between collections and Keepsake will pick up the pattern.']),
      retailers.length ? el('p', { class: 'help' }, ['Retailer habits: ' + retailers.map((x) => `${x.host} → ${ctx.collectionById(x.cid)?.name || '?'}`).join(' · ')]) : null,
      el('div', { class: 'actions-row' }, [el('button', { type: 'button', class: 'btn btn-sm', disabled: !learned.length && !retailers.length, onClick: async () => {
        const ok = await UI.confirmDialog({ title: 'Clear learned preferences?', message: 'Keepsake forgets every keyword and retailer habit it picked up from your moves. Your rules and collections are kept.', confirmLabel: 'Clear', danger: true });
        if (ok) await ctx.store.updatePrefs({ learnedKeywords: {}, retailerPrefs: {}, corrections: [] });
      } }, ['Clear learned preferences'])]),
    ]);
    box.append(learnedBox);
    box.append(el('p', { class: 'help' }, [`${ctx.state.items.filter((i) => i.needsReview && !i.archived).length} low-confidence saves waiting in the `, el('a', { href: '#review' }, ['review queue']), '.']));
  };
  draw();
  return UI.section('Categorization', 'How Keepsake decides where a save goes: your rules first, then collection names and keywords, then what it learned from your corrections. All of it runs locally.', [box]);
}

function collectionsSection(ctx) {
  const cols = ctx.regularCollections();
  const counts = new Map();
  for (const i of ctx.state.items) counts.set(i.collectionId, (counts.get(i.collectionId) || 0) + 1);
  const rows = cols.map((c) => el('tr', {}, [
    el('td', {}, [el('a', { href: `#c/${c.id}` }, [c.name]), c.taxonomyKey ? el('span', { class: 'help' }, [' default']) : null]),
    el('td', {}, [String(counts.get(c.id) || 0)]),
    el('td', {}, [(c.keywords || []).slice(0, 5).join(', ') || el('span', { class: 'muted' }, ['—'])]),
  ]));
  return UI.section('Collections', `${pluralize(cols.length, 'collection', 'collections')}. Rename, merge, edit keywords or delete a collection from its page.`, [
    el('div', { class: 'table-wrap' }, [el('table', { class: 'table' }, [el('thead', {}, [el('tr', {}, [el('th', {}, ['Name']), el('th', {}, ['Items']), el('th', {}, ['Your keywords'])])]), el('tbody', {}, rows)])]),
    el('p', { class: 'help' }, [`${pluralize(counts.get(null) || 0, 'item', 'items')} uncategorized, waiting in Review. Collections with similar names are merged automatically when created.`]),
  ]);
}

function igAccessControl(ctx) {
  const box = el('span', {});
  const draw = async () => {
    clear(box);
    const has = await hasInstagramAccess();
    box.append(el('span', { class: `pill ${has ? 'pill-ok' : ''}` }, [has ? 'Granted' : 'Not granted']));
    if (has) box.append(' ', el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: async () => { await revokeInstagramAccess(); UI.toast('instagram.com access revoked.', { duration: 2000 }); draw(); } }, ['Revoke']));
  };
  draw();
  return box;
}

function instagramSection(ctx) {
  const s = ctx.state.settings.instagram;
  const history = ctx.state.importHistory?.instagram || {};
  const n = Object.keys(history).length;
  const limitInput = el('input', { class: 'input', type: 'number', min: '20', max: '2000', step: '10', 'aria-label': 'Safety limit' });
  limitInput.value = String(s.safetyLimit);
  limitInput.addEventListener('change', () => ctx.store.updateSettings({ instagram: { safetyLimit: Math.max(20, Math.min(2000, Number(limitInput.value) || 300)) } }));
  const idleInput = el('input', { class: 'input', type: 'number', min: '2', max: '30', step: '1', 'aria-label': 'Idle timeout in seconds' });
  idleInput.value = String(Math.round(s.idleTimeoutMs / 1000));
  idleInput.addEventListener('change', () => ctx.store.updateSettings({ instagram: { idleTimeoutMs: Math.max(2, Math.min(30, Number(idleInput.value) || 6)) * 1000 } }));
  return UI.section('Instagram import', 'Import posts from a Saved collection you have open. Keepsake only reads the page in front of you and never touches your login.', [
    UI.settingRow('Store small thumbnails locally', UI.switchInput({ checked: s.storeThumbnails, onChange: (v) => ctx.store.updateSettings({ instagram: { storeThumbnails: v } }), label: 'Store thumbnails' }), 'Keeps a ≤320px copy of each imported post image in your browser, so cards still show after Instagram links expire.'),
    UI.settingRow('Read post details after a scan', UI.switchInput({ checked: s.readPostDetails !== false, onChange: (v) => ctx.store.updateSettings({ instagram: { readPostDetails: v } }), label: 'Read post details' }), 'Opens each scanned post’s page (with your own Instagram session, one at a time) to fill in the caption, creator, hashtags, links and tagged products. Needs one-time permission for instagram.com; the review screen asks for it.'),
    UI.settingRow('instagram.com access', igAccessControl(ctx), 'Only used for reading post pages during an import.'),
    UI.settingRow('Safety limit (posts per scan)', limitInput, 'The scan stops on its own after this many posts.'),
    UI.settingRow('Stop after no new posts for (seconds)', idleInput),
    UI.settingRow('Imported post history', el('button', { type: 'button', class: 'btn btn-sm', disabled: !n, onClick: async () => {
      const ok = await UI.confirmDialog({ title: 'Forget imported posts?', message: 'Keepsake will no longer mark these posts as already imported. Items you imported are kept.', confirmLabel: 'Forget' });
      if (ok) await ctx.store.backend.set({ keepsake_importHistory: { instagram: {} } });
    } }, [`Forget ${pluralize(n, 'remembered post', 'remembered posts')}`]), 'Used to skip posts you already imported.'),
  ]);
}

function aiSummarySection(ctx) {
  const ai = ctx.state.settings.ai;
  return UI.section('Optional AI (beta)', 'Off by default. Uses your own API key with the provider you choose; nothing is sent until you enable it and confirm.', [
    UI.settingRow('Status', el('span', { class: `pill ${ai.on ? 'pill-warn' : ''}` }, [ai.on ? `On · ${PROVIDERS[ai.provider]?.label || ai.provider}` : 'Off — everything runs locally'])),
    el('div', { class: 'actions-row' }, [el('button', { type: 'button', class: 'btn', onClick: () => ctx.navigate('#ai') }, ['Open AI settings'])]),
  ]);
}

function dataSection(ctx) {
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', 'aria-label': 'Choose export file' });
  let importMode = 'merge';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await UI.readFileText(file, LIMITS.maxImportBytes);
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON.');
      }
      if (importMode === 'replace') {
        const ok = await UI.typedConfirm({ title: 'Replace everything?', message: 'All current collections, items and learned preferences will be replaced by the file’s contents.', word: 'REPLACE', confirmLabel: 'Replace' });
        if (!ok) return;
      }
      const res = await ctx.store.importJSON(payload, { mode: importMode });
      UI.toast(`Imported ${pluralize(res.addedItems, 'item', 'items')} and ${pluralize(res.addedCollections, 'collection', 'collections')}${res.skippedItems ? ` (${res.skippedItems} duplicates skipped)` : ''}.`, { duration: 6000 });
    } catch (e) {
      UI.toast(String((e && e.message) || e), { kind: 'danger', duration: 7000 });
    }
  });
  const usage = stat('…', 'in local storage');
  const stats = el('div', { class: 'stat-grid' }, [
    stat(ctx.state.items.length, 'items'),
    stat(ctx.regularCollections().length, 'collections'),
    stat(ctx.state.items.filter((i) => i.type === 'instagram').length, 'Instagram imports'),
    usage,
  ]);
  Promise.resolve()
    .then(() => chrome.storage.local.getBytesInUse(null))
    .then((bytes) => { usage.querySelector('.stat-value').textContent = formatBytes(bytes); })
    .catch(() => { usage.querySelector('.stat-value').textContent = '—'; });
  return UI.section('Your data', 'Stored in chrome.storage.local — this browser profile only. Export a JSON backup any time; it never includes your AI key.', [
    stats,
    el('div', { class: 'actions-row' }, [
      el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
        const data = await ctx.store.exportJSON();
        const stamp = new Date().toISOString().slice(0, 10);
        UI.download(`keepsake-export-${stamp}.json`, JSON.stringify(data, null, 2));
      } }, ['Export JSON']),
      el('button', { type: 'button', class: 'btn', onClick: () => { importMode = 'merge'; fileInput.click(); } }, ['Import (merge)']),
      el('button', { type: 'button', class: 'btn', onClick: () => { importMode = 'replace'; fileInput.click(); } }, ['Import (replace all)']),
      el('button', { type: 'button', class: 'btn btn-quiet', onClick: async () => {
        const n = await ctx.store.loadSampleData();
        UI.toast(`Added ${pluralize(n, 'sample item', 'sample items')}.`);
      } }, ['Load sample data']),
      fileInput,
    ]),
    el('p', { class: 'help' }, ['Merge keeps what you have and skips duplicates (same page URL). Replace clears everything first. Imports are validated and capped at 25 MB.']),
    el('div', { class: 'divider' }),
    el('div', { class: 'actions-row' }, [
      el('button', { type: 'button', class: 'btn btn-danger', onClick: async () => {
        const ok = await UI.typedConfirm({ title: 'Delete all local data?', message: 'Every collection, item, learned preference, setting and stored API key will be erased from this browser. Export first if you want a backup.', word: 'DELETE', confirmLabel: 'Delete everything' });
        if (!ok) return;
        await ctx.store.clearAll();
        try { await chrome.storage.session.clear(); } catch { /* fine */ }
        await ctx.store.init();
        await ctx.reload();
        ctx.navigate('#welcome');
        UI.toast('All local data deleted.');
      } }, ['Delete all local data']),
      el('span', { class: 'help' }, ['Erases everything Keepsake stored. Cannot be undone.']),
    ]),
  ]);
}

function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function stat(value, label) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [String(value)]), el('div', { class: 'stat-label' }, [label])]);
}

function aboutSection() {
  const manifest = chrome.runtime.getManifest();
  return UI.section('About', '', [
    el('p', { class: 'prose' }, [`Keepsake ${manifest.version}. Open source, no account, no telemetry. `, el('a', { href: '#privacy' }, ['Privacy details'])]),
  ]);
}

// --- Optional AI ------------------------------------------------------------------------------------

export function renderAI(ctx, view) {
  const page = el('div', { class: 'page' });
  const box = el('div', {});
  const draw = async () => {
    clear(box);
    const ai = ctx.state.settings.ai;
    const cfg = providerConfig(ctx.state.settings);
    const origin = originFor(ctx.state.settings);
    const origins = await grantedOrigins();
    const originGranted = !!origin && (origins.includes(origin) || hasAllSites(origins));
    const key = await ctx.store.getSecret('aiApiKey');

    box.append(UI.section('What this does — and what leaves your browser', '', [
      el('div', { class: 'prose' }, [
        el('p', {}, ['Keepsake never needs the internet. Turning on Optional AI connects your own AI provider account, and then:']),
        el('ul', {}, [
          el('li', {}, [el('strong', {}, ['Saves are instant: ']), 'every time you save, Keepsake sends the item’s title, price, description, retailer and your collection names. The AI tidies the title and picks the collection, and the item is saved right away with no preview (“Saved to …”, with Undo and Move). If the AI isn’t confident, the item waits in Review.']),
          el('li', {}, [el('strong', {}, ['Fix with AI: ']), 'when you start it (from Review or below), Keepsake sends the same fields for each item being checked, plus the title, price and availability read from its live product page. Pages are fetched from this browser without your cookies.']),
          el('li', {}, [el('strong', {}, ['Find products in Instagram saves: ']), 'for a post you select, Keepsake sends the locally stored thumbnail (a small JPEG) plus the caption, creator name and the Saved-collection name, and shows back product guesses. It never invents purchase links, and results can be wrong.']),
        ]),
        el('p', {}, ['Nothing else is ever sent: no browsing history, no cookies, no Instagram account data, no other items. Your key is stored only in this browser and is excluded from exports.']),
      ]),
    ]));

    const providerSel = UI.selectInput({ value: ai.provider || 'openai', options: Object.entries(PROVIDERS).map(([k, v]) => ({ value: k, label: v.label })), onChange: async (v) => { await ctx.store.updateSettings({ ai: { provider: v, baseUrl: '', model: '' } }); }, label: 'Provider' });
    const baseInput = el('input', { class: 'input', type: 'url', placeholder: PROVIDERS[ai.provider]?.baseUrl || 'https://…', 'aria-label': 'Base URL', spellcheck: 'false' });
    baseInput.value = ai.baseUrl || '';
    baseInput.addEventListener('change', () => ctx.store.updateSettings({ ai: { baseUrl: baseInput.value.trim() } }));
    const modelInput = el('input', { class: 'input', placeholder: PROVIDERS[ai.provider]?.model || 'model name', 'aria-label': 'Model', spellcheck: 'false' });
    modelInput.value = ai.model || '';
    modelInput.addEventListener('change', () => ctx.store.updateSettings({ ai: { model: modelInput.value.trim() } }));
    const keyInput = el('input', { class: 'input', type: 'password', placeholder: key ? '•••••••• (saved)' : 'Paste your API key', 'aria-label': 'API key', autocomplete: 'off', spellcheck: 'false' });
    const saveKey = el('button', { type: 'button', class: 'btn', onClick: async () => {
      const v = keyInput.value.trim();
      if (!v) return;
      await ctx.store.setSecret('aiApiKey', v);
      keyInput.value = '';
      UI.toast('Key saved in this browser only.');
      draw();
    } }, ['Save key']);
    const removeKey = el('button', { type: 'button', class: 'btn btn-quiet', disabled: !key, onClick: async () => {
      await ctx.store.setSecret('aiApiKey', '');
      await ctx.store.updateSettings({ ai: { on: false } });
      UI.toast('Key removed and Optional AI turned off.');
      draw();
    } }, ['Remove key']);
    const testBtn = el('button', { type: 'button', class: 'btn', disabled: !key, onClick: async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing…';
      try {
        if (!originGranted && origin) {
          const ok = await requestOrigin(origin);
          if (!ok) throw new Error('Keepsake needs permission to contact the provider’s address.');
        }
        const reply = await testConnection(ctx.state.settings, key);
        UI.toast(`Connected. Provider replied: ${reply || '(empty)'}`, { duration: 4000 });
      } catch (e) {
        UI.toast(String((e && e.message) || e), { kind: 'danger', duration: 8000 });
      } finally {
        draw();
      }
    } }, ['Test connection']);

    box.append(UI.section('Provider', '', [
      UI.settingRow('Provider', providerSel),
      ai.provider === 'custom' || ai.baseUrl ? UI.settingRow('Base URL', baseInput, ai.provider === 'custom' ? 'Any OpenAI-compatible chat completions endpoint (without /chat/completions).' : 'Leave empty to use the provider default.') : UI.settingRow('Base URL', el('span', { class: 'mono' }, [cfg.baseUrl]), 'Requests go only to this address.'),
      UI.settingRow('Model', modelInput, `Default: ${PROVIDERS[ai.provider]?.model || '—'}`),
      UI.settingRow('API key', el('div', { class: 'inline-form' }, [keyInput, saveKey, removeKey]), 'Stored under keepsake_secrets in chrome.storage.local. Never exported.'),
      UI.settingRow('Permission to contact the provider', el('span', { class: `pill ${originGranted ? 'pill-ok' : 'pill-warn'}` }, [originGranted ? `Granted for ${origin}` : origin ? 'Not granted yet' : 'Set a valid https base URL']), 'Chrome asks for this when you enable a feature or test the connection. Revoke it any time below or at chrome://extensions.'),
      el('div', { class: 'actions-row' }, [testBtn, originGranted && origin ? el('button', { type: 'button', class: 'btn btn-quiet', onClick: async () => { await removeOrigin(origin); await ctx.store.updateSettings({ ai: { on: false } }); draw(); } }, ['Revoke permission & turn off']) : null]),
    ]));

    const setAiOn = async (on) => {
      if (on) {
        if (!key) {
          UI.toast('Save your API key first.', { kind: 'danger' });
          return false;
        }
        if (!origin) {
          UI.toast('Set a valid https base URL first.', { kind: 'danger' });
          return false;
        }
        const confirmed = await UI.confirmDialog({
          title: 'Turn on Optional AI?',
          message: `Every save will send the item’s title, price, description, retailer and your collection names to ${cfg.baseUrl}, and be saved right away into the collection the AI picks. “Fix with AI” and “Find products” also become available; they only send anything when you start them.`,
          confirmLabel: 'Turn on',
        });
        if (!confirmed) return false;
        if (!originGranted) {
          const ok = await requestOrigin(origin);
          if (!ok) {
            UI.toast('Permission not granted, so Optional AI stays off.', { kind: 'danger' });
            return false;
          }
        }
      }
      await ctx.store.updateSettings({ ai: { on } });
      draw();
      return true;
    };

    box.append(UI.section('Optional AI', '', [
      UI.settingRow('Use AI', UI.switchInput({ checked: ai.on, onChange: async (v, input) => { if (!(await setAiOn(v))) input.checked = !v; }, label: 'Use AI' }), 'Instant saves, “Fix with AI” and “Find products”, all using the provider above.'),
    ]));
    if (ai.on) box.append(cleanupSection(ctx));
  };
  draw();
  page.append(box);
  view.append(page);
}

// Runs the "find products" analysis for one or more items, with a payload preview first.
export async function analyzeItems(ctx, items, { web = null } = {}) {
  const settings = ctx.state.settings;
  if (!settings.ai?.on) {
    UI.toast('Turn on Optional AI first.');
    ctx.navigate('#ai');
    return null;
  }
  const key = await ctx.store.getSecret('aiApiKey');
  if (!key) {
    UI.toast('Add your API key under Optional AI first.', { kind: 'danger' });
    return null;
  }
  const cfg = providerConfig(settings);
  const origin = originFor(settings);
  const origins = await grantedOrigins();
  if (origin && !(origins.includes(origin) || hasAllSites(origins))) {
    const ok = await requestOrigin(origin);
    if (!ok) {
      UI.toast('Permission to contact the provider was not granted.', { kind: 'danger' });
      return null;
    }
  }
  const eligible = items.filter((i) => i.type === 'instagram' || i.type === 'inspiration');
  if (!eligible.length) {
    UI.toast('Select imported Instagram posts to analyze.');
    return null;
  }
  const first = eligible[0];
  const payload = describePayload({ thumbnail: first.image, caption: first.instagram?.caption || first.description || first.title, creator: first.instagram?.creator, collectionName: first.instagram?.collectionName });
  const preview = el('div', { class: 'payload-preview' }, [
    el('div', {}, [el('strong', {}, ['Destination: ']), cfg.baseUrl, ` (model ${cfg.model})`]),
    el('div', {}, [el('strong', {}, ['Image: ']), payload.image]),
    first.image && first.image.startsWith('data:image/') ? el('img', { src: first.image, alt: '' }) : null,
    el('div', {}, [el('strong', {}, ['Text:'])]),
    el('pre', {}, [payload.text]),
    eligible.length > 1 ? el('div', { class: 'help' }, [`…and the same for ${eligible.length - 1} more selected ${eligible.length - 1 === 1 ? 'post' : 'posts'}.`]) : null,
  ]);
  const canWeb = supportsWebLookup(settings);
  const webCheck = el('input', { type: 'checkbox' });
  webCheck.checked = web === null ? !!settings.ai.webLookup && canWeb : !!web && canWeb;
  webCheck.disabled = !canWeb;
  const go = await UI.openModal({
    title: eligible.length === 1 ? 'Send this to your AI provider?' : `Send ${eligible.length} posts to your AI provider?`,
    body: [
      el('p', { class: 'modal-text' }, ['This is exactly what will leave your browser. Results are guesses and are labelled as such.']),
      preview,
      el('label', { class: 'check' }, [webCheck, el('span', {}, ['Also search the web for where to buy (the provider runs up to 3 web searches per post; only links that appear in its search results are kept)'])]),
      canWeb ? null : el('p', { class: 'help' }, ['Web search needs OpenAI or Anthropic; custom endpoints only get the identification step.']),
    ],
    actions: [{ label: 'Cancel', quiet: true, value: false }, { label: 'Send', primary: true, value: true }],
  });
  if (go !== true) return null;
  const doWeb = webCheck.checked && canWeb;
  if (settings.ai.webLookup !== doWeb) await ctx.store.updateSettings({ ai: { webLookup: doWeb } });
  const results = [];
  let done = 0;
  let failed = 0;
  const dismiss = UI.toast(`Analyzing ${eligible.length === 1 ? 'post' : `${eligible.length} posts`}…`, { duration: 600000 });
  for (const item of eligible) {
    try {
      const post = { thumbnail: item.image, caption: item.instagram?.caption || item.description || item.title, creator: item.instagram?.creator, collectionName: item.instagram?.collectionName };
      let ai = { ...(item.ai || {}) };
      try {
        ai = { ...ai, ...(await analyzePost(post, settings, key)) };
      } catch (e) {
        if (!doWeb) throw e;
        ai = { ...ai, provider: providerConfig(settings).provider, model: providerConfig(settings).model, analyzedAt: new Date().toISOString(), suggestions: ai.suggestions || [] };
      }
      if (doWeb) {
        const found = await findProductOnline(post, settings, key);
        ai = { ...ai, candidates: found.candidates, searchedAt: found.searchedAt };
      }
      await ctx.store.updateItem(item.id, { ai });
      results.push(ai);
      done++;
    } catch (e) {
      failed++;
      results.push(null);
      UI.toast(`“${String(item.title).slice(0, 40)}”: ${String((e && e.message) || e)}`, { kind: 'danger', duration: 7000 });
    }
  }
  if (dismiss) dismiss();
  UI.toast(`Done — ${done} analyzed${failed ? `, ${failed} failed` : ''}. Open an item to see the suggestions.`, { duration: 5000 });
  return results;
}

// --- Privacy --------------------------------------------------------------------------------------------

export function renderPrivacy(ctx, view) {
  const page = el('div', { class: 'page' });
  page.append(UI.section('The short version', '', [
    el('div', { class: 'prose' }, [
      el('ul', {}, [
        el('li', {}, [el('strong', {}, ['Local only. ']), 'Everything you save lives in chrome.storage.local on this device. There is no Keepsake server, account or sync.']),
        el('li', {}, [el('strong', {}, ['No tracking. ']), 'No analytics, no telemetry, no crash reports, no ads, no third-party scripts.']),
        el('li', {}, [el('strong', {}, ['Nothing runs on pages until you ask. ']), 'The toolbar popup reads a page only when you click it. On-page buttons are off until you enable them and grant a site.']),
        el('li', {}, [el('strong', {}, ['Instagram: ']), 'the importer only reads the Saved collection you have open. It never reads cookies, tokens, messages, or anything about your account.']),
        el('li', {}, [el('strong', {}, ['Optional AI is opt-in and BYOK. ']), 'If you enable it, only the data shown on the AI page is sent to the provider you configured. Your key stays in this browser and is excluded from exports.']),
        el('li', {}, [el('strong', {}, ['You are in control. ']), 'Export to JSON, import it back, or delete everything from Settings at any time.']),
      ]),
    ]),
  ]));
  page.append(UI.section('Permissions Keepsake asks for', '', [
    el('div', { class: 'table-wrap' }, [el('table', { class: 'table' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Permission']), el('th', {}, ['Why'])])]),
      el('tbody', {}, [
        permRow('storage', 'Keep your collections, items and settings in your browser.'),
        permRow('activeTab + scripting', 'Read the page you clicked the icon on (title, price, images) at that moment only, and show the save toast.'),
        permRow('contextMenus', 'The “Save to Keepsake” right-click item.'),
        permRow('Site access (optional)', 'Only requested if you enable on-page buttons for a site or all sites, connect an AI provider (its address only), or let “Fix with AI” read your saved items’ product pages (all sites). Revoke any time here or at chrome://extensions.'),
      ]),
    ])]),
  ]));
  page.append(UI.section('What is stored', '', [
    el('div', { class: 'prose' }, [
      el('p', {}, ['For each save: title, price, retailer, page URL, image URL (or, for Instagram imports, a small stored thumbnail), your note, flags such as favorite/purchased, which collection it is in and why. For categorization: your rules, and keyword/retailer weights learned from moves. For Instagram: which post URLs were already imported. Optional AI: your API key and provider settings, and a log of what “Fix with AI” changed so it can be undone.']),
      el('p', {}, ['Keepsake does not store browsing history, page contents beyond the fields above, or anything from pages you did not save from.']),
    ]),
  ]));
  page.append(el('div', { class: 'actions-row' }, [
    el('button', { type: 'button', class: 'btn', onClick: () => ctx.navigate('#settings') }, ['Export or delete my data']),
    el('button', { type: 'button', class: 'btn btn-quiet', onClick: () => ctx.navigate('#ai') }, ['AI settings']),
  ]));
  view.append(page);
}

function permRow(name, why) {
  return el('tr', {}, [el('td', {}, [el('span', { class: 'mono' }, [name])]), el('td', {}, [why])]);
}
