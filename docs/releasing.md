# Releasing AllTerrain MAIA

The approved WordPress.org slug and text domain are `allterrain-maia`. Its public
name is **AllTerrain MAIA**; MAIA stands for **Media Asset Interface & Administration**.
The directory title uses the full expansion: **AllTerrain MAIA — Media Asset Interface & Administration**.
The app and artwork keep the short AllTerrain MAIA name. The version header, `ATME_VERSION`, `readme.txt` Stable tag,
`package.json` and both root version entries in `package-lock.json` must agree.
The packager refuses a mismatch.

The release helpers are ported from AllTerrain Photo Editor (`daguerre`),
retaining its main-branch, reviewed-changelog and green-CI release sequence.
Preparing a package does not publish anything.

## Local checks

```bash
npm ci
npm run artwork:build
npm run env:start
npm run plugin:release
```

`plugin:release` runs typechecking, Vitest, all bundle builds, PHP integration
tests, Plugin Check, version/artwork validation and packaging. It creates:

- `dist/allterrain-maia.zip` — one plugin directory, ready to upload.
- `dist/allterrain-maia/` — the same staged plugin tree for SVN.
- `dist/assets/` — banners, icons and screenshot PNGs for SVN's separate assets directory.

`npm run plugin:package` runs the JS checks/build and packaging only. It is useful
for iteration but is not the full release gate. `npm run plugin:check` uses wp-env
and installs WordPress Plugin Check there if needed. `npm run test:php` prefers
the sibling Docker QA environment (port 8889), otherwise uses wp-env (8894/8895).

PHP contract tests need the real OpenStation framework. The QA instance provides
it. For a standalone wp-env checkout, use the same pinned fixture as CI:

```bash
git clone --filter=blob:none --no-checkout https://github.com/WordPress/openstation.git .test-framework
git -C .test-framework sparse-checkout set includes/framework
git -C .test-framework checkout 7545b530bf6ba420ebdd647a0d7e418a415d5215
npm run test:php
```

`ATME_FRAMEWORK_AUTOLOAD` may point at another framework autoloader **inside the
PHP environment**. Tests fail if no usable backend or framework is available.

## First WordPress.org submission

1. Run the full local checks and inspect the ZIP and listing assets.
2. Submit the ZIP through the [WordPress.org plugin submission page](https://wordpress.org/plugins/developers/add/).
3. Follow the review team's instructions. Plugin Check is a useful gate, not a
   guarantee of approval. The current fixes and limits are recorded in
   [the review audit](review-2026-09.md).
4. After approval, confirm the assigned SVN repository slug. The workflow currently
   targets `allterrain-maia`. If WordPress.org assigns another slug,
   reconcile the package/install path and workflow before the first deploy;
   do not blindly rename stored data or API identifiers.
5. Add repository Actions secrets `SVN_USERNAME` and `SVN_PASSWORD`. Use the
   maintainer's WordPress.org username and its dedicated SVN password. Both are
   required before the deploy step runs. The listing contributor is
   `allterraindeveloper`, matching the other AllTerrain plugins.

WordPress.org approved `allterrain-maia` on 17 September 2026. The SVN repository
is https://plugins.svn.wordpress.org/allterrain-maia/. Configure both credentials
under GitHub Settings → Secrets and variables → Actions → Repository secrets;
no Actions variables or manually supplied GitHub token are required. Without
both secrets the workflow skips WordPress.org deployment.

No SVN credentials are stored in this repository.

## Naming review resubmission

The 15 September 2026 revision adds AllTerrain to the listing, app labels and
banner, and changes the package directory and text domain to `allterrain-maia`.
The submitted reservation was `maia-media-asset-interface-administration`;
the review team approved the replacement slug on 17 September 2026.
The [prepared review reply](wordpress-org-reply.txt) is retained as historical
context. No directory upload or email is performed by the build scripts.

The bootstrap filename remains `allterrain-media-explorer.php`. The local Docker
QA install stays under its existing `allterrain-media-explorer/` folder to keep
its activation intact; wp-env mounts the new `allterrain-maia/` package path.
Stored data and public integration IDs do not change; see [architecture](architecture.md#branding-and-identifiers).

## Publishing releases

The first WordPress.org release uses `0.1.1`: GitHub already has a `v0.1.0`
release from before directory approval. Do not redeploy that old tag, which
predates the approved naming and package changes.

Start on `main`, synchronized with `origin/main`. Commit feature work, built
assets and hand-written release notes first.

```bash
npm run release -- 0.1.1
```

The helper validates the version, checks the branch/tree and existing tags,
bumps all version files, drafts changelog bullets from GitHub notes, and shows
the final WordPress.org changelog for terminal confirmation. It commits/pushes
the version files, waits for CI on that exact commit, then pushes `v0.1.1`.
This command **does publish** by triggering the release workflow.

Other modes:

```bash
npm run bump-version -- 0.1.1
npm run release -- 0.1.1 --dry-run-changelog
npm run release -- 0.1.1 --skip-changelog
```

The bump helper only edits version files. The dry run only previews notes.
`--skip-changelog` skips drafting; the changelog review still happens.
Release helpers require Bash, Node/npm, Perl, Git and an authenticated `gh` CLI;
packaging also uses the system `zip` command.

## Tag workflow and retries

`.github/workflows/release.yml` checks out the tag, verifies its version, runs
JS checks/build, PHP tests against the pinned App Framework, Plugin Check and
package validation. A tag push creates a GitHub Release with the ZIP attached.
Stable releases also deploy the staged plugin and directory artwork through
10up's WordPress.org deploy action when both SVN secrets exist. Prereleases
(e.g. `v0.1.1-rc1`) remain on GitHub.

If the WordPress.org deploy fails after a GitHub Release exists, correct the
workflow on `main` and dispatch it against the existing tag:

```bash
gh workflow run release.yml --ref main -f tag=v0.1.1
```

The dispatch runs the current workflow against the tagged source, repeats the
gates and retries SVN without creating a duplicate GitHub Release. `VERSION` is
set from the validated tag, not the dispatch branch. Avoid deleting published
tags to retry deployment.

## Listing maintenance

Edit `readme.txt` for WordPress.org and `README.md` for GitHub. Keep numbered
screenshot captions synchronized with `.wordpress-org/screenshot-N.png`.
The packager rejects missing/extra art, wrong dimensions and oversized files.
See [artwork sources and export instructions](artwork/README.md),
[WordPress.org asset rules](https://developer.wordpress.org/plugins/wordpress-org/plugin-assets/)
and [readme rules](https://developer.wordpress.org/plugins/wordpress-org/how-your-readme-txt-works/).
