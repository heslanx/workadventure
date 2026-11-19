#!/usr/bin/env bash
# Builds the server images from this checkout and runs the load staircase against them, on one Docker network.
#
#   benchmark/ci/run-load.sh <out dir>
#
# What runs is in load-run.env beside this script. For every scenario, repeat and level it starts a fresh stack
# (compose.yaml), runs scripts/load-staircase.sh for that one level from a container on the same network, saves the
# container CPU samples, the host load and the server logs, and removes the stack. The generator runs in the play
# image: that image already holds the generated protocol code, its stamped version and the dependencies.
#
# Output, under <out dir>:
#   build-<service>.log                         image builds
#   <scenario>/rep<r>-n<level>/                 gen-<k>.json, merged.json (load-staircase.sh), docker-stats.txt,
#                                               host-load.txt, limits.txt, play.log, back.log, server-logs-tail.txt,
#                                               generator.log
#   <scenario>/staircase.json, staircase.txt    every level of the scenario and its knee
#   profile/...                                 the same for the profiled level, plus pusher-profile.json and
#                                               profile-summary.txt
#   calibration/...                             the same for the calibration level
#   run.txt                                     the commit, the parameters and one verdict line per level
#
# docker-stats.txt holds the CPU of each container only where the daemon keeps a cgroup per container; where it does
# not, the file says so and the CPU of the servers comes from the metrics scrape in merged.json.
#
# Exit code: 0 when every level produced a measurement, whatever it measured (a saturated level is a result, not a
# failure); 1 when an image did not build, a stack did not start or the generator of a level failed.
#
# LOAD_SKIP_BUILD=1 with LOAD_IMAGE_PREFIX and LOAD_IMAGE_TAG runs against images that already exist.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
[ $# -eq 1 ] || {
  echo "usage: benchmark/ci/run-load.sh <out dir>" >&2
  exit 1
}
mkdir -p "$1"
OUT="$(cd "$1" && pwd)"

# shellcheck source=load-run.env
. "$HERE/load-run.env"

export LOAD_IMAGE_PREFIX="${LOAD_IMAGE_PREFIX:-konclui-load}"
export LOAD_IMAGE_TAG="${LOAD_IMAGE_TAG:-$(git -C "$REPO" rev-parse --short=12 HEAD)}"
NETWORK=konclui-load_default
PUBLIC_URL=http://konclui-load.localhost:8094
ROOM_URL="$PUBLIC_URL/~/konclui-office/office.wam"
METRICS_URLS=http://play:9100/metrics,http://back:9101/metrics

# The stack keeps no state and takes no outside traffic: its secrets live for one run.
random_hex() { od -An -tx1 -N24 /dev/urandom | tr -d ' \n'; }
SECRET_KEY="$(random_hex)"
MAP_STORAGE_API_TOKEN="$(random_hex)"
MAP_STORAGE_AUTHENTICATION_TOKEN="$(random_hex)"
export SECRET_KEY MAP_STORAGE_API_TOKEN MAP_STORAGE_AUTHENTICATION_TOKEN

compose() { docker compose -f "$HERE/compose.yaml" "$@"; }

note() { echo "$*" | tee -a "$OUT/run.txt"; }

sampler_pid=""
stop_sampler() {
  if [ -n "$sampler_pid" ]; then
    kill "$sampler_pid" 2>/dev/null || true
    wait "$sampler_pid" 2>/dev/null || true
    sampler_pid=""
  fi
}

stack_down() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}

cleanup() {
  stop_sampler
  stack_down
}
trap cleanup EXIT
trap 'exit 130' INT TERM

build_images() {
  local service start
  for service in back map-storage play; do
    start=$SECONDS
    local -a extra=()
    # The front build takes the heap it is given; the default asks for more than the CI pool allows.
    [ "$service" = play ] && extra=(--build-arg NODE_OPTIONS=--max-old-space-size=6144)
    if ! docker build --progress=plain -t "$LOAD_IMAGE_PREFIX/$service:$LOAD_IMAGE_TAG" -f "$REPO/$service/Dockerfile" \
      ${extra[@]+"${extra[@]}"} "$REPO" >"$OUT/build-$service.log" 2>&1; then
      note "build of $service FAILED, last lines of build-$service.log:"
      tail -40 "$OUT/build-$service.log" >&2
      exit 1
    fi
    note "built $service in $((SECONDS - start))s"
  done
}

# host_load <file> <label>: how busy the machine is, which a run on a shared host needs beside its numbers.
host_load() {
  {
    echo "== $2 $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "nproc $(nproc)"
    echo "loadavg $(cat /proc/loadavg 2>/dev/null || uptime)"
    if [ -r /proc/pressure/cpu ]; then sed 's/^/cpu pressure /' /proc/pressure/cpu; fi
    if [ -r /proc/pressure/memory ]; then sed 's/^/memory pressure /' /proc/pressure/memory; fi
    cgroup_cpu
  } >>"$1"
}

# cgroup_cpu: the CPU limit, the throttling counters and the pressure of the cgroup this run lives in and of every
# cgroup above it, below the root (the root is the machine, already printed). A shared pool caps its jobs as a whole: a
# level that the cap throttled measured the cap, not the servers.
cgroup_cpu() {
  local path name file found=0
  path="/sys/fs/cgroup$(sed -n 's/^0:://p' /proc/self/cgroup 2>/dev/null || true)"
  path=${path%/}
  while [ "$path" != /sys/fs/cgroup ]; do
    name=${path#/sys/fs/cgroup}
    for file in cpu.max cpu.stat cpu.pressure; do
      if [ -r "$path/$file" ]; then
        found=1
        awk -v prefix="cgroup $name $file " \
          '/^(max|[0-9]|nr_periods|nr_throttled|throttled_usec|some)/ { print prefix $0 }' "$path/$file"
      fi
    done
    path=${path%/*}
  done
  [ "$found" = 1 ] || echo "cgroup CPU counters not readable here"
}

# throttled_ms: the longest time any of those cgroups was held back by its CPU limit so far, or "unknown".
throttled_ms() {
  cgroup_cpu | awk '
    $3 == "cpu.stat" && $4 == "throttled_usec" { seen = 1; if ($5 > max) max = $5 }
    END { if (seen) printf "%d", max / 1000; else printf "unknown" }'
}

# stalled_usec: the time some task of the whole machine waited for a CPU so far, or nothing where it is not kept.
stalled_usec() { sed -n 's/^some .*total=//p' /proc/pressure/cpu 2>/dev/null || true; }

# contention <throttled before> <stalled before> <seconds>: what the level shared its CPU with, for its verdict line.
contention() {
  local throttled stalled text
  throttled=$(throttled_ms)
  stalled=$(stalled_usec)
  if [ "$1" = unknown ] || [ "$throttled" = unknown ]; then
    text="cgroup throttling unknown"
  else
    text="cgroup throttled $((throttled - $1))ms"
  fi
  if [ -n "$2" ] && [ -n "$stalled" ] && [ "$3" -gt 0 ]; then
    text="$text, host CPU pressure $(((stalled - $2) / ($3 * 10000)))%"
  fi
  echo "$text"
}

# stack_up <scenario> <dir>: a fresh stack with the flags of the scenario.
stack_up() {
  case "$1" in
  budget-on) export PUSHER_VIEWER_BUDGET_ENABLED=true ;;
  budget-off | profile | calibration) export PUSHER_VIEWER_BUDGET_ENABLED=false ;;
  *)
    note "unknown scenario '$1' (budget-off, budget-on)"
    exit 1
    ;;
  esac
  stack_down
  if ! compose up --detach --wait --wait-timeout 300 >"$2/stack-up.log" 2>&1; then
    note "$1: the stack did not start, last lines of stack-up.log and of the logs:"
    tail -20 "$2/stack-up.log" >&2
    compose logs --no-color --tail 60 >&2 || true
    exit 1
  fi
  # A socket per bot: the limit that counts is the hard one (Node and Go raise the soft limit to it at start).
  {
    echo "open files, hard limit: play $(compose exec -T play sh -c 'ulimit -Hn'), reverse-proxy $(compose exec -T reverse-proxy sh -c 'ulimit -Hn')"
    echo "PUSHER_VIEWER_BUDGET_ENABLED=$PUSHER_VIEWER_BUDGET_ENABLED"
  } >"$2/limits.txt"
}

# in_play_image <network> <mounted out dir> <command...>: runs a command of the benchmark package in the play image,
# on the stack's network ($NETWORK) or on none (a command that only reads and writes files).
in_play_image() {
  local network=$1 mounted=$2
  shift 2
  docker run --rm --label konclui-load.generator=1 --network "$network" --user 0 \
    --volume "$REPO/benchmark:/usr/src/benchmark:ro" --volume "$mounted:/out" \
    --workdir /usr/src/benchmark --entrypoint "$1" "$LOAD_IMAGE_PREFIX/play:$LOAD_IMAGE_TAG" "${@:2}"
}

# run_level <scenario> <repeat> <level> <processes> <ramp> <duration> <window> <profile: 0|1> <generator flags...>
run_level() {
  local scenario=$1 repeat=$2 level=$3 processes=$4 ramp=$5 duration=$6 window=$7 profile=$8
  shift 8
  local dir="$OUT/$scenario/rep$repeat-n$level"
  local work="$OUT/$scenario/.work"
  rm -rf "$dir" "$work"
  mkdir -p "$dir" "$work"

  stack_up "$scenario" "$dir"
  host_load "$dir/host-load.txt" start
  local throttled_before stalled_before started=$SECONDS
  throttled_before=$(throttled_ms)
  stalled_before=$(stalled_usec)
  (
    while :; do
      # The names keep the sample readable; the list is read again each time because containers can restart.
      # shellcheck disable=SC2046  # one argument per container id
      docker stats --no-stream --format "$(date -u +%H:%M:%S) {{.Name}} {{.CPUPerc}} {{.MemUsage}}" \
        $(compose ps --quiet) 2>/dev/null || true
      sleep 5
    done
  ) >"$dir/docker-stats.txt" &
  sampler_pid=$!

  local profiler_pid=""
  if [ "$profile" = 1 ]; then
    # Inside the steady window: it starts a sixth of the window after the window opens and lasts half of it.
    local delay=$((duration - window + window / 6)) seconds=$((window / 2))
    compose exec -T play node /tools/inspector-profile.mjs "$delay" "$seconds" /tmp/pusher-profile.json \
      >"$dir/profiler.txt" 2>&1 &
    profiler_pid=$!
  fi

  local code=0
  in_play_image "$NETWORK" "$work" bash scripts/load-staircase.sh --levels="$level" --processes="$processes" \
    --ramp-seconds="$ramp" --duration-seconds="$duration" --steady-window="$window" --pause-seconds=0 \
    --metrics-urls="$METRICS_URLS" --out-dir=/out \
    -- --pusher-url="$PUBLIC_URL" --ws-url="$PUBLIC_URL" --room-urls="$ROOM_URL" "$@" \
    >"$dir/generator.log" 2>&1 || code=$?

  if [ -n "$profiler_pid" ]; then
    # The profile leaves the container through exec, the way the profiler went in: docker cp fails on the pool's
    # rootless daemon.
    if ! wait "$profiler_pid"; then
      note "$scenario n$level: the profiler failed, see profiler.txt"
    elif ! compose exec -T play cat /tmp/pusher-profile.json >"$dir/pusher-profile.json" 2>>"$dir/profiler.txt"; then
      rm -f "$dir/pusher-profile.json"
      note "$scenario n$level: the profile could not be read out of the container, see profiler.txt"
    else
      in_play_image none "$dir" node scripts/profile-summary.mjs /out/pusher-profile.json \
        flushBatch send encodeBatchFrame handleUserMoved reconcileZones >"$dir/profile-summary.txt" 2>&1 ||
        note "$scenario n$level: the profile summary failed, see profile-summary.txt"
    fi
  fi

  local shared
  shared=$(contention "$throttled_before" "$stalled_before" $((SECONDS - started)))
  stop_sampler
  # A daemon that keeps no cgroup per container reports nothing, or the same figure for every container: the figure of
  # the cgroup they all share. Then the file keeps one line per sample and says what the line is.
  if ! awk '$3 != "0.00%" { found = 1 } END { exit !found }' "$dir/docker-stats.txt"; then
    echo "no CPU per container from this daemon: see serverCpu in merged.json" >"$dir/docker-stats.txt"
  elif awk '{ figure = $3 " " $4; if ($1 == time && figure != last) differ = 1; time = $1; last = figure }
    END { exit differ }' "$dir/docker-stats.txt"; then
    {
      echo "this daemon keeps no cgroup per container: each line is every container of the daemon together"
      echo "(the stack and the generator); the CPU of each server is serverCpu in merged.json"
      awk '$1 != time { print $1, "all containers", $3, $4; time = $1 }' "$dir/docker-stats.txt"
    } >"$dir/docker-stats.tmp"
    mv "$dir/docker-stats.tmp" "$dir/docker-stats.txt"
  fi
  host_load "$dir/host-load.txt" end
  compose logs --no-color play >"$dir/play.log" 2>&1 || true
  compose logs --no-color back >"$dir/back.log" 2>&1 || true
  # The whole logs stay on the runner; their sizes and last lines travel with the results.
  {
    wc -l "$dir/play.log" "$dir/back.log"
    echo "== play, last 40 lines" && tail -40 "$dir/play.log"
    echo "== back, last 40 lines" && tail -40 "$dir/back.log"
  } >"$dir/server-logs-tail.txt" 2>&1 || true
  stack_down

  # load-staircase.sh names its level folder rep1-n<level>: its files move up into this repeat's folder.
  if [ -d "$work/rep1-n$level" ]; then
    mv "$work/rep1-n$level"/* "$dir"/
  fi
  rm -rf "$work"
  local verdict
  # The headline of the merge: "valid accepted=..." or "INVALID ...".
  verdict=$(grep -E '^(valid|INVALID) ' "$dir/generator.log" | tail -1 || true)
  note "$scenario rep$repeat n$level: generator exit $code. ${verdict:-no verdict line, see generator.log} [$shared]"
  # 0 is a valid level and 2 an invalid one: both are measurements. Anything else is a generator that did not run.
  if { [ "$code" != 0 ] && [ "$code" != 2 ]; } || [ -z "$verdict" ]; then
    failed_levels=$((failed_levels + 1))
  fi
}

# summarize <scenario> [staircase flags...]: the staircase of every level folder of the scenario.
summarize() {
  [ -d "$OUT/$1" ] || return 0
  in_play_image none "$OUT/$1" npx --no-install tsx scripts/merge-summaries.ts staircase /out --out=/out/staircase.json \
    --headline "${@:2}" >"$OUT/$1/staircase.txt" 2>&1 || true
  note "== $1"
  tee -a "$OUT/run.txt" <"$OUT/$1/staircase.txt"
}

: >"$OUT/run.txt"
note "commit $(git -C "$REPO" rev-parse HEAD) images $LOAD_IMAGE_PREFIX/*:$LOAD_IMAGE_TAG"
note "levels '$LEVELS' repeat $REPEAT scenarios '$SCENARIOS' processes $PROCESSES ramp ${RAMP_SECONDS}s duration ${DURATION_SECONDS}s window ${STEADY_WINDOW}s"
note "generator flags: $GENERATOR_FLAGS; profile level $PROFILE_LEVEL; calibration level $CALIBRATION_LEVEL"
host_load "$OUT/run.txt" "before the builds"

if [ "${LOAD_SKIP_BUILD:-0}" = 1 ]; then
  note "images not built here (LOAD_SKIP_BUILD=1)"
else
  build_images
fi
docker version --format 'docker server {{.Server.Version}}' 2>/dev/null | tee -a "$OUT/run.txt" || true

# The generator flags and the scenarios are lists of words by design.
read -r -a generator_flags <<<"$GENERATOR_FLAGS"
read -r -a scenarios <<<"$SCENARIOS"
failed_levels=0

if [ "$CALIBRATION_LEVEL" != 0 ]; then
  # The timing of the workstation baseline: 60 s in all, statistics over the whole run (no steady window).
  run_level calibration 1 "$CALIBRATION_LEVEL" 1 20 60 0 0 --move-hz=5
  summarize calibration
fi

# The scenarios of one level run side by side, and the one that goes first alternates from level to level: the load of
# a shared host drifts over the run, and a scenario that always ran later would carry that drift as its own effect.
turn=0
for repeat in $(seq 1 "$REPEAT"); do
  for level in $LEVELS; do
    for position in "${!scenarios[@]}"; do
      index=$position
      [ $((turn % 2)) -eq 1 ] && index=$((${#scenarios[@]} - 1 - position))
      run_level "${scenarios[$index]}" "$repeat" "$level" "$PROCESSES" "$RAMP_SECONDS" "$DURATION_SECONDS" \
        "$STEADY_WINDOW" 0 "${generator_flags[@]}"
    done
    turn=$((turn + 1))
  done
done
for scenario in "${scenarios[@]}"; do
  if [ "$scenario" = budget-on ]; then
    # Under the viewer budget a socket hears its 150 nearest peers at full rate, the next ones once a second and none
    # beyond 400, while the probe of the generator expects every move: delivery is lower by design.
    note "budget-on: delivery and move p95 do not compare with budget-off (the budget drops and slows far peers by design); its knee rests on validity and server CPU"
    summarize "$scenario" --min-delivery=0
  else
    summarize "$scenario"
  fi
done

if [ "$PROFILE_LEVEL" != 0 ]; then
  run_level profile 1 "$PROFILE_LEVEL" "$PROCESSES" "$RAMP_SECONDS" "$DURATION_SECONDS" "$STEADY_WINDOW" 1 \
    "${generator_flags[@]}"
  summarize profile
  [ -f "$OUT/profile/rep1-n$PROFILE_LEVEL/profile-summary.txt" ] &&
    sed -n 1,14p "$OUT/profile/rep1-n$PROFILE_LEVEL/profile-summary.txt" | tee -a "$OUT/run.txt"
fi

host_load "$OUT/run.txt" "after the last level"
if [ "$failed_levels" -gt 0 ]; then
  note "done, but the generator failed on $failed_levels level(s): no measurement there"
  exit 1
fi
note "done"
