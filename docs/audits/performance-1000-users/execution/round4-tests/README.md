# Round 4: row-reuse test observes every prop (verdict `2fb269214`, finding 1)

Test-only. No product file changes. Host sbh, tree `~/wa-jobs/wa-fable-20261112/src-chat` (`RoomTimeline.svelte` sha256 `e1743a01...`, the same as `HEAD` `e19bbf7dc`), image `node:24-trixie`, every container `--cpus 1.5 --cpu-shares 512 --memory 4g --network none`, label `owner=wa-fable-20261112`, names `wa-fable-nits-b-*`, all `--rm`. Variants were bind-mounted read-only over the tree files, so no tree file was edited.

## Patch

| Patch | Applies on | sha256 | `git apply --check` on the checkout |
|---|---|---|---|
| `row-reuse-all-props.test.patch` | `HEAD` (`RoomTimelineRowReuse.test.ts` blob `ab311b3`) | `c56074c7215408507f3af48ba04dff21290d8589900d61c0827f78974cf3dd77` | exit 0 |

Resulting test file sha256: `a643e7309b6db6034f6d31c35c20bad79bbbffac28936518820f9a3b548360c8` (before: `d29fcd1e...`).

## What changed

The stand-in for `Message.svelte` used to read `message.id`, `showHeader` and `showTime`. It now reads `Object.keys(props)` inside the `toStore` getter, so every prop the timeline passes is a dependency of the row's counter, and a prop added to the `<Message>` call later is counted without editing the stand-in. All existing assertions stay. One assertion is added: the names the stand-in saw include `membersForMessageAvatars`, `readReceipts` and `showReaders`, so a change in how Svelte hands over props cannot silently turn the stand-in back into a three-prop observer.

## Checks

| Check | Command (in `/work/play`) | Exit | Result |
|---|---|---|---|
| vitest, old test (`HEAD`) on `HEAD` | `npx vitest run src/front/Chat/Components/Room/RoomTimelineRowReuse.test.ts` | 0 | 1 passed |
| vitest, new test on `HEAD` | same | 0 | 1 passed |
| eslint, new test | `npx eslint --max-warnings 0 --stdin --stdin-filename <path>` | 0 | clean |
| prettier, new test | `npx prettier --check --stdin-filepath <path>` | 0 | clean |
| `git apply --check` on the checkout | `git -C <checkout> apply --check` | 0 | applies on `HEAD` |

Run with `NODE_OPTIONS=--max-old-space-size=2600`. Raw output: `row-reuse-all-props.checks.raw.log`. Not run: `svelte-check` (test file only).

## Mutants

Each mutant is a one-line change to `RoomTimeline.svelte`. The four `MB` mutants change only a prop the old stand-in did not read, on rows that are unchanged, once a sixth render item exists (the day separator is item 1, so the 5 messages already make 6, and the appended message makes 7). M0 is the control from round 3.

| mutant | change | old test | new test |
|---|---|---|---|
| M0 | `reuseUnchangedRenderItems` not called: `return out;` | not rerun (control) | exit 1, killed: `row m0 was updated: expected 4 to be 3` |
| MB1 | `showReaders={... === lastOwnMessageId \|\| renderItems.length > 6}` | exit 0, survives | exit 1, killed: `row m0 was updated: expected 4 to be 3` |
| MB2 | `readReceipts={renderItems.length > 6 ? new Map() : $readReceipts}` | exit 0, survives | exit 1, killed (same message) |
| MB3 | `membersForMessageAvatars={renderItems.length > 6 ? [] : room.membersForMessageAvatars}` | exit 0, survives | exit 1, killed (same message) |
| MB4 | new prop `futureProp={renderItems.length}` on `<Message>` | exit 0, survives | exit 1, killed (same message) |

M0 was not run against the old test in this round, because round 3 already killed it with the old stand-in (`mutants-lint.raw.log` in `../round3-tests/`).

The first run used `> 5` in MB1 to MB3. Those mutants changed no value (6 items before and after), so MB1 survived the new test. That was an equivalent mutant, not a gap. The thresholds were corrected to `> 6` and every run was repeated. The superseded output is at the end of the raw log.

## Resources

Containers created: `wa-fable-nits-b-v2-base`, `-v2-MB1` to `-v2-MB4`, `-v2-M0`, `-static`, `-v1-base`, `-v1-MB1` to `-v1-MB4`, and a first-run `-v2-base`, `-v2-MB1`, `-v2-MB2`, `-v2-MB3` (the last stopped by name with `docker rm -f` when the run was restarted). Containers left: 0. Scratch kept on sbh: `~/wa-jobs/wa-fable-20261112/nits-b/` (variants and logs).
