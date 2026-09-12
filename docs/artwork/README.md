# MAIA artwork

MAIA follows the AllTerrain Forms and AllTerrain Photo Editor visual family:
cream graph paper, a dark rounded serif wordmark, terracotta punctuation, sage
and peach shapes, and tilted paper cards. Its own mark is an **M with a folder
badge**; the banner uses a stack of illustrated media cards.

The product name is **MAIA**. “By AllTerrain” identifies the developer without
expanding the acronym or changing the plugin's machine slug. The WordPress.org
listing adds the descriptor “Media Library” to satisfy its minimum-name-length rule.

## Edit and export

Edit `banner.svg` (1544 × 500) or `icon.svg` (256 × 256), then run:

```bash
npm ci
npm run artwork:build
```

The renderer uses bundled fonts and ignores system fonts, so macOS and Linux
produce the same artwork. Commit both the source and all four rendered PNGs in
`.wordpress-org/`. That folder also holds four real screenshots of MAIA on the
local Docker demo site, captured on 13 September 2026. Screenshot 3 is a crop of
the folder controls; no controls or media are fabricated or retouched.

The listing PNGs are staged in `dist/assets/`. SVG sources, fonts and screenshots
are excluded from the installable plugin ZIP. WordPress.org's
[asset requirements](https://developer.wordpress.org/plugins/wordpress-org/plugin-assets/)
specify 772 × 250 / 1544 × 500 banners and 128 × 128 / 256 × 256 icons. The
packager checks exact artwork dimensions, file sizes and screenshot captions.

## Sources and licenses

- Original MAIA SVG geometry and layout: Daniel Lopez / AllTerrain, 2026,
  GPL-2.0-or-later, like this repository. No stock artwork is used in the banner
  or icon.
- **Fraunces**, by the Fraunces Project Authors: SIL Open Font License 1.1.
  [Upstream](https://github.com/google/fonts/tree/main/ofl/fraunces),
  [bundled license](fonts/OFL-Fraunces.txt).
- **DM Sans**, by the DM Sans Project Authors: SIL Open Font License 1.1.
  [Upstream](https://github.com/google/fonts/tree/main/ofl/dmsans),
  [bundled license](fonts/OFL-DMSans.txt).
- The font files are unmodified variable TTFs from Google Fonts, retrieved
  13 September 2026. They are development assets, never served by the plugin.
- Screenshot photography comes from the existing ACF Demo property library in
  the local test site; it is separate from the original banner/icon artwork.
