set -u
mkdir -p /tmp/p && cd /tmp/p && npm pack phaser@4.2.1 --offline --silent >/dev/null && tar xzf phaser-4.2.1.tgz; echo PACK_EXIT=$?
mkdir -p /tmp/r/a/node_modules /tmp/r/b/node_modules/phaser
mv /tmp/p/package /tmp/r/a/node_modules/phaser
cd /work
FILES=$(grep "^diff --git" patches/phaser+4.2.0.patch | sed "s|^diff --git a/\(\S*\) .*|\1|")
for f in $FILES; do mkdir -p /tmp/r/b/$(dirname $f); cp /work/$f /tmp/r/b/$f; done
cd /tmp/r; : > /work/patches/phaser+4.2.1.patch
for f in $FILES; do git diff --no-index --no-prefix --no-color a/$f b/$f | sed "1s|^diff --git a/a/|diff --git a/|; 1s| b/b/| b/|; s|^--- a/a/|--- a/|; s|^+++ b/b/|+++ b/|" >> /work/patches/phaser+4.2.1.patch; done
cd /work; grep -c "^@@" patches/phaser+4.2.1.patch; grep -c "^diff --git" patches/phaser+4.2.1.patch
cd /tmp/r/a && git apply -p1 --check --verbose /work/patches/phaser+4.2.1.patch 2>&1 | grep -ci offset; cd /tmp/r/a && git apply --check /work/patches/phaser+4.2.1.patch; echo REBASED_CHECK_ON_PRISTINE_EXIT=$?
