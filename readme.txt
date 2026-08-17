=== MAIA — Media Asset Interface & Administration ===
Contributors: allterraindev
Tags: media library, folders, webp, avif, openstation
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.1.0
Requires Plugins: desktop-mode
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

The media library WordPress should have shipped: folders, conversion, replace-in-place, versions, viewer and wizard on the OpenStation desktop.

== Description ==

MAIA (Media Asset Interface & Administration) is a media library built as a native window on the
[OpenStation](https://wordpress.org/plugins/desktop-mode/) desktop. Everything
the core Media Library does, plus everything it cannot:

* **Folders and collections** — a real tree, drag tiles to file them, save
  any search as a live collection. Smart views for unattached, unfiled,
  missing-alt, converted and duplicate files.
* **Convert between formats** — JPEG, PNG, WebP, AVIF and GIF, as a copy or
  in place, one file or a whole selection. The server converts with the
  Imagick/GD your host already has; formats your host lacks are encoded in
  your browser instead (WebP/JPEG/PNG on the canvas, AVIF via a bundled
  open-source WASM codec — jSquash, the Squoosh codecs, Apache-2.0).
* **iPhone photos just work** — HEIC uploads convert to JPEG on the way in,
  on hosts whose Imagick reads HEIC.
* **Replace in place** — swap the file behind an attachment; its ID and URL
  survive, every post shows the new pixels, and the old file is kept as a
  restorable version. Nothing is destroyed without a copy.
* **The Optimization Wizard** — scans the library for oversized images,
  legacy formats, missing alt text and duplicate files; shows the findings;
  applies the fixes you pick as a resumable batch.
* **Used where?** — every item shows the posts and settings using it, and
  the delete dialog warns before you empty them.
* **Made for the desktop** — drag photos out of the grid into Gutenberg,
  onto kanban cards, into wallpaper folders; drop files from your computer
  straight into a folder; ⌘K commands; AI alt-text drafting; typed
  Abilities so assistants can search, convert and file media with your
  capability checks.

The classic Media Library is untouched, and deactivating removes every
surface. Uninstalling removes folders, collections and version files;
your media is never touched.

**OpenStation is required** (the plugin dependency slug is `desktop-mode`).
The explorer is a native desktop window; without the shell, your folders
and data are safe and a signpost page under Media explains where the
product lives.

== Source ==

Built from TypeScript sources in `src/`, shipped unminified alongside the
minified bundles. The AVIF encoder is jSquash
(https://github.com/jamsinclair/jSquash), Apache-2.0, compiled to
WebAssembly and bundled unmodified.

== Changelog ==

= 0.1.0 =
* First release.
