#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-dvroom-dev/resumer}"
PREFIX="${PREFIX:-$HOME/.local}"
BINDIR="${BINDIR:-$PREFIX/bin}"
NAME="${NAME:-res}"
VERSION="${VERSION:-latest}"

usage() {
  cat <<EOF
Install resumer ("res") from GitHub Releases.

Env vars:
  REPO     GitHub repo (default: $REPO)
  VERSION  Tag like v0.1.0, or "latest" (default: $VERSION)
  BINDIR   Install directory (default: $BINDIR)
  NAME     Installed binary name (default: $NAME)

Examples:
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash
  VERSION=v0.1.0 curl -fsSL ... | bash
  BINDIR=/usr/local/bin curl -fsSL ... | sudo bash
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing dependency: $1" >&2
    exit 1
  fi
}

need curl

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "$os" in
  linux) os="linux" ;;
  darwin) os="macos" ;;
  *)
    echo "Unsupported OS: $os" >&2
    exit 1
    ;;
esac

case "$arch" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *)
    echo "Unsupported arch: $arch" >&2
    exit 1
    ;;
esac

asset="res-${os}-${arch}"

# Build download URL directly (faster than API)
if [[ "$VERSION" == "latest" ]]; then
  download_url="https://github.com/${REPO}/releases/download/latest/${asset}"
else
  download_url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${asset}..."
out="$tmp/$asset"
if ! curl -fL "$download_url" -o "$out" 2>/dev/null; then
  echo "Failed to download from: $download_url" >&2
  echo "" >&2
  echo "The release may not exist yet. Try again in a few minutes," >&2
  echo "or build from source:" >&2
  echo "  git clone https://github.com/${REPO}.git && cd resumer" >&2
  echo "  bun install && bun run build" >&2
  echo "  install -m 755 ./dist/res ~/.local/bin/res" >&2
  exit 1
fi

mkdir -p "$BINDIR"
chmod +x "$out"
install -m 755 "$out" "$BINDIR/$NAME"

echo ""
echo "Installed: $BINDIR/$NAME"
echo ""
if [[ ":$PATH:" != *":$BINDIR:"* ]]; then
  echo "Note: $BINDIR is not in your PATH. Add it with:"
  echo "  export PATH=\"$BINDIR:\$PATH\""
  echo ""
fi
echo "Try: $NAME --help"
