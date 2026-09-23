# Keepsake

**A privacy-first universal wishlist and visual inspiration board for Chrome.**

Save products from any site with one click, let your collections sort themselves, keep everything on your own machine.

- Works on any shop, without per-site integrations: reads JSON-LD / Open Graph / visible page data.
- Files each save into a collection automatically (Home Decor, Clothing, Technology, Kitchen, Camping & Outdoors, Weddings, Pets, …) and learns from your corrections. Unsure saves are left uncategorized and wait in **Review** instead of being guessed.
- Optional on-page save buttons for product grids — off until you turn them on, and only on sites you grant.
- Import your own **Instagram Saved collections**, then **read each post's page** for the real caption, creator, links and creator-tagged products (name, price, shop URL) — no login, no credentials, just your existing session.
- Calm masonry dashboard with search, sort, filters, favorites, purchased/archive, bulk actions, drag-to-reorder collections, light/dark.
- **No account. No server. No telemetry.** Everything lives in `chrome.storage.local`. Export/import as JSON. Delete everything in one click.
- Optional, opt-in, bring-your-own-key AI to help identify products in Instagram saves — with a preview of exactly what leaves the browser.

Manifest V3, plain HTML/CSS/JS, no build step, no dependencies at runtime.

---

## Contents

1. [Install (unpacked, developer mode)](#install-unpacked-developer-mode)
2. [Pin the icon and learn the shortcut](#pin-the-icon-and-learn-the-shortcut)
3. [Saving from the toolbar](#saving-from-the-toolbar)
4. [On-page save buttons (optional)](#on-page-save-buttons-optional)
5. [Right-click save](#right-click-save)
6. [How categorization works and how to train it](#how-categorization-works-and-how-to-train-it)
7. [The dashboard](#the-dashboard)
8. [Instagram Saved-collection import](#instagram-saved-collection-import)
9. [Optional AI: "Find products in Instagram saves"](#optional-ai-find-products-in-instagram-saves)
10. [Privacy, export, import, erase](#privacy-export-import-erase)
11. [Permissions explained](#permissions-explained)
12. [Limitations](#limitations)
13. [Development and tests](#development-and-tests)
14. [Packaging for the Chrome Web Store](#packaging-for-the-chrome-web-store)
15. [Project layout](#project-layout)

---

## Install (unpacked, developer mode)

1. Download and unzip `keepsake.zip` (or clone this folder). You need the folder that contains `manifest.json`.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and pick the `keepsake` folder.
5. Keepsake installs, opens a short welcome page and creates the default collections. Nothing runs on any website yet.

Requires Chrome 121 or newer (also works in Edge, Brave and other Chromium browsers with the same steps).

To update after editing files, click the reload icon on the Keepsake card at `chrome://extensions`.

## Pin the icon and learn the shortcut

Click the puzzle-piece icon in Chrome's toolbar and press the pin next to **Keepsake** so it is always one click away.

- **Alt+Shift+K** opens the Keepsake popup for the current page. Change it at `chrome://extensions/shortcuts`.
- **Alt+Shift+S** saves the product card you are hovering or focusing when on-page buttons are enabled.
- In the dashboard, **/** focuses search, **Esc** leaves select mode or closes dialogs, **Alt+↑ / Alt+↓** on a collection in the sidebar moves it.

## Saving from the toolbar

Open any product page and click the Keepsake icon (or press Alt+Shift+K). If the local categorizer is at least **75% sure** of the collection (or Optional AI is on), the item is **saved straight away**: the popup shows *Saved to …* with **Undo**, a **Move to** menu, and **Open in dashboard**, which opens that collection (or Review). Undo brings up the full preview below so you can adjust and save by hand.

Otherwise — or when the page is already saved — the popup shows a preview:

1. Shows a skeleton while it reads the page, then the detected **image, title, price, retailer and URL**. Up to six image candidates are offered; click one to use it as the cover.
2. Picks a **collection** and shows a confidence pill (High / Good / Low / Needs sorting) and a one-line reason ("*tent* in title", "you usually file items from this shop here"). Change the collection from the dropdown, pick "＋ New collection…" to create one inline, or leave it uncategorized for Review.
3. Lets you edit the title and price and add a note.
4. Detects if the page is already saved (tracking parameters ignored) and offers **Update existing item** or **Save another copy**.
5. Confirms with **Undo**, **Open in dashboard** (opens the collection the item went into) and — when you overrode the suggestion — a checkbox "Use this choice for similar items" that teaches the categorizer strongly.

On pages Keepsake cannot read (browser pages, the Web Store, local files) it says so and offers the dashboard instead. On pages with no product data it still lets you save the page; the item is left uncategorized and flagged for Review.

## On-page save buttons (optional)

Dashboard → **Settings → On-page save buttons**. Three modes:

| Mode | What Chrome asks | What runs |
| --- | --- | --- |
| **Off (default)** | nothing | nothing — the toolbar, shortcut and right-click menu still work everywhere |
| **Only on sites I choose** | permission for each site you add | the button script on those sites only |
| **On all sites** | "read and change data on all sites" | the button script on every site; Keepsake still only reads a card when you hover it |

When enabled, a small **Save** button appears next to product cards on listing pages and next to the main image on product pages. It lives in a closed Shadow DOM, is positioned over the page (never inserted into its layout), avoids logos, avatars, banners, navigation and ads, works with keyboard focus (Tab to a card, Alt+Shift+S) and respects `prefers-reduced-motion`.

- Saving from a card reads **only that card's** title, price, link and image and saves it straight away, following the same rule as the toolbar icon: at **75%** confidence or more it's filed into that collection (toast with **Undo** and **Edit**); below that it goes to Review and the toast offers the best guess in a **Move to** menu. The right-click *Save to Keepsake* item works the same way. With Optional AI on, the AI picks the collection instead.
- Options: button size (small/medium/large) and position within the card. The site list shows only for *Only on sites I choose*; *Hidden on these sites* shows for *On all sites* (and for *Only on sites I choose* only while it still lists a site).
- Hide the button on specific sites (e.g. news sites) without revoking access, or **Revoke all site access** in one click. Switching away from "all sites" gives the broad permission back to Chrome automatically.

## Right-click save

Right-click a page, product image, link or selected text → **Save to Keepsake**. On listing pages Keepsake reads the card around the clicked image or link (title, price, link) rather than the whole page. A toast confirms with Undo/Edit.

## How categorization works and how to train it

Categorization runs **entirely locally** (`src/shared/categorizer.js`, deterministic, no network). For each save it scores every collection from:

- the product's title, description, structured category, breadcrumbs, image alt text, card text and — for Instagram — the Saved-collection name and caption;
- the **store's own product type and tags** when the page publishes them (Shopify's embedded product data, WooCommerce `product_cat-`/`product_tag-` classes). The type counts as much as the title; tags only back up a collection the product already matches elsewhere, because stores use them for merchandising ("Holiday Gift Guide");
- each collection's built-in vocabulary (strong keywords such as *tent*, *dutch oven*, *headphones* and softer ones such as *ceramic*, *wireless*), the collection's name and aliases, and **your own keywords** (Collection → *Keywords & color*);
- **your rules** (Settings → Categorization → *Rules*: "for mum, birthday → Gifts");
- **what it learned** from your corrections: every time you move an item, the salient words of its title get a small weight toward the new collection; "Use this choice for similar items" gives a strong weight. Retailers you file consistently also count.

Keywords match their plurals ("hoodie" → "hoodies", "battery" → "batteries"). Longer phrases beat shorter ones ("camp chair" beats "chair"). Usage phrases in descriptions ("at home", "on the job site", "on the go") are ignored, since they say how something is used rather than what it is. Collection names and aliases ("Home", "Body", "Gear") only count when they appear in the title, product type, category, tags or breadcrumbs — not in descriptions — and site-navigation crumbs like "Home" or "Shop all" are ignored. A confidence score compares the winner with the runner-up; a runner-up that only matched description words counts for much less than one that also matched the title, product type, category or breadcrumbs. Below the **threshold** (default 0.6, adjustable) the item is left uncategorized with a suggestion instead of a guess. The **Review** queue shows those, with one-click "Move to …" buttons that teach the categorizer.

Other knobs (Settings → Categorization): auto-create missing default collections (e.g. re-create *Tools* when a drill shows up), and a view of the strongest learned terms and retailer habits with a one-click clear. Similar collection names are never duplicated ("Lamps" and "lamp" are the same collection; "Home Décor" matches "Home Decor"); merging collections carries names over as aliases.

Keepsake starts with three collections — Home Decor, Clothing and Technology — and creates the rest of its default taxonomy (Camping & Outdoors, Kitchen, Van Build, Personal Care, Books & Media, Gifts, Travel, Tools, Weddings, Baby & Kids, Pets, Fitness & Wellness, Garden & Outdoor Living, Art & Crafts, Office & Stationery, Automotive, Jewelry & Watches, Music & Instruments, Party & Events) on demand, the first time something actually matches one. There is no separate Inbox collection: anything Keepsake can't confidently place is simply left uncategorized and shows up in **Review**. Rename, recolor, merge or delete any collection.

## The dashboard

Open it from the popup, from the extension's Options, or at `#…` routes:

`#all` · `#favorites` · `#review` · `#archive` · `#c/<collection-id>` · `#item/<item-id>` (opens the item) · `#import` · `#settings` · `#ai` · `#ailog` · `#privacy` · `#welcome`

- **Masonry grid** of cards with image (or a text placeholder when there is none), title, price, retailer or Instagram creator, note, favorite star, source badge and "Needs sorting" label. Clicking a card opens a lightweight **Quick view** (image, title, price, a link to the original page); "Edit details" from there or from a card's **⋯** menu opens the full editor.
- **Search** across titles, retailers, notes, descriptions, prices, captions and creators; **sort** newest/oldest/price; **filter** by retailer; empty states for every view.
- **Item details**: the **exact link** the item was saved from, shown in full as a selectable field with **Copy** and **Visit page** (**Open post** for Instagram) — and editable, so you can point an item at the right product page if the extractor grabbed a listing or a redirect. Changing the link updates the host, refreshes an auto-derived retailer name, re-keys duplicate detection, and refuses a link another item already has. Alongside it: edit title/price/note, choose a cover from the candidates, move collection (optionally "use for similar"), favorite / purchased / archived, delete with confirmation.
- **Select** mode for bulk move, favorite, archive/unarchive, delete and (when AI is on) *Find products*.
- **Collections**: drag to reorder (or Alt+↑/↓), covers from the newest image or your own URL, colors, keywords, rename, merge into…, delete (items become uncategorized, waiting in Review, unless you choose otherwise).
- **Theme**: system / light / dark (toolbar sun icon or Settings → Appearance).
- **Load sample data** from the welcome page or the empty state to see the layout; delete it any time.

## Instagram Saved-collection import

Keepsake never asks for Instagram credentials and never calls Instagram's API. It reads the page you already have open.

1. In Chrome, log in to Instagram normally and open **one of your Saved collections** (`instagram.com/<you>/saved/<collection>/…`). The generic *Saved* overview page is not importable — open a specific collection.
2. Click the Keepsake icon. The popup recognises the collection and shows **Import this collection**.
3. Click it. Keepsake injects a small reader into **that tab only**, scrolls the collection to load more posts, and shows live progress (*24 posts found…*) with a **Stop** button. It stops automatically at the end of the collection, after a quiet period (default 6 s with nothing new), at the **safety limit** (default 300 posts), or when you press Stop.
4. Click **Review** to open the dashboard. Every post appears with its thumbnail, caption, creator and type (post/reel), selected by default; posts you imported before are marked and deselected.
5. **Read post details.** The Saved grid only exposes a thumbnail and a scrap of alt text — which is why an unenriched import gives you "Instagram post". The review screen offers **Read post details**: Keepsake opens each post's own page using your existing Instagram session, one at a time with a short pause, and pulls out the **full caption** (which becomes the item title), the **creator**, the post date and location, **hashtags**, **any links in the caption**, and **products the creator tagged** — including name, price and shop URL when Instagram exposes them. Progress is shown with a Stop button, partial progress is saved, and failures can be retried without redoing the rest. This needs one-time permission for `instagram.com` (asked here, revocable under Settings → Instagram); once granted it runs automatically after each scan.
6. Each post has a collection dropdown pre-filled by the categorizer, which now sees the real caption as well as the Instagram collection name ("Lamps" → Home Decor). If the collection name doesn't match anything you have, Keepsake offers to **create a collection with that name**. Change any post, or *Set collection for all selected*.
7. **Import N posts**. Posts become cards with the **original post URL**, creator, caption, hashtags, caption links and tagged products. In the item detail view, each tagged product or caption link has **Open** and **Save as product** — the latter creates a real product item (name, price, retailer, URL) linked back to the post it came from. Keepsake remembers which posts it imported so re-scanning never duplicates them.

If a creator didn't tag anything and put no link in the caption (the "link in bio" case), there is genuinely no product data on the post. That is what the optional AI below is for.

Thumbnails: Instagram image links expire, so Keepsake stores a small local copy (JPEG, ≤ 320 px) by default. Turn this off in Settings → Instagram to store only the link. Settings also expose the safety limit and idle timeout.

Limits and honesty: this depends on Instagram's page markup. All selectors live in one file (`src/instagram/adapter.js`) so they can be updated when Instagram changes. Reels and posts are imported; captions come from what Instagram exposes in the grid (alt text), so they can be short. Keepsake does **not** identify products in posts unless you enable the optional AI feature below.

## Optional AI

Off by default, and it needs **your own API key**. It's one switch (**Use AI**): when it's on, saves are instant, and *Fix with AI* and *Find products* are available. There are no per-feature toggles.

- Dashboard → **Optional AI**. Choose OpenAI, Anthropic or a custom OpenAI-compatible endpoint, paste your key, optionally set the model. Enabling asks Chrome for permission to contact **only the provider's address**; disabling revokes it.
- Your key is stored in `chrome.storage.local` under a separate `keepsake_secrets` key that is **never included in exports**. *Remove key* wipes it.
- On an Instagram card (or in bulk via Select → *Find products (AI)*) click **Find this product online**. Before anything is sent you see the exact payload: the stored thumbnail (image) and the caption / creator / collection name (text). Nothing else — no cookies, no account data, no browsing history.
- With **web search** ticked (OpenAI and Anthropic only — custom endpoints have no search tool), the provider runs up to three web searches per post and returns real listings: product name, brand, retailer, price and a link. Each link is checked against the URLs its search actually returned; anything the model made up is **dropped**, and the candidate is shown without a link rather than with a fake one. Every result gets an **Open** and a **Save as product** button, so a found listing becomes a normal Keepsake item with price and URL, linked back to the post.
- *Identify only* skips the search and just names the likely item, with category, brand and 2–4 **Search the web** phrases you can click yourself.
- Everything here is labelled as a guess: the model can identify the wrong item, and prices go stale. Check the listing before buying.
- **Instant save**: clicking the toolbar icon or an on-page button saves immediately with no preview. The AI tidies the title and picks the collection; if it isn't confident (below your confidence threshold) a confident local pick is used, otherwise the item waits in Review. The popup shows *Saved to …* with Undo and a *Move to* menu; the on-page toast offers Move and Undo. Undo in the popup opens the normal editable preview.
- **Fix with AI** (Review → *Fix all with AI*, or Optional AI → *Fix with AI* for all items or one collection): reads each item's live product page (optional, without cookies), then tidies titles, updates prices (the model may only choose a number that appears on the page or in the saved data), replaces missing/broken images, and files items into collections. From Review, an item is filed when the AI's confidence meets your threshold; elsewhere an item is only moved at ≥ 85% and never if you filed it yourself. Fixes apply immediately, and every change goes to the **AI change log** (`#ailog`) with per-item and per-run Undo. Dead links, out-of-stock items and unfixable broken images are listed at the end of a run.

Local vs cloud in one sentence: everything in Keepsake — saving, extraction, categorization, dashboard, Instagram import — runs on your machine with no network; the only network call Keepsake ever makes is to the AI provider **you** configured, **when you click** a button that says what it will send.

## Privacy, export, import, erase

See [PRIVACY.md](PRIVACY.md) and the in-extension **Privacy** page. In short:

- **Export** (Settings → Data): downloads `keepsake-export-<date>.json` with collections, items, learned preferences, settings and import history. Never the API key.
- **Import**: pick a JSON export. Keepsake validates it (format, schema version, every field sanitized, URLs must be http(s)) and either **merges** (collections dedupe by name, items by URL; duplicates are reported) or **replaces** everything after a typed confirmation.
- **Delete all local data**: typed confirmation, then everything is wiped (including any AI key) and the defaults are recreated. Learned preferences (keywords, retailer habits, corrections) can be cleared separately; rules are edited one by one.
- Settings shows item/collection counts and how much local storage Keepsake uses. Items are capped at 20,000 and collections at 500 to keep the dashboard responsive.

## Permissions explained

| Permission | When | Why |
| --- | --- | --- |
| `storage` | install | Keep your items, collections and settings in `chrome.storage.local`. |
| `activeTab` + `scripting` | install | When you click the icon, press the shortcut or use the context menu, read *that* page's title/price/images at that moment and show the confirmation toast. Nothing runs on pages otherwise. |
| `contextMenus` | install | The "Save to Keepsake" right-click item. |
| Site access (`optional_host_permissions`: `*://*/*`) | **only if you enable on-page buttons** | Run the hover-button script on the sites you granted (per site or all). Revocable in Settings or at `chrome://extensions`. |
| `https://www.instagram.com/*` | **only if you use "Read post details"** | Read each imported post's own page (caption, creator, links, tagged products) with your existing session. Revocable under Settings → Instagram. |
| Provider origin (e.g. `https://api.openai.com/*`) | **only if you enable AI** | Let the dashboard call the API you configured. Revoked when you disable AI. |

No `tabs`, `history`, `cookies`, `webRequest`, `alarms` or `identity`. The background worker has no timers and no network access of its own.

## Limitations

- **Extraction is heuristic.** Sites with JSON-LD/Open Graph data are read accurately; heavily scripted stores, infinite-scroll grids that render prices lazily, or pages that hide products behind "Quick view" may yield a title without a price or the wrong image. Everything is editable before and after saving.
- **Prices are snapshots.** Keepsake does not re-check prices, stock or availability, and does not know about variants (size/color) beyond what is in the page.
- **On-page buttons can be wrong** on unusual layouts (very large "cards", galleries). The detector errs on the side of silence; use the toolbar or right-click on those pages.
- **Instagram** markup changes often; the importer and post reader may need adapter updates. "Read post details" opens one post page at a time with a pause between them to stay polite; it is roughly 2–3 seconds per post (about four minutes for 90 posts) and Instagram can still rate-limit or show a login page, in which case Keepsake falls back to reading the post in a short-lived background tab and reports the ones it couldn't get. Posts where the creator tagged nothing and linked nothing simply have no product data to find.
- **AI suggestions are guesses.** They are labelled as such, and cost money on your own account.
- **No sync.** Data lives in one browser profile. Use export/import to move it.
- Tested with Node + jsdom and reviewed by hand; the automated suite does not drive a real Chrome, so pixel-level behaviour on real sites should be spot-checked after install.

## Development and tests

No build step. Requirements for the test suite: Node 20+.

```bash
npm install          # jsdom (dev only)
npm test             # static checks + behavioural suites
npm run check        # manifest/syntax/CSP/dead-link checks only
npm run zip          # builds dist/keepsake.zip for upload or sharing
```

What the suite covers (`tests/`):

- `check-manifest.js` — valid MV3 manifest, every referenced file exists, all JS parses, no `innerHTML`/`eval`/inline scripts/styles, no remote resources in extension pages, no leftover markers or dead links.
- `storage.test.js` — CRUD, duplicate detection with tracking parameters, collection dedupe/merge/delete, reorder, export excludes secrets, import merge/replace/validation of hostile input, sample data, migrations, Instagram import history.
- `extract.test.js` — JSON-LD, Open Graph, sparse and hint-driven extraction against HTML fixtures; product-card detection on a listing page (logos/ads/banners ignored) and main-image detection on a product page.
- `categorizer.test.js` — camping, lamps, shoes, electronics, kitchen, personal care, van, books, tools, travel; ambiguous → uncategorized; threshold; rules; keywords; corrections learn (light/strong, capped) and forget; name similarity.
- `instagram.test.js` — Saved-URL parsing, post/reel URL parsing, alt-text parsing, fixture scan with dedup, categorization from collection names.
- `post-details.test.js` — post-page parsing from meta tags and embedded JSON (caption, creator, likes, date, full image, location, tagged products), login-wall detection, caption link/hashtag extraction with `javascript:` and Instagram links rejected, title generation, merge semantics, tab fallback, and the enrichment loop (progress, stop, retry-only-failures).
- `ai.test.js` — provider boundary with a fake `fetch`: exact payload, key handling, link stripping, error handling.
- `dashboard.test.js` — boots the real dashboard in jsdom against a fake `chrome`: every route, empty states, search/sort/filter, item modal, the link field (copy, open, edit, host/retailer follow-up, duplicate refusal), card menu, bulk actions, collections CRUD/reorder/merge, settings permissions flow, export/import, typed delete-all.
- `e2e.test.js` — the real background worker + popup + page scripts wired through a fake browser: install, restricted/product/sparse/Instagram popups, save/undo/duplicate/update, learning, context-menu card save, floating-button registration and hover-save, Instagram scan → review → import, and an enriched import that ends with real titles, captions, links and tagged products.

## Releasing to the Chrome Web Store

Releases are automated with GitHub Actions (`.github/workflows/release.yml`):

1. Bump `version` in `keepsake/manifest.json`.
2. Commit, then tag the commit `vX.Y.Z` (matching the manifest version exactly) and push the tag:
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```
3. The workflow checks out the tag, verifies the tag matches `manifest.json`'s `version`, zips the extension (`manifest.json`, `background.js`, `icons/`, `src/` — docs excluded), uploads it to the existing Chrome Web Store listing via the Chrome Web Store Publish API, and publishes it. It also attaches the zip to a GitHub release for that tag.
4. Chrome reviews the update (usually within a few hours to a few days) before it rolls out to users; the workflow's "Publish item" step succeeds once the item is submitted for publishing, not once review finishes.

This requires one-time setup of Google OAuth credentials stored as GitHub Secrets — see the repository's Actions secrets for `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`. The target listing (`icons/`, `icon128.png` as the store icon, single purpose, permission justifications from the table above, remote code: none, data usage: none collected, `PRIVACY.md` as the privacy policy text) is configured once in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and does not need to change per release.

## Project layout

```
manifest.json                MV3 manifest
background.js                service worker: context menu, message hub, saving, content-script registration
icons/                       original bookmark mark (16/32/48/128 PNG + SVG source)
src/shared/                  util, url, taxonomy, categorizer, storage (schema v1 + migrations), messages, base.css
src/extract/extract.js       page extractor (JSON-LD → OG/Twitter → microdata → visible heuristics)
src/content/                 toast.js (Shadow DOM toast), detector.js (card detection), floating.js (hover button)
src/instagram/               adapter.js (all Instagram selectors), scan.js (scroll + collect + report),
                             post.js (post-page parsing), post-page.js (in-tab reader), enrich.js (read details for a scan)
src/ai/provider.js           optional BYOK provider boundary
src/popup/                   toolbar popup
src/dashboard/               dashboard page, ui primitives, settings/AI/privacy pages, Instagram importer
tests/                       node:test suites, jsdom helpers, HTML fixtures, static checks, packaging script
```

License: MIT.
