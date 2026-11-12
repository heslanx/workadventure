#!/usr/bin/env bash
# Interleave TS6 (tsc6) and native (tsc) --noEmit runs for back and map-storage.
# No project sets `incremental`, so every run starts without compiler build
# info. The OS page cache is not dropped (unprivileged container on a shared
# host); one discarded warm-up per variant makes that equal for both.
# usage: bench.sh <phase> <runs>
set -u
PHASE=$1
RUNS=$2
M=/tmp/wa-meas
R=$M/$PHASE.jsonl
L=$M/logs
BIN=/work/node_modules/.bin

one() {
  local label=$1 dir=$2
  shift 2
  (cd "/work/$dir" && python3 "$M/measure.py" "$label" "$R" "$L/$PHASE-last.log" -- "$@")
}

for i in warmup $(seq 1 "$RUNS"); do
  one "back:ts6:$i" back "$BIN/tsc6" --noEmit
  one "back:native:$i" back "$BIN/tsc" --noEmit
  one "map-storage:ts6:$i" map-storage "$BIN/tsc6" --project tsconfig-node.json --noEmit
  one "map-storage:native:$i" map-storage "$BIN/tsc" --project tsconfig-node.json --noEmit
done
