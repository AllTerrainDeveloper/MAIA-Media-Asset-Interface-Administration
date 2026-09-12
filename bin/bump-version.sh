#!/usr/bin/env bash
# Bump the plugin version across all tracked spots. Does not commit or tag.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -ne 1 ]]; then
	echo "usage: $0 <version>  (e.g., 1.0.0 — no 'v' prefix)" >&2
	exit 1
fi

new="$1"

if ! [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
	echo "error: '$new' is not a valid version (expected X.Y.Z or X.Y.Z-prerelease)" >&2
	exit 1
fi

npm version "$new" --no-git-tag-version --allow-same-version > /dev/null

# Perl — portable inline edit; BSD and GNU sed differ on the `-i` form.
perl -i -pe "s/^(\s*\*\s*Version:\s*)\S+/\${1}${new}/" allterrain-media-explorer.php
# The constant still carries the plugin's first name, and deliberately so: it is a
# published PHP symbol, and renaming it would break anything reading it. See README.
perl -i -pe "s/(ATME_VERSION',\s*')[^']+/\${1}${new}/" allterrain-media-explorer.php
# wp.org rejects submissions whose readme.txt Stable tag doesn't match the plugin
# header Version, so keep them in lockstep.
perl -i -pe "s/^(Stable tag:\s*)\S+/\${1}${new}/" readme.txt

cat <<EOF
Bumped to $new. Review the version files and changelog, then run:
  npm run release -- $new
That command commits/pushes from main and tags only after CI passes.
EOF
