#!/bin/sh
# Print the golem version: the git tag with the leading "v" removed, or 0.0.0-dev.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
if desc=$(git -C "$root" describe --tags --match 'v*' --dirty 2>/dev/null); then
  printf '%s\n' "${desc#v}"
else
  printf '%s\n' "0.0.0-dev"
fi
