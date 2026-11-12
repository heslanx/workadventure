# Avatar learnings and review workflow

Read this before changing avatar art, compositing, editor persistence, or acceptance
checks. The user requested persistent learning and independent Gemini review on
2026-10-12. This is the reusable workflow; current delivery results belong in
[`design/avatars/verification.md`](../design/avatars/verification.md).

## Work from the resolved path

1. Reproduce the reported appearance with the actual recipe and shipping renderer.
   Identify the slot, stable option ID, direction and animation column. Express
   pixel coordinates in the native cell, accounting for the gait offset. Compare
   the skin, hair and outfit layers when a visible strip could belong to an ear,
   neck, scalp or garment.
2. Preserve a versioned baseline of the affected sources and proofs. Keep current
   gallery URLs stable. Follow the native source and layer contracts in
   [`README.md`](README.md); retain the pinned body, proportions, anchors and walk
   cycle. Reference pictures guide the paint, shading and accessories.
3. Correct the owning source. For full-cover hairstyles, use the independently
   measured anatomical coverage in
   [`identity/hair_bodies/scalp_continuity.py`](identity/hair_bodies/scalp_continuity.py).
   Preserve eyes, neck and deliberate shaved areas. Ear visibility follows the
   style: exposed ears stay intact, while a bob or ear flap may cover them.
   Resolve each proposed
   coverage exception visually and record its anatomical or design reason.
4. Validate the failure mode across all 12 frames. A regression for an observed
   defect must reject the archived defective asset and accept the correction.
   Include contrasting hair/skin colors and relevant accessory combinations.
   Source validation, renderer parity and visual inspection establish different
   facts; retain evidence for each.
   For side views, compare front/back identity with separately authored left/right
   silhouettes. An unchanged frontal lock can frame a profile face like a hood
   even when scalp coverage passes. Ear visibility depends on the item: a cap's
   ear flap is expected to cover the ear, whereas a glasses arm meets it.
5. Rebuild after source owners freeze their changes. Restart the local preview
   after a catalog rebuild, then regenerate proofs with the shipping renderer.
   Confirm the gallery catalog hash matches the build before reviewing screenshots.
6. Obtain an independent Gemini visual review. Supply the user reference, native
   and enlarged proofs, all directions/gait frames, acceptance rules and known
   intentional overlaps. Ask for precise asset/frame/pixel findings, inspect
   every reported defect, and re-review corrected outputs. Review the affected
   pieces and their interactions; for a catalog expansion also review every new
   category and collection. Record the actual inspected scope and remaining limits.
   If Gemini is unavailable, record the missing gate explicitly.
7. Run the applicable checks from the avatar README and the project verification
   guide. Keep browser suites sequential when they compete for the local engine.
   Reuse passing evidence only while its inputs remain unchanged. Record final
   results, unrelated failures, retained preview and resource cleanup. Update this
   guide when the work yields another reusable lesson.

The installed Gemini worker route is Orca's `antigravity` agent. Consult the
installed orchestration skill for current model discovery, dispatch and cleanup;
use this existing checkout. A standalone `gemini` executable is not required.
Antigravity is the transport, not proof of which model ran. Discover available
models through the installed `agy models` command in the configured interactive
shell, select a Gemini model explicitly at worker start, and retain the effective
launch receipt. A provider/executor failure before image inspection is a missing
review, never an artistic verdict; stop/release that attempt before retrying.
Keep review prompts, inspected-file lists and verdicts with the delivery evidence.

## Confirmed failure modes

| Problem and cause | Resolved approach and evidence |
| --- | --- |
| Classic/soft eyes still looked tinted and empty although the three added expressions had whites. The imported options used the generic whole-layer tint mask. | Apply the fixed sclera/highlight/pupil contract to **every** eye option. Author current classic/soft paint within their exact original alpha footprints; preserve imported sources and legacy catalogs. Verify the composed face at dark/light iris extremes, on contrasting skin and through transparent lenses, in all visible gait frames. `tests/test_avatar_eyes.py` rejects the archived tinted eyes and protects whites, recoloring, footprint and legacy compatibility. Opaque sunglasses/enclosing masks intentionally hide the base eyes. |
| Scalp strips survived the first bun fix. The test sampled a central nape strip but omitted the crown and side perimeter. Curls, braids, ponytail, the Franky pompadour and Dragon Ball spikes had related gaps. | Measure crown, profile and rear scalp from the pinned body, independently of the hair being tested. Every archived defective style must fail the coverage contract. See `identity/faces/test_fit.py`, `identity/hair_bodies/proof-scalp-detail.png` and `identity/hair_bodies/continuity_proof.py`. |
| Skin-colored pixels were easy to misclassify. Ears can be visible or covered depending on the style, while some lower rear pixels belong to clothing. Similar brown hair/skin colors conceal leaks. | Inspect composed and isolated layers with contrasting colors. Protect exposed ear anatomy and the area below the nape; allow intentional coverage by a bob or ear flap. Keep named intentional bald/shaved styles separate from full-cover styles. The contract owns coordinates and exceptions; this guide does not duplicate them. |
| Browser/Python parity and nonempty-frame checks passed despite visible scalp defects. | Treat parity as compositor consistency only. Gemini must inspect actual pixels and continuity; the gallery generator proves placement/coverage, not artistic correctness. The superseded gallery is archived in `design/avatars/archive/identity-v3-before-scalp-fix/`. |
| A review spanning a rebuild mixed pre-fix failures with current acceptance and overstated what screenshots proved. | Stamp review rounds with the catalog hash, label historical findings, and preserve the original report before correcting its wording. Cross-check exact colors/coordinates against the owning source. Separate visible appearance from interactive test evidence; a scoped visual pass never grants deployment authorization. See `design/avatars/gemini-visual-review-v3.md`. |
| The previous broad review missed the Mônica bob's frontal lock being retained in profile and the Chaves flap hanging behind the ear. Both could pass eye/scalp checks. | Review actual lateral projection and the item's intended anatomy, not only pixel clearance. `tests/avatar_profile_review.py` freezes both profiles and all gait frames for every option, with front/back context and named interaction cases. Preserve each round and its catalog hash; corrections require a new Gemini inspection. |
| A detailed visual report invented option IDs, board rows and native coordinates while describing real defects. Whole-composite color counts also mistook matching trousers/shoes for hair or cap pixels. | Derive labels and zero-based row indices from `board-index.json`. Use the full 32×32 cell for coordinates; an alpha-bbox crop has a different origin. Measure a part from its isolated alpha, not a similar RGB anywhere on the body. Corroborate actionable claims with source layers, preserve the raw report and require a corrected evidence log. Never equate a long report with complete pixel inspection. See `design/avatars/archive/profile-baseline-gemini-originals/`. |
| Handheld motion was mistaken for detachment; the actual wizard-staff defect was higher up, where a back-plane connector vanished behind the face while its crystal remained in front. | Inspect both grip contact and visible end-to-end structure in the final composite. Measured hand-overlap tests establish only the first fact. The staff now uses explicit per-frame straight shafts through measured grips, with its crystal outside the rear head contour and the visible connector in the near-hand plane. `identity/props/test_staff_profile.py` rejects the archived broken composite and checks the corrected path across bodies, skin colors, hair and gloves. |
| A profile-wide recolor branch erased the Pegasus upper silver armor while leaving front/back art correct. | Limit red undertunic coloring to its authored region; retain upper metal in each side gait frame. `identity/pop/test_profile_fit.py` checks the missing upper plate against archived art and preserves front/back output. Inspect recognizable materials across directions, not only silhouette and contact. |
| A proof copied one catalog but rendered a later read, allowing a concurrent rebuild or environment override to invalidate its hash. | Point the renderer at the immutable copied catalog, clear its catalog cache, record source-manifest hashes and write `COMPLETE` only after successful export. Frozen recipes and compact board indices belong to the same round. |
| A label and imported sheet disagreed: the Chanel choice used a source with a high side ponytail. | Keep the pinned upstream source and published legacy IDs unchanged; author the intended current-catalog profile explicitly in `identity/hair_bodies/profile_fit.py`. The regression compares the new silhouette against the pinned counterexample. |
| A fixed-height hair matrix omitted later choices when the catalog grew. | Derive rows from the actual option count. Check every recipe's placement and read back exported pixels. `tests/avatar_identity_review.py` owns the generated gallery and coverage manifest. |
| Portuguese accents and dashes were missing from exported proof labels although the HTML was valid UTF-8. The default Pillow font lacked the glyphs. | Use an already-installed font with the required glyphs and inspect the exported image labels. The gallery generator owns Arial/DejaVu selection; the failed first font pass is archived in `design/avatars/archive/identity-v3-label-first-pass/`. |
| Saved recolors could be replaced by a newly selected option's suggested color during recovery. | Apply `defaultColor` only on an explicit change to a different option. Existing recipe colors remain authoritative, including legacy migration and clicking the already-selected choice. Editor flow checks cover these distinctions. |
| The standalone editor saved a new recipe but reopened the old engine identity. `characterTextures` had priority and its ID was not updated by the standalone save callback. | Save the composed ID in the standalone callback as the native bridge does. Test save, reopen and reload while an older engine ID remains present. A failed storage write must preserve visible choices/draft and permit retry. See `theme/avatars/index.html` and `tests/avatar_editor.py`. |
| Clear and random actions can accidentally replace the saved identity or mutate a request already being saved. | Update the editable draft only; keep both controls inside the pending-save inert region. Clear retains body, skin and eyes with the required basic outfit. Test failed-save retry and reopen/reload with an existing engine ID, as well as visible keyboard access on desktop, tablet and mobile. See `check_quick_actions` in `tests/avatar_editor.py`. |
| Updating source art can silently change old self-contained avatar IDs. | Preserve published-version catalogs and golden PNG hashes. Migrate choices/colors in memory; only saving creates a current-version ID. The backend contract and `legacy/README.md` own version compatibility. |
| A rebuilt catalog did not appear in the already-running preview. The Python renderer caches catalogs and textures. | Restart only the preview created for the task, reuse its URL, and verify the returned catalog before capturing evidence. Do not diagnose stale pixels as another authoring failure. |
| Replacing diagnostic screenshots with a timeout hid the original browser assertion. | Preserve the original error and make diagnostic capture best-effort. Repair the specific test fixture or product behavior; retain evidence of the actual failing flow. |
| The native customizer's "Clássicos" section mixed skin tones with skeletons, ghosts and grey/black bodies, eyes with glasses, and weapons with a face mask (owner report, 20/10/2026). It was the engine's whole list renamed, and the sections lived in constants inside `native_export.py` while production kept a hand-edited copy. | One contract, `sections.json`, with sections by kind shared by engine and catalog pieces; `native_export.py` and `sections.py` derive every list from it. `tests/test_avatar_sections.py` fails on a texture with no section or two, a member matching nothing, or a consumer drifting. Evidence: `check_woka.py` PASS on 20/10/2026 with the new sections and tabs. |
| The Koncluí "Nenhum" sheets (`kc-hair-none`, `kc-hat-none`, `kc-accessory-none`) were byte-identical to the engine's `hair1`, `hat1` and `accessory1`, which are fully transparent. The README also claimed new visitors start holding a sword; they start with `accessory1`, empty. | Use the engine's empty textures as the "nothing" sections and stop exporting ours. `check_woka.py` reads back zero opaque pixels from each one as the engine serves it. |
| Grouping changes engine behaviour: the customizer preselects the first texture of each part's first section for new visitors, and "Randomizar" draws only from that section ([code] `WokaCustomizeScene.svelte`, v1.34.2). | Order sections deliberately: the first one is a product decision, not just a label. Production's first section must exist in every list, which the contract test checks. |
| The tab labels and the "<part> Options" heading are the internal part names, not translated by the engine; the heading is also styled `capitalize`, so a Portuguese text read "Opções De Corpo". | Rewrite the engine's own text node in place (its updates compare a cached value and write the next English text, which is translated again) and set `text-transform: none` on that heading. Labels come from the contract. |
| `art/build_woka.py` and `fetch_sources.py` read engine textures by position in the first collection of `admin-api/woka.json`; regrouping that list would have made them fetch the wrong sheets without error. | Read the engine's own list (`local-wa/woka/upstream-woka.json`). `build_woka.py` no longer writes the admin-api lists; `sections.py` does. |

## Evidence and open decisions

The user screenshot that reopened scalp acceptance is represented by the archived
before/after proofs. The new contract checks the full intended region and protects
the ears/neck. Any style-specific exception pending visual assessment remains a
review item; a passing contract with an unresolved exception is not final approval.

For each reusable lesson, record the trigger, root cause, owner path, corrective
action, observed validation and any exception. Link the relevant test or proof
instead of copying commands, coordinates or option counts into multiple documents.
Revise a disproved rule in place and preserve its historical evidence in the archive.
