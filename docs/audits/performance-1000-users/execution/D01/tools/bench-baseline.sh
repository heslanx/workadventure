#!/usr/bin/env bash
# TS 5.9.3 baseline: interleaved back / map-storage --noEmit runs on the
# pristine p3 tree (back and map-storage untouched there), in a throwaway
# container with the same CPU cap as wa-fable-ts. Runs inside the container.
# usage: bench-baseline.sh <runs>
set -u
RUNS=$1
M=/meas
R=$M/baseline-ts593.jsonl
BIN=/src/node_modules/.bin
mkdir -p $M/logs
echo "tsc: $($BIN/tsc -v)"
for i in warmup $(seq 1 "$RUNS"); do
  (cd /src/back && python3 $M/measure.py "back:ts593:$i" $R $M/logs/back-$i.log -- $BIN/tsc --noEmit)
  (cd /src/map-storage && python3 $M/measure.py "map-storage:ts593:$i" $R $M/logs/ms-$i.log -- $BIN/tsc --project tsconfig-node.json --noEmit)
done
