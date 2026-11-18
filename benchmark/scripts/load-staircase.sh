#!/usr/bin/env bash
#
# Staircase load run: for each level (total number of bots) start P staggered generator processes that share the
# level between them, wait for all of them, merge their JSON summaries and move on to the next level.
#
# It starts nothing but the generator processes (npm start in benchmark/) and the merge (tsx): no server, no docker, no
# browser. Start and restart the pusher, back and map-storage yourself, and give every level the same fresh server
# if you want comparable numbers (the nodejs_eventloop_lag_max gauge only resets on a restart).
#
# Written for bash 3.2 (macOS) and 4+ (Linux): no associative arrays, no mapfile, no wait -n.
#
# Usage:
#   scripts/load-staircase.sh [options] -- <generator flags>
#
# Options (whole seconds, all optional):
#   --levels=300,500,700,1000   total bots at each step, run in this order
#   --processes=4               generator processes per level (at most one per bot)
#   --stagger-seconds=4         delay between process starts; every process still stops at the same moment
#   --ramp-seconds=60           each process ramps its own bots up over this long
#   --duration-seconds=240      run time of the first process; process k runs k x stagger less, so all stop together
#   --steady-window=120         closing seconds that the statistics cover (must fit after the ramp and the stagger)
#   --repeat=1                  runs of the whole staircase, interleaved: level 1, 2, 3, then 1, 2, 3 again
#   --pause-seconds=20          rest between runs
#   --metrics-urls=<list>       comma-separated /metrics URLs; only the first process scrapes them
#   --taskset=<cpus>            Linux only: pin every generator to these CPUs (for example 4-7); ignored elsewhere
#   --out-dir=<dir>             where the JSON goes; default benchmark/load-out/<timestamp>
#   --dry-run                   print the plan and the commands, run nothing
#
# Everything after -- goes to every generator process (see `npm start` usage in benchmark/README.md): at least
# --pusher-url and --room-urls, usually --move-hz, --viewport, --pattern, --moving-fraction, --world-space. The flags
# this script sets itself (--sessions, --index-offset, --ramp-seconds, --duration-seconds, --steady-window, --output,
# --metrics-urls) are refused there. --min-accepted defaults to each process's own session count.
#
# Output: <out-dir>/rep<r>-n<level>/gen-<k>.json (one per process), gen-<k>.err.log, merged.json; <out-dir>/staircase.json.
# The merge is told how many processes it should find and how many bots the level has, so a process that died without
# writing its summary, or a leftover gen-<k>.json from an earlier attempt, makes the level invalid instead of smaller.
# Exit code: 0 when every level is valid, 2 when one is not, 1 on a usage error.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LEVELS="300,500,700,1000"
PROCESSES=4
STAGGER=4
RAMP=60
DURATION=240
WINDOW=120
REPEAT=1
PAUSE=20
METRICS_URLS=""
TASKSET_CPUS=""
OUT_DIR=""
DRY_RUN=0

die() {
  echo "load-staircase: $*" >&2
  exit 1
}

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

require_whole_number() {
  case "$2" in
    '' | *[!0-9]*) die "$1 must be a whole number, got '$2'" ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --levels=*) LEVELS="${1#*=}" ;;
    --processes=*) PROCESSES="${1#*=}" ;;
    --stagger-seconds=*) STAGGER="${1#*=}" ;;
    --ramp-seconds=*) RAMP="${1#*=}" ;;
    --duration-seconds=*) DURATION="${1#*=}" ;;
    --steady-window=*) WINDOW="${1#*=}" ;;
    --repeat=*) REPEAT="${1#*=}" ;;
    --pause-seconds=*) PAUSE="${1#*=}" ;;
    --metrics-urls=*) METRICS_URLS="${1#*=}" ;;
    --taskset=*) TASKSET_CPUS="${1#*=}" ;;
    --out-dir=*) OUT_DIR="${1#*=}" ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *) die "unknown option '$1' (generator flags go after --)" ;;
  esac
  shift
done

GENERATOR_FLAGS=()
HAS_MIN_ACCEPTED=0
for argument in ${1+"$@"}; do
  case "$argument" in
    --sessions=* | --index-offset=* | --ramp-seconds=* | --duration-seconds=* | --steady-window=* | --output=* | --metrics-urls=*)
      die "'${argument%%=*}' is set by this script; use its own option instead"
      ;;
    --min-accepted=*) HAS_MIN_ACCEPTED=1 ;;
  esac
  GENERATOR_FLAGS+=("$argument")
done

require_whole_number --processes "$PROCESSES"
require_whole_number --stagger-seconds "$STAGGER"
require_whole_number --ramp-seconds "$RAMP"
require_whole_number --duration-seconds "$DURATION"
require_whole_number --steady-window "$WINDOW"
require_whole_number --repeat "$REPEAT"
require_whole_number --pause-seconds "$PAUSE"
[ "$PROCESSES" -ge 1 ] || die "--processes must be at least 1"
[ "$REPEAT" -ge 1 ] || die "--repeat must be at least 1"

LEVEL_LIST="$(echo "$LEVELS" | tr ',' ' ')"
[ -n "${LEVEL_LIST// /}" ] || die "--levels is empty"
for level in $LEVEL_LIST; do
  require_whole_number "a level" "$level"
  [ "$level" -ge 1 ] || die "a level must be at least 1"
done

# Process k starts k x stagger late and runs k x stagger less, so all of them stop together and their windows line up.
LAST_START=$(((PROCESSES - 1) * STAGGER))
if [ "$WINDOW" -gt 0 ] && [ $((WINDOW + RAMP + LAST_START)) -gt "$DURATION" ]; then
  die "the steady window (${WINDOW}s) does not fit: ramp ${RAMP}s + last start ${LAST_START}s + window must be at most the duration (${DURATION}s)"
fi
[ "$LAST_START" -lt "$DURATION" ] || die "the last process would start after the run ends: lower --stagger-seconds or --processes"

if [ -z "$OUT_DIR" ]; then
  OUT_DIR="$BENCH_DIR/load-out/$(date +%Y%m%d-%H%M%S)"
fi

TASKSET_CMD=""
if [ -n "$TASKSET_CPUS" ]; then
  if command -v taskset >/dev/null 2>&1; then
    TASKSET_CMD="taskset -c $TASKSET_CPUS"
  else
    echo "load-staircase: taskset is not available here; the generators run unpinned" >&2
  fi
fi

if [ "$DRY_RUN" -eq 0 ]; then
  command -v node >/dev/null 2>&1 || die "node is not on PATH (the benchmark needs Node 24)"
  command -v npm >/dev/null 2>&1 || die "npm is not on PATH"
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" = "24" ] || echo "load-staircase: node $(node -v) found; the benchmark README asks for Node 24" >&2
  mkdir -p "$OUT_DIR"
fi

PIDS=""

stop_children() {
  local pid
  for pid in $PIDS; do
    kill "$pid" 2>/dev/null || true
  done
}

on_signal() {
  echo "load-staircase: interrupted, stopping the generators (each prints its summary)" >&2
  stop_children
  wait 2>/dev/null || true
  exit 130
}

trap on_signal INT TERM
trap stop_children EXIT

# Prints "<sessions> <offset>" for process $3 of $2 when $1 bots are shared out: the first (level % processes)
# processes take one extra bot.
share_of() {
  local level=$1 processes=$2 index=$3
  local base=$((level / processes)) extra=$((level % processes))
  local count=$base offset=$((base * index))
  if [ "$index" -lt "$extra" ]; then
    count=$((base + 1))
    offset=$((offset + index))
  else
    offset=$((offset + extra))
  fi
  echo "$count $offset"
}

run_level() {
  local repeat=$1 level=$2
  local dir="$OUT_DIR/rep${repeat}-n${level}"
  local processes=$PROCESSES
  [ "$processes" -le "$level" ] || processes=$level
  local index share count offset duration
  PIDS=""

  [ "$DRY_RUN" -eq 1 ] || mkdir -p "$dir"
  index=0
  while [ "$index" -lt "$processes" ]; do
    share="$(share_of "$level" "$processes" "$index")"
    count="${share% *}"
    offset="${share#* }"
    duration=$((DURATION - index * STAGGER))
    local -a command=(npm start --silent --)
    command+=(${GENERATOR_FLAGS[@]+"${GENERATOR_FLAGS[@]}"})
    command+=("--sessions=$count" "--index-offset=$offset" "--ramp-seconds=$RAMP" "--duration-seconds=$duration")
    command+=("--steady-window=$WINDOW" "--output=$dir/gen-$index.json")
    [ "$HAS_MIN_ACCEPTED" -eq 1 ] || command+=("--min-accepted=$count")
    if [ "$index" -eq 0 ] && [ -n "$METRICS_URLS" ]; then
      command+=("--metrics-urls=$METRICS_URLS")
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
      echo "rep$repeat n$level process $index: sessions=$count index-offset=$offset start=+$((index * STAGGER))s duration=${duration}s"
      echo "  (cd $BENCH_DIR && ${TASKSET_CMD:+$TASKSET_CMD }${command[*]})"
    else
      echo "rep$repeat n$level process $index: sessions=$count index-offset=$offset start=+$((index * STAGGER))s duration=${duration}s"
      (
        cd "$BENCH_DIR"
        # shellcheck disable=SC2086
        exec $TASKSET_CMD "${command[@]}"
      ) >/dev/null 2>"$dir/gen-$index.err.log" &
      PIDS="$PIDS $!"
      [ $((index + 1)) -lt "$processes" ] && [ "$STAGGER" -gt 0 ] && sleep "$STAGGER"
    fi
    index=$((index + 1))
  done

  local -a merge=(npx --no-install tsx scripts/merge-summaries.ts run "$dir" --out="$dir/merged.json" --headline)
  merge+=("--expect-processes=$processes" "--expect-sessions=$level")
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  merge: (cd $BENCH_DIR && ${merge[*]})"
    return 0
  fi

  local pid failed=0 position=0
  for pid in $PIDS; do
    local code=0
    wait "$pid" || code=$?
    # 0 = valid run, 2 = the generator judged its own run invalid (the merge reports why), anything else is an error.
    if [ "$code" -ne 0 ] && [ "$code" -ne 2 ]; then
      failed=1
      echo "load-staircase: process $position exited with $code; last lines of its log:" >&2
      tail -n 5 "$dir/gen-$position.err.log" >&2 || true
    fi
    position=$((position + 1))
  done
  PIDS=""

  local merge_code=0
  (cd "$BENCH_DIR" && "${merge[@]}") || merge_code=$?
  [ "$failed" -eq 0 ] || merge_code=1
  return "$merge_code"
}

overall=0
run_number=0
total_runs=$((REPEAT * $(echo "$LEVEL_LIST" | wc -w)))
repeat=1
while [ "$repeat" -le "$REPEAT" ]; do
  for level in $LEVEL_LIST; do
    run_number=$((run_number + 1))
    echo "== run $run_number of $total_runs: repeat $repeat, $level bots over up to $PROCESSES processes =="
    code=0
    run_level "$repeat" "$level" || code=$?
    if [ "$code" -ne 0 ]; then
      overall=2
    fi
    if [ "$DRY_RUN" -eq 0 ] && [ "$run_number" -lt "$total_runs" ] && [ "$PAUSE" -gt 0 ]; then
      sleep "$PAUSE"
    fi
  done
  repeat=$((repeat + 1))
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry run: nothing was started; output would go to $OUT_DIR"
  exit 0
fi

echo "== staircase =="
(cd "$BENCH_DIR" && npx --no-install tsx scripts/merge-summaries.ts staircase "$OUT_DIR" --out="$OUT_DIR/staircase.json" --headline) || overall=1
echo "output: $OUT_DIR"
exit "$overall"
