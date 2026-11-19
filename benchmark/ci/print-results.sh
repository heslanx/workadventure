#!/usr/bin/env bash
# Prints the results of a load run into the job log as one base64 block, for fetch-results.sh to read back.
#
#   benchmark/ci/print-results.sh <out dir of run-load.sh>
#
# The whole server logs and the build logs are left out: they can be large, and their last lines are already in
# server-logs-tail.txt and in the job's own output.
set -euo pipefail
[ $# -eq 1 ] || {
  echo "usage: benchmark/ci/print-results.sh <out dir>" >&2
  exit 1
}
if [ ! -d "$1" ]; then
  echo "no results: $1 does not exist (the run stopped before its first step)"
  exit 0
fi
cd "$1"
echo "-----BEGIN KONCLUI LOAD RESULTS-----"
tar -czf - --exclude='play.log' --exclude='back.log' --exclude='build-*.log' . | base64 | tr -d '\n' | fold -w 120
echo
echo "-----END KONCLUI LOAD RESULTS-----"
