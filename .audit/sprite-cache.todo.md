# Local runtime and sprite cache verification

- [x] Capture the live signal on the matching surface via the driver skill: a CPU profile for a spinning process, a heap snapshot for a leak, a CDP trace for a visual glitch. A real artifact, not a guess.
- [x] Reduce the artifact to the smoking gun: the function on the hot path, the retainer chain from the leaked object to a GC root, the loop firing without input. Parse large artifacts in a subagent (the **guard-the-context-window** principle skill), keep the reduced finding in the main thread. Pick each subagent's reasoning level for the job, per the Subagents section.
  - skip: no large artifact or agent delegation is needed for a bounded request-count comparison.
- [x] Prove the mechanism before believing it. Inject instrumentation via CDP eval on the running process, or hotfix the live code without reloading, to confirm the hypothesis cheaply.
- [x] Map the finding back to source: file, symbol, the line that allocates or schedules.
- [x] Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only forensics`.

## Execution
- [x] Start an isolated Compose project for this checkout.
- [x] Verify page load and two player sessions.
- [x] Compare sprite requests for first appearance, reappearance and reload.
- [x] Save sanitized evidence and remove measurement overrides.

Expected claim: a previously loaded sprite is reused when a remote player reappears. Measure request counts and cache indicators, not frame timing. Distinguish development HTTP headers from production configuration.

## Resources
- Borrowed Docker daemon and Chrome browser. Preserve unrelated containers and user tabs.
- Owned image pull command, exec session 73418. No application containers created yet.
- Intended Compose project: workadventure-sprite-check, current checkout. Retain the application for the user after verification. Stop with the same Compose project and override using `stop`.

- Owned setup container 73178281300c, started 2026-11-11T22:33:07Z, exec session 48161. Auto-removes on completion.
- Owned browser tab cacheTab, created for network measurement. Close after measurement.

## Current evidence
- Root page, pusher /ping and test map return HTTP 200.
- Browser rendered the player name form; Chrome then blocked automation because an extension UI was open. The user has been asked to dismiss it.
- Real PNG GET returned 200 and 3488 bytes; conditional GET returned 304 and zero body bytes. See sprite-cache.http.json. This is HTTP revalidation evidence, not yet a player reappearance measurement.
- Image pull and setup commands completed successfully. Setup container auto-removal verified.
- Product sources and tracked lockfiles unchanged; pre-existing .gitignore change preserved.
- Application retained at user request. Browser tab cacheTab retained for the pending browser check.

## Final browser result
- Dedicated Chrome DevTools profile with isolated observer and visitor contexts.
- First remote appearance: six custom sprite GETs, all HTTP 200.
- Departure: zero remote players and all six textures retained in Phaser.
- Reconnection: new remote player ID 4, six rendered textures, zero additional custom sprite requests.
- Observer reload with cache enabled: six HTTP 304 revalidations, six rendered textures.
- Single functional comparison; no throughput or timing claim.
- Evidence: sprite-cache.browser.json and sprite-cache-two-players.jpg.
- DevTools pages 2 and 3 closed; page list contains only the pre-existing blank page. Runtime-managed MCP browser preserved.
- No temporary page instrumentation or cache overrides remain. Application stack retained for user access.

- Cleanup limitation: extension-browser tab 1406613901 remained listed after both supported close attempts failed with "Debugger unattached". No user tabs or browser processes were terminated. It may require manual closure; task-owned DevTools pages were verified closed.
