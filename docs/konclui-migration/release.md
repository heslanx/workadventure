# Local release preparation

This is a release-input checklist, not a release or a completed local delivery. The migration matrix owns product gates. On 2026-11-12 the user authorized completing the migration, granular commits, PR/review/merge and necessary database changes. This document does not certify readiness; the technical gates still govern publication.

## Current build boundary

The submitted verification builds the frontend and iframe API from this worktree's pinned source and generates messages from the matching upstream protocol inputs. The local stack currently reuses official v1.34.5 Pusher/Play, Back, and map-storage images. Custom frontend output is mounted into the official Play service without HTML injection or bundle rewriting. This does not certify a complete custom service image.

The candidate's selected map and character inputs are target-owned. Generated assets are a separate serving boundary with provenance receipts. Stable custom URLs currently require revalidation; versioned immutable delivery remains an open cache gate. Map-storage owns edited WAM state, independently of any generated seed.

The eventual image package must include the frontend plus its native Pusher, Back and map-storage compatibility evidence, selected static assets, source identities, lockfile identities, image digests, and the completed verification reports. Registry access is unnecessary for constructing and inspecting those images locally.

## Architectures and local construction

The Mac's existing service images are `linux/arm64`; the offload runner is Linux x86-64. A JavaScript frontend built on x86-64 can be served locally, but this does not certify native modules or an ARM64/AMD64 service image. Record the production target architecture before building release images. Do not silently run emulation and call its timing native performance.

Upstream build entry points are [Play](../../play/Dockerfile), [Back](../../back/Dockerfile), and [map-storage](../../map-storage/Dockerfile). Play also has a `front` target for its static frontend. Build from a frozen, verified source snapshot with the intended architecture and local tags; these builds have not yet been executed for the complete candidate. Keep generated message hashes aligned across frontend, iframe API, Pusher, Back, and map-storage. Never stamp a guessed version to suppress a mismatch.

Required publication access: the chosen registry namespace, push permission for the release operator, target architecture, and the production platform's pull credentials/configuration. Do not copy those credentials into this repository or benchmark archives.

## Workflows and upstream updates

The inherited [build/test/deploy workflow](../../.github/workflows/build-test-and-deploy.yml) triggers on pushes to `master`/`develop`, created releases, and selected pull-request events. It includes registry and Helm deployment jobs. Preserve upstream files during migration, but review and configure these workflows before creating any remote fork or pushing. The old `konclui-work` repository has a separate main-branch auto-deploy contract; it remains untouched.

Keep the official remote named `upstream` and its push URL `DISABLED`. A future upstream update starts with `git fetch upstream`, review of the desired tag and release changes, and an isolated update branch/worktree. Rebase unpublished local migration commits or merge a reviewed tag into a shared fork history; do not rewrite published history. Rerun protocol generation/hash parity, affected contracts, root/direct entry, asset caching, visual checks, and representative load tests before accepting the update. This migration stays at v1.34.5.

Upstream license and notice files remain in their original locations. The selected-asset provenance manifest records imported origins, font notices, and vendor notices. Keep these with distributed artifacts; do not discard them as temporary files.

## Rollback and smoke inputs

Before any future deployment, retain the previously accepted image digests and serving configuration, snapshot the current editor-authored WAM through its owner, and prepare a configuration rollback to those digests. Rollback must preserve map-storage data and must not reseed from generated defaults. Retain old content-addressed assets for clients with cached entry points.

The post-change smoke plan covers root/direct entry and reload; correct native shell and dock; expected map and edited entities; matching bundle/source/protocol identities; no legacy injection; custom resource cache validators; two synthetic local participants; movement, presence and reconnect; and a synthetic media call. Production verification retains the existing visitor/no-real-device restrictions and requires the release readiness gates to pass. A passed local smoke is not production verification.

## State separation

| State | Current evidence |
|---|---|
| Local implementation | Partial native shell/controllers and standalone asset pipeline; remaining matrix rows open |
| Local verification | Asset-generation evidence, source review and scoped syntax/configuration checks; remote builds and browser gates pending |
| Performance and 1000-user scale | No candidate claim; production-equivalent workloads and measurements pending |
| Production release | Not built as a complete release package, not published, not deployed |

The authorized PR target is the fork `heslanx/workadventure` on a dedicated `konclui-v1.34.5` base branch seeded at the pinned tag. Its existing `master` contains newer work and is preserved. A PR merge into the dedicated branch does not certify or implicitly perform a production deployment.
