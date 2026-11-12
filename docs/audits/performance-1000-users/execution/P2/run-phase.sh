#!/usr/bin/env bash
# Runs the identical P2 check sequence for one phase (base|head) inside wa-fable-svelte.
# usage: run-phase.sh <phase> [checks|rest]
# "checks" = svelte-check + typecheck in play; "rest" = focused tests, shared consumers, production build.
phase="$1"; part="${2:-all}"
R=/work/.p2/run-step.sh
PLAY_TESTS="src/front/Chat/Components src/front/Chat/Stores src/front/Components src/front/Stores src/front/Utils/svelte-floatingui-show.test.ts tests/front/Components tests/front/Stores"
if [ "$part" = checks ] || [ "$part" = all ]; then
  $R "$phase" play-svelte-check play "npm run svelte-check"
  $R "$phase" play-typecheck play "npm run typecheck"
fi
if [ "$part" = rest ] || [ "$part" = all ]; then
  $R "$phase" play-focused-tests play "npm test -- run $PLAY_TESTS"
  $R "$phase" store-utils-svelte-check libs/store-utils "npm run svelte-check"
  $R "$phase" store-utils-typecheck libs/store-utils "npm run typecheck"
  $R "$phase" store-utils-test libs/store-utils "npm test"
  $R "$phase" map-storage-typecheck map-storage "npm run typecheck"
  # CI uses --max-old-space-size=16384; the container is capped at 8 GB, so 6144 is used here.
  $R "$phase" play-build play "rm -rf dist && PUSHER_URL=//localhost:3000 ADMIN_URL=//localhost:80 NODE_OPTIONS=--max-old-space-size=6144 timeout 600 npm run build"
  (cd /work/play && if [ -d dist ]; then find dist -type f -printf '%s %p\n' | sort -k2 > "/work/.p2/$phase/play-dist-files.txt"; du -sb dist > "/work/.p2/$phase/play-dist-total.txt"; fi)
fi
date -u
