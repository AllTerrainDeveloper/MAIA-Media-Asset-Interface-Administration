# AllTerrain MAIA — Media Asset Interface & Administration — the plan

> (Originally shipped as `allterrain-media-explorer`; now AllTerrain MAIA with
> approved package slug/text domain `allterrain-maia` and stable integration IDs.) The media library WordPress should have
> shipped, built as a **native
> [OpenStation](https://github.com/WordPress/openstation) app**. Everything the
> core Media Library does, plus everything it cannot: folders, format
> conversion, replace-in-place, versions, a batch optimization wizard, usage
> tracking, and media you can *drag* — out of the window, onto a card, into
> Gutenberg, across the desktop.

This file is the working plan and the running checklist. It is written before
the code so the shape survives a context reset. Tick items as they land.

---

## 0. The thesis

Three claims, and everything else follows from them.

**1. The Media Library is a list pretending to be a library.** Core's grid can
show and delete. It cannot organize (no folders), cannot convert (a HEIC from
an iPhone is an error, not an import), cannot replace a file without changing
its URL, cannot tell you *where an image is used* before you delete it, and
cannot fix a thousand oversized PNGs without a third-party SaaS. Every one of
those is a solved problem. They ship here, free, GPL, on day one.

**2. A media library is a spatial surface, so it belongs in a spatial shell.**
A photo is the most draggable object in computing. In wp-admin it is a
rectangle you click. In OpenStation this explorer is a **native window**
sharing `wp.os.dragManager` with every other window — so a photo lifts out of
the grid and drops into a Gutenberg post (through the cross-iframe bridge, for
free), onto an AllTerrain Work card as an attachment, onto an AllTerrain
Fields image field, onto a folder in our own sidebar, or onto the wallpaper as
a desktop file. And the reverse: files from Finder, tiles from WP Explorer and
drops from any other app land in our grid. None of that is reachable from an
iframe — which is why **this app is native-only**.

**3. Conversion is a property of the library, not an editor feature.** "Save
as WebP" belongs next to the file, not three windows deep in an editor. The
convert engine is a REST verb over Imagick (already in the PHP runtime — no
Composer, no binaries) with per-format capability detection, and the wizard is
just that verb run over a queue with a progress bar.

## 1. What the shell buys us that core's grid never had

| Shell framework | What it becomes here |
|---|---|
| **Drag manager + bridge** | Grid tiles emit the shell's `'shortcut'` payload with `kind:'attachment'` **and a `bridgePayload`** — so drops into Gutenberg iframes, Work cards and Fields controls work with zero code on our side. Multi-select drags carry the whole selection. |
| **OS file drop** | Finder → window = upload, with the shell's own progress pipeline (`os.drop.*` hooks), straight into the folder you dropped on. |
| **Relations** | Open an image and the window declares `{ type:'attachment', id, links:[posts using it] }` — ties are drawn to the editor windows using it, and the Related menu lists them. Deleting warns "used in 3 posts" *before* the damage. |
| **WP Explorer interop** | We consume its `media-usage` REST + `openstation_attached_media`; we add a "Reveal in Media Explorer" preview action; double-clicking any `attachment` desktop file opens *us* (registered file opener). |
| **File opener registry** | "Edit in AllTerrain Photo Editor" appears on our tiles via the same registry the photo editor already registered into — the two apps compose without knowing each other. |
| **Native window** | Tabs, `<os-*>` components, loading overlay, session restore, deep links (`registerNativeUrlRemap` claims `upload.php` so core Media links open here). |
| **Commands** | ⌘K: "Find media…", "Upload…", "Start optimization wizard", "Show unused media". |
| **Abilities** | Typed, permission-checked abilities so the shell's AI copilot (and any MCP client) can search media, read usage, set alt text, convert formats. |
| **Toasts / confirm / notify** | Every destructive action through `wp.os.confirm`; every batch through toasts with an action button; never a browser modal. |
| **Badges** | Wizard findings (e.g. "37 images missing alt text") as a dock badge, cleared when the window focuses. |

**Native-only, by design.** Unlike Forms and Fields, this app requires
OpenStation (`Requires Plugins: desktop-mode`, the AllTerrain Photo Editor
stance). The reason is honest: the product *is* the drag surface. With
OpenStation installed but the desktop switched off for a user, a minimal page
under **Media → Media Explorer** explains how to switch it on — it does not
grow a parallel UI that rots. Core's own Media Library remains untouched
either way; we are additive, never a replacement.

**PixiJS: not in 0.1.0.** The shell ships Pixi 8 as a loadable module and the
photo editor proves the pattern, but a library grid's jobs — a11y, text,
virtualized scrolling, native scroll physics — are DOM jobs. A GPU canvas
would cost keyboard nav and screen-reader parity and buy nothing the
`createInfiniteList` + CSS grid path doesn't already deliver at 60fps.
Revisit only if a "light table" free-arrange view earns a phase.

## 2. Non-negotiables

- **No Composer, anywhere.** PHP dependencies are WordPress + the Imagick /
  GD *extensions* (capability-detected at runtime, never assumed). Dev
  tooling and any client-side codec are free open-source **npm** packages
  only. WPCS discipline is enforced by review, not a vendor/ tree.
- **Everything is a post (or a term).** An attachment *is already a post* —
  we register no bespoke tables and no shadow copies. Folders are a
  hierarchical taxonomy on `attachment`; collections are saved-query posts;
  versions are attachment meta pointing at real files in uploads. Core REST
  (`/wp/v2/media`) does the browsing; our namespace only adds what core
  cannot say in one round trip.
- **Non-destructive by default.** Convert produces a sibling unless you ask
  to replace; replace keeps a version you can roll back; nothing overwrites
  pixels without a copy of the old ones (capped, pruneable).
- **The core Media Library keeps working.** Deactivate the plugin and the
  only trace is the taxonomy terms and meta rows it wrote (removed by
  uninstall.php on delete).
- **Accessible or it doesn't ship.** Full keyboard grid navigation (arrows,
  space = Quick Look, Enter = open), `aria-selected` multi-select, focus
  management in the wizard, `prefers-reduced-motion`.
- **WPCS with tabs, Yoda conditions, `defined( 'ABSPATH' ) || exit;`, full
  PHPDoc, TypeScript strict. A feature without tests is not done.**
- **If a function decides something, wrap it in a filter. If it does
  something, fire an action.**

## 3. Identity and conventions (the sibling contract)

- Package slug / text domain: `allterrain-maia` (approved by WordPress.org)
- Window ID: `allterrain-media-explorer`
- Prefixes: `atme_` functions, `ATME_` constants, `.atme-` CSS, `@group allterrain-media-explorer` tests
- REST namespace: `atme/v1`
- Drag payloads **emitted**: the shell's own `'shortcut'` + `kind:'attachment'` + `bridgePayload` (interop first); accepted: `'shortcut'`, `'desktop-file'`, OS file drops
- Ability names: `allterrain-media-explorer/<verb>-<noun>`
- Copied verbatim-in-spirit from siblings: `includes/shell-api.php`,
  `src/dnd.ts`, `src/desktop-drops.ts`, `src/open.ts`, `src/os-ui.ts`,
  `src/relations.ts` (forms), `bin/ships.mjs`, `bin/deploy.mjs`,
  `bin/package.mjs`, `tests/phpunit/bootstrap.php` (shell-stubbing pattern),
  `vite.config.js` (multi-target + vitest), `tsconfig.json` — minus every
  composer file.
- Deploys into `../wordpress-alcazaba/src/wp-content/plugins/allterrain-media-explorer`
  and is QA'd on the Docker WordPress at **http://localhost:8889** only.

## 4. Data model

| Thing | Storage | Why |
|---|---|---|
| Media item | `attachment` post (core) | it already is one |
| Folder | hierarchical taxonomy `atme_folder` on `attachment`, `show_in_rest` | folders are labels, not locations; a file can be filed twice; core REST filtering comes free |
| Collection (saved search) | post type `atme_collection`, query JSON in meta | shareable, exportable, trashable |
| Version (pre-replace backup) | meta `_atme_versions` = array of `{ file, size, mime, date, author }`, files under `uploads/atme-versions/` | rollback without a table |
| Conversion provenance | meta `_atme_converted_from` (source id), `_atme_conversions` (derived ids) | both directions navigable |
| Wizard findings | transient-cached scan + per-item meta only when acted on | scans are cheap to redo, stale caches lie |
| File hash (duplicate detection) | meta `_atme_hash` (sha1 of file), filled lazily | duplicates found by index lookup, not O(n²) |

Everything `register_post_meta`'d with `show_in_rest` and real schemas.

## 5. Feature checklist

### Baseline — parity with the core Media Library
- [x] Grid browse with infinite scroll over `/wp/v2/media` *(sentinel `IntersectionObserver` + recycled tiles rather than `createInfiniteList` — one code path that also runs in jsdom)*
- [x] List view *(toolbar toggle; rows show name, date, dimensions, type; sorting rides the toolbar's sort control rather than per-column headers)*
- [x] Search-as-you-type, filter by type / date / author / attached-status
- [x] Upload: drop from Finder onto the window (into the current folder), upload button, paste from clipboard
- [x] Details inspector: title, alt, caption, description, URL-copy, file facts (dimensions, size, MIME, EXIF)
- [x] Rotate in place through the convert-replace pipeline — versioned and undoable, which core's REST edit (detached copy) is not. *(Crop/scale UI: not shipped in 0.1.0; scale exists as the wizard's downscale remedy)*
- [x] Delete with usage guard + bulk selection (click, shift-range, ⌘-toggle, keyboard) *(attachments have no core trash; deletes are guarded and confirmed instead. Marquee selection: not shipped in 0.1.0)*
- [x] Regenerate thumbnails (single + bulk)
- [x] Download original; audio/video players inline; typed placeholder tiles with extension chips for documents

### Organize — what core never had
- [x] Folder tree sidebar; drag tiles onto folders to file them; drag folders to nest
- [x] A file can live in multiple folders; "Unfiled" smart view
- [x] Collections: save the current search/filter as a live collection
- [x] Smart views: Unattached, Unfiled, Missing alt text, Converted copies, Duplicates (hash-matched) *(Oversized/Legacy live in the wizard's findings, where their remedies are)*
- [x] Quick Look: spacebar full-preview overlay with arrow-key walk, EXIF panel

### Convert — the twist
- [x] Convert engine (`POST atme/v1/convert`): any raster ↔ **WebP / AVIF / JPEG / PNG**, quality slider, strip-metadata toggle — Imagick first, GD fallback, per-format `atme_conversion_formats` capability map surfaced in the UI (greyed, never lying)
- [x] **HEIC/HEIF import**: iPhone photos auto-offered as JPEG/WebP on upload (when Imagick can read them)
- [x] Convert as copy (default) or convert-and-replace (same ID, same URL, thumbnails regenerated)
- [x] Batch convert over any selection (bulk bar) and library-wide via the wizard
- [x] Client-side "Download as…" using free open-source JS codecs (`@jsquash/webp`, `@jsquash/avif` — MIT/MPL/Apache WASM builds, npm, no Composer) so a one-off export never needs a server round trip; also the fallback path when the server lacks a format
- [x] SVG and PDF rasterize through the engine's raw-Imagick path (decode-gated) *(engine-level; no dedicated UI yet)*

### Override — replace in place
- [x] **Replace file** keeping attachment ID and URL (drop a file onto the inspector's replace well)
- [x] Old file saved as a version; visible version history with one-click rollback
- [x] Optional filename-too swap with redirect-safe URL retention (`atme_replace_keep_name` filter decides the default)
- [x] Thumbnail regeneration + `atme_file_replaced` action for cache-busting plugins

### The wizard
- [x] **Media Optimization Wizard** (in-window multi-step): ① scan the library → ② findings cards (X oversized, Y legacy-format, Z missing alt, W duplicates, orphaned files) → ③ pick remedies + budgets (max width, target format, quality) → ④ dry-run preview of savings → ⑤ client-driven batch queue with `<os-*>` progress, pausable/resumable, per-item error ledger → ⑥ report toast + badge cleared
- [x] Wizard never deletes on its own; duplicate resolution and orphan cleanup are explicit, confirmed steps
- [x] Batch endpoint chunked + nonce-fresh via `wp.os.fetch`; survives a closed window (state in an option, resumes where it stopped)

### Usage & safety
- [x] "Used in" panel per item: featured-of, in-content (URL and `wp-image-id` spellings), site icon/logo — own scanner across every post type, extendable by `atme_media_usage` filter
- [x] Delete guard: `wp.os.confirm` danger dialog lists actual usages before permanent delete
- [x] Relations: inspector window sets `WindowContentRef { type:'attachment', id, links:[using posts] }` — desktop ties + Related menu

### Shell surfaces
- [x] Native window (`openstation_register_window`, `placement:'dock'`, `capabilities:['upload_files']`), wallpaper icon, session-restored
- [x] ~~`registerNativeUrlRemap` for `upload.php`~~ **Decided against**: the shell's own Media window already claims `upload.php`, and contesting a built-in claim makes "open media" ambiguous. The explorer is reached via dock, icon, opener, ⌘K and the WP Explorer action.
- [x] File opener for `attachment` desktop files (`is_default => true`; the photo editor stays the *edit* opener)
- [x] Tile payload handler: drop a `shortcut`/`desktop-file` on our dock/desktop icon → reveal it in the grid
- [x] WP Explorer: "Reveal in Media Explorer" preview action; accept its tiles as drops
- [x] "Edit in AllTerrain Photo Editor" composes through the shell's opener registry: any media desktop file lists both openers (ours default for *open*, the editor's for *edit*), no code between the two plugins. *(An in-window "edit in…" button awaits a public per-file opener-invoke API)*
- [x] **Media Viewer**: a second native window — dark stage, wheel/pinch zoom with panning, fit/1:1, ← / → library navigation by date, ⓘ drawer carrying the full inspector; double-click in the grid opens it, and it registers as the *default* file-association for `attachment` desktop files (user-overridable in OpenStation Preferences), surpassing core's attachment screen it replaces
- [x] Commands: find media, upload, start wizard, show unused
- [x] Dock badge = wizard findings count across all three rails, cleared when the fixes land
- [x] Abilities (category `allterrain-media-explorer`): search-media, get-media-usage, set-alt-text, convert-media, list-folders, file-media, scan-library — typed schemas, `upload_files` permission callbacks, one-liners over the same helpers the UI uses *(replace-media needs a file body, which the Abilities API cannot carry; convert-media with `replace: true` covers the format half)*
- [x] AI assist (gated on `wp.os.ai`): "Suggest alt text" button in the inspector and a wizard remedy for the missing-alt finding

### Content-change liveness
- [x] `openstation_content_changes_record( 'attachment', … )` on every mutation; subscribe to `os.attachment.changed` so two explorer windows, WP Explorer and our grid stay in sync without refresh

## 6. The conversion engine (design notes)

One PHP service, `includes/convert.php`:

- `atme_conversion_capabilities()` — probes Imagick formats + GD flags once,
  caches per request, filterable (`atme_conversion_formats`). The UI asks the
  server what it can do; nothing is hardcoded.
- `atme_convert( $attachment_id, $args )` — reads the original (never a
  thumb), converts via `WP_Image_Editor` when the target is one it speaks,
  raw Imagick otherwise (AVIF/HEIC), writes through `wp_insert_attachment` +
  `wp_generate_attachment_metadata`, stamps provenance meta, fires
  `atme_media_converted`.
- `atme_replace( $attachment_id, $file, $args )` — version-stashes the
  current file set (original + all sizes), swaps, regenerates, fires
  `atme_file_replaced`.
- Budgeted: refuses images whose decoded size would exceed a filterable
  memory ceiling; the wizard routes those to the client-side codec path.

## 7. Window anatomy

```
+--------------------------------------------------------------------------+
| [icon] Media Explorer                    [search…]        [– □ ×]        |
| Tabs:  Library | Collections | Wizard                                    |
+-----------+---------------------------------------------+----------------+
| FOLDERS   |  GRID (virtualized, container-query sized)  | INSPECTOR      |
|  All      |  [tile][tile][tile][tile][tile]             |  preview       |
|  Unfiled  |  [tile][tile][tile][tile][tile]             |  fields        |
|  ▸ Trips  |  …                                          |  usage         |
|  Smart    |                                             |  versions      |
|   Unused  |                                             |  convert ▾     |
|   No alt  |  status bar: 365 items · 2 selected · 48 MB |  actions       |
+-----------+---------------------------------------------+----------------+
```

Sidebar and inspector collapse under container-query breakpoints; every
control is an `<os-*>` component loaded via `wp.os.loadComponents`.

## 8. File structure

```
allterrain-media-explorer/
├── allterrain-media-explorer.php      # header (Requires Plugins: desktop-mode), constants, requires
├── uninstall.php                      # meta + terms + versions dir cleanup
├── readme.txt / README.md / LICENSE
├── includes/
│   ├── shell-api.php                  # openstation_*/desktop_mode_* indirection (sibling pattern)
│   ├── content-model.php              # taxonomy, collection CPT, register_*_meta
│   ├── window.php                     # register window/tabs/icon/opener/url-remap, template, config
│   ├── assets.php                     # handles, deps on 'openstation' + 'os-variables'
│   ├── convert.php                    # engine (above)
│   ├── replace.php                    # replace + versions
│   ├── usage.php                      # usage scanner + delete guard data
│   ├── wizard.php                     # scan + batch state
│   ├── folders.php                    # folder/collection helpers
│   ├── rest.php                       # atme/v1: convert, replace, scan, batch, usage, duplicates, hash
│   ├── abilities.php                  # wp_register_ability × 7 (guarded per call site)
│   ├── explorer.php                   # WP Explorer preview actions / list hooks
│   ├── admin-page.php                 # the "switch OpenStation on" page under Media
│   └── helpers.php                    # shared logic the REST/abilities/UI all call
├── src/                               # TypeScript, strict — targets: explorer, dock?, wizard-in-bundle
│   ├── index.ts  grid.ts  inspector.ts  folders.ts  quicklook.ts
│   ├── wizard.ts  convert-client.ts  (jsquash wasm, lazy)
│   ├── dnd.ts  desktop-drops.ts  open.ts  os-ui.ts  relations.ts  api.ts
│   └── types.ts
├── assets/{js,css}/                   # committed builds (dev + .min) + atme.css
├── bin/  ships.mjs  deploy.mjs  package.mjs  test-php.mjs
├── tests/phpunit/  (bootstrap stubs the shell; @group allterrain-media-explorer)
├── tests/vitest/   (dnd, drops, grid model, convert-client, wizard queue)
├── docs/  architecture.md  hooks-reference.md  javascript.md  openstation.md
│         examples/{accept-a-drop.md, emit-a-payload.md, add-a-smart-view.md}
├── package.json  vite.config.js  tsconfig.json   # npm only — NO composer files
```

## 9. Build order

1. **Foundation** — skeleton, shell-api, content model, asset plumbing, window
   registers and opens with a hello grid; deploy script targets
   wordpress-alcazaba; PHPUnit + vitest harnesses green.
2. **Library** — grid + infinite scroll + search/filters + list view +
   uploads (drop pipeline) + selection model + status bar.
3. **Inspector & Quick Look** — details editing, core image edits, EXIF,
   trash/delete with usage guard, keyboard nav.
4. **Organize** — folders, drag-to-file, collections, smart views, duplicates.
5. **Convert & Replace** — engine, REST, UI, versions, rollback, HEIC intake,
   client codec path.
6. **Wizard** — scan, findings, dry-run, batch queue, badge.
7. **Shell weave** — relations, openers, url-remap, WP Explorer actions,
   commands, abilities, AI alt text, liveness.
8. **Polish** — a11y audit, RTL, reduced motion, docs, Plugin Check clean,
   full test pass, QA on :8889.

Each phase lands with its tests and its docs; the checklist above is ticked
as boxes close, and every phase ends with a working deploy QA'd in the
browser at http://localhost:8889.

## 10. Open-source JS dependencies (the complete list)

| Package | License | Why |
|---|---|---|
| `@jsquash/webp`, `@jsquash/avif` | MIT / MPL-2.0 / Apache-2.0 (WASM codecs) | client-side encode for "Download as…" and as server-capability fallback |
| `exifr` | MIT | EXIF/XMP parse in the inspector without a server trip |
| dev: `vite`, `typescript`, `vitest`, `jsdom` | MIT | sibling-standard toolchain |

Nothing else. No Composer. No CDN loads (everything bundled or lazy-loaded
from the plugin's own directory).
