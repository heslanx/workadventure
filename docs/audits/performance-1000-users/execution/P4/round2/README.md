# P4 round 2: close the review findings

Reviews: `../review.md` (round 1, PASS_WITH_NITS) and `review.md` (round 2, PASS_WITH_NITS). Round 2 fixes round 1
findings 2, 3 and 4, then the round 2 review findings r2-2, r2-3 and r2-4, and re-runs the checks on knc. The
production file is unchanged (`9605481a...`); only the test file and the P4 README change.

Current patch: `p4-round2-tests.v2.patch` (test file only, +64 lines, repo-relative `a/` `b/` paths, made with
`git diff` in the scratch repo `/tmp/wa-r2/p4-fix/`, whose base commit is the checkout test file `4ccf0536...`). It
fully replaces `p4-round2-tests.patch` (+36 lines, kept for history; do not apply both). Result file sha256
`682ac9e2...`, the same as the reviewer's verified `review-suggested-tests.patch` result.
`git -C <checkout> apply --check p4-round2-tests.v2.patch`: exit 0.

## What changed

| Finding | Change | File |
|---|---|---|
| R1-3: no test changes only the bottom-right edge (`topleftonly` survived) | Test `subscribes to the new zones when the viewport grows to the bottom right only`: zone 0 grows to zones 0-2 in width with the same top-left; asserts `subscribeToZone` calls `[1,0],[2,0]`, no unsubscription, `listenedZones` = `{0,0; 1,0; 2,0}` | `play/tests/pusher/PositionDispatcher.test.ts` |
| R1-2: no test for invariant 3, partial failure (`noclear` survived) | Test `reconciles the zones again after a subscription failed halfway through a move`: `subscribeToZone` throws for zone 2 while moving from zones 0-1 to 1-2; then the old viewport comes back and must unsubscribe zone 2 and leave `{0,0; 1,0}` | same |
| R1-4: stale README text | Runs 2/3 attributed to the inline version `f2bcb3a4...`; noise bands recomputed from the receipts and labelled with their runs; typecheck line points here | `../README.md` |
| r2-2: the bottom-right test only grows in width (`nobottomj` survived) | Test `subscribes to the new zones when the viewport grows downward only`: `bottom` 319 -> 959 with the same top-left; asserts `subscribeToZone` calls `[0,1],[0,2]` and `listenedZones` = `{0,0; 0,1; 0,2}` | `play/tests/pusher/PositionDispatcher.test.ts` |
| r2-3: no test for the "set after" half of invariant 3 (`setbefore` survived) | Test `finishes a move that failed halfway when the same viewport is sent again`: zone 2 fails during the move to zones 1-2; the same viewport is sent again and must unsubscribe zone 0 and leave `{1,0; 2,0}` | same |
| r2-4: "Runs 4 and 5 widen it" | Now "Run 4 widens it to 0.93 to 1.10 (both ends come from run 4; run 5's base2/base medians, 0.942 to 1.056, sit inside)". The closing gap line now says 25 tests and names the v2 patch | `../README.md` |
| R1-1 / r2-1: live lanes, profiler, 1,000-moving-users probe | Not run; stays open (below). Typecheck part closed | - |

The two r2 tests are the reviewer's `review-suggested-tests.patch` hunk, taken unchanged after checking that they
assert observable behavior only (zone subscribe/unsubscribe calls and the listened zone set).

## Checks for v2 (host knc, image `node:24-trixie`, `--cpus 1 --cpu-shares 512 --memory 3g --network none`, `--rm`)

Tree: `~/wa-jobs/wa-fable-20261112/src-p4` with the v2 test file (sha256 `682ac9e2...`) pushed in. Mutants and HEAD's
file were bind-mounted read-only over `play/src/pusher/models/PositionDispatcher.ts`; every receipt prints the sha256
of both files. Scripts: `receipts-v2/run-tests.sh`, `receipts-v2/run-static.sh`. Command from `play/`:
`npm test -- --run tests/pusher/PositionDispatcher.test.ts`. Receipts have ANSI colors stripped.

| Production file | Mutation (diff in `mutants/`) | Result | Exit | Receipt |
|---|---|---|---|---|
| change `9605481a...` | none | 25 passed | 0 | `receipts-v2/test-change-knc.log` |
| HEAD `c27eacdc...` | (HEAD's file) | 25 passed (the new tests characterize HEAD's behavior) | 0 | `receipts-v2/test-head-knc.log` |
| `topleftonly` `3e43d9a0...` | both `bottomRight` comparisons dropped | 2 failed: `...grows to the bottom right only` (`expected [] to deeply equal [[1,0],[2,0]]`) and `...grows downward only` (`expected [] to deeply equal [[0,1],[0,2]]`), 23 passed | 1 | `receipts-v2/test-topleftonly-knc.log` |
| `nobottomi` `d40500a8...` | only `bottomRight.i` comparison dropped | 1 failed: `...grows to the bottom right only`, 24 passed | 1 | `receipts-v2/test-nobottomi-knc.log` |
| `nobottomj` `93f6e5a3...` | only `bottomRight.j` comparison dropped | 1 failed: `...grows downward only` (`expected [] to deeply equal [[0,1],[0,2]]`), 24 passed | 1 | `receipts-v2/test-nobottomj-knc.log` |
| `noclear` `fb3850ae...` | `lastRectangle.reconciled = undefined` removed | 1 failed: `...subscription failed halfway through a move` (`expected [] to deeply equal [[2,0]]`), 24 passed | 1 | `receipts-v2/test-noclear-knc.log` |
| `setbefore` `cc024d6a...` | cache set before `reconcileZones` | 1 failed: `...same viewport is sent again` (`expected [] to deeply equal [[0,0]]`), 24 passed | 1 | `receipts-v2/test-setbefore-knc.log` |

Static, same tree (`receipts-v2/static-knc.log`): `npm run typecheck` (`tsc --noEmit`, covers `src/pusher` and
`tests/`) `typecheck_exit=0`; `npx eslint` on the two P4 files `eslint_exit=0`; `npx prettier --check` on them
`prettier_exit=0` ("All matched files use Prettier code style!"). This closes the review's open "typecheck not run on
the suggested file". Exit codes are the commands' own (no pipe).

All five mutants are killed; each single-comparison or single-statement mutant fails exactly the test written for
it. The v1 receipts (23 tests) stay in `receipts/` for history.

## Resources

v2 containers `wa-fable-r2-p4-fix-{1..4,11..13,20}`, all `--rm`. After the runs
`docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-r2-p4-fix -q | wc -l` printed 0. Remote
files created by the fix round: `~/wa-jobs/wa-fable-20261112/p4-fix/` (scripts, copies of the mutants from `p4-mut/`
and `p4-review/mut/`, raw receipts) and the v2 test file in `src-p4`. v1 containers
`wa-fable-r2-20261112-p4-impl-{1,2,3,4,10}` were also all removed.

## Still open

- Finding R1-1 / r2-1 (major, plan evidence): the 10 live lanes, profiler output and the 1,000-moving-users probe
  from `upstream-pr-plan.md` were not run. The ~70% gain stays a micro-benchmark result and must not be claimed as
  pusher capacity.
- The full `play` test suite and `npm run lint` over all of `play/` were not run (not required for a test-only
  change to one file).
