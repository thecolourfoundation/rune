#!/bin/sh
# Installs the rune executable from GitHub Releases. No npm, no Node.
set -eu
REPO="thecolourfoundation/rune"
os=$(uname -s); arch=$(uname -m)
case "$os-$arch" in
  Linux-x86_64)  asset=rune-linux-x64 ;;
  Darwin-arm64)  asset=rune-macos-arm64 ;;
  *) echo "No prebuilt binary for $os $arch yet: https://github.com/$REPO/releases" >&2; exit 1 ;;
esac
dir="${RUNE_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir"
tmp=$(mktemp)
base="https://github.com/$REPO/releases/latest/download"
echo "Downloading $asset ..."
curl -fsSL "$base/$asset" -o "$tmp"
want=$(curl -fsSL "$base/SHA256SUMS" | awk -v a="$asset" '$2==a{print $1}')
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp" | awk '{print $1}'); else got=$(shasum -a 256 "$tmp" | awk '{print $1}'); fi
if [ -z "$want" ] || [ "$want" != "$got" ]; then echo "Checksum verification failed - not installing." >&2; rm -f "$tmp"; exit 1; fi
mv "$tmp" "$dir/rune"; chmod +x "$dir/rune"
echo "Installed: $dir/rune ($("$dir/rune" --version 2>/dev/null || echo ok))"
case ":$PATH:" in *":$dir:"*) ;; *) echo "Add to your PATH:  export PATH=\"$dir:\$PATH\"" ;; esac
echo 'Try:  cd your-project && rune "how does this project work"'
