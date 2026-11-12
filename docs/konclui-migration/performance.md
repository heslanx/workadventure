# Performance verification contract

No native-candidate performance or 1000-user claim has passed. The Mac was heavily contended during asset generation and the interrupted dependency installation; those elapsed times are not benchmark results. Offloaded builds/checks are also not benchmarks.

## Artifact and correctness gate

| Variant | Required identity and role |
|---|---|
| A | Official v1.34.5 source fingerprint, generated protocol hash, production frontend file hashes and actual service image IDs; calibration |
| B | Reference Git identity, selected dirty-source hashes, served bundle identities and actual service image IDs; existing product |
| C | Native source fingerprint, production frontend/assets receipts, protocol parity and actual service image IDs; equivalent product candidate |

`.audit/konclui-runtime/reference-b-identity.json` records a read-only B observation: its root answered HTTP 200 on port8090. This selected-file/HTML inventory is not yet the complete performance artifact identity. The frozen A/C job is documented in [offload instructions](../../deployment/konclui/offload-README.md). Do not compare incomplete C against full B as a product performance improvement.

Before timing, prove identical intended participant sets, movement destinations, map state, media availability, visible controls and relevant feature behavior. Known baseline defects have separate corrected acceptance criteria. A failed required correctness case stops promotion even if timing improves.

## Comparable measurements

Use production bundles, the same assets, map/camera position, viewport, participant count, media parameters, browser version, renderer and device settings. Separate cold and warm cache. Interleave at least five runs per side; report median and range, raw samples, errors, machine load and competing jobs. A single source-level optimization or faster build is not a runtime result.

Collect browser frame-time p95/FPS, long tasks above 50 and 200 milliseconds, input-to-visible-roster latency, mounted row counts, retained memory across transitions, asset transfers/cache hits, and WebSocket message/byte rates. Collect CPU, RSS and egress for each service with timestamps aligned to the workload. Headless/SwiftShader results must identify that renderer and cannot certify a physical low-end GPU.

Run unthrottled, 4× and 6× CPU profiles separately. Throttling is a controlled browser experiment, not a replacement for physical modest-device validation. Record initialization separately from steady state and retain failures in both; do not remove long tasks from the report merely because they occur during a transition.

## Protocol-load sequence

The existing `benchmark/index.ts` imports a stale `Connection/WebSocket` path and browser-bound `ConnectionManager`. It is not a verified current runner. The replacement must use the existing generated Protobuf protocol and Node WebSocket capability, with no new dependency or guessed protocol version.

Use 1, 50, 250, 500 and 1000 synthetic sessions, plus one to three measured real browsers. Each client has a distinct authoritative session identity, a realistic 200-millisecond movement cadence, and a bounded viewport. Track accepted joins, exact observed membership, departures/reconnects, decoded movement, sequence/transport errors and bytes. Distinct display names alone are not identity proof.

Cover dense single-room and distributed multi-room workloads. Keep high-frequency movement in spatial subscriptions. Test concurrent arrivals/departures and status changes separately from movement, including one duplicate display name and multiple sessions for one account. The browser's room roster must keep offscreen participants; its mounted DOM must remain bounded. Call membership is verified independently using synthetic local media.

A failed load level remains failed. Diagnose the bottleneck before increasing load or changing semantics. Do not open 1000 browsers, use real devices for media input, or target production. Local single-node evidence does not certify a multi-node cluster.

## Bounded optimization loop

Before each experiment, append the diagnosed operation, hypothesis, correctness gate, primary metric, baseline sample identity, and resource/time allowance to the audit ledger. Initial search budget: at most three candidate variants and 30 minutes of measured experimentation for one diagnosed bottleneck, excluding prerequisite correctness repair. Run experiments serially and stop when the budget is reached, results are within observed variation, or the hypothesis is refuted.

Keep a performance-only change only when correctness passes and the benefit repeats. Revert rejected experiments and remove temporary measurement overrides. A justified native migration with neutral or inconclusive timing remains an architectural improvement, not a speed claim. Report the measured numerator, denominator, units, range and workload behind every percentage.

## Open evidence

The live baseline sprite/cache/movement probe, equivalent B/C runs, measured CPU-throttled browser runs, protocol load through 1000 sessions, synthetic group calls, raw result sets, and keep/revert decisions remain pending. The full migration matrix stays open until these gates have actual results or an explicit unresolved blocker.
