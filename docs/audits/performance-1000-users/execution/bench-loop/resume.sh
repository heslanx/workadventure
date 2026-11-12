#!/usr/bin/env bash
# Resumes a halted matrix only once the 1-minute load average is below 6 on two samples 10 s apart (waits at most WAIT_S).
# Aborted run directories move to bench-out/aborted/ (kept as evidence) so the matrix re-attempts them.
set -uo pipefail
J=/root/wa-jobs/wa-fable-20261112
OUT=$J/bench-out
WAIT_S=${WAIT_S:-600}
pgrep -f "bash matrix.sh" >/dev/null && { echo "matrix already running"; exit 1; }
deadline=$(( $(date +%s) + WAIT_S ))
while :; do
  a=$(cut -d' ' -f1 /proc/loadavg); sleep 10; b=$(cut -d' ' -f1 /proc/loadavg)
  echo "$(date -u +%T) load $a $b"
  awk -v a="$a" -v b="$b" 'BEGIN{exit !(a < 6 && b < 6)}' && break
  [ "$(date +%s)" -ge "$deadline" ] && { echo "load stayed >= 6 for ${WAIT_S}s, not resuming"; exit 3; }
done
mkdir -p "$OUT/aborted"
for d in "$OUT"/*/; do
  d=${d%/}; [ "$(basename "$d")" = aborted ] && continue
  if grep -q '^ABORT' "$d/host.txt" 2>/dev/null; then mv "$d" "$OUT/aborted/$(basename "$d")-$(date -u +%H%M%S)"; fi
done
rm -f "$OUT/STOP"
cd "$J/bench-loop" && nohup bash matrix.sh plan.txt >> "$OUT/matrix.log" 2>&1 < /dev/null &
echo "resumed $(date -u +%T)"
