# The OpenStation surfaces

Everything this plugin registers with the shell, and what happens without
one.

## Registered surfaces

| Surface | Registration | What it does |
|---|---|---|
| Library app | `App::define( 'allterrain-media-explorer' )`, `placement( 'dock' )` | The explorer itself. Dock tile comes free. |
| Viewer app | `App::define( 'atme-viewer' )`, `placement( 'none' )` | The Media Viewer: dark stage, wheel/pinch zoom + pan, fit/1:1, ← / → walks the library by date, and the ⓘ drawer is the whole inspector. Reached through a photo (double-click anywhere, `params.mediaId` deep-link survives session restore), never launched cold — hence no dock tile. Filter: `atme_viewer_window_args`. |
| Wallpaper icon | `openstation_register_icon()` | Desktop shortcut; accepts attachment drops (below). |
| File opener | `openstation_register_file_opener()` + `os.files.resolve-opener` filter | **AllTerrain MAIA Viewer** (`atme-viewer`) — deliberately *not* default-flagged: the "(default)" suffix in Preferences → File Associations marks the opener WordPress ships, and that stays with the stock media editor. AllTerrain MAIA becomes the *effective* opener through the shell's `os.files.resolve-opener` filter, which only decides when the user has no stored pick — a choice made in Preferences (any opener) always wins. "Reveal in library" lives in the viewer's toolbar rather than as a second opener row. The photo editor's *edit* opener composes alongside. |
| Commands | `openstation_register_command()` × 2 + JS `wp.os.registerCommand` | ⌘K: open the explorer; start the wizard. |
| WP Explorer action | `openstation_my_wordpress_preview_actions` + `os.my-wordpress.preview-actions` | "Reveal in Media Explorer" on media previews. Server declares, client wires `onSelect` — appearance and behaviour on opposite sides of the wire. |
| Icon drop handler | `wp.os.files.registerTilePayloadHandler` | Drop a media tile on our wallpaper icon → reveal it. A raw DropTarget on the tile would be displaced by the tile's claimant; the handler registry is the cooperative path. |
| Relations | `wp.os.relations.set()` via `src/relations.ts` | Browsing: a library identity, so two explorer windows group. Inspecting: `{ type: 'media', id, links: [posts using it] }` — ties to open editors, Related-menu rows both ways. `media` is deliberately the shell's own identity type, so our window and a core media-edit iframe are the same subject. |
| Content changes | `openstation_content_changes_record( 'attachment', … )` + `os.attachment.changed` | Every mutation announces; every surface repaints without polling. |
| Components | `wp.os.loadComponents( COMPONENT_TAGS )` | `<os-select>`, `<os-text-field>`, `<os-textarea>`, `<os-checkbox-label>`, `<os-range-field>`, `<os-steps>`, `<os-progress-bar>`, `<os-notice>`, `<os-empty-state>` and friends. Every helper still falls back to a native control when a tag is not registered. |
| Theming | `--os-ui-*` tokens throughout | Selected surfaces paint `--os-ui-holo-fill` with `--os-ui-holo-ink`; hovers use `--os-ui-hover`; washes use `--os-ui-accent-soft`; text on accent uses `--os-ui-fg-on-accent`. No hardcoded palette. |
| Abilities | `wp_register_ability()` × 7 | search-media, get-media-usage, set-alt-text, convert-media, list-folders, file-media, scan-library — the AI copilot and MCP clients get the same verbs, same capability checks. |
| AI assist | `wp.os.ai.ask` | "Suggest alt text" in the inspector, and gated remedies in the wizard. Quietly absent without the AI stack. |

## Drag interop, both directions

**Out:** tiles emit the shell's `shortcut` payload with `kind:
'attachment'` and a `bridgePayload` — the exact shape WP Explorer emits.
Kanban cards, image fields, wallpaper folders and Gutenberg iframes accept
them with no code written for this plugin.

**In:** the grid and folder rows accept `shortcut` and `desktop-file`
payloads (multi-selection aware via the `items` / `placements`
conventions); OS files from Finder upload straight into the current folder.

## Opener contracts learned the hard way

Two facts the docs understate, load-bearing for anyone registering openers:
the **`js` handler's entry point is `open( file, ctx )`** — a `run` key is
silently ignored and the open fails; and **`isDefault` must ride the JS
`registerOpener()` call** — the resolver reads the JS registry, and the PHP
`is_default` flag alone changes nothing at double-click time.

## What we deliberately do not claim

`upload.php` is already remapped to the shell's own Media window by WP
Explorer. Contesting a built-in claim in the URL-remap registry would make
"open media" ambiguous per session; instead the explorer is reached through
its dock tile, its icon, its opener, its command and its preview action.

## Degrading

The plugin declares `Requires Plugins: desktop-mode`. Below WordPress 6.5,
or with the shell deleted after activation, every shell call is behind a
`function_exists()` gate resolved through `includes/shell-api.php` (both
the `openstation_*` and legacy `desktop_mode_*` spellings): the folders,
collections, conversion engine and REST namespace keep working, the
signpost page under **Media → Media Explorer** explains where the product
lives, and an admin notice appears on the Plugins screen. There is no
second, lesser explorer UI — that copy is the one that rots.


## App Framework integration

The library and viewer are discovered from `apps/` on framework-capable shells.
Their ids, launcher/icon, opener, commands, drag payloads and relations remain
unchanged. The framework controls mount, reopen and disposal; the client view
keeps the media canvas under an `os-preserve` host. Read
[architecture.md](architecture.md#two-app-framework-windows) for the boundary.
Older shells retain native rendering. Current shells never register a competing
legacy renderer for these two window ids.

To test locally, run `npm run build`, then open **AllTerrain MAIA** on
http://localhost:8889/wp-admin/. Reopen a second photo while the viewer remains
open, use Show in library, open the wizard, and reload the page to check restore.
