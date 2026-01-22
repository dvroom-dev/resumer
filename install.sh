#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-dvroom-dev/resumer}"
BRANCH="${BRANCH:-main}"
PREFIX="${PREFIX:-$HOME/.local}"
BINDIR="${BINDIR:-$PREFIX/bin}"
NAME="${NAME:-res}"

usage() {
  cat <<EOF
Install resumer ("res") from source.

Requires: git, bun (will offer to install if missing)

Env vars:
  REPO     GitHub repo (default: $REPO)
  BRANCH   Git branch (default: $BRANCH)
  BINDIR   Install directory (default: $BINDIR)
  NAME     Installed binary name (default: $NAME)

Examples:
  curl -fsSL https://raw.githubusercontent.com/$REPO/$BRANCH/install.sh | bash
  BINDIR=/usr/local/bin curl -fsSL ... | sudo bash
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

# Check for git
if ! need git; then
  echo "Error: git is required but not installed." >&2
  exit 1
fi

# Check for bun, offer to install if missing
if ! need bun; then
  echo "Bun is required but not installed."
  read -p "Install bun now? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
  else
    echo "Please install bun first: https://bun.sh" >&2
    exit 1
  fi
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Cloning $REPO ($BRANCH)..."
git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$tmp/resumer"

cd "$tmp/resumer"

echo "Installing dependencies..."
bun install

echo "Building binary..."
bun run build

mkdir -p "$BINDIR"
install -m 755 ./dist/res "$BINDIR/$NAME"

echo ""
echo "Installed: $BINDIR/$NAME"
echo ""
if [[ ":$PATH:" != *":$BINDIR:"* ]]; then
  echo "Note: $BINDIR is not in your PATH. Add it with:"
  echo "  export PATH=\"$BINDIR:\$PATH\""
  echo ""
fi
echo "Try: $NAME --help"
