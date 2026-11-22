"""Normal maps of the office's entity sprites, composed into one map-space texture, and of the 32x32 atlases.

  python3 tools/normals.py DIST OUT.png [--method tool|legacy|auto]
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

Characters and pets walk, so their atlas normals cannot be stamped into a map-space texture: `atlas` writes them as
separate files and nothing in the runtime reads them (the shader has no per-sprite normal path). fx.py writes
fx/normal.png by default (KONCLUI_FX_NORMALS=0 turns it off; tools/README.md has the decision).
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pixelgrid as PG  # noqa: E402

NORMALS_ENV = 'SPRITEFUSION_NORMALS_BIN'
NORMALS_DEFAULT = 'spritefusion-sprite-normals'
FLAT = (128, 128, 255, 0)
STRENGTH = 1.0


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
    return path, hashlib.sha256(Path(path).resolve().read_bytes()).hexdigest()


def tool_normals(sprites):
    """{path: RGBA normal array} from one tool run over the distinct sprites (silhouette-aware). The tool is fed the
    `geometry` of each sprite and the result is masked to it: alpha 255 on an opaque pixel, 0 elsewhere."""
    binary = PG.tool_path(NORMALS_ENV, NORMALS_DEFAULT)
    out = {}
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / 'in', Path(tmp) / 'out'
        src.mkdir()
        names, solid = {}, {}
        for i, path in enumerate(sorted(sprites)):
            names[path] = f'{i:05d}'
            rgba = geometry(PG.load_rgba(path))
            solid[path] = rgba[..., 3] == 255
            Image.fromarray(rgba, 'RGBA').save(src / f'{i:05d}.png')
        files = sorted(src.glob('*.png'))
        for start in range(0, len(files), 400):          # a batch per run keeps the command line short
            run = subprocess.run([binary, *map(str, files[start:start + 400]), '--output-dir', str(dst), '--force'],
                                 capture_output=True, text=True)
            if run.returncode:
                raise SystemExit(f'{binary} failed ({run.returncode}): {run.stderr[-2000:]}')
        for path, stem in names.items():
            with Image.open(dst / f'{stem}_n.png') as made:
                n = np.array(made.convert('RGBA'))
            n[..., 3] = np.where(solid[path], 255, 0)
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


def resolve_method(method):
    """'tool' or 'legacy'. 'auto' takes the tool when SPRITEFUSION_NORMALS_BIN is set or the tool is on PATH, else the
    luminance fallback with a loud notice on stderr. 'tool' with no usable tool is a SystemExit (tool_path)."""
    if method != 'auto':
        return method
    if os.environ.get(NORMALS_ENV) or PG.shutil.which(NORMALS_DEFAULT):
        return 'tool'
    print(f'normals: !!! {NORMALS_DEFAULT} not found ({NORMALS_ENV} unset, not on PATH): using the LUMINANCE FALLBACK, '
          f'not silhouette-aware normals', file=sys.stderr)
    return 'legacy'


def compose(dist, method='auto'):
    """The map-space normal texture of every placed sprite, and the method used ('tool' or 'legacy'). Sprites are
    stamped in the runtime's draw order (depth = y + height + depthOffset), so where two overlap the one drawn on top
    owns the normal."""
    manifest = json.loads((Path(dist) / 'fx' / 'manifest.json').read_text())
    width, height = manifest['map']
    items = placed(dist)
    method = resolve_method(method)
    sprites = {p for _, _, p, _ in items}
    maps = tool_normals(sprites) if method == 'tool' else \
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


def write(dist, target, method='auto'):
    """Compose and save the texture (deterministic: the same inputs give the same bytes). The method that made it is
    stamped in a PNG text chunk (`METHOD_KEY`: 'tool' or 'legacy'), so a served file says whether it is silhouette-aware.
    Returns the method used."""
    image, used = compose(dist, method)
    info = PngImagePlugin.PngInfo()
    info.add_text(METHOD_KEY, used)
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
    if len(argv) in (2, 4) and (len(argv) == 2 or argv[2] == '--method'):
        used = write(argv[0], argv[1], argv[3] if len(argv) == 4 else 'auto')
        print(f'{argv[1]}: {used}')
        return 0
    raise SystemExit(__doc__)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
