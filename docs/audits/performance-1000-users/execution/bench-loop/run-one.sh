#!/usr/bin/env bash
# One measured run on knc: fresh stack from bench-<variant>, N headless sessions at 1 Hz, steady-window samples, teardown.
# usage: run-one.sh <variant> <sessions> <rooms> <rep> [measure|profile]
set -euo pipefail
J=/root/wa-jobs/wa-fable-20261112
HERE=$J/bench-loop
OUT=$J/bench-out
VARIANT=$1 N=$2 ROOMS=$3 REP=$4 MODE=${5:-measure}
SRC=$J/bench-$VARIANT
RUN=$VARIANT-n$N-r$ROOMS-$REP$([ "$MODE" = profile ] && echo -prof || true)
D=$OUT/$RUN
OWNER=owner=wa-fable-20261112
COMPOSE=(docker compose -f "$HERE/docker-compose.bench.yaml")
mkdir -p "$D"
[ -d "$SRC" ] || { echo "missing $SRC" >&2; exit 2; }
[ -e "$OUT/STOP" ] && { echo "STOP file present" >&2; exit 3; }

load1=$(cut -d' ' -f1 /proc/loadavg)
nontask=$(docker ps --format '{{.Names}}' | grep -vc '^wa-fable-bench-' || true)
printf 'startedAt=%s\nloadavg1=%s\nnonTaskRunning=%s\n' "$(date -u +%FT%TZ)" "$load1" "$nontask" > "$D/host.txt"
if awk -v l="$load1" 'BEGIN{exit !(l > 6)}'; then
  echo "ABORT load average $load1 > 6" | tee -a "$D/host.txt" >&2
  touch "$OUT/STOP"
  exit 3
fi

RAMP=$(( N / 10 > 10 ? N / 10 : 10 ))
SETTLE=10 STEADY=30 TAIL=5
DURATION=$(( RAMP + SETTLE + STEADY + TAIL ))
ROOM_URLS=""
if [ "$ROOMS" = 1 ]; then
  ROOM_URLS=http://wa-fable-bench-play:3000/_/global/wa-fable-bench-maps/starter/map.json
else
  for r in $(seq 1 "$ROOMS"); do
    ROOM_URLS="$ROOM_URLS${ROOM_URLS:+,}http://wa-fable-bench-play:3000/_/room$r/wa-fable-bench-maps/starter/map.json"
  done
fi

cleanup() {
  docker rm -f wa-fable-bench-gen >/dev/null 2>&1 || true
  SRC=$SRC "${COMPOSE[@]}" down --timeout 5 >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

SRC=$SRC BACK_CPUS=${BACK_CPUS:-0.65} "${COMPOSE[@]}" up -d --quiet-pull >/dev/null 2>&1
ready=0
for _ in $(seq 1 90); do
  if docker exec wa-fable-bench-play curl -sf -m 2 http://localhost:3000/ready >/dev/null 2>&1 &&
     docker exec wa-fable-bench-play curl -sf -m 3 http://localhost:3000/ping-backs >/dev/null 2>&1 &&
     docker exec wa-fable-bench-play curl -sf -m 2 http://wa-fable-bench-back:9100/metrics >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "stack not ready" | tee -a "$D/host.txt" >&2; docker logs --tail 40 wa-fable-bench-play > "$D/play.log" 2>&1; docker logs --tail 40 wa-fable-bench-back > "$D/back.log" 2>&1; exit 4; }
echo "readyAt=$(date -u +%FT%TZ)" >> "$D/host.txt"

docker run -d --name wa-fable-bench-gen --label "$OWNER" --cpus "${GEN_CPUS:-1.2}" --cpu-shares 512 --memory 1536m \
  --network wa-fable-bench-net --tmpfs /tmp \
  -v "$J/bench-base:/work:ro" -v "$J/bench-genpkg/benchmark:/work/benchmark:ro" -v "$D:/out" -w /work/benchmark \
  -e WA_PUSHER_URL=http://wa-fable-bench-play:3000 -e WA_WS_URL=ws://wa-fable-bench-play:3001 \
  -e WA_ROOM_URLS="$ROOM_URLS" -e WA_API_VERSION=dev -e WA_OUTPUT=/out/summary.json \
  -e WA_SESSIONS="$N" -e WA_RAMP_SECONDS="$RAMP" -e WA_DURATION_SECONDS="$DURATION" -e WA_MOVE_HZ=1 \
  -e WA_JOIN_TIMEOUT_SECONDS=60 \
  node:24-trixie /work/node_modules/.bin/tsx ./index.ts >/dev/null

sample() {
  local tag=$1
  for c in play back redis maps gen; do
    local id; id=$(docker inspect -f '{{.Id}}' "wa-fable-bench-$c")
    local usage; usage=$(awk '$1=="usage_usec"{print $2}' "/sys/fs/cgroup/system.slice/docker-$id.scope/cpu.stat")
    local thr; thr=$(awk '$1=="nr_throttled"{print $2}' "/sys/fs/cgroup/system.slice/docker-$id.scope/cpu.stat")
    local pid; pid=$(docker inspect -f '{{.State.Pid}}' "wa-fable-bench-$c")
    local tx rx; tx=$(cat "/proc/$pid/net/dev" | awk -F'[: ]+' '/eth0/{print $11}'); rx=$(cat "/proc/$pid/net/dev" | awk -F'[: ]+' '/eth0/{print $3}')
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$tag" "$c" "$(date +%s.%N)" "$usage" "$thr" "$tx" "$rx" >> "$D/cgroup.tsv"
  done
  for c in play back; do
    docker exec wa-fable-bench-play curl -s -m 5 "http://wa-fable-bench-$c:9100/metrics" \
      | grep -E '^(nodejs_eventloop_lag|workadventure_nb_sockets|workadventure_nb_rooms|process_cpu_seconds_total|nodejs_heap_size_used_bytes)' \
      | sed "s/^/$tag\t$c\t/" >> "$D/metrics.tsv" || true
  done
}

sleep $(( RAMP + SETTLE ))
sample steadyStart
if [ "$MODE" = profile ]; then
  for c in play back; do
    docker exec -i -e PROFILE_SECONDS=20 -e PROFILE_OUT=/tmp/$c.cpuprofile "wa-fable-bench-$c" node --input-type=module - < "$HERE/cdp-prof.mjs" > "$D/prof-$c.log" 2>&1 &
  done
  wait
  for c in play back; do docker exec "wa-fable-bench-$c" cat "/tmp/$c.cpuprofile" > "$D/$c.cpuprofile" 2>/dev/null || true; done
  sleep 5
else
  sleep "$STEADY"
fi
sample steadyEnd
echo "steadySeconds=$STEADY rampSeconds=$RAMP durationSeconds=$DURATION" >> "$D/host.txt"

docker wait wa-fable-bench-gen > "$D/gen-exit.txt"
docker logs wa-fable-bench-gen > "$D/gen.log" 2>&1 || true
docker logs --tail 200 wa-fable-bench-play > "$D/play.log" 2>&1 || true
docker logs --tail 200 wa-fable-bench-back > "$D/back.log" 2>&1 || true
echo "loadavgEnd=$(cut -d' ' -f1-3 /proc/loadavg)" >> "$D/host.txt"
echo "done $RUN"
