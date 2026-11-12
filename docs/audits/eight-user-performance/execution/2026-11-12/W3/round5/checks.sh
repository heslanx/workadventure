#!/bin/sh
# usage: checks.sh <n> <label> <cpus> <tracker override or "-"> <test file in stage> <command...>
set -u
n=$1; label=$2; cpus=$3; src=$4; tst=$5; shift 5
jobs_root=$HOME/wa-jobs/wa-fable-20261112
stage=$jobs_root/receipts-cpu-r5/stage
out=$jobs_root/receipts-cpu-r5/run$n-$label.txt
override=""
[ "$src" != "-" ] && override="-v $stage/$src:/work/back/src/Services/QuotaAwareCpuTracker.ts:ro"
{
    echo "# run $n: $label (--cpus $cpus)"
    echo "# tracker override: $src; test file: $tst"
    echo "# started $(date -u +%H:%M:%S) UTC"
    echo "# command: $*"
    sha256sum "$stage/$tst" "$jobs_root/src-cpu/back/src/Services/QuotaAwareCpuTracker.ts"
    [ "$src" != "-" ] && sha256sum "$stage/$src"
} > "$out"
docker run --rm --name "wa-fable-cpu5-$n" --label owner=wa-fable-20261112 \
    --cpus "$cpus" --cpu-shares 512 --memory 1g --network none \
    -v "$jobs_root/src-cpu:/work" -w /work/back -e NO_COLOR=1 \
    -v "$stage/$tst:/work/back/tests/CpuTracker.test.ts:ro" \
    -v "$stage/CommunicationTypes.head.ts:/work/back/src/Model/Types/CommunicationTypes.ts:ro" \
    -v "$stage/Capabilities.head.ts:/work/back/src/Services/Capabilities.ts:ro" \
    -v /dev/null:/work/back/src/Model/Websocket/Identificable.ts:ro \
    -v /dev/null:/work/back/src/Services/Logger.ts:ro \
    $override node:24-trixie sh -c "$*" >> "$out" 2>&1
echo "container_exit=$?" >> "$out"
echo "# finished $(date -u +%H:%M:%S) UTC" >> "$out"
