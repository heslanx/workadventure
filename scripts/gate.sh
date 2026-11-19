#!/usr/bin/env bash
# Runs the checks of one package side by side and prints each exit code and duration.
#
#   scripts/gate.sh play [base-ref]
#   scripts/gate.sh back [base-ref]
#
# Lint and format run on the .ts and .svelte files changed since base-ref (default HEAD), untracked files included.
# Type checks and tests always cover the whole package. Logs go to <git-dir>/gate-logs/<package>/<step>.log.
# One gate runs at a time on the machine: a second one waits for the first (GATE_LOCK_WAIT_S, default 1800).
# GATE_SERIAL=1 runs the steps one after the other, to compare timings.
# Test files that fail beside the other steps run once more alone; those that pass then are listed as flaky.

set -u

package=${1:-}
base=${2:-HEAD}
case "$package" in
play | back) ;;
*)
    echo "usage: scripts/gate.sh play|back [base-ref]" >&2
    exit 64
    ;;
esac

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root" || exit 1
log_dir=$(git rev-parse --absolute-git-dir)/gate-logs/$package
mkdir -p "$log_dir"
rm -f "$log_dir"/*.log "$log_dir"/*.result

lock=${TMPDIR:-/tmp}/workadventure-gate.lock
lock_wait=${GATE_LOCK_WAIT_S:-1800}
waited=0
until mkdir "$lock" 2>/dev/null; do
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
        rm -rf "$lock"
        continue
    fi
    if [ "$waited" -ge "$lock_wait" ]; then
        echo "gate: another gate (pid ${holder:-unknown}) still holds $lock after ${lock_wait}s" >&2
        exit 75
    fi
    [ "$waited" -eq 0 ] && echo "gate: waiting for the gate of pid ${holder:-unknown}"
    sleep 5
    waited=$((waited + 5))
done
echo $$ >"$lock/pid"
trap 'rm -rf "$lock"' EXIT
trap 'exit 130' INT TERM

changed=()
while IFS= read -r file; do
    case "$file" in
    *.ts | *.svelte) [ -f "$file" ] && changed+=("${file#"$package"/}") ;;
    esac
done < <(
    git diff --name-only --diff-filter=d "$base" -- "$package"
    git ls-files --others --exclude-standard -- "$package"
)

export PLAY_URL=${PLAY_URL:-http://play.workadventure.localhost}
export ADMIN_URL=${ADMIN_URL:-}

# step <name> <command...>: runs the command in the package, records its exit code and duration.
step() {
    local name=$1
    shift
    local start=$SECONDS
    (cd "$root/$package" && "$@") >"$log_dir/$name.log" 2>&1
    echo "$? $((SECONDS - start))" >"$log_dir/$name.result"
}

names=()
pids=()
launch() {
    names+=("$1")
    if [ "${GATE_SERIAL:-0}" = 1 ]; then
        step "$@"
    else
        step "$@" &
        pids+=($!)
    fi
}

started=$SECONDS
if [ "$package" = play ]; then
    # The generated i18n types feed the type checks, so they come first.
    names+=(i18n)
    step i18n sh -c "npm run typesafe-i18n && npm run i18n:check"
    launch typecheck npm run typecheck
    launch svelte-check npm run svelte-check
else
    launch typecheck npx tsc --noEmit
    launch lint npm run lint
fi
if [ "${#changed[@]}" -gt 0 ]; then
    launch eslint npx eslint "${changed[@]}"
    launch prettier npx prettier --check "${changed[@]}"
fi
launch vitest npx vitest run
[ "${#pids[@]}" -gt 0 ] && wait "${pids[@]}"

# A test that measures real time can fail only because the other steps took the CPU. The failed files run once more,
# alone: a file that passes then is reported as flaky, not hidden, and a file that fails again fails the gate.
flaky=()
read -r vitest_code _ <"$log_dir/vitest.result"
if [ "$vitest_code" != 0 ] && [ "${GATE_SERIAL:-0}" != 1 ]; then
    while IFS= read -r file; do
        flaky+=("$file")
    done < <(sed -n 's/^ *FAIL  *\([^ ]*\).*/\1/p' "$log_dir/vitest.log" | sort -u)
    if [ "${#flaky[@]}" -gt 0 ]; then
        cp "$log_dir/vitest.log" "$log_dir/vitest-first.log"
        names+=(vitest-alone)
        step vitest-alone npx vitest run "${flaky[@]}"
        read -r alone_code _ <"$log_dir/vitest-alone.result"
        [ "$alone_code" = 0 ] || flaky=()
    fi
fi

failed=0
for name in "${names[@]}"; do
    read -r code seconds <"$log_dir/$name.result"
    note=
    if [ "$name" = vitest ] && [ "${#flaky[@]}" -gt 0 ]; then
        note=" (not counted: the failed files passed alone)"
    elif [ "$code" != 0 ]; then
        failed=1
    fi
    printf '%-13s exit=%s %ss%s\n' "$name" "$code" "$seconds" "$note"
done
grep -hE '^ *(Test Files|Tests) ' "$log_dir/vitest.log" | tail -2
[ "${#flaky[@]}" -gt 0 ] && echo "FLAKY under load (failed beside the other steps, passed alone): ${flaky[*]}"
echo "gate $package: $([ "$failed" = 0 ] && echo PASS || echo FAIL) in $((SECONDS - started))s, ${#changed[@]} changed files linted, logs in $log_dir"
exit "$failed"
