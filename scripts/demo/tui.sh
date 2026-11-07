#!/bin/sh
# Records the terminal demo: starts the scripted stack, runs tui.tape in VHS, stops the stack,
# and encodes the result for the docs. Needs vhs (brew install vhs).
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"
command -v vhs >/dev/null || { echo "demo-tui needs vhs: brew install vhs" >&2; exit 1; }

work=$(mktemp -d)
env_file="$work/demo.env"
log="$work/stack.log"
(cd packages/web && node e2e/demo-stack.ts "$env_file" >"$log" 2>&1) &
stack=$!
trap 'kill "$stack" 2>/dev/null; wait "$stack" 2>/dev/null || true; rm -rf "$work"' EXIT

i=0
until grep -q '^ready' "$log" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 120 ] || ! kill -0 "$stack" 2>/dev/null; then
    cat "$log" >&2
    echo "the demo stack did not start" >&2
    exit 1
  fi
  sleep 0.5
done

mkdir -p scripts/demo/out
DEMO_ENV="$env_file" vhs scripts/demo/tui.tape
sh scripts/demo/encode.sh scripts/demo/out/tui.mp4 demo-tui
