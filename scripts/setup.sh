#!/bin/sh
# Make a checkout ready for development. Safe to run again.
#
#   scripts/setup.sh             check the tools, then install the packages and the hooks
#   scripts/setup.sh --install   also brew install the tools that are missing
#   scripts/setup.sh --check     also run just check at the end
#
# Exits 1 if a required tool is missing or a step fails. The versions follow
# .github/actions/setup, which CI uses.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
unset VIRTUAL_ENV

install=0
check=0
for arg in "$@"; do
  case $arg in
    --install) install=1 ;;
    --check) check=1 ;;
    -h | --help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown option: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

problems=0
warnings=0

ok() { printf '✓ %-6s %s\n' "$1" "$2"; }
warn() {
  printf '! %-6s %s\n' "$1" "$2"
  [ -z "${3:-}" ] || printf '         fix: %s\n' "$3"
  warnings=$((warnings + 1))
}
fail() {
  printf '✗ %-6s %s\n' "$1" "$2"
  [ -z "${3:-}" ] || printf '         fix: %s\n' "$3"
  problems=$((problems + 1))
}
have() { command -v "$1" >/dev/null 2>&1; }

# The first number in a version string: "v24.1.0" -> 24.
major() { printf '%s\n' "$1" | sed 's/^[^0-9]*//; s/\..*//'; }
# "1.3.10" -> 1.3
minor() { printf '%s\n' "$1" | sed 's/^[^0-9]*//' | cut -d. -f1-2; }

# brew_fix <formula> prints the install command, or runs it with --install.
# Returns 0 if the tool was installed now.
brew_fix() {
  if [ "$install" = 1 ] && have brew; then
    printf '  installing %s with Homebrew\n' "$1"
    brew install "$1" >/dev/null && return 0
  fi
  return 1
}

# tool <command> <brew formula> <label>: present, or installed now, or a problem.
tool() {
  if ! have "$1" && brew_fix "$2"; then
    hash -r 2>/dev/null || true
  fi
  if have "$1"; then
    return 0
  fi
  fail "$3" "not installed" "brew install $2"
  return 1
}

printf 'Tools\n'

if [ "$(uname -s)" = Darwin ] && ! have brew; then
  warn brew "not installed. The fixes below use it" "see https://brew.sh"
fi

if tool just just just; then
  ok just "$(just --version | cut -d' ' -f2)"
fi

if tool uv uv uv; then
  ok uv "$(uv --version | cut -d' ' -f2). It installs Python $(cat .python-version) by itself"
fi

if tool node node node; then
  v=$(node --version)
  if [ "$(major "$v")" -ge 24 ]; then
    ok node "$v"
  else
    fail node "$v, but golem needs 24 or newer" "brew upgrade node"
  fi
fi

# pnpm comes from corepack, which ships with Node, at the version package.json names.
pinned=$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' package.json)
if ! have pnpm && have corepack && [ "$install" = 1 ]; then
  printf '  turning on corepack for pnpm\n'
  corepack enable && hash -r 2>/dev/null || true
fi
if have pnpm; then
  ok pnpm "$(pnpm --version) (package.json pins $pinned)"
elif have corepack; then
  fail pnpm "not on PATH" "corepack enable"
else
  fail pnpm "not installed, and no corepack to provide it" "brew install node"
fi

if tool bun oven-sh/bun/bun bun; then
  v=$(bun --version)
  if [ "$(minor "$v")" = 1.3 ]; then
    ok bun "$v"
  else
    warn bun "$v. CI uses 1.3, so builds may differ" "brew install oven-sh/bun/bun"
  fi
fi

# gh is only needed to open pull requests and to release, so it is a warning.
if have gh || brew_fix gh; then
  # Only github.com: a stale login to another host must not count.
  if gh auth status --hostname github.com >/dev/null 2>&1; then
    ok gh "$(gh --version | head -1 | cut -d' ' -f3), signed in to github.com"
  else
    warn gh "not signed in to github.com. /ship and just release need it" \
      "gh auth login --hostname github.com"
  fi
else
  warn gh "not installed. /ship and just release need it" "brew install gh"
fi

# The daemon tests put sockets under <checkout>/.test-socks/<8>/run/golem.sock,
# and macOS allows 103 bytes for a socket path.
if [ "$(printf '%s' "$root/.test-socks/12345678/run/golem.sock" | wc -c)" -gt 103 ]; then
  warn path "$root is too long for the daemon tests' sockets" \
    "clone into a folder whose path has 67 characters or fewer"
fi

if [ "$problems" -gt 0 ]; then
  printf '\n%s missing. Install them, then run scripts/setup.sh again.\n' \
    "$([ "$problems" = 1 ] && echo '1 tool is' || echo "$problems tools are")"
  exit 1
fi

printf '\nPackages\n'

# step <label> <command...>: runs quietly, shows the output only on failure.
step() {
  label=$1
  shift
  log=$(mktemp)
  if "$@" >"$log" 2>&1; then
    ok "$label" "$*"
    rm -f "$log"
  else
    fail "$label" "$* failed:"
    sed 's/^/         /' "$log"
    rm -f "$log"
    exit 1
  fi
}

step python uv sync --all-packages --frozen
step node pnpm install --frozen-lockfile
step hooks git config core.hooksPath .githooks

if [ "$check" = 1 ]; then
  printf '\nCheck (lint, typecheck, tests)\n'
  if just check; then
    ok check "just check passed"
  else
    fail check "just check failed. The output above says where"
    exit 1
  fi
fi

if [ "$warnings" -gt 0 ]; then
  printf '\nReady, with %s warning%s above.\n' "$warnings" "$([ "$warnings" = 1 ] || echo s)"
else
  printf '\nReady. Next: just check, then just golem.\n'
fi
