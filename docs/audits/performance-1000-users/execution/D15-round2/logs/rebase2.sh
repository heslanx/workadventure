set -u
cd /work
FILES=$(grep "^diff --git" patches/phaser+4.2.0.patch | sed "s|^diff --git a/\(\S*\) .*|\1|")
for f in $FILES; do mkdir -p /tmp/r/a/$(dirname $f) /tmp/r/b/$(dirname $f); cp /work/$f /tmp/r/a/$f; cp /work/$f /tmp/r/b/$f; done
cd /tmp/r/a && patch -R -p1 --no-backup-if-mismatch < /work/patches/phaser+4.2.0.patch > /dev/null; echo REVERSE_TO_PRISTINE_EXIT=$?
cd /tmp/r; : > /work/patches/phaser+4.2.1.patch
for f in $FILES; do git diff --no-index --no-color a/$f b/$f | sed "1s|^diff --git a/a/|diff --git a/|; 1s| b/b/| b/|; s|^--- a/a/|--- a/|; s|^+++ b/b/|+++ b/|" >> /work/patches/phaser+4.2.1.patch; done
cd /work; echo HUNKS=$(grep -c "^@@" patches/phaser+4.2.1.patch) FILES=$(grep -c "^diff --git" patches/phaser+4.2.1.patch) LINES=$(wc -l < patches/phaser+4.2.1.patch)
cd /tmp/r/a && git apply --check --verbose /work/patches/phaser+4.2.1.patch 2>&1 | grep -ci "offset\|fuzz"; git apply --check /work/patches/phaser+4.2.1.patch; echo REBASED_CHECK_ON_PRISTINE_EXIT=$?
diff <(grep "^[+-]" /work/patches/phaser+4.2.0.patch | grep -v "^+++\|^---") <(grep "^[+-]" /work/patches/phaser+4.2.1.patch | grep -v "^+++\|^---") > /dev/null; echo BODY_DIFF_EXIT=$?
