# D14: container image targets

`image-targets.csv` has one row per image declaration: 51 rows. Of these, 44 come from `inventory/container-images.csv` and 7 from `inventory/helm-image-declarations.csv`. `resolve_tags.py` is the read-only registry lookup that produced the tag, digest and architecture columns.

The image tags and digests were looked up in the registries only. No image was pulled, scanned or run, and no SBOM was produced. Every digest and architecture value is what the registry returned at lookup time. The CSV records no per-row timestamp, but the node notes show the lookup ran after 2026-11-11T23:39Z. Re-resolve each one before pinning it.

## Counts

All counts below were computed from the CSV with the Python `csv` module on 2026-11-12 at 00:38 UTC.

By classification and status:

| classification | already_current | pending | blocked_with_reason | total |
|---|---:|---:|---:|---:|
| low_risk_patch_minor | 13 | 9 | 0 | 22 |
| migration_gate | 4 | 9 | 2 | 15 |
| project_built | 0 | 13 | 0 | 13 |
| unresolved | 0 | 0 | 1 | 1 |
| **total** | **17** | **31** | **3** | **51** |

By kind:

- `third_party_pinned_tag`: 20
- `third_party_floating_tag`: 18
- `project_built_variable`: 13

## Failed lookups and anomalies recorded in the CSV

1. **`ghcr.io/soluto/oidc-server-mock:0.7.0`** (`docker-compose.yaml:363`) is the only `unresolved` row, with status `blocked_with_reason`. The version order and the image creation dates disagree: `10.0.0` was created on 2024-10-30, `0.12.1` on 2025-05-04 and the declared `0.7.0` on 2022-07-14. The upstream release history and the mock's config schema were not consulted.
2. **`docker.io/library/node:24-trixie-slim`** (8 rows in the back, map-storage and play Dockerfiles) had a mixed index at lookup. The amd64 image was 24.22.3, pushed 2026-11-11T23:39Z without arm64, while the arm64 image was still 24.22.2. The pin candidate is therefore `24.22.2-trixie-slim`, the newest version with both amd64 and arm64.
3. **13 `project_built` rows** were not resolved by design. Their architecture is `not resolved (built by project CI)`. They are built from the accepted SHA rather than chosen from a registry.
4. No row records an HTTP or network lookup error.

## Recommended order of small PRs

Each step is one reviewable PR, ranked from lowest risk to highest. Every PR re-resolves the digests it pins and runs the compose or Helm path it touches.

1. **Replace implicit and `latest` tags with pinned versions** (2 rows, both low_risk):
   - `busybox` → `1.38.0` in `contrib/helm/templates/mapstorage-deployment.yaml:56`
   - `redislabs/redisinsight:latest` → `3.8.0` in `docker-compose.yaml:346`. 3.8.0 has the same digest as `latest`.
2. **Patch and minor bumps of third-party tools** (7 rows, all low_risk_patch_minor, pending):
   - `matthiasluedtke/iconserver` v3.21.0 → v3.23.0 (2 compose rows and the Helm `values.yaml`)
   - `amazon/aws-cli` 2.31.1 → 2.40.1 (3 compose rows)
   - `alpine` 3.14 → 3.24.4 (`docker-compose.e2e.yml:120`)
3. **Optional Node digest pin**: `node:24-trixie-slim` → `24.22.2-trixie-slim@sha256:...`, only after both architectures are confirmed again. Node 26 is a major change and needs its own PR.
4. **One migration gate per PR** (pending):
   1. traefik v3.6.1 → v3.7.18
   2. matrixdotorg/synapse v1.140.0 → v1.165.0
   3. rustfs 1.0.0-alpha.83 → 1.0.5
   4. thecodingmachine/php 8.1-v4-apache-node12 → 8.5-v5-apache-node24 (3 rows, including `maps/Dockerfile:1`)

   Each one needs the gate described in the CSV's `gate` column.
5. **Blocked until a decision is made**:
   - `redis:6`: choose 7.4.12 or 8.10.3 (2 rows).
   - `oidc-server-mock`: settle the version order (1 row).
6. **No PR needed**:
   - The 13 project-built rows are rebuilt at the accepted SHA.
   - The rows already current (livekit-server v1.13.11, egress v1.15.0, the `thecodingmachine/nodejs` v2-24 tags, nginx 1.30-alpine3.24) need no change.
