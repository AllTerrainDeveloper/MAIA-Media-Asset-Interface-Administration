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
| Wizard state | per-user, per-site user option `atme_wizard_state`, cleared when a run completes |

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
| `POST /atme/v1/replace/{id}` | Swap the file (multipart `file`), keep ID; same-format replacements keep URL |
| `GET/POST /atme/v1/versions/{id}` | History; roll back |
| `GET /atme/v1/usage/{id}` | Every place the file is used |
| `GET /atme/v1/facts/{id}` | Bytes, dimensions, provenance, version count |
| `POST /atme/v1/regenerate` | Rebuild sub-sizes |
| `GET/POST /atme/v1/folders` + `/file` + `/unfile` | The tree; filing |
| `GET /atme/v1/duplicates` | Hash groups + coverage |
| `GET /atme/v1/scan` | One wizard chunk |
| `GET/POST /atme/v1/wizard-state` | The resumable batch |

Every route requires `upload_files`. Attachment-specific routes also require
`edit_post` for that attachment, including the history, facts and usage readers.
Filing/unfiling preflights every selected attachment before mutating any of them.
The matching abilities use those same object-aware permission callbacks.
Usage results omit posts the acting user cannot edit, including filter-added
rows; scan findings and duplicate memberships omit uneditable attachments.

Wizard queues use WordPress user options, which prefix the meta key with the
current site's table prefix. An author cannot read, clear or resume another
user's queue, including across sites on multisite. String values are sanitized
before storage while numbers and booleans retain their types. Legacy shared
queues are not adopted because their owner is unknown; start a new scan.
Uninstall clears the site's queues and the obsolete shared option.

The REST client joins both pretty and `?rest_route=` URLs without putting
query parameters inside the route. Asset URLs come from PHP's plugin URL;
codec loading never guesses the content directory from a REST endpoint.

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
rollback goes *through* replace, so undo has an undo. Version basenames travel to the client; absolute server paths do not.
Rollback validates the requested basename against the stored history. Stashes
use unique names even for replacements within the same second. A format
change also changes the file extension and URL; embedded old URLs are not
rewritten automatically.

## Two App Framework windows

The explorer renders into the shell's own DOM. That is what gives it the
shell's drag manager (tiles lift into the same pointer pipeline as every
other window), its components (`<os-*>`, loaded via `wp.os.loadComponents`),
its theming tokens, and the relations engine (an inspected item declares
`{ type: 'media', id, links: [users of it] }`, so ties appear against open
editor windows). See [openstation.md](openstation.md) for every surface.


`apps/explorer/explorer.os.php` and `apps/viewer/viewer.os.php` declare the
existing window ids, sizes, `upload_files` gate, state and mount/reopen actions.
OpenStation discovers them through `openstation_apps_directories`. The built
client view registers through `window.openStationAppsPending`, the supported
third-party API; it never imports the shell's internal build aliases.

The framework owns window mounting, dispatch, teardown and deep-link state
(`mediaId`, `wizard`, `revision`). The existing imperative media canvas lives
under an `os-preserve` host: drag targets, selection, zoom and browser codecs
keep their local controllers and existing REST operations. Repaints retarget
those controllers without remounting them. The public REST API remains shared
with abilities and third-party callers. This is a client-canvas integration,
not a rewrite of media CRUD into framework-only actions.

Older shells without the framework keep the native callbacks. The legacy
callbacks must never overwrite framework renderers when the runtime loaded
through a different app first. Both paths use open-time params for cold opens;
legacy broadcasts still support retargeting already-open native windows.
