# P4 independent review

Reviewer did not write the change. Scope: `play/src/pusher/models/PositionDispatcher.ts` (checkout sha256
`9605481a...`, HEAD `c27eacdc...`) and `play/tests/pusher/PositionDispatcher.test.ts` (`4ccf0536...`). Lane kept the
change, so the production file differs from HEAD by design (`git diff`: +40/-7, test +233/-7).

Verdict: PASS_WITH_NITS. No blocker. The early return is behavior-equivalent to HEAD in every case probed below. The
lane's suite misses two of the change's invariants (two mutants survive it), and the plan's typecheck, live and
profiler boxes are open.

## Refutation attempts (code reading, `PositionDispatcher.ts` lines 139-254)

| Case | Result |
|---|---|
| Invalid viewport | Validation (lines 140-150) still runs first and returns before the cache is read or written. Not refuted. |
| Crop/cap | `boundZoneRectangle` runs before the comparison (line 153), so the comparison uses the cropped rectangle and `oversizedViewportsCropped` and the first-oversize warning advance exactly as in HEAD. Not refuted. |
| Negative coordinates | `Math.floor` is unchanged; `-0 === 0` and `${-0}` is `"0"`, so the cache and the zone keys agree. Not refuted. |
| removeViewport then re-add | Entry deleted at line 246; the same viewport reconciles again. Not refuted. |
| Subscribe throws halfway | `reconciled` is cleared (line 178) before `reconcileZones` and only set after it (line 182), so the next viewport reconciles like HEAD. Not refuted. |
| Writes to `listenedZones` outside reconciliation | `rg` finds them only in `Zone.startListening/stopListening` (`Zone.ts` 419, 435), reached only from `subscribeZone`/`unsubscribeZone`. The cache cannot go stale through another path. Not refuted. |
| Per-socket lifetime | `WeakMap` keyed by the socket, one per `PusherRoom`'s dispatcher, and deleted in `removeViewport` (called by `PusherRoom.leave`). It does not keep a socket alive. Not refuted. |

## Re-run (host knc, my containers `wa-fable-p4review-*`, `--rm`, `--cpus 2 --memory 3g --cpu-shares 512 --network none`)

The two checkout files went through `rsync -aR` into `~/wa-jobs/wa-fable-20261111/p4review/tree/`. The remote sha256
matched the checkout (`9605481a...`, `4ccf0536...`). They were bind-mounted read-only over the `src-wa-fable-p3`
snapshot. Command from `play/`: `npm test -- --run tests/pusher/PositionDispatcher.test.ts`.

| Production file | Lane suite (21 tests) | Reviewer ad-hoc tests (3) |
|---|---|---|
| final `9605481a...` | 21 passed, exit 0 | 3 passed, exit 0 |
| HEAD `c27eacdc...` | (lane receipt `test-unchanged-code-knc-2.log`: 21 passed) | 3 passed, exit 0 |
| mutant `noinvalidate` (line 246 removed) `0a2e7979...` | 1 failed (`subscribes again ... after its viewport was removed`), exit 1 | not run |
| mutant `noclear` (line 178 neutralised) `07b02292...` | **21 passed, exit 0 (survives)** | 1 failed (`subscription that throws halfway`), exit 1 |
| mutant `topleftonly` (bottom-right compare dropped) `3e43d9a0...` | **21 passed, exit 0 (survives)** | 1 failed (`resize that keeps the top-left zone`), exit 1 |

The ad-hoc test file (`p4review/review.test.ts`, sha256 `7388760e...`, remote only, not in the checkout):
(1) a viewport grows from zone 0 to zones 0-2 with the same top-left; (2) `subscribeToZone` throws for zone 2
while moving from zones 0-1 to 1-2, and then the old viewport comes back; (3) the failed rectangle is retried. Each
asserts `listenedZones`. HEAD and final agree on all three.

## Findings

1. **major, evidence gap (plan, not code).** `upstream-pr-plan.md` lines 218-238 require the 10 live lanes, profiler
   output and the 1,000-moving-users probe before the PR counts as verified. README lines 131-137 says none of these
   ran. The ~70% gain is micro-benchmark only. It must not be claimed as pusher capacity. The reviewer closed the
   typecheck gap: `npm run typecheck` (`tsc --noEmit`; `play/tsconfig.json` has no `include`, so `tests/` is
   covered) over the final file printed no error, 00:59:10-00:59:33 UTC. Caveat: the output was piped to `tail`
   without `pipefail`, so the recorded `exit=0` is `tail`'s. Success is read from the empty tsc output and the
   absence of `npm error` lines.
2. **minor, test gap.** `PositionDispatcher.test.ts` has no test for invariant 3 (partial failure). The `noclear`
   mutant passes 21/21. Suggested test: ad-hoc test (2) above.
3. **minor, test gap.** No test changes only the bottom-right edge (window resize or zoom with a fixed top-left), so
   a comparison that ignores `bottomRight` passes 21/21. Suggested test: ad-hoc test (1) above.
4. **minor, doc.** README line 60 calls `f2bcb3a4...` "the checkout file", but the checkout is `9605481a...`. The
   noise band is 0.94-1.06 at line 77 and 0.93-1.10 at line 120; the wider band includes run 4's crowd-walk
   base2/base 1.100. The decision holds under both: walk 0.268/0.262 and crowd-walk 0.281/0.282. Miss path
   1.011/1.013 and 1.027/0.983 sit inside the band. Bytes per all-miss update are +3.8% (repeatable, under the 5% rule).

## Keep/reject consistency

Keep is consistent with the receipts for the micro-benchmark rule: target improvement is far beyond either noise band,
traces are identical, miss-path time is inside noise in runs 4/5, and the 1080p all-miss bytes regression (+3.8%) is
below 5%. Lane did not revert, so the "identical to HEAD" check does not apply (production sha differs from HEAD by
design).

## Resources

Every container was `--rm`. `docker ps -a --filter name=wa-fable-p4review` printed nothing after the runs, including
`wa-fable-p4review-tc` (typecheck). Remote `~/wa-jobs/wa-fable-20261111/p4review/` (receipts, synced files,
mutants) is removed at the end of the review. Local `/tmp/p4review/` is also removed.
