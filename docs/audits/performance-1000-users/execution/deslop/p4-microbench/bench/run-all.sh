#!/usr/bin/env bash
# Runs the P4 viewport micro-benchmark 6 times on sbh, one container at a time, each label load order once.
set -u
ROOT=~/wa-jobs/wa-fable-20261112/src-p5
REL=docs/audits/performance-1000-users/execution/p4db
OUT=$ROOT/$REL/logs
orders=("A A2 B" "B A A2" "A2 B A" "A B A2" "B A2 A" "A2 A B")
n=0
for order in "${orders[@]}"; do
  n=$((n+1))
  log=$OUT/run$n.log
  waited=0
  while [ "$waited" -lt 90 ] && [ -n "$(docker ps -q --filter label=owner=wa-fable-20261112)" ]; do
    sleep 5; waited=$((waited+5))
  done
  {
    echo "# $(date -u) host=$(hostname) run=$n label-order=$order"
    echo "# load before: $(cat /proc/loadavg) nproc=$(nproc) waited-for-sibling=${waited}s"
    echo "# other wa-fable containers before: $(docker ps --filter label=owner=wa-fable-20261112 --format '{{.Names}}' | tr '\n' ' ')"
  } > "$log"
  args=""
  for l in $order; do args="$args $l=../$REL/bench/PositionDispatcher.$l.ts"; done
  docker run --rm --name wa-fable-p4db-$n --label owner=wa-fable-20261112 --cpus 2 --cpu-shares 512 --memory 2g \
    --network none -v "$ROOT":/work -w /work/play node:24-trixie bash -lc \
    "node --version; sha256sum ../$REL/bench/*.ts; time npx tsx --expose-gc --min-semi-space-size=64 --max-semi-space-size=64 ../$REL/bench/viewport-bench.ts ../$REL/results/run$n.json $args; echo exit=\$?" \
    >> "$log" 2>&1
  {
    echo "# load after: $(cat /proc/loadavg)"
    echo "# $(date -u) done run=$n"
  } >> "$log"
done
echo ALLDONE > "$OUT/done"
