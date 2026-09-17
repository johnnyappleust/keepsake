// Message types exchanged between the popup, dashboard, content scripts and the
// background service worker. Kept in one place so the contract is visible.
export const MSG = {
  EXTRACT_TAB: 'keepsake:extract-tab', // { tabId } -> { ok, product }
  CLASSIFY: 'keepsake:classify', // { product } -> { ok, classification }
  SAVE_ITEM: 'keepsake:save-item', // { product, collectionId?, force?, source } -> { ok, item, collection, duplicate?, existing? }
  UPDATE_ITEM: 'keepsake:update-item', // { itemId, patch } -> { ok, item }
  UNDO_SAVE: 'keepsake:undo-save', // { itemId } -> { ok }
  OPEN_DASHBOARD: 'keepsake:open-dashboard', // { hash } -> { ok }
  FLOATING_CONFIG: 'keepsake:floating-config', // { host } -> { ok, enabled, settings, collections }
  FLOATING_REFRESH: 'keepsake:floating-refresh', // background -> content scripts when settings change
  IG_START_SCAN: 'keepsake:ig-start', // { tabId } -> { ok }
  IG_STOP_SCAN: 'keepsake:ig-stop', // { tabId } -> { ok }
  IG_SCAN_UPDATE: 'keepsake:ig-update', // from page -> background (progress/results)
  IG_SCAN_STATE: 'keepsake:ig-state', // -> { ok, scan }
  IG_SCAN_CLEAR: 'keepsake:ig-clear',
  IG_SCAN_SET_POSTS: 'keepsake:ig-set-posts', // extension pages -> background { posts } (after "Read post details")
  IG_READ_POST: 'keepsake:ig-read-post', // extension pages -> background { url } -> { ok, bundle } (opens the post in a background tab briefly)
  PAGE_TOAST: 'keepsake:page-toast',
};

export const SESSION_KEYS = {
  igScan: 'keepsake_igScan',
};
