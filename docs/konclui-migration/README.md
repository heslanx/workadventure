# Konclui native fork

The native migration preserves the existing office on official WorkAdventure v1.34.5. It uses native Svelte, Phaser, stores, and protocol owners. The implementation is in progress. The [migration matrix](../migration-matrix.md) owns completion claims.

## Working guide

1. Read the nearest upstream `AGENTS.md` and the package scripts before changing a subsystem. Upstream guides remain authoritative for TypeScript, Svelte 5, translations, tests, and formatting.
2. Read [boundary contracts](contracts.md) before changing room lifecycle, presence, media, map state, or cache behavior. Room roster, viewport visibility, and active call membership are separate concepts.
3. Use the [isolated runtime workflow](runtime.md) for build, start, inspection, and stop. Keep the parent checkout, reference repository, and their services intact.
4. Use the [selected asset pipeline](assets.md) for source provenance and reproducible imports. Editor-authored WAM state is persistent data; never replace it with generated defaults during an update.
5. Record each verified slice and its exact evidence in the matrix and [handoff](handoff.md). Make local commits only after the slice passes its gates. The user authorized granular commits and the PR/review/merge workflow on 2026-11-12. Keep integration on the pinned fork branch and complete technical gates before merge.

## Product verification

Preserve the current Konclui design tokens, map, art, controls, and interactions. Evaluate the affected flows at 360, 768, 1000, and 1440 pixels. Include keyboard/touch, reduced motion, denied media, reconnect, root/direct entry, chat/panel transitions, and resource cleanup. A hidden control or a skipped scenario is not a pass.

Use the existing package runners for focused unit, type, Svelte, lint, and formatting checks. Use actual local engine captures for visual changes, then an independent Sonnet review through `klaude` when available. Check every reported visual finding against the image and source. Independent code review is a separate gate.

Benchmark only identified production bundles. Keep A upstream, B reference product, and C native candidate distinct. Product claims compare equivalent B/C capabilities with at least five interleaved runs and error counters. Scale tests use protocol clients plus one to three browsers; they do not launch 1000 browsers. Physical modest-device and multi-node claims require their own evidence.

## Ownership and resources

One writer owns each file during a slice. The coordinator integrates and verifies worker results. Record task-owned container/process identity, purpose, and shutdown command. Keep at most one preview after final verification. Remove unused task-created archives, transient outputs, and test fixtures after verifying their retained replacement. Preserve maps, source, evidence, and other sessions' resources.

The reference checkout is a migration input only. Its absolute paths may appear in provenance documentation and one-time import commands; they must not be required by the target runtime or standalone build.

The [release preparation record](release.md) separates local implementation, local verification, scale evidence, and publication. [Candidate activation](candidate-runtime.md) stays blocked until its complete asset and frontend receipts pass.

[UI boundary characterization](ui-contracts.md) records the inspected profile, navigation, economy, emote, and FX contracts, including source/documentation differences that still require runtime proof.

The [performance verification contract](performance.md) defines variant identities, correctness gates, measurements and the bounded optimization search. Its evidence remains open.
