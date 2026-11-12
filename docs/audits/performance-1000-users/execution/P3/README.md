# P3 lane: contribution to upstream PR #6688

Status: **PARTIAL**. The review, the proposed tests and store-level micro-measurements are done. The live and 1,000-session lanes were not run: they need the P1 harness.

- Reviewed head: `04634ad3f38b5a74460911d2a7f2850258119aa3`. Local baseline: `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`.
- `git apply --check pr-6688-04634ad.diff` against the checkout exits 0 (checked 2026-11-12 00:38 UTC; read-only, nothing applied). `play/src/common/NoncedMessageStore.ts` and `play/src/pusher/services/PusherWebSocket.ts` in the checkout are identical to the baseline (`git diff --quiet ddbe245a8 -- <files>` exits 0).
- Nothing was posted upstream. No product file in the checkout was changed.

## Files

| Path | What it is |
|---|---|
| `review.md` | The review: equivalence vs new behaviour, close codes, findings F1-F4, test runs, measurements and their limits, what remains |
| `../pr-descriptions/P3-contribution.md` | English draft of the review comment for #6688 (not posted) |
| `pr-6688-04634ad.diff` | PR diff at the reviewed head |
| `pr-head/play/...` | PR-head copies of the 3 changed files |
| `proposed-tests.patch` | Proposed tests on top of the PR-head tests: 8 in `NoncedMessageStore.test.ts`, 1 in `PusherRoomSocketController.test.ts` |
| `proposed/NoncedMessageStore.test.ts`, `proposed/insert-controller-test.py` | Patched test file, and the script that inserted the controller test into a snapshot copy |
| `proposed/OverCapFrameRepro.test.ts` | Repro for F2 (over-cap frame during backpressure gives a 4000 close). Review-only, not in the patch |
| `proposed/DrainExpiryRepro.test.ts` | Repro for F3 (a pre-existing silent loss while waiting for a drain). Review-only, passes at the baseline and the head |
| `proposed/bench.mts`, `micro-measurement.json` | Differential trace (3 seeds × 200,000 operations), storm and steady measurements |
| `proposed/bench2.mts`, `micro-measurement-2.jsonl` | One process per implementation: steady ns per add and a 100k-frame burst, for baseline, head, head+guard and head+shift-one |
| `proposed/variants/` | The `guard` and `shift-one` variants of the PR store that were measured (review-only) |
| `logs/` | Filtered vitest, Prettier and ESLint output (run1, run4, run6) |
| `upstream-search.sh`, `upstream-search-raw*.txt` | Read-only upstream duplicate search receipts (summary in `../research/upstream-duplicates.md`) |

## Plan checklist (P3 section of `../../plans/upstream-pr-plan.md`)

- [x] Review the PR versions of the 3 files and save the reviewed SHA.
- [x] Separate equivalence from the cap and refusal behaviour. Document close codes and fresh join.
- [x] Unit: PR-head `NoncedMessageStore`, `PusherRoomSocketController` and `WorkAdventureWebSocket` tests (25/25), plus the proposed tests (38/38 with the repros). Prettier and ESLint are clean on the changed tests.
- [ ] Typecheck at the PR head with the proposed tests.
- [ ] Live lanes 1-10 (need the P1 harness).
- [~] Perf: store-level only. The memory bound and the prune/replay gains were measured. The healthy-path `add` is about 16 times slower (F1). Event-loop lag, heap/RSS under real load, successful resumes and forced fresh joins were not measured.

## Resources

This finishing pass started no container, process or server. The containers the previous agent used to produce `logs/` and the measurements are not recorded in this directory. They are not covered by this pass and need to be checked by the coordinator.
