# Modular avatar sources and offline build

Before changing or reviewing avatars, read [learnings and review workflow](LEARNINGS.md).
It records resolved fitting/persistence failures and the required independent Gemini review.

Current catalog: v3, 143 options including empty choices (78 new collection pieces). The original identity packages (`identity/hair_bodies`,
`identity/hats`, `identity/props`) are joined by `faces`, `fantasy`, `pop` and
`spooky`: expressive eyes, moustache, balding hair and modular fantasy, hero,
anime, television and spooky costumes. Existing body3 proportions and walking
anchors remain unchanged. See the [collections brief](../design/avatars/collections-v3.md)
and [current gallery](../design/avatars/review/identity/index.html).
`legacy/v1.json` and `legacy/v2.json` are frozen and embedded only for server-side
resolution of old IDs; public catalogs omit those archives.

`python3 avatars/native_export.py --check` also exports every option as a layer for WorkAdventure's own
customizer in the local office, beside the engine's options; the engine's fixed layer order limits some
combinations ([local office, "Avatares"](../local-wa/README.md)).

## Sections

[`sections.json`](sections.json) is the one contract for where every choice appears: per part (ready-made
character, body, eyes, hair, clothes, hat, accessory, companion), the ordered sections with their Portuguese names,
and members (texture ids, `*` globs over ids, or catalog `collection`s) that put each texture in exactly one section.
[`sections.schema.json`](sections.schema.json) describes the shape; [`sections.py`](sections.py) enforces the rest.
Terms are defined in [GLOSSARY.md](GLOSSARY.md). Consumers derive from it and keep no copy:

- `native_export.py`: the local customizer list (`local-wa/woka/woka.json`) and `accessories.json` (exclusivity
  groups, tab labels and headings that replace the engine's English ones);
- `python3 avatars/sections.py`: `admin-api/woka.json` and `admin-api/companions.json` for production (they ship
  only with a deploy). The engine's own lists come from `local-wa/woka/upstream-*.json`; the five pre-v3 Koncluí
  pieces and Koru are `legacyPieces` in the contract.

The Koncluí editor (`theme/avatars/`) shows catalog options per slot with search and has no sections of its own.

Rules worth knowing before editing the contract:

- the engine's textures keep their bytes, ids and URLs; only grouping and order change;
- the first section of each part is the engine's default for new visitors and the only pool "Randomizar" draws
  from, so it must contain textures present in every list (an engine or legacy one);
- accessory sections follow the catalog draw order, because collection order is the native draw order; sections
  sharing a `group` hold one piece at a time;
- a costume keeps its universe's section name in every tab.

Checks: `python3 -m unittest tests.test_avatar_sections -v` (exactly one section per texture, no dead member,
consumers match the contract) and `python3 avatars/sections.py --check` (production lists up to date).

`python3 avatars/build.py` builds `catalog.json` deterministically using local Pillow.
Production reads this catalog with Python stdlib only (`admin-api/avatar.py`). The browser
and server share its palette, shade masks, layer order and run-length pixel arrays.
See `design/avatars/backend-contract.md` for the exact rendering and HTTP contract.

Inputs are pinned copies of public WorkAdventure sheets already selected by `admin-api/woka.json`.
`sources/manifest.json` records their public paths and SHA-256 hashes. The optional
`fetch_sources.py` fetches missing source files only; normal builds never use the network.
`koru.png` is copied from the existing `art/out/companions/koru.png`, which derives from the
real Koru reference, not an invented mascot. The sprite-gen `recolor-palette` utility was
used to inspect the old body palette: `body2` is translucent, so opaque human `body3`
was selected. `body2.palette.json` retains that authoring observation.

Six garments reuse upstream animated geometry with textile shade masks and fixed brand
accents. Glasses, beard and headset are custom authored pixel patterns measured against
the actual eyes, ears and jaw in all 12 frames. `accessories/patterns.json` owns their
geometry; `accessories/landmarks.json` records the anatomy. The catalog builder rasterizes
those definitions directly. See [accessory authoring and fit](accessories/README.md). The twelve slots cover body, eyes, hair, beard, outfit, glasses, hat, headset,
handhelds, gloves, cape and aura, independently combinable. All five eye styles,
including classic/soft, preserve fixed white sclera/highlights and dark pupils;
only the iris recolors. Skin and each accessory have separate
RGB controls. Accessories use hard alpha, preserving exact pixels on a 32px grid.

Version 1 and 2 recipes keep their frozen catalogs unchanged. For a changed
silhouette/palette/mask, ship a new version and keep the old decoder/catalog available.
The recipe is self-contained; no database, uploaded user image or client-provided URL.
Appearance persists in browser storage; there is no cross-device identity account.

The serialized recipe order stays stable. `renderOrder` separately places facial pieces
below hair, the fitted headset band and earcups above hair, and hats above them. Authored band
variants accommodate every hairstyle and the bald head; crown hats select the bald band. Mint earcup accents remain
fixed when the user recolors the headset. No runtime fitting heuristics are used.

Checks:

- `python3 avatars/build.py` validates anatomy before building the catalog.
- `python3 -m unittest tests.test_avatar_fit` protects source eyes, ear anchors, lens enclosure and gait.
- `python3 -m unittest avatars.identity.faces.test_fit -v` checks scalp coverage,
  the corrected profile lenses, the official cape mark and independent face colors.
- `python3 -m unittest tests.test_avatar_eyes -v` protects visible whites/pupils
  across eye colors and body/hair/lens combinations, including archived failures.
- For eye paint changes, `python3 -m tests.avatar_eye_review --round <new-name>`
  freezes all five styles, iris extremes, body/accessory cases and before/after
  views in native and enlarged sizes for Gemini review.
- `python3 -m unittest avatars.identity.pop.test_profile_fit avatars.identity.hair_bodies.test_profile_fit avatars.identity.props.test_staff_profile -v`
  protects the Mônica/Chanel silhouettes, Chaves ear flap, Pegasus profile metal
  and the wizard staff's visible crystal-to-grip continuity against archived defects.
- `python3 -m tests.avatar_profile_review --round <new-name>` freezes the current
  catalog and exports both side directions in all three gait frames for independent
  visual review. Existing rounds are never overwritten; see `LEARNINGS.md`.
- `python3 tests/avatar_editor.py` compares 1,199 full sheets covering 143 choices,
  3,985 anatomical pairs and tint extremes. The explicit anatomical interaction graph
  is in `tests/avatar_cases.py`.
  This is deterministic pair coverage, not exhaustive wardrobe combinations.
- `cd admin-api && python3 -m unittest -v test_avatar.py test_server.py`.
- `python3 tests/avatar_identity_review.py` builds the current gallery and fit matrices using the shipping renderer. The accessory v1 comparison remains archived in `design/avatars/review/accessories/`.

Options may declare a validated `defaultColor` and `collection`. Selecting a different
option applies its authored default; clicking the selected option leaves custom color
intact. Saved and migrated recipes preserve their colors. Editor search matches labels
and collections within the current category. New recipes use expressive `bright` eyes;
opening v1/v2 recipes migrates them in memory while preserving their original eyes and
all other choices. Only saving creates a `ka3_` ID.

The visible `Remover tudo` action removes optional pieces and restores Essencial while
retaining body, skin and eyes. `Aleatório` draws editable catalog pieces with authored
defaults and curated palettes, suppressing hidden face accessories under enclosing
masks. Both update only the local draft until Save and are inert during a pending save.
The editor check covers 24 reproducible random draws, clear identity retention,
keyboard/mobile access and random save/reopen/reload. For a focused control check,
run `python3 tests/avatar_editor.py --quick-actions-only`.
