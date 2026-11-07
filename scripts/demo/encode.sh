#!/bin/sh
# encode.sh <source.mp4> <name>: writes docs/images/<name>.mp4 (for the docs site), <name>.gif
# (for the README, which only animates GIFs), and <name>.jpg (the last frame: the poster, and the still picture under reduced motion).
set -eu

src=$1
name=$2
out=docs/images

# 1600 wide: sharp on a retina screen at the docs' width, and small.
ffmpeg -v error -y -i "$src" -vf "scale=1600:-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -crf 22 -preset slow -an -movflags +faststart "$out/$name.mp4"

# The GIF: 960 wide, 12 frames a second, one palette for the whole clip.
ffmpeg -v error -y -i "$src" -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  "$out/$name.gif"

ffmpeg -v error -y -sseof -0.3 -i "$src" -frames:v 1 -vf "scale=1600:-2:flags=lanczos" -q:v 3 "$out/$name.jpg"

ls -la "$out/$name.mp4" "$out/$name.gif" "$out/$name.jpg"
