# AllTerrain MAIA — developer docs

> Branding note: the product name is **AllTerrain MAIA**. The approved directory
> slug and text domain are `allterrain-maia`. The `atme_` prefixes, `atme/v1`
> REST namespace and window IDs `allterrain-media-explorer` / `atme-viewer`
> remain stable. See [branding and identifiers](architecture.md#branding-and-identifiers).

The public contract with anyone building on this plugin. A hook, event or
payload documented here with a **Stable** label will not change shape without
a major version; **Experimental** may; **Planned** does not exist yet.

If a function decides something, wrap it in a filter. If it does something,
fire an action. When writing any code in this plugin, ask *"can a plugin
author extend or override this?"* If the answer is no, add a hook. A change
to a hook without a change here ships a lie.

| Document | What it covers |
|---|---|
| [architecture.md](architecture.md) | How the plugin is put together and why. |
| [hooks-reference.md](hooks-reference.md) | Every PHP action and filter, with status labels. |
| [javascript.md](javascript.md) | Bundles, drag payloads, broadcast topics, the config blob. |
| [openstation.md](openstation.md) | Every shell surface the plugin registers, and how it degrades. |
| [review-2026-09.md](review-2026-09.md) | Forms review lessons, AllTerrain MAIA fixes and validation. |
| [releasing.md](releasing.md) | WordPress.org submission, release helpers, CI and listing assets. |
| [artwork/](artwork/README.md) | AllTerrain design sources, font licenses and exports. |
| [examples/](examples/) | Copy-paste recipes. |

## The one-paragraph tour

An attachment is already a post, so the plugin adds no tables: folders are a
hierarchical taxonomy on `attachment`, collections are saved-query posts,
versions are meta rows pointing at real files under `uploads/atme-versions/`.
Browsing rides core's `/wp/v2/media`; the `atme/v1` namespace carries only
the verbs core cannot say — convert, replace, roll back, usage, scan,
duplicates, folders. The explorer itself is a **native OpenStation window**;
its tiles emit the shell's own `shortcut` drag payload with a
`bridgePayload`, which is why drops into Gutenberg, kanban cards and image
fields work without those plugins knowing this one exists.

## Testing and release maintenance

Vitest covers interface behavior and request lifecycles. PHP integration tests
cover the WordPress data layer and the real OpenStation App Framework. The PHP
runner fails if no test backend is available; CI uses a pinned framework fixture.
The local Docker integration site is http://localhost:8889.

See [local checks and release commands](releasing.md#local-checks) for test
backends, version bumps and publishing, and [artwork maintenance](artwork/README.md)
for banner/icon exports and screenshot requirements.
