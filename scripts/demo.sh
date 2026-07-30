#!/usr/bin/env bash
# One-command demo: scan a real repo, then show the claim + the receipts.
# Usage: ./scripts/demo.sh <path-to-repo>
set -euo pipefail

TARGET_DIR="${1:?Usage: ./scripts/demo.sh <path-to-repo>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Scanning $TARGET_DIR ..."
echo
node "$SCRIPT_DIR/../bin/rune.js" scan "$TARGET_DIR"
node "$SCRIPT_DIR/demo-report.mjs" "$TARGET_DIR"
