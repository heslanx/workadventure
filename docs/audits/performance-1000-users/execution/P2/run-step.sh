#!/usr/bin/env bash
# Receipt runner used inside the remote container wa-fable-svelte (snapshot mounted at /work).
# usage: run-step.sh <phase> <name> <workspace-dir> <command string>
# Records start/end, exit code and wall duration next to the captured log.
phase="$1"; name="$2"; ws="$3"; cmd="$4"
out="/work/.p2/$phase"; mkdir -p "$out"
cd "/work/$ws" || exit 97
start=$(date -u +%s)
echo "start_utc=$(date -u +%FT%TZ)" > "$out/$name.meta"
bash -c "$cmd" > "$out/$name.log" 2>&1
code=$?
end=$(date -u +%s)
{
  echo "end_utc=$(date -u +%FT%TZ)"
  echo "exit_code=$code"
  echo "duration_s=$((end - start))"
  echo "workspace=$ws"
  echo "command=$cmd"
} >> "$out/$name.meta"
echo "$phase $name exit=$code duration=$((end - start))s"
exit 0
