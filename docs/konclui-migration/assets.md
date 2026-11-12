# Selected asset inputs

The importer inventories the current reference files and verifies their SHA-256 hashes without executing legacy code. It does not copy assets unless you pass `--import`.

## Reproduce the inventory

Run from this worktree. The two source paths are one-time import inputs, not runtime dependencies.

```sh
python3 -B tools/konclui-assets.py \
  --reference /Users/erickheslan/Developments/konclui-project/konclui-work \
  --brand-assets /Users/erickheslan/Developments/konclui-project/konclui-platform/apps/web/src/assets \
  --check
```

Omit `--check` for a read-only inventory summary. `--write-manifest` writes a new manifest and refuses to overwrite a different one. For reviewed source drift, use `--manifest <candidate.json> --write-manifest`, compare the candidate, then replace the old manifest explicitly.

After reviewing [provenance.json](../../assets/konclui/provenance.json), use the same command with `--import` instead of `--check`. Import requires an exact match between the manifest and current selected inputs. It preserves matching destination files and refuses different existing content. It never deletes files. Source drift, missing files, path traversal, excluded dependency/cache paths, and destination symlink escapes fail before the corresponding file is written. All existing destination conflicts are checked before any copy starts.

## Selection and provenance

The reviewed selection contains 12,022 files totaling 32,751,936 bytes. The coordinator imported that selection successfully into `assets/konclui/source`. Most entries are small content-addressed furniture images. The HQ editor constructs the full furniture catalogue before filtering it, so importing only furniture placed on the map would remove editor content or break the build.

Each manifest row has `sourceRoot`, the original relative `source`, the target-relative `destination`, `sha256`, byte count, ownership group, and input kind. Group metadata points to the source owner and attribution. No runtime source path points to the old checkout.

The selection includes:

1. HQ map build modules and their imported local module dependencies, current editor overrides, sheet inputs, shared furniture catalogue images, and the map scripts. The locally imported `sheets.pieces()` dependencies are included explicitly; unused build commands from other offices are excluded.
2. Only brand-frame originals referenced by `hq-office/frames.py::ART`, current Koru fountain artwork, two required brand SVGs, and the Urbanist font with its existing SIL Open Font License notice from the platform asset folder.
3. Games with their vendor notices, koi runtime modules, reactions, selected sounds, and the Kenney emote images and license.
4. The curated avatar palette/RLE catalogue, section contract, required legacy sprite inputs, and exporter source. The old injected avatar page and compiled native sheets are excluded.
5. All 24 current pet species' `base.png`, `species.json`, and `palette.json`, plus `petkit.py` and catalogue source. Generated atlases, picker images, previews, and historical AI generation runs are excluded.

Stylesheets are classified as `migration-reference`, not native runtime entry points. This manifest does not activate the legacy HUD, page injection, private-store bridge, or gateway.

The avatar catalogue and pet base rasters are curated build inputs. They are enough to derive native sheets and runtime atlases after adapting the exporters. They do not reproduce the original artwork-generation history. The manifest labels that boundary rather than claiming a full authoring-tool migration.

## Standalone build

Run from the target worktree (Python with NumPy/Pillow and `rsvg-convert` already installed):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B tools/build-konclui-assets.py
```

The wrapper builds the map and characters sequentially. `--only map` or `--only characters` reruns one boundary. `--out <directory>` supports a dedicated build directory; a nonempty unmarked directory is rejected. Default output is ignored `.local/konclui/asset-build`. No legacy checkout, platform folder, Docker resource, network call, or generated reference `dist` is needed.

The standalone wrapper passes `--whiteboard-namespace konclui-native-local/konclui-office/` to isolate Excalidraw room links from the reference/production office. The direct map builder retains its original namespace default for compatibility. This option changes only board links, not entity/property IDs or editor-authored state. `all-receipt.json` records the selected namespace under `config.whiteboardNamespace`; candidate preparation rejects assets without a local namespace. Never open the earlier generated board links as a local test: the first direct map build predated this isolation fix.

| Output | Consumer contract |
|---|---|
| `maps/konclui-office/office.{tmj,wam}` and sibling assets | Map storage inputs; generated WAM is a seed, never an instruction to overwrite editor state |
| `resources/konclui/<part>/*.png` | Native avatar layers, URL `/resources/konclui/<part>/<id>.png` |
| `resources/konclui/accessories.json` | Ordered exclusivity groups and labels for a native customizer; no injected loader/page |
| `resources/konclui/companion/koru.png` | Legacy Koru companion, copied from selected source |
| `resources/konclui/fonts/urbanist-latin.woff2`, `fonts/OFL.txt`, `logo.svg` | Native shell font, its license notice, and logo, served under `/resources/konclui/` |
| `resources/konclui-pets/<species>/` | Atlas, native picker, and animation manifest for every curated species |
| `catalogues/{woka,companions}.json` | Target upstream lists plus curated Konclui entries; distinct authoritative IDs |
| `review/map/{preview.png,build.json}` | One composited preview and existing map-validator summary |
| `<scope>-receipt.json` | Output SHA-256 inventory and build/input identities; not runtime certification |

These native adaptations live only in the target:

| Owner | Current dependency | Target contract |
|---|---|---|
| `hq-office/signature.py::ASSETS` | Absolute platform asset folder | Source-relative `brand/` |
| `hq-office/pool.py::{LOGO,KORU}` | Absolute platform / historical `.dream-loop` paths | Source-relative `brand/` SVGs |
| `hq-office/build.py` | Preview written inside source; silently omitted missing koi runtime | Explicit `--renders`; missing koi runtime raises an error |
| `hq-office/build.py` whiteboards | Namespace shared with production room links | Explicit whiteboard-only namespace; standalone local default supplied by the wrapper, existing entity IDs preserved |
| `avatars/native_export.py` | Injected JS/HTML and hardcoded output | Explicit resource/catalogue directories; JSON + PNG only; owned output marker |
| `avatars/sections.py`, `pets/tools/catalog.py` | `local-wa/woka/upstream-*.json` | Explicit upstream paths and pet output; wrapper selects target `play/src/pusher/data` |
| `pets/tools/petkit.py::build` | Hardcoded `pets/out` | Optional explicit output root; original atlas validation retained |

The source layout under `assets/konclui/source` preserves the relative imports used by the map modules. Generate map output into a separate runtime/build directory. Do not activate the copied reference styles or page scripts as a shortcut to native integration.

The provenance manifest retains the original imported hashes. Adapted source deliberately differs from those origins; do not overwrite it by repeating `--import`. Build receipts identify adapted builder hashes separately. No new dependency was installed.

## Build evidence and remaining runtime gates

On 2026-11-12 the direct map command completed with exit zero:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B assets/konclui/source/hq-office/build.py \
  --out .local/konclui/asset-build/maps/konclui-office \
  --renders .local/konclui/asset-build/review/map
```

The existing validator reported `errors: []`: 86×56 tiles, 664 objects, 201 seats, 27 areas, 408 thin-wall tiles, and 3,775 reachable tiles. Both lake and canal koi overlays were generated. FX data contains 169 lights and six rooms. The retained preview is offline composition, not an engine visual review.

`python3 -B tools/build-konclui-assets.py --only characters` exited zero: all 24 species passed the existing atlas validator; 68 pet color variants, 268 avatar layers, 337 custom 96×128 picker/layer images, and 75 total companion choices were produced. All 268 matching avatar PNGs and all 136 pet atlas/picker PNGs were byte-identical to the reference's existing exports; the extra legacy Koru companion is selected source. Character output contains no JS or HTML. This preserves exported pixels, not full browser behavior or compositor parity across combinations.

The old `native_export.py --check` depended on a non-imported legacy server compositor. That comparison is not claimed here: the target exporter removes the HTML/JS branch and its legacy comparison command, while retaining strict section/ID checks and validating generated picker dimensions. Full renderer parity and independent visual review remain migration gates.

The generated map still preserves its existing map-API scripts and page-event contracts. `hq-office/map-script.js` initializes `createPageLink`, `installHud`, `installPets`, and `window.__office*` state. These scripts are **intermediate migration output**: the native candidate must replace their legacy page consumers through explicit native boundaries. No injected HUD listener is installed by this pipeline. Scene FX data builds, but `theme/fx` runtime JavaScript was not in this selected import and still needs a native engine port. Avatar multi-accessory selection, animated pet behavior, seating, thin walls, shaders, and map/HUD events require runtime evidence; exported data alone does not pass those gates.

Stable resource URLs above require revalidation headers until the serving owner provides versioned immutable URLs. This build does not configure cache headers or seed volumes. The Mac was heavily contended during validation; elapsed times are not performance evidence.

The subsequent whiteboard isolation change passed a pure source fixture: default link behavior remains compatible, local links differ, and the entity ID is unchanged. No external board was contacted. A fresh complete local build now verifies the generated links, as recorded below. The queued [asset offload verification](../../deployment/konclui/offload-assets-README.md) has not returned and is not claimed as evidence.

## Verification evidence and limits

The initial manifest and its check both exited zero with 12,026 files before unused optional office modules were removed and external brand inputs were selected. The final manifest has 12,022 inputs. SHA checks compare each selected furniture PNG to the SHA encoded by its source catalogue, in addition to hashing every selected file.

Focused temporary-fixture controls exercised successful import, idempotent repeat import, preservation of conflicting destination content, source-content drift rejection, destination symlink rejection, forbidden paths, and missing references. All six grouped checks passed. A first fixture exposed an overbroad symlink guard on macOS `/var`; the guard was corrected to inspect only destination components beneath the target. Fixtures were deleted by their temporary-directory owner.

These are inventory and copy-safety results. They are not browser, visual, build, cache-header, or performance certification. The coordinator owns actual import, native integration, generated-output checks, and runtime acceptance.


## Complete rebuild after whiteboard isolation

On 2026-11-12 at 09:26:58 Europe/Rome, the standalone all-assets command ran with scheduling priority 15 and `OPENBLAS_NUM_THREADS`, `OMP_NUM_THREADS`, `MKL_NUM_THREADS`, and `NUMEXPR_NUM_THREADS` set to `1`. It exited zero under a 360-second timeout. Python 3.14.6, NumPy 2.5.3, Pillow 12.3.0, and rsvg-convert 2.63.2 were already installed; no dependency installation, reference-checkout execution, network call, or service mutation was required.

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
nice -n 15 python3 -B tools/build-konclui-assets.py
```

The new `.local/konclui/asset-build/all-receipt.json` has SHA-256 `80f8bc1334d7d08c4961eadc49a1fa0893cb27c9a1a628d2e791224ee6444e01`. All 13,228 listed output files match their receipt hashes and exact inventory, totaling 14,467,560 bytes. The 12,026 build/source inputs recorded before execution remained unchanged afterward; receipt-specific input hashes also match the current target files.

Map validation reports zero errors with the same 86×56 map, 664 objects, 201 seats, 27 areas, 408 thin-wall tiles, and 3,775 reachable tiles. Ten `DOOR_AT_CORNER` warnings remain visible in the report and are not suppressed or certified as resolved. The character validator confirms 24 pet species, 268 added avatar layers, 337 custom picker/layer images, and 75 companion choices.

Both generated Excalidraw board links use the isolated `konclui-native-local/konclui-office/` namespace. The generated WAM preserves the established board entity IDs `0b956fcc-bbd6-532d-b494-dd687f92b45e` and `f714c593-3c32-54e5-bed2-aaa02e440898`. The direct builder's default link behavior passed the existing pure source seam as well. No external board was opened.

Local evidence is retained under `.audit/konclui-runtime/asset-rebuild-20261112/`: `build.log`, `source-inputs.json`, `resource.json`, `verification.json`, and the reproducible `run.py`/`verify.py` commands. The build process group exited with no remaining children, and the verifier exited zero. This closes the complete standalone asset-build gate for these inputs. Engine behavior, visual review, cache headers, media, and performance remain separate open gates. The Mac was contended and this duration is not a performance result.
