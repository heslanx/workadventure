#!/bin/sh
# usage: apply-check.sh   (run from the checkout root)
# Applies the round 3 to 7 patches in order to a temporary index built from HEAD. The index and the object directory
# live in a mktemp directory under /tmp, and the checkout's objects are an alternate, so the checkout is not written.
set -u
W=docs/audits/eight-user-performance/execution/2026-11-12/W3
T=$(mktemp -d /tmp/wa-cpu7-apply.XXXXXX)
mkdir "$T/objects"
export GIT_OPTIONAL_LOCKS=0 GIT_INDEX_FILE="$T/index" GIT_OBJECT_DIRECTORY="$T/objects"
export GIT_ALTERNATE_OBJECT_DIRECTORIES="$(cd "$(git rev-parse --git-common-dir)" && pwd)/objects"
echo "HEAD $(git rev-parse HEAD)"
git read-tree HEAD || exit 1
echo "round 7 on HEAD alone (expected to fail, it is stacked):"
git apply --cached --check "$W/round7/cpu-all-mounts.patch" > "$T/stacked.out" 2>&1
echo "exit=$?"
head -2 "$T/stacked.out"
echo "round 7 on the round 3 to 5 state, without round 6 (expected to fail):"
for patch in round3/cpu-quota-ancestors.patch round4/namespace-evidence.test.patch round5/cpu-mount-ancestry.patch; do
    git apply --cached "$W/$patch" || exit 1
done
git apply --cached --check "$W/round7/cpu-all-mounts.patch" > "$T/skip6.out" 2>&1
echo "exit=$?"
head -2 "$T/skip6.out"
git read-tree HEAD
for patch in round3/cpu-quota-ancestors.patch round4/namespace-evidence.test.patch round5/cpu-mount-ancestry.patch round6/cpu-ascent-paths.patch round7/cpu-all-mounts.patch; do
    git apply --cached --check "$W/$patch"; echo "check $patch exit=$?"
    git apply --cached "$W/$patch"; echo "apply $patch exit=$?"
done
echo "round 7 blobs after the full stack (expected 84680d75d... and 877ec1104...):"
git ls-files -s -- back/src/Services/QuotaAwareCpuTracker.ts back/tests/CpuTracker.test.ts
echo "pin-tests patch on the round 3 to 6 state, rebuilt:"
git read-tree HEAD
for patch in round3/cpu-quota-ancestors.patch round4/namespace-evidence.test.patch round5/cpu-mount-ancestry.patch round6/cpu-ascent-paths.patch; do
    git apply --cached "$W/$patch" || exit 1
done
git apply --cached --check "$W/round7/cpu-all-mounts.pin-tests.patch"; echo "check cpu-all-mounts.pin-tests.patch exit=$?"
git apply --cached "$W/round7/cpu-all-mounts.pin-tests.patch"
echo "test blob after the pin-tests patch (expected 877ec1104...), tracker blob unchanged (expected 5c1f03fd5...):"
git ls-files -s -- back/tests/CpuTracker.test.ts back/src/Services/QuotaAwareCpuTracker.ts
rm -rf "$T"
