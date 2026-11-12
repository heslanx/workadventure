#!/usr/bin/env bash
# Read-only upstream duplicate recheck against workadventure/workadventure. No writes to GitHub.
# Usage: bash upstream-search.sh > upstream-search-raw.txt
REPO=workadventure/workadventure
echo "# date_checked_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
q() { # kind query
  local kind=$1; shift
  local query="$*"
  echo "## $kind | state=open | query: $query"
  if [ "$kind" = pr ]; then
    gh pr list --repo "$REPO" --state open --limit 40 --search "$query" \
      --json number,title,author,updatedAt,isDraft \
      --jq '.[] | "#\(.number)\t\(if .isDraft then "draft" else "ready" end)\t\(.updatedAt)\t\(.author.login)\t\(.title)"'
  else
    gh issue list --repo "$REPO" --state open --limit 40 --search "$query" \
      --json number,title,author,updatedAt \
      --jq '.[] | "#\(.number)\t\(.updatedAt)\t\(.author.login)\t\(.title)"'
  fi
  echo "exit=$?"
}
for query in \
  "benchmark" "load test" "load generator" "headless" "artillery" \
  "svelte in:title" "svelte 5" \
  "typescript in:title" "tsgo" "typescript-go" "native-preview" "TypeScript 6" "TypeScript 7" \
  "PositionDispatcher" "viewport zone" "zone pusher" "reconcile" \
  "MapsManager" "autosave" "map-storage save" "map-storage in:title" \
  "NoncedMessageStore" "resume replay" "backpressure"
do
  q pr "$query"
  q issue "$query"
done
