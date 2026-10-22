#!/bin/sh
# Print the Homebrew formula for one release.
#
#   sh scripts/render_formula.sh <version> <sha256> <owner/repo>
#
# The release workflow writes the output to Formula/golem.rb in the tap. Only
# stable versions go to the tap: Homebrew installs whatever the formula names.
set -eu

version=${1:-}
sha256=${2:-}
repository=${3:-}
if [ -z "$version" ] || [ -z "$sha256" ] || [ -z "$repository" ]; then
  printf '%s\n' "usage: sh scripts/render_formula.sh <version> <sha256> <owner/repo>" >&2
  exit 1
fi
if ! printf '%s' "$version" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+'; then
  printf '%s\n' "not a stable version: $version" >&2
  exit 1
fi
if ! printf '%s' "$sha256" | grep -Eqx '[0-9a-f]{64}'; then
  printf '%s\n' "not a sha256: $sha256" >&2
  exit 1
fi
if ! printf '%s' "$repository" | grep -Eqx '[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+'; then
  printf '%s\n' "not owner/repo: $repository" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
sed -e "s|@VERSION@|$version|g" -e "s|@SHA256@|$sha256|g" -e "s|@REPOSITORY@|$repository|g" \
  "$root/packaging/homebrew/golem.rb.in"
