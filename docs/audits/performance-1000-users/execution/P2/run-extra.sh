#!/usr/bin/env bash
# Extra gates beyond the lane minimum, run identically for base and head inside wa-fable-svelte.
# usage: run-extra.sh <phase>
# SKIP_FULL_TESTS=1 skips the whole play suite. It was set for head because the base run hit the
# 420 s time box (exit 124) at 1.5 CPUs, so a head run could not be compared with anything.
phase="$1"
R=/work/.p2/run-step.sh
out="/work/.p2/$phase"
# Size summary of the production build left in play/dist by run-phase.sh (raw and gzip -9 bytes).
(cd /work/play && [ -d dist ] && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.wasm' \) -print0 | sort -z | while IFS= read -r -d '' f; do printf '%s %s %s\n' "$(stat -c %s "$f")" "$(gzip -9 -c "$f" | wc -c)" "$f"; done > "$out/play-dist-js-css-wasm-sizes.txt")
$R "$phase" play-build-iframe-api play "timeout 300 npm run build-iframe-api"
$R "$phase" map-storage-front-build map-storage "timeout 180 npm run front:build"
$R "$phase" play-pretty-check play "timeout 180 npm run pretty-check"
[ "${SKIP_FULL_TESTS:-0}" = 1 ] || $R "$phase" play-full-tests play "timeout 420 npm test -- run"
$R "$phase" map-storage-test map-storage "timeout 180 npm test -- run"
# SKIP_LINT=1: same reason, the base lint run hit its 360 s time box (exit 124).
[ "${SKIP_LINT:-0}" = 1 ] || $R "$phase" play-lint play "timeout 360 npm run lint"
date -u
