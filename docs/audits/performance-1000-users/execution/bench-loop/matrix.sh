#!/usr/bin/env bash
# Drains a plan file on knc, one run at a time, re-reading it after every run so lines appended later are picked up.
# Plan line: <variant> <sessions> <rooms> <rep> <measure|profile> [BACK_CPUS]
# A run is attempted once: its directory gets an "attempted" marker; delete the directory to re-run it.
# usage: matrix.sh plan.txt   (stops on $OUT/STOP or when no unattempted line remains)
set -uo pipefail
J=/root/wa-jobs/wa-fable-20261112
OUT=$J/bench-out
PLAN=$1
mkdir -p "$OUT"
while :; do
  [ -e "$OUT/STOP" ] && { echo "STOP file present, halting"; exit 3; }
  next=""
  while read -r variant n rooms rep mode backcpus; do
    [ -z "${variant:-}" ] || [ "${variant:0:1}" = "#" ] && continue
    run=$variant-n$n-r$rooms-$rep$([ "$mode" = profile ] && echo -prof || true)
    if [ ! -e "$OUT/$run/attempted" ]; then next="$variant $n $rooms $rep $mode ${backcpus:-0.65}"; break; fi
  done < "$PLAN"
  [ -z "$next" ] && { echo "plan drained $(date -u +%FT%TZ)"; exit 0; }
  set -- $next
  run=$1-n$2-r$3-$4$([ "$5" = profile ] && echo -prof || true)
  # Let this loop's own previous run decay out of the 1-minute load average (at most 60 s) before run-one.sh's guard samples it.
  for _ in 1 2 3 4 5 6; do awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN{exit !(l > 6)}' || break; sleep 10; done
  mkdir -p "$OUT/$run" && touch "$OUT/$run/attempted"
  echo "$(date -u +%FT%TZ) start $run back_cpus=$6"
  BACK_CPUS=$6 bash "$J/bench-loop/run-one.sh" "$1" "$2" "$3" "$4" "$5" > "$OUT/$run/run.log" 2>&1
  echo "$(date -u +%FT%TZ) exit=$? $run"
done
