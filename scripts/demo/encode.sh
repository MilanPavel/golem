#!/bin/sh
# encode.sh <source.mp4> <name>: writes docs/images/<name>.mp4 (for the docs site), <name>.gif
# (for the README, which only animates GIFs), and <name>.jpg (the last frame: the poster, and the still picture under reduced motion).
# A busy clip can ask for a lighter GIF: GIF_FPS, GIF_COLORS (up to 256), GIF_DITHER (none, bayer) and GIF_STATS (diff, full).
set -eu

src=$1
name=$2
out=docs/images

# 1600 wide: sharp on a retina screen at the docs' width, and small.
ffmpeg -v error -y -i "$src" -vf "scale=1600:-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -crf 22 -preset slow -an -movflags +faststart "$out/$name.mp4"

# The GIF: 960 wide, 12 frames a second, one palette for the whole clip.
fps=${GIF_FPS:-12}
colors=${GIF_COLORS:-128}
dither=${GIF_DITHER:-bayer:bayer_scale=4}
stats=${GIF_STATS:-diff}
ffmpeg -v error -y -i "$src" -vf "fps=${fps},scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=${stats}[pal];[b][pal]paletteuse=dither=${dither}:diff_mode=rectangle" \
  "$out/$name.gif"

ffmpeg -v error -y -sseof -0.3 -i "$src" -frames:v 1 -vf "scale=1600:-2:flags=lanczos" -q:v 3 "$out/$name.jpg"

ls -la "$out/$name.mp4" "$out/$name.gif" "$out/$name.jpg"
