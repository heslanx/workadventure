#!/usr/bin/env bash
# Run the repository's own check scripts for the given targets and record
# exit code, wall time and peak RSS per target through measure.py.
# usage: run-checks.sh <phase> <target...>
set -u
PHASE=$1
shift
M=/tmp/wa-meas
R=$M/$PHASE.jsonl
L=$M/logs

run() {
  local label=$1 dir=$2
  shift 2
  (cd "/work/$dir" && python3 "$M/measure.py" "$PHASE:$label" "$R" "$L/$PHASE-$label.log" -- "$@") >/dev/null
  echo "$label exit=$? log_lines=$(wc -l <"$L/$PHASE-$label.log")"
}

for target in "$@"; do
  case $target in
    back) run back-typecheck back npm run -s typecheck ;;
    map-storage) run map-storage-typecheck map-storage npm run -s typecheck ;;
    map-storage-front) run map-storage-front-check map-storage npm run -s front:check ;;
    shared-utils) run shared-utils-typecheck libs/shared-utils npm run -s typecheck ;;
    store-utils) run store-utils-typecheck libs/store-utils npm run -s typecheck ;;
    store-utils-svelte) run store-utils-svelte-check libs/store-utils npm run -s svelte-check ;;
    map-editor) run map-editor-typecheck libs/map-editor npm run -s typecheck ;;
    messages) run messages-typecheck libs/messages npm run -s typecheck ;;
    math-utils) run math-utils-tsc-noemit libs/math-utils npx --no-install tsc --noEmit ;;
    e2e-report) run e2e-report-typecheck contrib/tools/e2e-report npm run -s typecheck ;;
    play) run play-typecheck play npm run -s typecheck ;;
    play-pusher) run play-pusher-tsc-noemit play npx --no-install tsc --project tsconfig-pusher.json --noEmit ;;
    play-iframe) run play-iframe-typings-noemit play npx --no-install tsc --project tsconfig-for-iframe-api-typings.json --noEmit ;;
    play-svelte) run play-svelte-check play npm run -s svelte-check ;;
    *) echo "unknown target $target" ;;
  esac
done
