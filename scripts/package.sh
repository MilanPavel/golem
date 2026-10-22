#!/bin/sh
# Pack a built tree into dist/<tree>.tar.gz and dist/<tree>.tar.gz.sha256.
# Pass the tree, or use the newest one under dist/. Prints the archive path.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

tree=${1:-}
if [ -z "$tree" ]; then
  tree=$(ls -td "$root"/dist/golem-*/ 2>/dev/null | head -n 1)
fi
tree=${tree%/}
if [ -z "$tree" ] || [ ! -x "$tree/bin/golem" ] || [ ! -x "$tree/libexec/golem-daemon/golem-daemon" ]; then
  printf '%s\n' "no built tree${tree:+ at $tree}; run just dist" >&2
  exit 1
fi

parent=$(CDPATH= cd -- "$(dirname "$tree")" && pwd)
name=$(basename "$tree")
archive="$parent/$name.tar.gz"

# The archive unpacks to one folder, golem-<version>-<os>-<arch>/. No macOS
# metadata files: code signatures are inside the executables, not in xattrs.
rm -f "$archive" "$archive.sha256"
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$parent" "$name"
(cd "$parent" && shasum -a 256 "$name.tar.gz" > "$name.tar.gz.sha256")

printf '%s\n' "$archive"
