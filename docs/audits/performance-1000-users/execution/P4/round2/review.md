# P4 round 2: independent review

The reviewer did not write this change. Scope: `p4-round2-tests.patch` (test file only), the edits to `../README.md`
and `README.md` in this directory, against the lane brief (kill the `topleftonly` and `noclear` mutants, fix the
stale README sha and noise bands, verify the tests, typecheck, eslint and prettier on knc).

Verdict: PASS_WITH_NITS. Every finding in the brief is fixed and verified. Each new test fails on its mutant and
passes on the change and on HEAD. Two neighbouring mutants still survive the 23 tests (findings 2 and 3 below). A
verified two-test fix-up is in `review-suggested-tests.patch`. Finding 1 of round 1 (plan evidence) stays open and is
outside this round's scope.

## Identity checks

- Checkout `PositionDispatcher.ts` sha256 `9605481a...` = remote `src-p4` = the author's receipts. HEAD's file
  (`git show HEAD:...`) is `c27eacdc...`, the same as the author's `p4-mut/head.ts`.
- Checkout test file `4ccf0536...` + `p4-round2-tests.patch` (applied in scratch `/tmp/wa-r2/p4-review/`) =
  `0209e81e...` = the remote `src-p4` test file. So the remote tree holds exactly the patch.
- `git -C <checkout> apply --check p4-round2-tests.patch`: exit 0. The checkout is not modified.

## Re-run (host knc, containers `wa-fable-r2-p4-review-*`, `node:24-trixie`, `--cpus 1 --cpu-shares 512 --memory 3g --network none --rm`)

The reviewer built its mutants from the checkout file with `sed`/`awk` (`review-mutants/*.diff`), not from the author's
copies. They were bind-mounted `:ro` over `play/src/pusher/models/PositionDispatcher.ts`, so the remote tree never
changed and nothing had to be restored. Command from `play/`: `npm test -- --run tests/pusher/PositionDispatcher.test.ts`.
Receipts: `review-receipts/`.

| Production file | Mutation | 23 tests (patch) | Receipt |
|---|---|---|---|
| change `9605481a...` | none | 23 passed, exit 0 | `test-change-knc.log` |
| `topleftonly` `0f7f9d36...` | both `bottomRight` comparisons -> `true` | 1 failed (`...grows to the bottom right only`), exit 1 | `test-mutant-topleftonly-knc.log` |
| `noclear` `b432cc6a...` | line 178 `lastRectangle.reconciled = undefined` removed | 1 failed (`...subscription failed halfway through a move`), exit 1 | `test-mutant-noclear-knc.log` |
| `nobottomi` `d40500a8...` | only `bottomRight.i` comparison dropped | 1 failed (`...grows to the bottom right only`), exit 1 | `test-mutant-nobottomi-knc.log` |
| `nobottomj` `93f6e5a3...` | only `bottomRight.j` comparison dropped | **23 passed, exit 0 (survives)** | `test-mutant-nobottomj-knc.log` |
| `setbefore` `cc024d6a...` | cache set before `reconcileZones` instead of after | **23 passed, exit 0 (survives)** | `test-mutant-setbefore-knc.log` |

Static (`static-knc.log`, same tree): `npm run typecheck` (`tsc --noEmit`) `typecheck_exit=0`; `npx eslint` on the two
files `eslint_exit=0`; `npx prettier --check` `prettier_exit=0`. Each exit is the command's own (no pipe).

The author's receipts in `receipts/` agree: change 23/23, `topleftonly` (`3e43d9a0...`) and `noclear` (`fb3850ae...`)
each fail only their own test, HEAD 23/23.

## Doc claims checked against the receipts

- `../README.md` lines 59-62: runs 2 and 3 print `f2bcb3a4...` for `src/pusher/models/PositionDispatcher.ts`
  (`receipts/bench-run2-knc.log`, `bench-run3-knc.log` line 2). The label "inline version" is correct. Line 45
  (`test-head-knc.log` = `f2bcb3a4...`) and line 46 (`test-variant-knc.log` = `9605481a...`) match.
- Line 75 absolute medians: walk 3149/2308 vs base 9349, crowd-walk 4013/4056 vs base 12859, cross-every-update
  19167/17883 vs base 18484. All match the run 2/3 logs.
- Noise bands, recomputed from every `base2` `time/ref med` in the six knc bench logs: runs 1-3 give 0.939
  (crowd-walk, run 1) to 1.061 (inside-bounds, run 1). All runs give 0.927 (max-inside-bounds, run 4) to 1.100
  (crowd-walk, run 4). Lines 78-80 and 123-124 match.

## Findings

1. **major, evidence gap (plan, carried from round 1, open).** The 10 live lanes, the profiler output and the
   1,000-moving-users probe from `upstream-pr-plan.md` were not run. Both READMEs say so. The ~70% gain is a
   micro-benchmark result and must not be claimed as pusher capacity. This finding is not a code defect and was not
   in this round's brief.
2. **minor, test gap.** The bottom-right test grows the viewport only horizontally (`right` 319 -> 959). A comparison
   that ignores `bottomRight.j` (`nobottomj`) passes all 23 tests. Then a window that only gets taller, or a zoom-out
   with a fixed top-left on a tall map, would keep the old zones. Fix: add a vertical-only growth test (in
   `review-suggested-tests.patch`). It fails on `nobottomj` (`expected [] to deeply equal [[0,1],[0,2]]`, exit 1) and
   passes on the change and on HEAD.
3. **minor, test gap.** README invariant 3 says the cache is cleared before subscribing *and set after*. The new
   partial-failure test only returns to the old viewport, so it cannot tell "set after" from "set before"
   (`setbefore` passes 23/23). With `setbefore`, retrying the failed viewport is skipped and zone 0 stays
   subscribed for good. Fix: add a test that sends the failed viewport again and expects zone 0 to be unsubscribed (in
   `review-suggested-tests.patch`). It fails on `setbefore` (`expected [] to deeply equal [[0,0]]`, exit 1) and
   passes on the change and on HEAD.
4. **nit, doc.** `../README.md` lines 79-80 say "Runs 4 and 5 widen it to 0.93 to 1.10". Both ends come from run 4.
   Run 5's base2 medians (0.942-1.056) sit inside 0.93-1.10 and widen nothing. Suggested wording: "Run 4 widens it
   to 0.93 to 1.10."

## Suggested fix-up (verified, not applied to the checkout)

`review-suggested-tests.patch` (+28 lines, `play/tests/pusher/PositionDispatcher.test.ts`) applies on top of
`p4-round2-tests.patch`. It adds `subscribes to the new zones when the viewport grows downward only` and
`finishes a move that failed halfway when the same viewport is sent again`. The resulting file `682ac9e2...` was
bind-mounted over the test file on knc:

| Production file | Result | eslint / prettier | Receipt |
|---|---|---|---|
| change `9605481a...` | 25 passed, exit 0 | 0 / 0 | `suggested-change-knc.log` |
| HEAD `c27eacdc...` | 25 passed, exit 0 | 0 / 0 | `suggested-head-knc.log` |
| `nobottomj` | 1 failed (`...grows downward only`), exit 1 | 0 / 0 | `suggested-mutant-nobottomj-knc.log` |
| `setbefore` | 1 failed (`...same viewport is sent again`), exit 1 | 0 / 0 | `suggested-mutant-setbefore-knc.log` |

Not run on the suggested file: `npm run typecheck`. It only adds `vi.fn` calls that the round 2 tests already use
(`mockImplementationOnce` throwing), so a type error is unlikely, but the check is open.

## Resources

Every container was `--rm`. Containers: `wa-fable-r2-p4-review-{1..6,20,30..33}`. After the runs,
`docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-r2-p4-review` printed nothing (0). Remote
files created by this review: `~/wa-jobs/wa-fable-20261112/p4-review/` (mutants, suggested test file, scripts,
receipts). The author's `src-p4` tree was not modified. Local scratch: `/tmp/wa-r2/p4-review/`.
