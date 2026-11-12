#!/bin/sh
# Formats the staged tracker and test file with the tree's prettier. The files are bind-mounted over the tree paths, so the tree is not written.
set -u
jobs_root=$HOME/wa-jobs/wa-fable-20261112
stage=$jobs_root/receipts-cpu-r6/stage
docker run --rm --name wa-fable-cpu6-fmt --label owner=wa-fable-20261112 \
    --cpus 0.5 --cpu-shares 512 --memory 1g --network none \
    -v "$jobs_root/src-cpu:/work" -w /work/back -e NO_COLOR=1 \
    -v "$stage/CpuTracker.final.test.ts:/work/back/tests/CpuTracker.test.ts" \
    -v "$stage/QuotaAwareCpuTracker.fix.ts:/work/back/src/Services/QuotaAwareCpuTracker.ts" \
    node:24-trixie sh -c "npx prettier --write tests/CpuTracker.test.ts src/Services/QuotaAwareCpuTracker.ts"
echo "container_exit=$?"
