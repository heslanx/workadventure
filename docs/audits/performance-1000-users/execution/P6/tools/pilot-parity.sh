#!/usr/bin/env bash
# Run the existing gate (tsc6) and the pilot (native tsc) through the package
# scripts for back and map-storage: once on the clean tree and once with a
# temporary fixture that contains one intentional type error. The fixture is
# removed before the script exits.
# usage: pilot-parity.sh <phase>
set -u
PHASE=$1
M=/tmp/wa-meas
R=$M/$PHASE.jsonl
L=$M/logs

run() {
  local label=$1 dir=$2
  shift 2
  (cd "/work/$dir" && python3 "$M/measure.py" "$PHASE:$label" "$R" "$L/$PHASE-$label.log" -- "$@") >/dev/null
  echo "$label exit=$? log_lines=$(wc -l <"$L/$PHASE-$label.log")"
}

for ws in back map-storage; do
  fixture=/work/$ws/src/p6-pilot-fixture.ts
  run "$ws-clean-ts6" "$ws" npm run -s typecheck -- --pretty false
  run "$ws-clean-native" "$ws" npm run -s typecheck:native -- --pretty false
  printf 'export const p6PilotFixture: number = "not a number";\n' >"$fixture"
  run "$ws-fixture-ts6" "$ws" npm run -s typecheck -- --pretty false
  run "$ws-fixture-native" "$ws" npm run -s typecheck:native -- --pretty false
  rm -f "$fixture"
  echo "$ws fixture removed: $([ -e "$fixture" ] && echo no || echo yes)"
  for kind in clean fixture; do
    if diff <(sort "$L/$PHASE-$ws-$kind-ts6.log") <(sort "$L/$PHASE-$ws-$kind-native.log") >"$L/$PHASE-$ws-$kind.diff"; then
      echo "$ws $kind diagnostics: IDENTICAL"
    else
      echo "$ws $kind diagnostics: DIFFERENT (see $PHASE-$ws-$kind.diff)"
    fi
  done
  echo "--- $ws fixture ts6:"
  cut -c1-300 "$L/$PHASE-$ws-fixture-ts6.log"
  echo "--- $ws fixture native:"
  cut -c1-300 "$L/$PHASE-$ws-fixture-native.log"
done
