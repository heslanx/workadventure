#!/usr/bin/env bash
set -u -o pipefail
TASK_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$TASK_ROOT"
mkdir -p out/logs
cp source-manifest.json out/source-manifest.json
export PYTHONDONTWRITEBYTECODE=1
export PYTHONUNBUFFERED=1
export OPENBLAS_NUM_THREADS=1
export OMP_NUM_THREADS=1
export MKL_NUM_THREADS=1
export NUMEXPR_NUM_THREADS=1
PYTHON=python3
CREATED_VENV=0
cleanup() {
    if [ "$CREATED_VENV" -eq 1 ]; then rm -rf -- "$TASK_ROOT/.asset-venv"; fi
}
trap cleanup EXIT
step() {
    local name=$1
    shift
    "$@" > "out/logs/$name.log" 2>&1
    LAST_STATUS=$?
    printf '%s\t%s\n' "$name" "$LAST_STATUS" >> out/status.tsv
    echo "$name exit=$LAST_STATUS"
}
step input-hashes "$PYTHON" -B job/offload-assets-check.py inputs
if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
step host-preflight "$PYTHON" -B job/offload-assets-check.py versions
if [ "$LAST_STATUS" -ne 0 ]; then
    if [ -e .asset-venv ]; then echo 'Refusing an existing task venv' >&2; exit 1; fi
    CREATED_VENV=1
    step task-venv "$PYTHON" -m venv .asset-venv
    if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
    PYTHON="$TASK_ROOT/.asset-venv/bin/python"
    step locked-python-dependencies timeout 120 "$PYTHON" -m pip install --disable-pip-version-check --no-input --no-cache-dir --only-binary=:all: numpy==2.5.3 Pillow==12.3.0
    if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
fi
step effective-toolchain "$PYTHON" -B job/offload-assets-check.py versions
if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
cp out/logs/effective-toolchain.log out/toolchain.json
step whiteboard-isolation "$PYTHON" -B job/offload-assets-check.py whiteboards
if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
COMPLETE=0
if command -v rsvg-convert >/dev/null 2>&1; then
    step rsvg-preflight rsvg-convert --version
    if [ "$LAST_STATUS" -eq 0 ]; then
        step all-assets timeout 360 "$PYTHON" -B tools/build-konclui-assets.py
        if [ "$LAST_STATUS" -eq 0 ]; then COMPLETE=1; fi
    fi
else
    printf 'map-build\tBLOCKED: rsvg-convert unavailable; no installation attempted\n' >> out/status.tsv
fi
if [ "$COMPLETE" -ne 1 ]; then
    step character-assets timeout 80 "$PYTHON" -B tools/build-konclui-assets.py --only characters
    if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
fi
step frozen-inputs-after-build "$PYTHON" -B job/offload-assets-check.py inputs
if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
step verified-output "$PYTHON" -B job/offload-assets-check.py outputs
if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
if [ "$COMPLETE" -eq 1 ]; then
    cp .local/konclui/asset-build/all-receipt.json out/all-receipt.json
    step output-archive timeout 30 tar -czf out/asset-build.tgz -C .local/konclui/asset-build maps resources catalogues review all-receipt.json .konclui-asset-build
else
    cp .local/konclui/asset-build/characters-receipt.json out/characters-receipt.json
    step output-archive timeout 30 tar -czf out/characters.tgz -C .local/konclui/asset-build resources catalogues characters-receipt.json .konclui-asset-build
fi
if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
sha256sum out/*.tgz > out/archive-sha256.txt
if [ "$COMPLETE" -eq 1 ]; then exit 0; else exit 2; fi
