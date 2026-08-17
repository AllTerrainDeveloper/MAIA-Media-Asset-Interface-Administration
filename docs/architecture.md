# Architecture

## Everything is a post (or a term, or a meta row)

| Thing | Storage |
|---|---|
| Media item | `attachment` post — core's own, untouched |
| Folder | hierarchical taxonomy `atme_folder` on `attachment`, REST base `atme-folders` |
| Collection | post type `atme-collection`, its query as JSON in `_atme_query` |
| Version | `_atme_versions` meta rows pointing at files under `uploads/atme-versions/` |
| Provenance | `_atme_converted_from` (source id) and `_atme_conversions` (derived ids) |
| File hash | `_atme_hash`, filled lazily by the scan and first inspection |
| Wizard state | option `atme_wizard_state`, cleared when a run completes |

No bespoke tables. The payoff is that REST, `current_user_can()`, search,
the trash and every plugin hooking `save_post` already work on all of it —
and `uninstall.php` can remove every trace without touching a single
attachment.

## Browsing is core REST; verbs are `atme/v1`

The grid pages `/wp/v2/media` with an explicit `_fields` list. Folder
filtering is the taxonomy's own REST param; smart views ride a registered
`atme_view` collection param resolved by the `rest_attachment_query` filter.
The plugin's namespace carries only what core cannot express in one round
trip:

| Route | Verb |
|---|---|
| `POST /atme/v1/convert` | Convert as copy or in place (`replace: true`) |
| `POST /atme/v1/replace/{id}` | Swap the file (multipart `file`), keep ID + URL |
| `GET/POST /atme/v1/versions/{id}` | History; roll back |
| `GET /atme/v1/usage/{id}` | Every place the file is used |
| `GET /atme/v1/facts/{id}` | Bytes, dimensions, provenance, version count |
| `POST /atme/v1/regenerate` | Rebuild sub-sizes |
| `GET/POST /atme/v1/folders` + `/file` + `/unfile` | The tree; filing |
| `GET /atme/v1/duplicates` | Hash groups + coverage |
| `GET /atme/v1/scan` | One wizard chunk |
| `GET/POST /atme/v1/wizard-state` | The resumable batch |

Every route gates on `upload_files` — the capability core's own Media
Library asks for.

## The conversion engine

`WP_Image_Editor` first (it picks Imagick or GD and honours EXIF rotation),
raw Imagick as the fallback for sources core's editors refuse — HEIC, PDF
pages, SVG rasterization. Capabilities are probed per host, never assumed;
a memory ceiling refuses images whose decode would kill a shared host, and
the browser codec path picks those up. Convert-as-copy stamps provenance
both ways; convert-in-place routes through replace, so it stashes a version
first and is undoable.

HEIC uploads convert to JPEG on the way in (`wp_handle_upload` filter),
gated on the host's Imagick actually reading HEIC.

## Non-destructive by definition

Nothing overwrites pixels without a copy: replace stashes the outgoing
original under `uploads/atme-versions/` (capped, pruned oldest-first), and
rollback goes *through* replace, so undo has an undo. Version filenames
never travel to the client — the history endpoint reports facts, and
rollback takes the stored name, validated against the stored list, never a
path.

## One window, native

The explorer renders into the shell's own DOM. That is what gives it the
shell's drag manager (tiles lift into the same pointer pipeline as every
other window), its components (`<os-*>`, loaded via `wp.os.loadComponents`),
its theming tokens, and the relations engine (an inspected item declares
`{ type: 'media', id, links: [users of it] }`, so ties appear against open
editor windows). See [openstation.md](openstation.md) for every surface.
