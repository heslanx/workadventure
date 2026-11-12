#!/usr/bin/env bash
# HTTP readiness checks for the wa-fable stack. Runs inside a throwaway container on wa-fable-net.
# Prints status codes, sizes and timings only. The anonymous login body is never printed.
set -u
fail=0
check() {
    local label="$1" expected="$2"
    shift 2
    local out code
    out=$(curl -sS -o /tmp/body -w '%{http_code} time_total=%{time_total}s size=%{size_download}B' --max-time 15 "$@" 2>&1)
    code=${out%% *}
    echo "$label -> $out"
    if [ "$code" != "$expected" ]; then
        echo "  UNEXPECTED: wanted $expected"
        fail=1
    fi
}

check "GET  play:3000/ping            " 200 http://wa-fable-stack-play:3000/ping
echo "  body: $(head -c 40 /tmp/body)"
check "GET  play:3000/ready           " 200 http://wa-fable-stack-play:3000/ready
echo "  body: $(head -c 40 /tmp/body)"
check "GET  play:3000/ping-backs      " 200 http://wa-fable-stack-play:3000/ping-backs
echo "  body: $(head -c 40 /tmp/body)"
check "POST play:3000/anonymLogin     " 200 -X POST http://wa-fable-stack-play:3000/anonymLogin
node -e 'const b=JSON.parse(require("fs").readFileSync("/tmp/body","utf8"));console.log("  body keys: "+Object.keys(b).sort().join(",")+" authTokenLength="+String(b.authToken).length)'
check "GET  maps/starter/map.json     " 200 http://wa-fable-stack-maps/starter/map.json
check "GET  back:8080/ping            " 200 http://wa-fable-stack-back:8080/ping
check "GET  back:9100/metrics         " 200 http://wa-fable-stack-back:9100/metrics
echo "  metric lines: $(grep -vc '^#' /tmp/body)"
check "GET  play:9100/metrics         " 200 http://wa-fable-stack-play:9100/metrics
echo "  metric lines: $(grep -vc '^#' /tmp/body)"
rm -f /tmp/body
echo "readiness_fail=$fail"
exit "$fail"
