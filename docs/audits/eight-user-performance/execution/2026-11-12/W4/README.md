# W4 - timeline and compatibility (2026-11-12)

Scope: H05, H06, H21, H22, A05, D06. No product file edited. The measurement harness `W4TimelineMeasure.test.ts` lives only here and was copied, per run, into the remote baseline tree of container `wa-fable-h8` on `sbh` (checksum-verified each time, removed at the end; see section 4).

Environment of every run: container `wa-fable-h8` (1 CPU, 4 GiB cap), tree `~/wa-jobs/wa-fable-20261111/src-wa-fable-h8` at baseline `ddbe245a8`, node v24.22.2, vitest 4.1.7, jsdom 29.1.1, **Svelte 5.55.9** (baseline; the checkout's working tree has `^5.57.3` from the P2 lane, not measured here). jsdom has no layout engine: numbers are DOM node counts and script time only, never style, layout, paint or GPU cost.

## 1. H05 measurement: short vs long history

### Runs

| Run | UTC | Receipt | What ran | Result |
|---|---|---|---|---|
| 1 (previous agent) | 00:26 | `measure-run1.raw.log` | all 9 cases | projection 3 passed; `Message.svelte` failed (`iframeListener` undefined via the GameScene import cycle); `RoomTimeline.svelte` failed (`gameManager.chatConnectionStore` not mocked). Exit 1 |
| 2 | 00:36:53-00:38:40 | `measure-run2.raw.log` | all 9 cases, mocks for `chatConnectionStore` and `UIWebsiteManager` added | 6 passed, 3 failed (`RoomTimeline`: `proximityChatRoomManager` not mocked). vitest failed; the `REMOTE_EXIT=0` line in that log is the exit of `tail`, not of vitest |
| 3 | 00:39:43-00:41:34 | `measure-run3.raw.log` | `-t RoomTimeline` | `VITEST_EXIT=1`: jsdom has no `Element.scroll` (`RoomTimeline.svelte:652`) |
| 4 | 00:42:08-00:43:33 | `measure-run4.raw.log` | `-t RoomTimeline`, `Element.scroll`/`scrollTo` stubs | `VITEST_EXIT=0`, 3 passed, 6 skipped (the 6 non-timeline cases already measured in run 2) |

Harness versions (sha256 of the local file, equal to the remote copy each time): run 2 `0dcf9feb320a870c...`, run 3 `e4708e470d5247dc...`, run 4 and the file now in this directory `499210658c9f004e...`. Each change only added mocks or jsdom stubs; the measured code paths did not change between runs.

The pre-existing timeline tests pass on the same tree: 4 files, 16 tests, exit 0 (`existing-timeline-tests.log`, 00:20 UTC).

### Projection (script time only), run 2

| Loaded messages | Append one: median (ms) | Append one: max (ms) | Samples | Unread helpers: median (ms) | Samples |
|---:|---:|---:|---:|---:|---:|
| 20 | 0.0113 | 0.5272 | 30 | 0.0036 | 50 |
| 500 | 0.0498 | 0.9767 | 30 | 0.0231 | 50 |
| 2000 | 0.1141 | 0.1495 | 30 | 0.1270 | 50 |

Run 1 gave the same order of magnitude (0.0119 / 0.0476 / 0.4514 ms median). "Append one" is `createProximityTimelineItemsStore` re-projecting after one new message; the helpers are `findFirstUnreadKey` + `countIncomingMessagesAfter` + `isReadMarkerLoaded`.

### Real `Message.svelte` per item (jsdom), run 2

| Loaded messages | Element nodes | Nodes per message | Mount, script time (ms) | Unmount (ms) |
|---:|---:|---:|---:|---:|
| 20 | 424 | 21.20 | 392.0 | 16.0 |
| 500 | 10,584 | 21.17 | 3,746.8 | 228.5 |
| 2000 | 42,332 | 21.17 | 8,309.3 | 604.3 |

One sample per size on a 1-CPU container; the 20-message mount also absorbs first-use JIT warm-up. Read only the shape: the DOM grows linearly (about 21 element nodes per text message, no images, no reactions), and mount script time grows with it.

### Real `RoomTimeline.svelte` (jsdom)

Run 4. Composer, banners and typing indicator replaced by empty components; `ResizeObserver` replaced by a counter. "Append one" = one new message pushed into `room.timelineItems` followed by `flushSync()`, 10 samples. "Prepend 20" = one older page of 20 inserted at the top.

| Loaded items | `li[data-event-id]` | Element nodes | Observed by ResizeObserver after mount | Mount (ms) | Append one: median (ms) | Append one: max (ms) | Prepend 20 (ms) | Unmount (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20 | 20 | 475 | 22 | 479.4 | 43.03 | 82.12 | 357.5 | 22.8 |
| 500 | 500 | 11,755 | 502 | 4,783.7 | 251.80 | 445.27 | 375.3 | 212.9 |
| 2000 | 2000 | 47,010 | 2002 | 14,351.0 | 1,013.38 | 1,126.31 | 1,165.4 | 651.4 |

All cases ended with every item still mounted (`itemsAfterPrepend` = loaded = 50 / 530 / 2030) and one `loadMorePreviousMessages` call at mount.

### Reading

- **Projection is not the bottleneck** at 2000 loaded messages: about 0.1 ms per append and per unread recomputation in the store.
- **DOM size is proportional to loaded history**: every loaded item stays mounted (about 23.5 element nodes per timeline item, about 21 per bare message) and each one is observed by `ResizeObserver` (items + 2).
- **Appending one message costs script time that grows with loaded history inside `RoomTimeline.svelte`**: median 43 / 252 / 1013 ms at 20 / 500 / 2000 items, roughly linear (about 0.5 ms per loaded item), while the store projection for the same append stays near 0.1 ms. So the per-append cost is in the view (row derivation, keyed `each` reconciliation or effects walking the list), not in the provider. This run does not attribute it to one of those; that needs a profile.
- Limits: jsdom DOM operations are much slower than a browser's, the container has 1 CPU, there is one run per size, and the messages are text only. The absolute milliseconds do not transfer to a browser; the growth with history is the result. Whether this costs frames or typing latency for the incident users depends on how many messages they had loaded, which is unknown.

## 2. Triage

| ID | State | Scenario | Evidence | Next discriminator | Owner |
|---|---|---|---|---|---|
| H05 chat history and DOM | inconclusive for the incident. Confirmed in jsdom: all loaded items stay mounted (about 23.5 nodes each), store projection about 0.1 ms at 2000 items, but one append in `RoomTimeline.svelte` costs script time linear in loaded history (median 43 / 252 / 1013 ms at 20 / 500 / 2000). Browser cost not measured | jsdom, 1 CPU, synthetic text messages | section 1, `measure-run2.raw.log`, `measure-run4.raw.log` | browser trace: one incoming message with chat open at 20 vs 2000 loaded items (which function owns the append time); chat closed vs open; count of messages the incident users had loaded | chat |
| H06 map scripts and embedded pages | not_executed (mechanism confirmed in code) | static read | `play/src/front/Api/IframeListener.ts:695` `registerScript`, `:815` message listener; `play/src/front/Phaser/Game/GameScene.ts:925-934` registers every map script (7 s load timeout noted at `:933`) | copy of the incident map without scripts/sites, same users and devices; attribute timers and messages per frame origin | scripting/integrations |
| H21 dev build | confirmed for the local preview (not for the incident) | local Compose stack | `docker-compose.yaml:35` `play` runs `command: npm run dev`; `play/package.json:18-19` `dev` = concurrently `vite` + i18n watch + iframe-api watch + `svelte-check` watch + pusher dev; production command is commented at `docker-compose.yaml:37`. Integration journal: preview served by this setup | equivalent scenario on a production build (`npm run build`/`start`) with the same map and versions; never mix the two | build/operation |
| H22 version regression, extensions, browser state | inconclusive | static read | Svelte: P2 lane `docs/audits/performance-1000-users/execution/P2/README.md` (5.55.9 -> 5.57.3, 15 releases; listed fixes include deriveds retaining disconnected dependencies 5.57.2, duplicate subscriptions on reconnect 5.57.2, deferred listeners cancelled on cleanup 5.57.1, `last_propagated_event` retention 5.56.10; its status line says live lanes and perf probe are PENDING and no memory or latency gain is claimed). Phaser: `patches/phaser+4.2.0.patch` (498 lines) patches the tilemap GPU shaders in `phaser.esm.js`: `highp` precision for the packed integer layer/animation samplers, exact byte snapping, bit tests for flags, frame-bounded sampling, transparent empty cells; `play/package.json:165` pins `phaser` 4.2.0 | incident version and browser list; compare with extensions off and a fresh profile; GPU/driver per device (with H04) | frontend/build/support |
| A05 / D06 | proposal written | - | `A05.proposal.md`: virtualization stays conditional | see proposal gate | chat |

## 3. What is not claimed

No frame-time, memory or latency improvement; no statement that the incident users had long histories; no statement that the Svelte upgrade or the Phaser patch caused or fixes anything.

## 4. Resources

| Resource | Host | Started by | Released |
|---|---|---|---|
| `play/tests/front/Chat/W4TimelineMeasure.test.ts` in the remote tree `src-wa-fable-h8` | sbh | previous agent (run 1), re-copied for runs 2-4 | yes: `rm -f` at 00:44:05 UTC, `test -e` printed `removed`, directory listing no longer shows it |
| `/tmp/w4run3.log`, `/tmp/w4run4.log` inside `wa-fable-h8` | sbh | this lane | yes: removed by the same command that printed them; `ls /tmp/w4run*.log` empty |
| vitest processes inside `wa-fable-h8` | sbh | this lane | yes: all runs exited; 0 `W4TimelineMeasure` processes at 00:44:05 |
| container `wa-fable-h8` | sbh | coordinator (shared eight-user container) | retained: not created by this lane, shared by other streams |

The checkout was never used to run the harness; no file outside `W0/`, `W1/`, `W4/` was written.
