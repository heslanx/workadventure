#!/usr/bin/env bash
# Typed ESLint smoke check: lint one small source file per workspace through the
# shared config (projectService) and record which TypeScript the parser loaded.
# usage: run-lint-sample.sh <phase>
set -u
PHASE=$1
M=/tmp/wa-meas
R=$M/$PHASE.jsonl
L=$M/logs

lint() {
  local name=$1 dir=$2 file=$3
  (cd "/work/$dir" && DEBUG= python3 "$M/measure.py" "$PHASE:lint-$name" "$R" "$L/$PHASE-lint-$name.log" -- npx --no-install eslint "$file") >/dev/null
  echo "lint-$name file=$file exit=$? log_lines=$(wc -l <"$L/$PHASE-lint-$name.log") unsupported_ts_warning=$(grep -c 'not officially supported' "$L/$PHASE-lint-$name.log")"
}

smallest() {
  # smallest non-trivial, non-test source file with the given extension
  find "/work/$1" -type f -name "*.$2" -size +300c ! -name '*.test.ts' ! -name '*.d.ts' ! -path '*/node_modules/*' ! -path '*/i18n/*' -printf '%s %P\n' | sort -n | head -1 | cut -d' ' -f2
}

lint back back "src/$(smallest back/src ts)"
lint map-storage map-storage "src/$(smallest map-storage/src ts)"
lint shared-utils libs/shared-utils "src/$(smallest libs/shared-utils/src ts)"
lint store-utils libs/store-utils "src/$(smallest libs/store-utils/src ts)"
lint map-editor libs/map-editor "src/$(smallest libs/map-editor/src ts)"
lint play-ts play "src/$(smallest play/src ts)"
lint play-svelte play "src/$(smallest play/src svelte)"

cd /work/libs/eslint-config && node -e '
const path = require("path");
const ts = require("typescript");
const tsPkg = require(path.join(path.dirname(require.resolve("typescript/package.json")), "package.json"));
const estree = require("@typescript-eslint/typescript-estree/package.json");
console.log(JSON.stringify({
  resolved_from: process.cwd(),
  typescript_api_version: ts.version,
  typescript_package_name: tsPkg.name,
  typescript_package_version: tsPkg.version,
  typescript_path: require.resolve("typescript"),
  typescript_estree_version: estree.version,
  typescript_estree_peer_range: estree.peerDependencies.typescript,
}));'
