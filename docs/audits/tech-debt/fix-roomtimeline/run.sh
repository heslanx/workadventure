#!/usr/bin/env bash
# usage: run.sh <suffix> <stage dir under v/ | head> <heap-mb> <command run in /work/play>
# Mounts src-review read-only at /work, v/<stage> read-only over the Room directory, and writes
# logs/<suffix>.log (ANSI stripped) ending with "EXIT <code>".
set -u
JOB=/srv/ci-jobs/wa-fable-20261112/fixrt
SRC=/srv/ci-jobs/wa-fable-20261112/src-review
ROOM=play/src/front/Chat/Components/Room
suffix=$1; stage=$2; heap=$3; shift 3
mkdir -p "$JOB/logs"
while :; do
  load=$(cut -d' ' -f1 /proc/loadavg)
  if awk -v l="$load" 'BEGIN{exit !(l>24)}'; then echo "load $load > 24, waiting" >&2; sleep 30; else break; fi
done
mounts=()
[ "$stage" != head ] && mounts=(-v "$JOB/v/$stage:/work/$ROOM:ro")
log="$JOB/logs/$suffix.log"
{
  echo "=== $suffix stage=$stage loadavg=$(cat /proc/loadavg) $(date -u +%FT%TZ)"
  echo "=== cmd: $*"
  docker run --rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none \
    --label ci-job=wa-fable-20261112 --name "wa-fable-fixrt-$suffix" \
    -v "$SRC:/work:ro" -v "$JOB/nm-play:/work/play/node_modules:ro" "${mounts[@]}" \
    --tmpfs /work/play/node_modules/.vite --tmpfs /work/play/node_modules/.vite-temp \
    -e NODE_OPTIONS="--max-old-space-size=$heap" -e CI=1 -e FORCE_COLOR=0 -e NO_COLOR=1 \
    -w /work/play node:24-trixie bash -c "(cd /work/$ROOM && sha256sum RoomTimeline.svelte RoomTimelineRenderItems.ts RoomTimelineCharacterization.test.ts RoomTimelineRowReuse.test.ts RoomTimelineRenderItems.test.ts RoomTimelineNewMessages.test.ts); $*" 2>&1
  echo "EXIT $?"
} | sed -r 's/\x1b\[[0-9;?]*[A-Za-z]//g' > "$log"
tail -n "${TAILN:-30}" "$log"
