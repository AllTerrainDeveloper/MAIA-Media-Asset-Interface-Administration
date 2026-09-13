=== MAIA — Media Asset Interface & Administration ===
Contributors: allterraindeveloper
Tags: media library, folders, image optimization, webp, avif
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.0
Requires Plugins: desktop-mode
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Organize, view and optimize your WordPress media with folders, collections, format conversion and restorable versions. Built for OpenStation.

== Description ==

Your media, in good order.

MAIA stands for **Media Asset Interface & Administration**. It gives your
WordPress media a home on the
[OpenStation](https://wordpress.org/plugins/desktop-mode/) desktop. Find an image,
file it into a folder, open it in the viewer, or prepare it for your next post —
all from the same window. Made by AllTerrainDeveloper, the developer behind AllTerrain
Forms and AllTerrain Photo Editor.

* **Folders and collections** — a real tree, drag tiles to file them, save
  any search as a live collection. Create top-level folders or subfolders with
  inline forms. Filing shows progress and a saved or retryable error message.
  Deleting a folder keeps its media and moves its children up one level. Smart views for unattached, unfiled,
  missing-alt, converted and duplicate files.
* **Convert between formats** — JPEG, PNG, WebP, AVIF and GIF, as a copy or
  in place, one file or a whole selection. The server converts with the
  Imagick/GD your host already has; formats your host lacks are encoded in
  your browser instead (WebP/JPEG/PNG on the canvas, AVIF via a bundled
  open-source WASM codec — jSquash, the Squoosh codecs, Apache-2.0).
* **iPhone photos just work** — HEIC uploads convert to JPEG on the way in,
  on hosts whose Imagick reads HEIC.
* **Replace in place** — keep the attachment ID and retain the previous
  original as a restorable version. Same-format replacements keep the URL.
  Changing format changes the extension and URL; existing embedded links
  may need updating.
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
your current media attachments and files stay in the Media Library.

**OpenStation is required** (the plugin dependency slug is `desktop-mode`).
The explorer is a native desktop window; without the shell, your folders
and data are safe and a signpost page under Media explains where the
product lives.

== Installation ==

1. Install and activate [OpenStation](https://wordpress.org/plugins/desktop-mode/).
2. Upload the MAIA ZIP through Plugins > Add New > Upload Plugin, then activate it.
3. Enable OpenStation for your user from the WordPress admin bar.
4. Open MAIA from the desktop dock or its desktop shortcut. Your existing media is already there.

Requires WordPress 6.0 or later and PHP 7.4 or later. Available conversion formats
depend on the image libraries installed on your host and your browser's capabilities.

== Frequently Asked Questions ==

= Do I need OpenStation? =

Yes. MAIA's interface is a native OpenStation app. Install OpenStation first;
its WordPress.org dependency slug is desktop-mode.

= Are folders physical directories? =

No. Folders organize attachments with a WordPress taxonomy. Filing an image does
not move its file or change its URL. Create a top-level folder beside any existing
root, or select a folder and choose New subfolder to nest it.

= What happens when I delete a folder? =

Only the folder is deleted, after an OpenStation confirmation. Its media remains
in the library and its child folders move up one level.

= Does replacement keep existing links working? =

Same-format replacements keep the attachment ID and URL. Changing format changes
the file extension and URL. MAIA does not rewrite existing embedded URLs; review
those links after converting in place. Previous originals are kept as versions.

= Can I convert HEIC and AVIF on any host? =

HEIC intake requires an Imagick installation that can read HEIC. Server-side
conversion uses the formats available through Imagick or GD. For supported
fallbacks, MAIA uses browser canvas encoding or its bundled AVIF WebAssembly codec.

= Will the wizard delete duplicates or generate alt text automatically? =

No. The wizard reports duplicates for you to review and only applies the fixes
you select. Alt text needs a human review. Optional AI suggestions require a
separate, explicit confirmation for each image; see External services below.

= What happens if I deactivate or uninstall MAIA? =

Deactivation leaves your data in place. Uninstall removes MAIA's folder terms,
saved collections, settings and saved version files. Current media attachments
and their active files remain. Export any versions you want to keep first.

== Screenshots ==

1. Browse and search your library, with folders, smart views and an inspector for image details and alt text.
2. Open a photo in the dedicated viewer, with zoom controls and an optional information drawer.
3. Create a top-level folder using an inline form with an explicit destination, even while another folder is selected.
4. Review the Optimization Wizard's findings before choosing which fixes to apply.

== External services ==

MAIA has no telemetry, license server or service operated by its author.
Media browsing, conversion, EXIF reading and the wizard run on your site or
in your browser. The AVIF codec is bundled and loaded from your own site.

AI alt text is optional. Only after you click “Suggest alt text (AI)” and
confirm “Send and draft” are that image's URL, title and caption sent through
OpenStation to the AI provider configured by your site administrator. That
provider may retrieve the image from its URL. No AI request is made by
opening a window or scanning the library. Review the selected provider's
terms and privacy policy in your site's AI provider configuration before
sending media. MAIA does not choose or configure a provider.

== Source ==

Source and build instructions: https://github.com/AllTerrainDeveloper/MAIA-Media-Asset-Interface-Administration
The repository contains TypeScript in src/ and the Vite build configuration.
Run npm ci and npm run build:bundles. Readable JavaScript ships alongside
the minified bundles. Third-party notices are in assets/licenses/. The AVIF encoder is jSquash
(https://github.com/jamsinclair/jSquash), Apache-2.0, compiled to
WebAssembly and bundled unmodified.

== Changelog ==

= 0.1.0 =
* First release of MAIA for the OpenStation desktop.
* Organize media with nested folders, saved collections and smart views.
* View, convert and replace images with restorable original versions.
* Review media usage and run a resumable optimization wizard.
* File media with progress feedback, create folders inline, and delete folders while preserving media.
