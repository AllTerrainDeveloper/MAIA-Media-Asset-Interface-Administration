# JavaScript reference

Three bundles, three schedules, one drag model.

| Bundle | File | Loads |
|---|---|---|
| `explorer` | `assets/js/explorer[.min].js` | When either native window opens. The grid, inspector, folders, Quick Look, wizard — and the Media Viewer. |
| `shell` | `assets/js/shell[.min].js` | At shell boot. File openers, ⌘K commands, WP Explorer action, icon drop handler. |
| `codec` | `assets/js/codec[.min].js` | On first browser-side AVIF encode, script-injected by `convert-client.ts`. Self-contained WASM. |

The `explorer` bundle queues **two** App Framework client views: the
explorer (`allterrain-media-explorer`) and the Media Viewer (`atme-viewer`).
On older shells it registers the native callbacks instead. Viewer keyboard: ← / → walks neighbors,
`+ − 0 1` zooms, `i` toggles the info drawer — claimed via a
*window*-capture listener, because the shell owns bare arrows (Space
switching) at document capture and Window fires first in that phase.

Every bundle depends on the `allterrain-media-explorer-config` handle, which
prints `window.allTerrainMediaExplorer`:

```typescript
interface Config {
	codecUrl: string;     // PHP-generated local codec URL, including cache version
	restUrl: string;      // …/wp-json/atme/v1 or ?rest_route=/atme/v1
	wpRestUrl: string;    // …/wp-json/wp/v2 or ?rest_route=/wp/v2
	nonce: string;        // sent only when wp.os.fetch is absent
	adminUrl: string;
	uploadUrl: string;
	folderField: string;  // 'atme-folders' — the taxonomy's rest_base, which ≠ its slug
	canUpload: boolean;
	viewerId: number;
	conversion: { imagick: boolean; gd: boolean;
	              encode: Record<string, boolean>; decode: Record<string, boolean> };
	maxUploadMb: number;
	version: string;
}
```

## The drag payload — Stable

A lifted tile carries the **shell's own** `shortcut` payload, byte-for-byte
the shape WP Explorer's media grid emits. That is the interop contract: any
drop target written against WP Explorer accepts our tiles unchanged, and
the `bridgePayload` makes cross-iframe drops (Gutenberg) work with zero code
here or there.

```typescript
{
	type: 'shortcut',
	source: HTMLElement,          // the tile
	data: {
		kind: 'attachment',
		ref: '42',                  // the id, as a string
		title: 'Sunset',
		icon: 'dashicons-format-image',
		entityId: 'media',
		bridgePayload: { kind: 'attachment', id: 42, url, title, alt, mime, thumbnailUrl? },
		items: [ /* the whole selection, one of these per member */ ],
	},
}
```

Receive one with the shell's conventions — top-level fields describe the
grabbed item, `items` the whole selection:

```javascript
const members = payload.data.items?.length ? payload.data.items : [ payload.data ];
```

## Accepted drops — Stable

The grid and every folder row register shell drop targets accepting
`shortcut` and `desktop-file` payloads whose entities are attachments.
Dropping on a folder files them; dropping on the grid files into the
current folder, or reveals when browsing All Media. OS files (Finder) drop
anywhere on the window and upload into the current folder.

## Broadcast topics — Stable

| Topic | Payload | Meaning |
|---|---|---|
| `os.attachment.changed` | `{ source, action: 'created'\|'updated'\|'trashed', ids: number[] }` | An attachment changed somewhere. The grid patches those rows. Emitted after every mutation this plugin makes; also consumed from anyone else. |
| `atme.reveal` | `{ id: number }` | Ask an open explorer window to scroll to and inspect an item. |
| `atme.wizard` | `{}` | Ask an open explorer window to open the Optimization Wizard. |
| `atme.view` | `{ id: number }` | Ask the Media Viewer to show an item (retargets an open viewer; `openViewer()` also passes `params.mediaId` for cold opens). |

Cold opens and session restore use `wp.os.openWindow()` params. The framework's
`reopen` lifecycle applies new params to an existing singleton. No global parking
spots are used. Existing broadcast topics remain supported for integrations.

```javascript
wp.os.openWindow( 'allterrain-media-explorer', { params: { mediaId: 42 } } );
wp.os.openWindow( 'allterrain-media-explorer', { params: { wizard: true } } );
wp.os.openWindow( 'atme-viewer', { params: { mediaId: 42 } } );
```

App definitions and dispatch state are **Experimental**. `mediaId` is checked
against the acting user's attachment permissions before mount/reopen. `wizard`
must be a boolean. `revision` is internal to lifecycle synchronization.

AI drafting is explicitly requested and confirmed through `suggestAltText()`.
The same gate discloses the image URL, title and caption before calling
`wp.os.ai.ask()`. The returned `message` must be a usable string; closing or
retargeting the inspector invalidates pending suggestions.

## The codec global — Experimental

```typescript
window.atmeCodec: {
	encodeAvif( data: ImageData, quality: number ): Promise<ArrayBuffer>;
}
```

Registered by the codec bundle. Load it through `convert-client.ts` rather
than injecting the script yourself.
