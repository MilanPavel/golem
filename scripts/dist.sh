#!/bin/sh
# Build a relocatable tree: dist/golem-<version>-<os>-<arch>/.
# libexec/golem-daemon is a PyInstaller one-folder build. bin/golem is the compiled CLI.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

version=$(sh "$root/scripts/version.sh")
os=$(uname -s)
case "$os" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  MINGW* | MSYS* | CYGWIN*) os=windows ;;
  *) os=$(printf '%s' "$os" | tr '[:upper:]' '[:lower:]') ;;
esac
case $(uname -m) in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) arch=$(uname -m) ;;
esac

dest="$root/dist/golem-${version}-${os}-${arch}"
build_file="$root/packages/daemon/golem/_build.py"

cleanup() {
  rm -f "$build_file"
}
trap cleanup EXIT

rm -rf "$dest"
mkdir -p "$dest/bin"

VERSION="$version" BUILD_FILE="$build_file" python3 -c 'import os; from pathlib import Path; Path(os.environ["BUILD_FILE"]).write_text("VERSION = " + repr(os.environ["VERSION"]) + "\n")'

unset VIRTUAL_ENV
# _build.py is in the source tree for this run, so the frozen daemon reports the tag.
if [ -x "$root/.venv/bin/pyinstaller" ]; then
  "$root/.venv/bin/pyinstaller" \
    --noconfirm \
    --distpath "$dest/libexec" \
    --workpath "$root/dist/.pyinstaller" \
    "$root/packages/daemon/golem-daemon.spec"
else
  uv run pyinstaller \
    --noconfirm \
    --distpath "$dest/libexec" \
    --workpath "$root/dist/.pyinstaller" \
    "$root/packages/daemon/golem-daemon.spec"
fi
rm -rf "$root/dist/.pyinstaller"

if ! command -v bun >/dev/null 2>&1; then
  printf '%s\n' "bun is required to compile bin/golem" >&2
  exit 1
fi
# A JSON string, so `bun build --define` inlines the git tag into GOLEM_VERSION.
define_value=$(printf '%s' "$version" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
bun build "$root/packages/cli/src/main.ts" \
  --compile \
  --outfile "$dest/bin/golem" \
  --define "GOLEM_VERSION=${define_value}"

printf '%s\n' "$dest"
