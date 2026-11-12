# Native migration handoff

## Objective and authorized workspace

Deliver the complete native Konclui product on official WorkAdventure v1.34.5 with standalone runtime, preserved visual identity, local verification, scale evidence, and prepared release inputs. On 2026-11-12 the user authorized granular commits, PR creation, review, merge, and database changes required by this migration. Technical completion gates remain mandatory; unrelated repository/data changes remain outside scope.

The user approved a worktree of the existing repository after discovery found concurrent dirty work. Active implementation path is `/Users/erickheslan/Developments/study/workadventure/.worktrees/konclui-native`, branch `20261112-konclui-native`, starting at official commit `38c808924267157fb3bd3f7a943de35f026e4773`. Keep the parent checkout and `konclui-work` unchanged. Upstream pushes are disabled.

## Current state

Official tag/tree verified. Clean worktree created with official history. Read-only inventories cover 12 engine patches, 25 product groups, and six service boundaries in [migration matrix](../migration-matrix.md). Contract acceptance is recorded in [contracts](contracts.md). The native shell, dock, chat geometry, editor placement, thin walls, sitting, and visible-animation controllers have candidate source. Runtime and pinned build/test gates remain pending; there is no verified frontend artifact or preview yet.

The standalone map and character builds passed: map validator reports no errors, 86×56 tiles and 201 seats; 268 avatar layers and 136 comparable pet images match existing exports byte-for-byte. These are asset-generation results, not native runtime or visual certification. Generated map scripts retain intermediate page-event contracts that still need native consumers.

At 02:44 Europe/Rome on 2026-11-12, the coordinator redirected heavy compilation to the user-authorized `~/grokbox-offload` queue. The pickup window ends around 03:15 that morning. Frontend job `wa-native-20261112-0245` was collected (`TAKEN` observed at 03:04); candidate fingerprint is `a76507c822b4ae412334bab3854cfc6a480a35b41ea065692d2530f9a423763a`. Asset job `wa-assets-20261112` was submitted before the deadline, including isolated whiteboard links and a fresh complete-build gate. The latest queue policy runs directly on host Linux Node24/Python3.13, without Docker; requested resource limits are not certified. Local Node builders were stopped under severe Mac memory pressure. Baseline build exited 137 after the requested stop during dependency installation; this is an interrupted check, not a source compilation failure. See `.audit/konclui-runtime/local-build-interruption.json`.

Prior native front source at reference `fork/build/v1.34.5-front-src` is reusable for engine behavior, but its global bridges are not the final architecture. The full native tracing branch changes the message hash and must not be mixed with official services.

Independent source review found and rechecked three fixed regressions: viewport-relative co-website dragging, immediate animation invalidation on layer/tile mutation, and mobile panel focus restoration. Focused tests are included in the frozen frontend job. Candidate Compose merge validation passed with synthetic configuration; no services were started. `claude-sonnet-5-5` availability was confirmed through `klaude`; visual review awaits actual engine captures.

## Concurrent owners

- Coordinator owns matrix/contracts/handoff, source integration, and review.
- Offload preparation workers completed and were interrupted after releasing local sessions. The coordinator owns result collection and acceptance. Queue execution belongs to its remote operator; no local installation or compilation is running.
- Asset inventory and map build workers completed and released their sessions. The selected import is 12,022 inputs totaling 32,751,936 bytes. Source adaptations and generated receipts are described in [assets](assets.md).
- Shell implementation worker completed. Candidate `play` sources are frozen for offload; independent correctness review is read-only. Coordinator owns integration after the snapshot.

Worker resource records must name exact container/process identities and stop commands. Builder `b1abfd88c4cd` and cache receiver `cf84c7194c96` were confirmed removed, along with their two empty task-owned dependency volumes. Preserve borrowed reference services on port8090 and stopped sprite-check services. Candidate baseline uses an isolated project and port8093. Do not treat stopped borrowed containers as garbage.

## Next action

Collect the remote baseline/candidate production artifacts and independent review. Verify artifact hashes before mounting baseline A in the isolated stack, then execute `tools/verify-baseline-browser.py` for live cache and movement evidence. Resolve actual failures, finish the candidate map/runtime integration and run the first-slice checks. Update this handoff and matrix at each phase/slice; commit only verified owned changes. Remaining product, visual, synthetic-call, performance, and 1000-user gates remain open. Nothing has been published.

The user requests disk conservation. Remove task-created temporary duplicates after verifying their retained replacement. Keep source, editor state, evidence, and the single preview needed for review. Never run broad Docker prune or delete another task's files.

## External verification blocker at 03:32 Europe/Rome

Frontend job `wa-native-20261112-0245` has a TAKEN timestamp of 2026-11-12 02:58:30 CET, but no outbox exists as of 03:32. The requested 1800-second timeout is not evidence that the host runner enforced it or started immediately. Do not claim success, failure, or continued execution without returned evidence. Asset job `wa-assets-20261112` still has READY and no TAKEN after the approximate 03:15 pickup window. The coordinator requested queue status; no permission to duplicate heavy jobs or alter frozen submissions is inferred from silence.

All local worker sessions are released. No baseline/candidate server or browser is running. Task builders, cache receiver, empty dependency volumes, temporary packaging copies and extraction fixtures were removed. Keep the two submitted source archives until delivery/integrity acceptance; they are still needed queue inputs. The reference services remain intact.

Next executable steps after return:

```sh
python3 -B deployment/konclui/accept-offload.py wa-native-20261112-0245
```

Inspect the independently retained statuses and logs. A successful baseline build artifact can be used for baseline runtime checks even if a candidate check failed; that failure stays open. The accepted baseline public directory is `.local/konclui/builds/wa-native-20261112-0245-baseline/public`. Use a target-local symlink at `.local/konclui/front` to avoid duplicating it, after confirming that path is still absent. Copy its frontend manifest to `.audit/konclui-runtime/frontend-manifest.json`, check `lsof` and `docker ps -a`, then use `deployment/konclui/stack.sh start`, `deployment/konclui/verify-http.py`, and `tools/verify-baseline-browser.py`.

For C, follow `candidate-runtime.md` after the complete asset receipt and frontend checks exist. Its root/direct URL, source-bundle provenance, visual identity, UI behavior, calls and cache gates remain unexecuted. Source review alone does not close them. UI contracts now also record the inspected 5 fps simplified-mode cap, Unicode-tag emote encoding and unresolved mixed economy restoration behavior.

Independent delivery review found two further fixes, now rechecked in source: create empty custom-resource mountpoints before the readonly frontend bind and accept the full offload artifact-label length. See `.audit/konclui-runtime/independent-delivery-review.json`. Compose merge and archive-path safety fixtures passed; container startup remains pending. All source remains uncommitted until a verified slice passes.

## Resumed execution at 09:20 Europe/Rome

The user explicitly authorized completing the work, granular commits, PR/review/merge and necessary database changes. The existing `origin` is `heslanx/workadventure`, with ADMIN access. Its sole branch `master` points at `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`, beyond the pinned baseline and used by the other workstream. Use a separate `konclui-v1.34.5` integration branch seeded at the verified tag for this migration's PR; do not merge the clean-baseline migration into the newer master or rewrite either history. Official upstream pushes remain disabled.

Neither Grokbox job returned artifacts by 09:17. Mac load dropped from roughly500 to34; disk has51GiB free. A serialized local frozen A/C build now uses task-owned container `944909036a1060e5f7bd38d744b5529cf9eda4a28fa302858d8b7a8effeef1a0`, 2 CPUs and5GiB total memory+swap, cached pinned Node24 image. Worker `native_baseline_runtime` owns exec session8290 and release. Evidence lives in `.audit/konclui-runtime/local-frozen-20261112-0920`. Preserve the remote submissions until their execution state is reconciled; do not fabricate remote outbox results from the local run.

No relational database/schema change has been identified as necessary for the current native shell/assets slice. Native Redis/map-storage state stays isolated. The authorization permits required data changes but does not make an unrelated production mutation part of this task.

Baseline A is now extracted and file-hash verified under `.local/konclui/front` with `.audit/konclui-runtime/frontend-manifest.json`. The coordinator started only the `konclui-native-baseline` Compose project (session35376), loopback8093 after checking ports/containers. Initial HTTP request before health readiness returned404; this is not a passed gate. Candidate build remains owned by native_baseline_runtime. The separate asset_rebuild_verification worker owns a bounded fresh all-assets run and its output evidence.

## Verified baseline and asset commits

Commits `2d19d5834` (contracts/gates) and `25a840366` (selected source/assets builder) now exist locally. Baseline HTTP/provenance passed. Browser cache/movement passed in `.audit/konclui-baseline-browser-20261112-short-names/report.json`: six initial sprite layer fetches, zero reappearance fetches, six disk-cache hits after reload, remote movement, zero page errors. Two earlier probe failures were invalid synthetic usernames (default maximum10), not engine defects; the harness now uses CacheA/CacheB and records failure screenshots. Baseline Compose was stopped after proof to release memory; its isolated map state remains. No physical-GPU/media/performance claim is made. Portable receipts are in `evidence/`.

The all-assets rebuild passed after whiteboard isolation;13,228 outputs/14,467,560bytes were rehashed and source inputs remained unchanged. Ten existing DOOR_AT_CORNER map warnings remain recorded. The asset commit retains imported/vendor bytes: whole-commit `git diff --check` reports inherited whitespace and a false conflict-marker match on the chess SVG license underline (`=======`). The SVG is legal XML-comment text; these imported notices are not rewritten to silence the check. New implementation diff checks remain separate.

Initial frozen C passed49tests,typecheck,Svelte and production build. A refined C adds an explicit optional ProfileMenu contextual-actions property, preserving upstream automatic default and removing the dock hidden-marker CSS override. Narrative comments were removed and the pathfinding public contract corrected to entry directions. A new exact snapshot/recheck is active under `candidate-refined-20261112`. Independent correctness review and the candidate browser harness are active; candidate runtime is not yet started.
