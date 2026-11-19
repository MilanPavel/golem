#!/bin/sh
# Records the three web UI demos (search, code, inbox): builds the page, runs e2e/demo.record.ts,
# which takes sharp frames of the real web UI against the scripted model, and encodes each clip
# for the docs. The code clip needs cargo. Name clips to record only those: sh scripts/demo/web.sh code
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root/packages/web"
frames="$root/scripts/demo/out/web-frames"
clips=${*:-search code inbox}

pnpm exec vite build >/dev/null
for clip in $clips; do
  DEMO_FRAMES="$frames" pnpm exec playwright test -c playwright.demo.config.ts -g "record the $clip demo"
  ffmpeg -v error -y -f concat -i "$frames/$clip/frames.txt" \
    -vf "fps=30,format=yuv420p" -c:v libx264 -crf 16 -preset slow "$root/scripts/demo/out/$clip.mp4"
  (cd "$root" && sh scripts/demo/encode.sh "scripts/demo/out/$clip.mp4" "demo-$clip")
done
