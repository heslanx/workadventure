#!/usr/bin/env bash
# Reads the results of a load run back from its job log (print-results.sh wrote them there) into a folder.
#
#   benchmark/ci/fetch-results.sh <run id> <dir> [owner/repo]
#
# Needs the gh CLI, signed in to an account that can read the repository.
set -euo pipefail
[ $# -ge 2 ] || {
  echo "usage: benchmark/ci/fetch-results.sh <run id> <dir> [owner/repo]" >&2
  exit 1
}
run=$1
dir=$2
repo=${3:-konclui/workadventure}
mkdir -p "$dir"
# Every log line is "<job>\t<step>\t<timestamp> <text>": the block's lines are the text between the two markers.
gh run view "$run" --repo "$repo" --log |
  awk -F'\t' '
    /-----END KONCLUI LOAD RESULTS-----/ { inside = 0 }
    inside { line = $NF; sub(/^[^ ]+ /, "", line); printf "%s", line }
    /-----BEGIN KONCLUI LOAD RESULTS-----/ { inside = 1 }
  ' >"$dir/.results.b64"
[ -s "$dir/.results.b64" ] || {
  echo "fetch-results: no results block in the log of run $run" >&2
  rm -f "$dir/.results.b64"
  exit 2
}
base64 --decode <"$dir/.results.b64" | tar -xzf - -C "$dir"
rm -f "$dir/.results.b64"
echo "results of run $run are in $dir"
