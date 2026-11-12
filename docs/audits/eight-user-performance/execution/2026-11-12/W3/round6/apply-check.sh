#!/bin/sh
# usage: apply-check.sh   (run from the checkout root)
# Applies the round 3, 4, 5 and 6 patches in order to a temporary index built from HEAD. The index and the object
# directory live in a mktemp directory under /tmp, and the checkout's objects are an alternate, so the checkout is not
# written.
set -u
W=docs/audits/eight-user-performance/execution/2026-11-12/W3
T=$(mktemp -d /tmp/wa-cpu6-apply.XXXXXX)
mkdir "$T/objects"
export GIT_OPTIONAL_LOCKS=0 GIT_INDEX_FILE="$T/index" GIT_OBJECT_DIRECTORY="$T/objects"
export GIT_ALTERNATE_OBJECT_DIRECTORIES="$(cd "$(git rev-parse --git-common-dir)" && pwd)/objects"
echo "HEAD $(git rev-parse HEAD)"
git read-tree HEAD || exit 1
echo "round 6 on HEAD alone (expected to fail, it is stacked):"
git apply --cached --check "$W/round6/cpu-ascent-paths.patch" > "$T/stacked.out" 2>&1
echo "exit=$?"
head -2 "$T/stacked.out"
echo "round 6 on the round 3 + round 4 state, without round 5 (expected to fail):"
git apply --cached "$W/round3/cpu-quota-ancestors.patch" && git apply --cached "$W/round4/namespace-evidence.test.patch" &&
    git apply --cached --check "$W/round6/cpu-ascent-paths.patch" > "$T/skip5.out" 2>&1
echo "exit=$?"
head -2 "$T/skip5.out"
git read-tree HEAD
for patch in round3/cpu-quota-ancestors.patch round4/namespace-evidence.test.patch round5/cpu-mount-ancestry.patch round6/cpu-ascent-paths.patch; do
    git apply --cached --check "$W/$patch"; echo "check $patch exit=$?"
    git apply --cached "$W/$patch"; echo "apply $patch exit=$?"
done
echo "round 6 blobs after the full stack (expected 5c1f03fd5969... and 9955ded57f90...):"
git ls-files -s -- back/src/Services/QuotaAwareCpuTracker.ts back/tests/CpuTracker.test.ts
echo "pin-tests patch on the round 3 + 4 + 5 state, rebuilt:"
git read-tree HEAD
for patch in round3/cpu-quota-ancestors.patch round4/namespace-evidence.test.patch round5/cpu-mount-ancestry.patch; do git apply --cached "$W/$patch"; done
git apply --cached --check "$W/round6/cpu-ascent-paths.pin-tests.patch"; echo "check cpu-ascent-paths.pin-tests.patch exit=$?"
git apply --cached "$W/round6/cpu-ascent-paths.pin-tests.patch"
echo "test blob after the pin-tests patch (expected 9955ded57f90...):"
git ls-files -s -- back/tests/CpuTracker.test.ts
rm -rf "$T"
