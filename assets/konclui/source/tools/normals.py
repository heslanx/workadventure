"""Normal maps of the office's entity sprites, composed into one map-space texture, and of the 32x32 atlases.

  python3 tools/normals.py DIST OUT.png [--method tool|legacy|auto] [--profile domed|plain]
  python3 tools/normals.py compare DIST OUT_DIR           old vs new: summary.json and three crops (OUT_DIR is git-ignored)
  python3 tools/normals.py atlas OUT_DIR [SHEET.png...]   per-cell normals of the 32x32 atlases (default: every
                                                          pets/species/*/base.png and art/out/wokas, art/out/companions
                                                          sheet) as OUT_DIR/<name>_n.png; the tool's --frame-size 32x32
                                                          isolates each cell. Tool only, not part of dist (see below)

Format of fx/normal.png, the runtime contract (read from play/src/front/Konclui/Ambience/phaser/effectsLoader.ts and
domain/shaders.ts, the ambience lane owns them): the file `fx/normal.png` beside the manifest, loaded as an OPTIONAL
picture (a missing or broken file is ignored, uNormalsOn stays 0); its size is the map's (the shader samples it with
`mapUV(w, 1.0)` = the masks.png lookup: texel centre of the world pixel, rows from the top); RGB = (normal + 1) / 2 * 255,
+X right and +Y up (OpenGL: the shader builds the light direction as (l.x - w.x, w.y - l.y, 42)); A = 255 where an
entity sprite pixel is opaque (the shader tests `a > 0.5`), else 0 with the flat normal (128, 128, 255), which the shader
treats as no normal. NEAREST filtering, no sRGB decode (the PNG carries no colour chunk). Only fully opaque (255) sprite
pixels are geometry: a translucent pixel of a declared layer (glass, a lamp's light pool) gets no normal.
Overlaps are ordered as the runtime draws: depth = y + image height + the prefab's depthOffset (`placed`, `compose`).

Methods
  tool    spritefusion-sprite-normals (path in SPRITEFUSION_NORMALS_BIN, else PATH), one run per distinct sprite:
          silhouette-aware. A set-but-wrong SPRITEFUSION_NORMALS_BIN is an error, never a silent fallback
  legacy  the 1-px luminance finite difference this module keeps as the fallback (no tool needed)
  auto    tool when it is found, else legacy with a loud notice on stderr

Floor pieces get no normal. A piece the manifest's "kinds" calls "floor" (a rug, a mat, a carpet: tools/kinds.py has the one
rule) is not stamped: its pixels stay the flat value (128, 128, 255, 0), "nothing", exactly as where no sprite is, so the
shader gives a rug no relief (its border had stripes: a floor piece has no volume). A manifest with no "kinds" (an older
build) stamps every piece as before. The tool is not even run on a floor piece.

Per piece (kinds.relief_profile, from the manifest's kinds, the prefab's tags and the manifest's lights; a manifest with no "kinds"
is an older build and every piece is domed as the profile says):
  none    a floor piece: not stamped (above)
  flat    a lamp (arc, floor, desk light): the flat normal (128, 128, 255) with alpha 255: it is a prop, it is lit, and it takes no
          relief. A lit shade used to fall to 80% of its brightness, a lamp that is on dimmer than off
  bevel   a table, a counter, a shelf, a picture, a screen, a piece on furniture: the tool is run with --shape-radius 4 and
          --detail-strength 0 (it must not read the picture's painted wash as relief), and only the outer BEVEL_PX (4) px keep its
          normal: inside that edge the normal is flat. The tool's radius is a long fall-off and not a bevel, so a desk top folded
          into four triangles and the air hockey's playfield into a roof until the inside was forced flat
  domed   a soft furnishing (plants, sofas, chairs): the size classes below

Profiles (what the tool is told per sprite; the stamp `konclui-normals-profile` in the PNG says which one made the file)
  domed   a size class by the longest side of the sprite's opaque box: under 48 px --shape-radius 4, under 96 px 10, else
          20, with --shape-strength 1.4 and --normal-strength 2.0, so a big sofa reads as a rounded volume (lit face, turned
          face) and not as a flat plate with a 4 px bevel. The default; the lighting lab's relief pictures decide the final
          numbers (SIZE_CLASSES, SHAPE_STRENGTH, NORMAL_STRENGTH)
  plain   the tool's own defaults for every sprite: what the build wrote before this profile existed
The legacy method has no profile.

Characters and pets walk, so their atlas normals cannot be stamped into a map-space texture: `atlas` writes them as
separate files and nothing in the runtime reads them (the shader has no per-sprite normal path). fx.py writes
fx/normal.png by default (KONCLUI_FX_NORMALS=0 turns it off; tools/README.md has the decision).
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kinds as KINDS  # noqa: E402
import pixelgrid as PG  # noqa: E402
import toolchain  # noqa: E402

NORMALS_ENV = toolchain.TOOLS['sprite-normals']['env']
NORMALS_DEFAULT = toolchain.TOOLS['sprite-normals']['binary']
FLAT = (128, 128, 255, 0)
STRENGTH = 1.0
PROFILE_KEY = 'konclui-normals-profile'
DOMED, PLAIN = 'domed', 'plain'
PROFILES = (DOMED, PLAIN)
# (exclusive upper bound of the longest side of the opaque box in px, --shape-radius), the last bound is open
SIZE_CLASSES = ((48, 4.0), (96, 10.0), (None, 20.0))
SHAPE_STRENGTH = 1.4
NORMAL_STRENGTH = 2.0
SMOOTH_PASSES = ((48, 1), (96, 2), (None, 3))        # a domed piece's normals are averaged this many times over the solid pixels, by size class
BEVEL_RADIUS = 4.0                                     # a slab (kinds.relief_profile 'bevel'): the tool's --shape-radius for it
BEVEL_PX = 4                                           # ... and the width of its edge: inside it the normal is flat, whatever the tool says


def legacy_normal(rgba, strength=STRENGTH):
    """The luminance finite difference: height = luminance, slope = (right - left) / 2 and (below - above) / 2 over
    the picture's edge-replicated border. Ignores the silhouette: an opaque edge reads as a cliff only through its
    colour. Ported from the runtime function `normalFromLuminance` of pixelMaps.ts, which no longer exists in the tree;
    the golden values in LegacyNormals are all that pins it now, there is no runtime fixture to compare against."""
    px = rgba.astype(np.float64)
    lum = (px[..., 0] * 0.299 + px[..., 1] * 0.587 + px[..., 2] * 0.114) / 255
    p = np.pad(lum, 1, mode='edge')
    dx = (p[1:-1, 2:] - p[1:-1, :-2]) * 0.5
    dy = (p[2:, 1:-1] - p[:-2, 1:-1]) * 0.5
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(dx)
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.empty(rgba.shape, np.uint8)
    for i, v in enumerate((nx / n, ny / n, nz / n)):
        out[..., i] = np.floor((v * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)
    out[..., 3] = np.where(rgba[..., 3] > 127, 255, 0)
    return out


def geometry(rgba):
    """The sprite as the normal tools see it: only fully opaque pixels exist, everything else (a declared translucent
    layer's pixels) is clear. Returns the same array when there is no partial alpha."""
    alpha = rgba[..., 3]
    if not ((alpha > 0) & (alpha < 255)).any():
        return rgba
    out = rgba.copy()
    out[alpha < 255] = 0
    return out


def tool_identity():
    """(path, sha256 of the binary) of the normals tool a run would use; the error of `tool_path` when it is missing."""
    path = PG.tool_path(NORMALS_ENV, NORMALS_DEFAULT)
    return path, toolchain.sha256_of(path)


def longest_side(solid):
    """The longest side of the box of the True pixels of a mask, 0 when there are none."""
    ys, xs = np.nonzero(solid)
    return int(max(ys.max() - ys.min(), xs.max() - xs.min()) + 1) if len(xs) else 0


def shape_radius(side):
    """The --shape-radius of the size class of a sprite whose opaque box has this longest side."""
    return next(radius for bound, radius in SIZE_CLASSES if bound is None or side < bound)


def tool_flags(profile, side, piece='domed'):
    """The extra command-line flags of one sprite's size class: [] for the plain profile. A `bevel` piece has the radius of an edge
    whatever its size."""
    if profile == PLAIN:
        return []
    radius = BEVEL_RADIUS if piece == 'bevel' else shape_radius(side)
    flags = ['--shape-radius', f'{radius:g}', '--shape-strength', f'{SHAPE_STRENGTH:g}',
             '--normal-strength', f'{NORMAL_STRENGTH:g}']
    if piece == 'bevel':
        # the tool also reads relief from the picture's own painted shading (--detail-strength, 6 by default): a table top or a
        # playfield painted with a light-to-dark wash came out as a folded sheet. A slab is flat inside, so its relief is the edge only
        flags += ['--detail-strength', '0']
    return flags


def smooth_passes(side):
    """How many averaging passes a domed piece of this longest side gets (SMOOTH_PASSES)."""
    return next(n for bound, n in SMOOTH_PASSES if bound is None or side < bound)


def smooth(normals, solid, passes):
    """The normals of a domed piece with each solid pixel's xy replaced by the mean of its 3 x 3 neighbours that are solid, `passes`
    times, then made unit length again. The tool's relief on a big soft piece (a tree's canopy, a bean bag, a planter) has the
    facets of the painted light and dark patches it reads: after the lighting's bands cut them they were hard-edged triangles with
    straight creases, 'low-poly' (the review of 2026-11-23). The mean makes the dome round, so a band's edge is a curve. Pure numpy,
    deterministic; a pixel outside `solid` is never read or written."""
    if passes <= 0 or not solid.any():
        return normals
    v = normals[..., :3].astype(np.float64) / 255 * 2 - 1
    m = solid.astype(np.float64)
    h, w = m.shape
    for _ in range(passes):
        pad_m = np.pad(m, 1)
        pad_v = np.pad(v * m[..., None], ((1, 1), (1, 1), (0, 0)))
        total = np.zeros_like(v)
        count = np.zeros(m.shape)
        for dy in range(3):
            for dx in range(3):
                total += pad_v[dy:dy + h, dx:dx + w]
                count += pad_m[dy:dy + h, dx:dx + w]
        mean = total / np.maximum(count, 1)[..., None]
        v = np.where(solid[..., None], mean, v)
    length = np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)
    v = v / length
    out = normals.copy()
    rgb = np.clip(np.round((v + 1) / 2 * 255), 0, 255).astype(np.uint8)
    out[..., :3] = np.where(solid[..., None], rgb, normals[..., :3])
    return out


def inside(solid, depth):
    """The pixels of a boolean mask that are at least `depth` px (4-neighbour steps) from a pixel that is not in it, and from the
    edge of the picture: what is left of a slab when its `depth` px edge is taken off."""
    kept = solid.copy()
    for _ in range(depth):
        padded = np.pad(kept, 1, constant_values=False)
        kept = kept & padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:]
    return kept


def flat_normals(rgba):
    """The flat normal on every solid pixel of a sprite (alpha 255), nothing elsewhere: a lamp's relief."""
    out = np.empty(rgba.shape, np.uint8)
    out[...] = FLAT
    out[..., 3] = np.where(rgba[..., 3] == 255, 255, 0)
    return out


def tool_normals(sprites, profile=DOMED, pieces=None):
    """{path: RGBA normal array} from the tool over the distinct sprites (silhouette-aware), one run per size class and 400
    files. The tool is fed the `geometry` of each sprite and the result is masked to it: alpha 255 on an opaque pixel, 0
    elsewhere. The profile picks the flags of each size class (see the module docstring); the file names are the sprites'
    sorted order whatever the profile, so a run is deterministic. `pieces` is {path: 'flat' | 'bevel' | 'domed'} (kinds.relief_profile):
    a flat piece does not run the tool at all, a bevel one has the radius of an edge, the rest the size class's; a path it does not
    list is domed."""
    if profile not in PROFILES:
        raise SystemExit(f'unknown normals profile {profile!r}: one of {PROFILES}')
    binary = PG.tool_path(NORMALS_ENV, NORMALS_DEFAULT)
    out = {}
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / 'in', Path(tmp) / 'out'
        src.mkdir()
        names, solid, groups, flat = {}, {}, {}, {}
        pieces = pieces or {}
        for i, path in enumerate(sorted(sprites)):
            names[path] = f'{i:05d}'
            rgba = geometry(PG.load_rgba(path))
            solid[path] = rgba[..., 3] == 255
            if pieces.get(path) == 'flat':
                flat[path] = flat_normals(rgba)
                continue
            Image.fromarray(rgba, 'RGBA').save(src / f'{i:05d}.png')
            flags = tuple(tool_flags(profile, longest_side(solid[path]), pieces.get(path, 'domed')))
            groups.setdefault(flags, []).append(src / f'{i:05d}.png')
        for flags, files in sorted(groups.items()):
            for start in range(0, len(files), 400):      # a batch per run keeps the command line short
                run = subprocess.run([binary, *map(str, files[start:start + 400]), '--output-dir', str(dst), '--force',
                                      *flags], capture_output=True, text=True)
                if run.returncode:
                    raise SystemExit(f'{binary} failed ({run.returncode}): {run.stderr[-2000:]}')
        for path, stem in names.items():
            if path in flat:
                out[path] = flat[path]
                continue
            with Image.open(dst / f'{stem}_n.png') as made:
                n = np.array(made.convert('RGBA'))
            n[..., 3] = np.where(solid[path], 255, 0)
            if profile == DOMED and pieces.get(path, 'domed') == 'domed':
                n = smooth(n, solid[path], smooth_passes(longest_side(solid[path])))
            if pieces.get(path) == 'bevel':
                n[inside(solid[path], BEVEL_PX)] = FLAT[:3] + (255,)
            out[path] = n
    return out


def atlas_normals(sheets, out_dir, frame_size='32x32'):
    """Normal maps of sprite-sheet atlases: {name: path} -> {name: out_dir/<name>_n.png}. One tool run per sheet with
    `--frame-size`, so each cell is lit as its own sprite (a neighbour cell never reads as part of the silhouette).
    The output has the sheet's size; a different size is an error."""
    binary = PG.tool_path(NORMALS_ENV, NORMALS_DEFAULT)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    made = {}
    with tempfile.TemporaryDirectory() as tmp:
        for name, path in sorted(sheets.items()):
            staged = Path(tmp) / f'{name}.png'                  # the output is <input stem>_n.png: the stem must be unique
            staged.symlink_to(Path(path).resolve())
            run = subprocess.run([binary, str(staged), '--output-dir', str(out_dir), '--force', '--frame-size', frame_size],
                                 capture_output=True, text=True)
            if run.returncode:
                raise SystemExit(f'{binary} failed on {path} ({run.returncode}): {run.stderr[-2000:]}')
            made[name] = out_dir / f'{name}_n.png'
            with Image.open(path) as src_img, Image.open(made[name]) as out_img:
                want, got = src_img.size, out_img.size
            if want != got:
                raise SystemExit(f'{made[name]}: {got[0]}x{got[1]} but the sheet is {want[0]}x{want[1]}')
    return made


def placed(dist):
    """[(x, y, sprite path, depthOffset)] of the objects of the built map, in file order. The depth offset is the
    prefab's (collection.json `depthOffset`, 0 when it has none): the runtime draws an entity at
    `y + displayHeight + depthOffset` (EntitiesManager.ts, Entity.ts), so `compose` needs it to order the overlaps."""
    dist = Path(dist)
    wam = json.loads((dist / 'office.wam').read_text())
    prefabs = {}
    for collection in sorted((dist / 'entities').glob('*/collection.json')):
        doc = json.loads(collection.read_text())
        for entry in doc.get('collection', []):
            if entry.get('imagePath'):
                prefabs[(doc.get('collectionName'), entry['id'])] = (str(collection.parent / entry['imagePath']),
                                                                      entry.get('depthOffset', 0))
    items = []
    for e in wam['entities'].values():
        prefab = prefabs.get((e['prefabRef']['collectionName'], e['prefabRef']['id']))
        if prefab:
            items.append((e['x'], e['y'], *prefab))
    return items


def floor_sprites(dist, manifest=None):
    """{str(path)} of the sprites the manifest's "kinds" calls "floor", spelled as `placed` spells them. Empty when the
    manifest has no "kinds" (an older build): every piece is stamped as before."""
    dist = Path(dist)
    if manifest is None:
        manifest = json.loads((dist / 'fx' / 'manifest.json').read_text())
    return {str(dist / 'entities' / folder / image)
            for key, kind in (manifest.get('kinds') or {}).items() if kind == 'floor'
            for folder, image in [key.split('/', 1)]}


def piece_profiles(dist, manifest=None):
    """{str(path): 'flat' | 'bevel' | 'domed'} of the sprites that get a normal, spelled as `placed` spells them (kinds.relief_profile).
    Empty when the manifest has no "kinds" (an older build): every piece is domed as before."""
    dist = Path(dist)
    if manifest is None:
        manifest = json.loads((dist / 'fx' / 'manifest.json').read_text())
    kind_map = manifest.get('kinds') or {}
    lights = manifest.get('lights') or {}
    entries = KINDS.placed_entries(dist) if kind_map else {}
    out = {}
    for key, kind in kind_map.items():
        tags = [t for e in entries.get(key, []) for t in e.get('tags', [])]
        profile = KINDS.relief_profile(kind, tags, (lights.get(key) or {}).get('kind'))
        if profile != 'none':
            folder, image = key.split('/', 1)
            out[str(dist / 'entities' / folder / image)] = profile
    return out


def resolve_method(method):
    """'tool' or 'legacy'. 'auto' takes the tool when SPRITEFUSION_NORMALS_BIN is set or the tool is on PATH, else the
    luminance fallback with a loud notice on stderr. 'tool' with no usable tool is a SystemExit (tool_path)."""
    if method != 'auto':
        return method
    if toolchain.declared('sprite-normals', cargo=False):
        return 'tool'
    print(f'normals: !!! {NORMALS_DEFAULT} not found ({NORMALS_ENV} unset, not on PATH): using the LUMINANCE FALLBACK, '
          f'not silhouette-aware normals', file=sys.stderr)
    return 'legacy'


def compose(dist, method='auto', profile=DOMED):
    """The map-space normal texture of every placed sprite except the floor pieces (`floor_sprites`: a rug has no relief),
    and the method used ('tool' or 'legacy'). Sprites are stamped in the runtime's draw order (depth = y + height +
    depthOffset), so where two overlap the one drawn on top owns the normal."""
    manifest = json.loads((Path(dist) / 'fx' / 'manifest.json').read_text())
    width, height = manifest['map']
    floor = floor_sprites(dist, manifest)
    items = [i for i in placed(dist) if i[2] not in floor]
    method = resolve_method(method)
    sprites = {p for _, _, p, _ in items}
    maps = tool_normals(sprites, profile, piece_profiles(dist, manifest)) if method == 'tool' else \
        {p: legacy_normal(geometry(PG.load_rgba(p))) for p in sprites}
    canvas = np.zeros((height, width, 4), np.uint8)
    canvas[...] = FLAT
    # Back to front by the runtime's depth, y + height + depthOffset (a tie goes to the larger x: the runtime's tie is
    # the texture load order, which no file records, so any fixed rule will do and this one is deterministic).
    for x, y, path, _ in sorted(items, key=lambda i: (i[1] + maps[i[2]].shape[0] + i[3], i[0])):
        n = maps[path]
        h, w = n.shape[:2]
        x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, width), min(y + h, height)
        if x1 <= x0 or y1 <= y0:
            continue
        tile = n[y0 - y:y1 - y, x0 - x:x1 - x]
        view = canvas[y0:y1, x0:x1]
        view[tile[..., 3] > 0] = tile[tile[..., 3] > 0]
    return Image.fromarray(canvas, 'RGBA'), method


METHOD_KEY = 'konclui-normals-method'


def write(dist, target, method='auto', profile=DOMED):
    """Compose and save the texture (deterministic: the same inputs give the same bytes). The method that made it is
    stamped in a PNG text chunk (`METHOD_KEY`: 'tool' or 'legacy'), so a served file says whether it is silhouette-aware,
    and the profile in `PROFILE_KEY`. Returns the method used."""
    image, used = compose(dist, method, profile)
    info = PngImagePlugin.PngInfo()
    info.add_text(METHOD_KEY, used)
    info.add_text(PROFILE_KEY, profile if used == 'tool' else 'legacy')
    image.save(target, optimize=True, pnginfo=info)
    return used


def describe(method):
    """One line naming the method and, for the tool, the binary and its sha256: what the build prints."""
    if method == 'legacy':
        return 'legacy luminance fallback (NOT silhouette-aware; the tool was not used)'
    path, digest = tool_identity()
    return f'{NORMALS_DEFAULT} {path} sha256 {digest[:16]}'


def compare(dist, out_dir):
    """Old vs new on the built map: summary.json (angle between the normals over the covered pixels) and three crops
    of the three most differing 256 x 256 windows (colour | legacy | tool, side by side)."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    old, _ = compose(dist, 'legacy')
    new, _ = compose(dist, 'tool')
    a, b = np.asarray(old).astype(np.float64), np.asarray(new).astype(np.float64)
    covered = (a[..., 3] > 0) | (b[..., 3] > 0)
    va, vb = a[..., :3] / 255 * 2 - 1, b[..., :3] / 255 * 2 - 1
    cos = np.clip((va * vb).sum(-1) / np.maximum(np.linalg.norm(va, axis=-1) * np.linalg.norm(vb, axis=-1), 1e-9), -1, 1)
    angle = np.degrees(np.arccos(cos))[covered]
    flat = lambda v: np.degrees(np.arccos(np.clip(v[..., 2] / np.maximum(np.linalg.norm(v, axis=-1), 1e-9), -1, 1)))
    both = covered & (np.abs(a[..., 0] - 128) > 8)         # where the legacy normal leans clearly: do the signs agree?
    both_g = covered & (np.abs(a[..., 1] - 128) > 8)
    agree = lambda i, m: float((np.sign(a[..., i] - 128) == np.sign(b[..., i] - 128))[m].mean())
    summary = dict(map=list(old.size), covered_px=int(covered.sum()),
                   sign_agreement=dict(R=agree(0, both), G=agree(1, both_g), where='legacy |channel - 128| > 8'),
                   angle_deg=dict(mean=float(angle.mean()), p50=float(np.percentile(angle, 50)),
                                  p95=float(np.percentile(angle, 95)), max=float(angle.max())),
                   tilt_from_flat_deg=dict(legacy_mean=float(flat(va)[a[..., 3] > 0].mean()),
                                           tool_mean=float(flat(vb)[b[..., 3] > 0].mean())),
                   opaque_px=dict(legacy=int((a[..., 3] > 0).sum()), tool=int((b[..., 3] > 0).sum())))
    (out_dir / 'summary.json').write_text(json.dumps(summary, indent=1))
    picture = Image.open(Path(dist).parent / 'renders' / 'preview.png').convert('RGB') \
        if (Path(dist).parent / 'renders' / 'preview.png').exists() else None
    size, step = 256, 128
    h, w = covered.shape
    score = []
    for y in range(0, h - size + 1, step):
        for x in range(0, w - size + 1, step):
            window = covered[y:y + size, x:x + size]
            if window.mean() > 0.2:
                score.append((float(np.degrees(np.arccos(np.clip(cos[y:y + size, x:x + size], -1, 1)))[window].mean()), x, y))
    chosen = []
    for s, x, y in sorted(score, reverse=True):
        if all(abs(x - cx) >= size or abs(y - cy) >= size for _, cx, cy in chosen):
            chosen.append((s, x, y))
        if len(chosen) == 3:
            break
    paths = []
    for i, (s, x, y) in enumerate(chosen):
        panels = [old.crop((x, y, x + size, y + size)), new.crop((x, y, x + size, y + size))]
        if picture is not None:
            panels.insert(0, picture.crop((x, y, x + size, y + size)).convert('RGBA'))
        sheet = Image.new('RGBA', (size * len(panels), size))
        for k, p in enumerate(panels):
            sheet.paste(p, (k * size, 0))
        path = out_dir / f'crop-{i + 1}-x{x}-y{y}.png'
        sheet.save(path)
        paths.append(str(path))
    print(json.dumps(dict(summary=summary, crops=paths), indent=1))


def default_atlases():
    """The 32x32 atlases of the repository: every pet's base.png and the avatar and companion sheets of art/out."""
    root = Path(__file__).resolve().parents[1]
    found = sorted((root / 'pets' / 'species').glob('*/base.png'))
    for group in ('wokas', 'companions'):
        found += sorted((root / 'art' / 'out' / group).glob('*.png'))
    return [str(p) for p in found]


def main(argv):
    if argv[:1] == ['compare'] and len(argv) == 3:
        compare(argv[1], argv[2])
        return 0
    if argv[:1] == ['atlas'] and len(argv) >= 2:
        sheets = argv[2:] or default_atlases()
        names = {Path(p).parent.name if Path(p).name == 'base.png' else Path(p).parent.name + '-' + Path(p).stem: p
                 for p in sheets}
        for name, path in atlas_normals(names, argv[1]).items():
            print(path)
        return 0
    if len(argv) >= 2 and len(argv) % 2 == 0 and all(a in ('--method', '--profile') for a in argv[2::2]):
        options = {a[2:]: v for a, v in zip(argv[2::2], argv[3::2])}
        used = write(argv[0], argv[1], options.get('method', 'auto'), options.get('profile', DOMED))
        print(f'{argv[1]}: {used}')
        return 0
    raise SystemExit(__doc__)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
