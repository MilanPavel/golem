#!/bin/sh
# CHANGELOG.md, one section per release (ADR-024, docs/sre.md section 5).
#
#   changelog.sh add <version>     write the commits since the last tag as <version>'s
#                                  section, above the newest one
#   changelog.sh notes <version>   print <version>'s section without its heading, for the
#                                  GitHub release; fail when there is none
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
file="$root/CHANGELOG.md"
usage="usage: changelog.sh add|notes <version>"
command=${1:?$usage}
version=${2:?$usage}
version=${version#v}

notes() {
  awk -v heading="## [$version]" '
    index($0, heading) == 1 { found = 1; next }
    found && /^## \[/ { exit }
    found && (started || NF) { started = 1; print }
  ' "$file"
}

case "$command" in
  add)
    if [ -n "$(notes)" ]; then
      echo "CHANGELOG.md already has a section for $version" >&2
      exit 1
    fi
    section=$(cd "$root" && uv run git-cliff --unreleased --tag "v$version" --strip all)
    if ! printf '%s\n' "$section" | grep -q '^- '; then
      echo "nothing to release: no feat, fix, perf, revert, or docs commits since the last tag" >&2
      exit 1
    fi
    tmp="$file.tmp"
    printf '%s\n' "$section" > "$tmp.section"
    awk -v section="$tmp.section" '
      !done && /^## \[/ { while ((getline line < section) > 0) print line; print ""; done = 1 }
      { print }
      END { if (!done) { print ""; while ((getline line < section) > 0) print line } }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
    rm -f "$tmp.section"
    ;;
  notes)
    text=$(notes)
    if [ -z "$text" ]; then
      echo "CHANGELOG.md has no section for $version. Run just release $version first (docs/sre.md, section 5)." >&2
      exit 1
    fi
    printf '%s\n' "$text"
    ;;
  *)
    echo "$usage" >&2
    exit 2
    ;;
esac
