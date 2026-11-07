#!/bin/sh
# Records the web UI demo: builds the page, runs e2e/demo.record.ts, which takes sharp frames of
# the real web UI against the scripted model, and encodes them for the docs.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root/packages/web"
frames="$root/scripts/demo/out/web-frames"

pnpm exec vite build >/dev/null
DEMO_FRAMES="$frames" pnpm exec playwright test -c playwright.demo.config.ts
ffmpeg -v error -y -f concat -i "$frames/frames.txt" \
  -vf "fps=30,format=yuv420p" -c:v libx264 -crf 16 -preset slow "$root/scripts/demo/out/web.mp4"
cd "$root"
sh scripts/demo/encode.sh scripts/demo/out/web.mp4 demo-web
