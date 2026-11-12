#!/bin/sh
# usage: probe.sh <n> <label> <inner prefix, or "-"> [docker run flags...]
set -u
n=$1
label=$2
prefix=$3
shift 3
[ "$prefix" = "-" ] && prefix=""
jobs_root=$HOME/wa-jobs/wa-fable-20261112
name=wa-fable-cpu4-$n
out=$jobs_root/receipts-cpu-r4/run$n-$label.txt
host_view=$(mktemp)

inner='
echo "## container view (inside $(hostname))"
echo "/proc/self/cgroup:"; cat /proc/self/cgroup
echo "mountinfo cgroup lines:"; grep -E " - cgroup2? " /proc/self/mountinfo
for f in /sys/fs/cgroup/cpu.max /host-cgroup/cpu.max; do [ -e "$f" ] && echo "$f: $(cat "$f")"; done
for d in /sys/fs/cgroup /host-cgroup; do
  for f in "$d"/system.slice/docker-$(hostname)*.scope/cpu.max; do [ -e "$f" ] && echo "$f: $(cat "$f")"; done
done
echo "## unshare attempts"
unshare --cgroup true; echo "unshare --cgroup exit=$?"
unshare --user --map-root-user --cgroup true; echo "unshare --user --map-root-user --cgroup exit=$?"
echo "## probe (prefix: ${PROBE_PREFIX:-none})"
$PROBE_PREFIX npx vitest --config vitest.config.ts --run tests/WaFableCpu4Probe.test.ts
echo "VITEST_EXIT=$?"
'

{
    echo "# run $n: $label"
    echo "# docker run flags: --cpus 0.5 --cpu-shares 512 --memory 1g --network none $*"
    echo "# started $(date -u +%H:%M:%S) UTC"
    sha256sum "$jobs_root/src-cpu/back/src/Services/QuotaAwareCpuTracker.ts"
} > "$out"

(
    for _ in $(seq 100); do
        id=$(docker inspect -f '{{.Id}}' "$name" 2>/dev/null) && break
        sleep 0.2
    done
    {
        echo "## host view"
        echo "container id: $id"
        echo "HostConfig.NanoCpus: $(docker inspect -f '{{.HostConfig.NanoCpus}}' "$name" 2>/dev/null)"
        echo "HostConfig.CgroupnsMode: $(docker inspect -f '{{.HostConfig.CgroupnsMode}}' "$name" 2>/dev/null)"
        f=/sys/fs/cgroup/system.slice/docker-$id.scope/cpu.max
        echo "$f: $(cat "$f" 2>&1)"
        echo "/sys/fs/cgroup/system.slice/cpu.max: $(cat /sys/fs/cgroup/system.slice/cpu.max 2>&1)"
    } > "$host_view"
) &
watcher=$!

docker run --rm --name "$name" --label owner=wa-fable-20261112 \
    --cpus 0.5 --cpu-shares 512 --memory 1g --network none \
    -v "$jobs_root/src-cpu:/work" -w /work/back \
    -e PROBE_PREFIX="$prefix" -e NO_COLOR=1 \
    "$@" node:24-trixie sh -c "$inner" >> "$out" 2>&1
echo "container_exit=$?" >> "$out"
wait "$watcher"
cat "$host_view" >> "$out"
rm -f "$host_view"
echo "# finished $(date -u +%H:%M:%S) UTC" >> "$out"
cat "$out"
