// Keepsake Instagram scan. Injected (after adapter.js) into an Instagram Saved
// collection tab only when the user explicitly starts an import. It reads the
// post links visible in the opened collection, optionally scrolls to load
// more, captures small local copies of thumbnails (Instagram image links
// expire), reports progress to the background worker and stops on request,
// at the end of the collection, after an idle timeout, or at the safety limit.
//
// It never reads cookies, tokens, messages or anything outside `main`.

(function keepsakeInstagramScan() {
  const adapter = globalThis.KeepsakeInstagram;
  if (!adapter || !globalThis.chrome?.runtime?.id) return;
  const MSG = { IG_SCAN_UPDATE: 'keepsake:ig-update', IG_STOP_SCAN: 'keepsake:ig-stop' };

  const state = globalThis.__keepsakeIgScan || (globalThis.__keepsakeIgScan = { running: false, posts: new Map(), timer: null });

  function report(status, extra = {}) {
    const parsed = adapter.parseSavedUrl(location.href) || {};
    const payload = {
      type: MSG.IG_SCAN_UPDATE,
      status,
      collectionName: adapter.detectCollectionName(document, parsed) || parsed.collectionName || '',
      collectionUrl: location.href.split('#')[0],
      username: parsed.username || '',
      posts: Array.from(state.posts.values()),
      ...extra,
    };
    try {
      chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
    } catch {
      /* worker gone */
    }
  }

  async function captureThumbnail(url, maxSize) {
    if (!url || url.startsWith('data:')) return url;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal, referrerPolicy: 'no-referrer' });
      clearTimeout(t);
      if (!res.ok) return '';
      const blob = await res.blob();
      if (!/^image\//.test(blob.type) || blob.size > 8_000_000) return '';
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      bitmap.close && bitmap.close();
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      return '';
    }
  }

  let captureQueue = Promise.resolve();
  function queueCapture(post, opts) {
    if (!opts.storeThumbnails || !post.thumbnail || post.thumbnail.startsWith('data:')) return;
    captureQueue = captureQueue.then(async () => {
      if (!state.posts.has(post.shortcode)) return;
      const data = await captureThumbnail(post.thumbnail, opts.thumbnailSize || 320);
      const rec = state.posts.get(post.shortcode);
      if (rec) {
        rec.originalThumbnail = rec.thumbnail;
        if (data) rec.thumbnail = data;
        rec.captured = !!data;
      }
    });
  }

  function collectOnce(opts) {
    const found = adapter.collectPosts(document, location.href);
    let added = 0;
    for (const p of found) {
      if (state.posts.has(p.shortcode)) {
        const rec = state.posts.get(p.shortcode);
        if (!rec.caption && p.caption) rec.caption = p.caption;
        if (!rec.creator && p.creator) rec.creator = p.creator;
        continue;
      }
      state.posts.set(p.shortcode, { ...p, captured: false });
      queueCapture(p, opts);
      added++;
      if (state.posts.size >= opts.safetyLimit) break;
    }
    return added;
  }

  async function run(opts) {
    state.running = true;
    state.stopReason = null;
    const parsed = adapter.parseSavedUrl(location.href);
    if (!parsed || !parsed.isCollection) {
      state.running = false;
      report('error', { error: 'Open one of your Saved collections on Instagram first, then start the import.' });
      return;
    }
    let lastNewAt = Date.now();
    let lastHeight = 0;
    let stableRounds = 0;
    report('scanning', { reason: 'started' });
    while (state.running) {
      const added = collectOnce(opts);
      const now = Date.now();
      if (added > 0) lastNewAt = now;
      report('scanning');
      if (state.posts.size >= opts.safetyLimit) {
        stop('limit');
        break;
      }
      if (!opts.autoScroll) {
        // Manual scrolling mode: keep sampling the DOM until the user stops or nothing new appears for a long while.
        if (now - lastNewAt > opts.idleTimeoutMs * 4) {
          stop('idle');
          break;
        }
      } else {
        const height = document.documentElement.scrollHeight;
        if (height === lastHeight) stableRounds++;
        else stableRounds = 0;
        lastHeight = height;
        window.scrollTo({ top: height, behavior: 'auto' });
        if (now - lastNewAt > opts.idleTimeoutMs && stableRounds >= 3) {
          stop('end');
          break;
        }
      }
      await new Promise((r) => (state.timer = setTimeout(r, opts.intervalMs || 900)));
    }
    await captureQueue;
    report('done', { reason: state.stopReason || 'stopped' });
  }

  function stop(reason) {
    state.stopReason = reason || 'stopped';
    state.running = false;
    clearTimeout(state.timer);
  }

  if (!state.listenerBound) {
    state.listenerBound = true;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === MSG.IG_STOP_SCAN) {
        stop('stopped');
        sendResponse({ ok: true });
      }
    });
  }

  const opts = Object.assign({ safetyLimit: 300, idleTimeoutMs: 6000, storeThumbnails: true, autoScroll: true, thumbnailSize: 320, intervalMs: 900 }, globalThis.__keepsakeIgScanOptions || {});
  if (!state.running) {
    state.posts = new Map();
    run(opts);
  }
})();
