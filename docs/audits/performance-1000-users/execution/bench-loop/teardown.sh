#!/usr/bin/env bash
# Removes this loop's containers and network on knc, by name only: other agents' containers also carry owner=wa-fable-20261112.
# Run on knc after the matrix has stopped. Prints what remains (expected: nothing).
set -uo pipefail
pkill -f "bash matrix.sh plan.txt" || true
pkill -f "bash resume.sh" || true
ids=$(docker ps -aq --filter 'name=^wa-fable-bench-')
[ -n "$ids" ] && docker rm -f $ids >/dev/null
docker network rm wa-fable-bench-net >/dev/null 2>&1 || true
echo "containers left: $(docker ps -aq --filter 'name=^wa-fable-bench-' | wc -l)"
echo "networks left: $(docker network ls -q --filter 'name=^wa-fable-bench-' | wc -l)"
