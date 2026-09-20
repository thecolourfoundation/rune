#!/usr/bin/env bash
# Builds one self-contained rune executable. Usage: scripts/build-binary.sh [output]
set -euo pipefail
OUT="${1:-dist/rune}"
mkdir -p "$(dirname "$OUT")" build
VERSION=$(node -p "require('./package.json').version")
npx -y esbuild bin/rune.js --bundle --platform=node --format=cjs \
  --define:import.meta.url=__importMetaUrl \
  --define:__RUNE_VERSION__="\"$VERSION\"" \
  --banner:js="const __importMetaUrl=require('url').pathToFileURL(process.execPath).href;" \
  --outfile=build/rune.cjs
sed '1{/^#!/d}' build/rune.cjs > build/rune.main.cjs
echo '{"main":"build/rune.main.cjs","output":"build/sea.blob","disableExperimentalSEAWarning":true}' > build/sea.json
node --experimental-sea-config build/sea.json
cp "$(command -v node)" "$OUT"
FUSE=NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
case "$(uname -s)" in
  Darwin)
    codesign --remove-signature "$OUT"
    npx -y postject "$OUT" NODE_SEA_BLOB build/sea.blob --sentinel-fuse "$FUSE" --macho-segment-name NODE_SEA
    codesign --sign - "$OUT"
    ;;
  *)
    npx -y postject "$OUT" NODE_SEA_BLOB build/sea.blob --sentinel-fuse "$FUSE"
    ;;
esac
