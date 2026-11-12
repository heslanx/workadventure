#!/usr/bin/env bash
# usage: run.sh <suffix> <dir[:rw][,dir[:rw]...]|-> <heap-mb> <command...>
# Mounts src-review read-only at /work, every file under <stage-dir> read-only over /work/<same path>,
# runs <command> in /work/play, and writes logs/<suffix>.log (ANSI stripped) ending with "EXIT <code>".
set -u
JOB=/srv/ci-jobs/wa-fable-20261112/fixmd
SRC=/srv/ci-jobs/wa-fable-20261112/src-review
suffix=$1; stage=$2; heap=$3; shift 3
mkdir -p "$JOB/logs"
while :; do
  load=$(cut -d' ' -f1 /proc/loadavg)
  if awk -v l="$load" 'BEGIN{exit !(l>24)}'; then echo "load $load > 24, waiting" >&2; sleep 30; else break; fi
done
mounts=()
hashes=""
if [ "$stage" != "-" ]; then
  IFS=, read -ra specs <<< "$stage"
  for spec in "${specs[@]}"; do
    dir=${spec%%:*}; mode=ro
    [ "$spec" != "$dir" ] && mode=${spec#*:}
    while IFS= read -r f; do
      rel=${f#"$JOB/$dir/"}
      mounts+=(-v "$f:/work/$rel:$mode")
      hashes="$hashes /work/$rel"
    done < <(find "$JOB/$dir" -type f | sort)
  done
fi
log="$JOB/logs/$suffix.log"
{
  echo "=== $suffix stage=$stage load=$load $(date -u +%FT%TZ)"
  echo "=== cmd: $*"
  docker run --rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none \
    --label ci-job=wa-fable-20261112 --name "wa-fable-fixmd-$suffix" \
    -v "$SRC:/work:ro" -v "$JOB/nm-play:/work/play/node_modules:ro" "${mounts[@]}" \
    --tmpfs /work/play/node_modules/.vite --tmpfs /work/play/node_modules/.vite-temp \
    -e NODE_OPTIONS="--max-old-space-size=$heap" -e CI=1 -e FORCE_COLOR=0 -e NO_COLOR=1 \
    -w /work/play node:24-trixie bash -c "sha256sum $hashes /dev/null | grep -v /dev/null; $*" 2>&1
  echo "EXIT $?"
} | sed -r 's/\x1b\[[0-9;?]*[A-Za-z]//g' > "$log"
tail -n 40 "$log"
