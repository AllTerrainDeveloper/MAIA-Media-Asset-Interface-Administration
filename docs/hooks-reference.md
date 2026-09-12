# Hooks reference

Every PHP action and filter this plugin exposes. Labels: **Stable** —
shape frozen until a major version; **Experimental** — may change in a
minor.

## Conversion

### `atme_conversion_formats` — filter — Stable

What this host can encode and decode, after probing Imagick and GD.

```php
apply_filters( 'atme_conversion_formats', array $capabilities );
// $capabilities = [ 'imagick' => bool, 'gd' => bool,
//                   'encode' => [ 'jpeg'|'png'|'webp'|'avif'|'gif' => bool ],
//                   'decode' => [ 'heic'|'pdf'|'svg' => bool ] ];
```

A host with an external transcoding service can widen it; the UI greys out
whatever is false and routes those formats to the browser codec instead.

### `atme_convert_pixel_ceiling` — filter — Stable

The largest image, in source pixels, the server will decode. Default
64,000,000. Bigger images are refused with `atme_too_large` and the client
falls back to browser-side encoding.

### `atme_media_converted` — action — Stable

```php
do_action( 'atme_media_converted', int $new_id, int $source_id, array $args );
```

Fires after a convert-as-copy lands, sub-sizes and provenance meta included.

### `atme_heic_upload_format` — filter — Stable

The format iPhone photos convert into on upload, when this host's Imagick
can read HEIC. Default `'jpeg'`; return `''` to keep HEIC files untouched.

## Replace & versions

### `atme_replace_keep_name` — filter — Stable

Whether replace keeps the existing filename (and so the URL). Default true.

### `atme_file_replaced` — action — Stable

```php
do_action( 'atme_file_replaced', int $attachment_id, string $file );
```

The file behind an attachment just changed. The moment for cache and CDN
plugins to purge the URL.

### `atme_version_cap` — filter — Stable

How many stashed versions one attachment keeps. Default 5; the oldest past
the cap is pruned, file and all.

## Usage

### `atme_media_usage` — filter — Stable

```php
apply_filters( 'atme_media_usage', array $rows, int $attachment_id );
// $rows[] = [ 'postId', 'title', 'type', 'typeLabel', 'usedAs', 'editUrl' ];
```

The seam for page builders, gallery plugins and custom-field plugins to
report the usages only they know about. Rows referring to posts the current user cannot edit are removed after this
filter. Rows feed the inspector's "Used in"
panel, the delete guard, and the window's relations identity.

## Wizard

### `atme_wizard_oversize_width` — filter — Stable

The width past which the scan flags an image as oversized. Default 2560 —
WordPress's own big-image threshold.

### `atme_wizard_findings` — filter — Stable

```php
apply_filters( 'atme_wizard_findings', array $findings, int $offset );
// $findings[] = [ 'id', 'title', 'kind', 'detail', 'mime'? ];
```

One scan chunk's findings. Add your own `kind` values — broken EXIF, missing
captions, a house style rule — and they appear in the findings step.

## Smart views

### `atme_view_query` — filter — Stable

```php
apply_filters( 'atme_view_query', array $query_args, string $view );
```

The `WP_Query` args a smart view (`?atme_view=` on `/wp/v2/media`) produces.
Register your own view name here and offer it via the JS side.

## Shell registration

### `atme_window_args` / `atme_viewer_window_args` / `atme_icon_args` — filters — Stable

The argument arrays handed to `openstation_register_window()` and
`openstation_register_icon()`. Resize the window, swap the icon, change the
dock placement. On framework hosts the window arrays describe the framework
renderer (`script: openstation-app-runtime`, client in `scripts`), and the
existing filters still receive the complete registration array. Preserve those
runtime fields when customizing visual properties. The icon remains on its
original registration path, preserving all `atme_icon_args` options.

Both framework apps also participate in OpenStation's Experimental
`openstation_app_manifest`, `openstation_app_window_args` and
`openstation_app_response` hooks. Use the app ids to scope customizations.
The app's dispatch access is declared in `capabilities( 'upload_files' )`;
a window-appearance filter is not a dispatch authorization override.

### `atme_script_config` — filter — Stable

The config blob printed as `window.allTerrainMediaExplorer`. Add keys for
your own bundle extensions; never remove the documented ones. `codecUrl` is the local encoder bundle URL
and supports relocated content directories. See the JS reference for the shape.

### `atme_shell_function` — filter — Stable

Resolves a bare shell capability name (`register_window`) to the callable
this install provides, across the OpenStation/Desktop-Mode rename. Return
`''` to make the plugin behave as though the shell lacks that capability —
also the only way to *test* the no-shell paths, since PHP cannot undefine a
function.

## Abilities

### `atme_abilities_registered` — action — Stable

Fires after the plugin has offered its abilities to the Abilities API.
