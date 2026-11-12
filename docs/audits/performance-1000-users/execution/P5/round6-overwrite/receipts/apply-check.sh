#!/bin/bash
# Applies the 12 patches in order with git apply --cached on a temporary index and object directory, the checkout's
# objects as an alternate, so nothing is written to the checkout. Then compares the blobs with the tested final files.
# Usage: apply-check.sh <checkout> <patch dir> <final state dir> <log>
C=$1; O=$2; S=$3; L=$4
T=$(mktemp -d /tmp/wa-p5r6/applycheck.XXXX)
export GIT_INDEX_FILE=$T/index GIT_OBJECT_DIRECTORY=$T/objects GIT_ALTERNATE_OBJECT_DIRECTORIES=$C/.git/objects
mkdir -p $GIT_OBJECT_DIRECTORY
cd $C
echo "checkout HEAD: $(git rev-parse --short HEAD)" > $L
git read-tree HEAD
for p in $(ls $O/*.patch | xargs -n1 basename | sort -n); do
  git apply --cached $O/$p
  echo "git apply --cached $p: exit $?  sha256 $(shasum -a 256 $O/$p | cut -d' ' -f1)" >> $L
done
F="map-storage/src/MapsManager.ts:MapsManager.ts map-storage/src/Upload/UploadController.ts:UploadController.ts map-storage/src/tests/MapsManagerAutosave.test.ts:tests/MapsManagerAutosave.test.ts map-storage/src/tests/UploadController.test.ts:tests/UploadController.test.ts"
for pair in $F; do echo "temp index  $(git ls-files -s ${pair%%:*} | awk '{print $2}')  ${pair%%:*}" >> $L; done
for pair in $F; do echo "tested file $(git hash-object --no-filters $S/${pair##*:})  ${pair%%:*}" >> $L; done
rm -rf $T
