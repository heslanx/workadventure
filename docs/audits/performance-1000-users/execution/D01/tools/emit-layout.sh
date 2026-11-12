#!/usr/bin/env bash
# List the files each emitting project would write, relative to its outDir,
# for a given compiler. Output goes to a scratch directory, never to the tree.
# usage: emit-layout.sh <tag> <path-to-tsc-js-or-bin>
set -u
TAG=$1
TSC=$2
OUT=/tmp/wa-meas/emit/$TAG
rm -rf "$OUT"
mkdir -p "$OUT"

emit() {
  local name=$1 dir=$2 cfg=$3
  (cd "/work/$dir" && "$TSC" -p "$cfg" --outDir "$OUT/$name" --listEmittedFiles >"$OUT/$name.raw" 2>&1)
  echo "$name exit=$?" >>"$OUT/exit-codes.txt"
  grep '^TSFILE: ' "$OUT/$name.raw" | sed "s|^TSFILE: $OUT/$name/||" | sort >"$OUT/$name.files"
  grep -v '^TSFILE: ' "$OUT/$name.raw" | cut -c1-300 | head -20 >"$OUT/$name.diag"
  echo "$name files=$(wc -l <"$OUT/$name.files") diag_lines=$(wc -l <"$OUT/$name.diag")"
}

emit shared-utils libs/shared-utils tsconfig.json
emit store-utils libs/store-utils tsconfig.json
emit map-editor libs/map-editor tsconfig.json
emit messages libs/messages tsconfig.json
emit math-utils libs/math-utils tsconfig.json
emit play-pusher play tsconfig-pusher.json
emit play-iframe-typings play tsconfig-for-iframe-api-typings.json
cat "$OUT/exit-codes.txt"
