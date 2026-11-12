"""The pets' asset contract, executable (pets/README.md, "Contrato do atlas").

  validate OUT_DIR     check out/<species>/<species>.json, its atlases and picker sheets; exit 1 listing every failure
  build SPECIES_DIR    species.json + base.png + palette.json -> out/<species>/ (one atlas and picker per colour), validated
  preview OUT_DIR      out/<species>/preview/: contact.png (every clip at 6x), <clip>.gif (4x), scene.png (1.5x in the lounge, the engine's zoom)

Python stdlib + numpy + Pillow, as the rest of the repository's art tools.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

CELL = 32
COLS = 16
REPO = Path(__file__).resolve().parents[2]
PETS = REPO / 'pets'
DIRS = ('down', 'left', 'up')
PLANS = {
    'bird': ([f'{a}-{d}' for a in ('idle', 'hop', 'fly', 'perch') for d in DIRS]
             + ['takeoff-left', 'land-left', 'glide-left', 'look-down', 'blink-down', 'sleep-down', 'preen-left',
                'happy-down', 'celebrate-down']),
    'quadruped': ([f'{a}-{d}' for a in ('idle', 'walk') for d in DIRS]
                  + ['sit-down', 'sit-left', 'lie-left', 'sleep-any', 'bellyup-any', 'groom-left', 'stretch-left',
                     'pounce-left', 'happy-down', 'yawn-down', 'look-down']),
    'hopper': [f'{a}-{d}' for a in ('idle', 'hop') for d in DIRS] + ['sit-down', 'sleep-any', 'happy-down', 'look-down'],
    'floater': [f'{a}-{d}' for a in ('idle', 'move') for d in DIRS] + ['happy-down', 'sleep-down', 'special-down'],
    'roller': [f'{a}-{d}' for a in ('idle', 'move') for d in DIRS] + ['curl-left', 'happy-down', 'sleep-down'],
    'swimmer': [f'{a}-{d}' for a in ('idle', 'walk', 'swim') for d in DIRS] + ['happy-down', 'sleep-down', 'look-down'],
    'plant': [f'{a}-{d}' for a in ('idle', 'walk') for d in DIRS] + ['root-down', 'sway-down', 'happy-down', 'sleep-down'],
}
FAMILIES = {'koru', 'brasil', 'sede', 'fantasia', 'halloween', 'time', 'classicos'}
TEMPERAMENTS = {'curious', 'calm', 'playful', 'lazy', 'loyal'}
# Clips whose frames stand on the anchor: their lowest opaque row must sit on it.
GROUNDED = ('idle-', 'walk-', 'sit-', 'perch-', 'hop-down', 'hop-up')
TWO_FRAMES = {'look-down': 2}
# Upright poses (pets/README.md "Tamanho"): the tallest a pet may stand or sit, and the most it may grow over its own
# idle-down frame, so a petted or looking pet keeps its size. Wings up, lying, swimming and hanging poses are exempt.
UPRIGHT = ('idle-', 'sit-', 'look-', 'happy-', 'blink-', 'yawn-', 'perch-', 'beg-', 'wag-', 'bark-', 'knead-', 'loaf-',
           'peep-', 'talk-', 'head-tilt-', 'sway-', 'root-', 'groom-', 'sniff-', 'preen-')
MAX_UPRIGHT = {'bird': 17}
# Walking and howling stand too: same height cap, no growth check (a side walk is longer than the front idle).
HEIGHT_ONLY = ('walk-', 'howl-')
# A lying quadruped is at most 26 px long (Tamanho).
LYING = ('lie-', 'sleep-', 'bellyup-', 'loaf-')
MAX_LYING = 26
MAX_UPRIGHT_DEFAULT = 20
GROWTH = 1.35


def cell(atlas, i):
    r, c = divmod(i, COLS)
    return atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]


def load_rgba(path):
    return np.array(Image.open(path).convert('RGBA'))


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def validate(out_dir):
    out_dir = Path(out_dir)
    fails = []
    species = out_dir.name
    mpath = out_dir / f'{species}.json'
    if not mpath.exists():
        return [f'{mpath}: missing manifest']
    m = json.loads(mpath.read_text())
    need = {'v': int, 'species': str, 'name': str, 'family': str, 'plan': str, 'cell': int, 'anchor': list,
            'shadow': list, 'temperament': str, 'clips': dict, 'picker': dict, 'variants': list}
    for k, t in need.items():
        if not isinstance(m.get(k), t):
            fails.append(f'manifest.{k}: expected {t.__name__}')
    if fails:
        return fails
    if m['v'] != 1 or m['cell'] != CELL:
        fails.append('manifest: v must be 1 and cell 32')
    if m['species'] != species:
        fails.append(f'manifest.species {m["species"]!r} differs from folder {species!r}')
    if m['plan'] not in PLANS:
        fails.append(f'manifest.plan {m["plan"]!r} unknown')
    if m['family'] not in FAMILIES:
        fails.append(f'manifest.family {m["family"]!r} unknown')
    if m['temperament'] not in TEMPERAMENTS:
        fails.append(f'manifest.temperament {m["temperament"]!r} unknown')
    ax, ay = m['anchor']
    if not variants_ok(m, fails):
        return fails
    base = load_rgba(out_dir / m['variants'][0]['atlas'])
    h, w, _ = base.shape
    if w != COLS * CELL or h % CELL:
        fails.append(f'atlas {w}x{h}: width must be 512 and height a multiple of 32')
        return fails
    ncells = (h // CELL) * COLS
    alpha = base[..., 3]
    if not np.isin(alpha, (0, 255)).all():
        fails.append('atlas: alpha must be binary (0 or 255)')
    first = (m['clips'].get('idle-down') or {}).get('frames') or [None]
    base_area = int((cell(base, first[0])[..., 3] > 0).sum()) if isinstance(first[0], int) and first[0] < ncells else 0
    for name in PLANS.get(m['plan'], []):
        if name not in m['clips']:
            fails.append(f'clip {name}: required by plan {m["plan"]}')
    for name, clip in m['clips'].items():
        frames = clip.get('frames')
        if not isinstance(frames, list) or not frames:
            fails.append(f'clip {name}: frames must be a non-empty list')
            continue
        if not isinstance(clip.get('fps'), (int, float)) or not 0 < clip['fps'] <= 24:
            fails.append(f'clip {name}: fps must be in (0, 24]')
        if not isinstance(clip.get('loop'), bool):
            fails.append(f'clip {name}: loop must be true or false')
        if name in TWO_FRAMES and len(frames) != TWO_FRAMES[name]:
            fails.append(f'clip {name}: needs exactly {TWO_FRAMES[name]} frames')
        elif name in TWO_FRAMES and all(isinstance(i, int) and 0 <= i < ncells for i in frames):
            a, b = (cell(base, i) for i in frames[:2])
            if int((a != b).any(axis=2).sum()) < 4:  # looking left and right must be two different pictures
                fails.append(f'clip {name}: its two frames are (almost) the same picture')
        for i in frames:
            if not isinstance(i, int) or not 0 <= i < ncells:
                fails.append(f'clip {name}: frame {i} outside the atlas ({ncells} cells)')
                continue
            a = cell(base, i)[..., 3] > 0
            if not a.any():
                fails.append(f'clip {name}: frame {i} is empty')
                continue
            ys, xs = np.nonzero(a)
            if ys.max() - ys.min() + 1 > 26 or xs.max() - xs.min() + 1 > 30:
                fails.append(f'clip {name}: frame {i} is {xs.max() - xs.min() + 1}x{ys.max() - ys.min() + 1}, over 30x26')
            if name.startswith(LYING) and m['plan'] == 'quadruped' and xs.max() - xs.min() + 1 > MAX_LYING:
                fails.append(f'clip {name}: frame {i} is {xs.max() - xs.min() + 1} px long, over {MAX_LYING} (Tamanho)')
            if name.startswith(HEIGHT_ONLY) and m['plan'] != 'bird':
                limit = MAX_UPRIGHT_DEFAULT + m.get('headroom', 0)
                if ys.max() - ys.min() + 1 > limit:
                    fails.append(f'clip {name}: frame {i} is {ys.max() - ys.min() + 1} px tall, over {limit} (Tamanho)')
            if name.startswith(UPRIGHT):
                limit = MAX_UPRIGHT.get(m['plan'], MAX_UPRIGHT_DEFAULT) + m.get('headroom', 0)
                if ys.max() - ys.min() + 1 > limit:
                    fails.append(f'clip {name}: frame {i} is {ys.max() - ys.min() + 1} px tall, over {limit} (Tamanho)')
                if base_area and a.sum() > GROWTH * base_area:
                    fails.append(f'clip {name}: frame {i} has {int(a.sum())} px, over {GROWTH}x idle-down '
                                 f'({base_area}): the pet grows when it switches clips')
            # a hopper's hop is its walk and its only lift (the runtime lifts floaters and fliers, not hoppers): up to 4 px
            rise = 4 if m['plan'] == 'hopper' and name.startswith('hop-') else 2
            # a bird's tail may hang below the feet it stands on (the feet stay on the anchor row)
            sink = 3 if m['plan'] == 'bird' else 0
            if name.startswith(GROUNDED) and not ay - rise <= ys.max() <= ay + sink:
                fails.append(f'clip {name}: frame {i} lowest row {ys.max()} not on the anchor row {ay} (-{rise}..+{sink})')
            pad = np.pad(a, 1)
            neigh = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
            lone = a & ~neigh
            if lone.any():
                y, x = np.argwhere(lone)[0]
                fails.append(f'clip {name}: frame {i} has {int(lone.sum())} lone pixel(s), first at ({x},{y})')
    for d in ('down', 'left', 'up'):
        row = m['picker'].get(d)
        if not (isinstance(row, list) and len(row) == 3 and all(isinstance(i, int) and 0 <= i < ncells for i in row)):
            fails.append(f'picker.{d}: three frame indices required')
    for v in m['variants']:
        atlas = load_rgba(out_dir / v['atlas'])
        if atlas.shape != base.shape or not np.array_equal(atlas[..., 3], base[..., 3]):
            fails.append(f'variant {v["id"]}: alpha differs from the base')
        pk = out_dir / v['picker']
        if not pk.exists():
            fails.append(f'variant {v["id"]}: picker {pk.name} missing')
            continue
        p = load_rgba(pk)
        if p.shape[:2] != (128, 96):
            fails.append(f'variant {v["id"]}: picker must be 96x128, is {p.shape[1]}x{p.shape[0]}')
    return fails


def variants_ok(m, fails):
    ids = [v.get('id') for v in m['variants']]
    if not ids:
        fails.append('manifest.variants: at least one')
        return False
    for v in m['variants']:
        for k in ('id', 'name', 'atlas', 'picker'):
            if not isinstance(v.get(k), str) or not v[k]:
                fails.append(f'variant {v.get("id")}: {k} missing')
        if isinstance(v.get('id'), str) and not v['id'].replace('-', '').isalnum():
            fails.append(f'variant {v["id"]}: id must be letters, digits and hyphens')
    if len(set(ids)) != len(ids):
        fails.append('manifest.variants: repeated id')
    return not fails


def recolour(base, key, colours):
    out = base.copy()
    rgb = base[..., :3]
    for name, new in colours.items():
        old = np.array(hex_rgb(key[name]))
        hit = (rgb == old).all(axis=2) & (base[..., 3] > 0)
        out[hit, :3] = hex_rgb(new)
    return out


def picker_sheet(atlas, picker):
    sheet = np.zeros((128, 96, 4), np.uint8)
    rows = [picker['down'], picker['left'], picker.get('right'), picker['up']]
    for r, frames in enumerate(rows):
        for c in range(3):
            if frames is None:  # right: the left row mirrored
                img = cell(atlas, picker['left'][c])[:, ::-1]
            else:
                img = cell(atlas, frames[c])
            sheet[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = img
    return sheet


def build(species_dir, output_root=None):
    species_dir = Path(species_dir)
    spec = json.loads((species_dir / 'species.json').read_text())
    pal = json.loads((species_dir / 'palette.json').read_text())
    species = spec['species']
    base = load_rgba(species_dir / 'base.png')
    key = pal['key']
    keyset = {hex_rgb(v) for v in key.values()}
    opaque = {tuple(int(c) for c in px) for px in base[base[..., 3] > 0][:, :3]}
    stray = opaque - keyset
    if stray:
        sys.exit(f'{species}: base.png uses colours outside palette.json key: {sorted(stray)[:8]}')
    out = (Path(output_root) if output_root is not None else PETS / 'out') / species
    out.mkdir(parents=True, exist_ok=True)
    variants = []
    for v in pal['variants']:
        atlas = recolour(base, key, v.get('colors', {}))
        a_name, p_name = f'{species}-{v["id"]}.png', f'{species}-{v["id"]}.picker.png'
        Image.fromarray(atlas, 'RGBA').save(out / a_name, optimize=True)
        Image.fromarray(picker_sheet(atlas, spec['picker']), 'RGBA').save(out / p_name, optimize=True)
        variants.append({'id': v['id'], 'name': v['name'], 'atlas': a_name, 'picker': p_name})
    manifest = {k: spec[k] for k in ('species', 'name', 'family', 'plan', 'anchor', 'shadow', 'temperament',
                                     'clips', 'picker')}
    manifest = {'v': 1, 'cell': CELL, **manifest, 'variants': variants}
    for k in ('label', 'perch', 'notes', 'headroom'):
        if k in spec:
            manifest[k] = spec[k]
    (out / f'{species}.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
    fails = validate(out)
    for f in fails:
        print(f'FAIL {species}: {f}')
    print(f'{species}: {len(variants)} colour(s), {len(spec["clips"])} clips, {"ok" if not fails else f"{len(fails)} failure(s)"}')
    return 1 if fails else 0


FLOOR = (233, 214, 186, 255)
AVATAR_CX, SHOULDER_Y = 111.5, 85  # screen px in the scene crop: the QA avatar spans x 94-129, y 55-102 (feet)
HAIR_HALF = 8  # map px from the woka's centre to its hair edge, the line a perched bird's inner side rests on


def shoulder_dx(mask, ax):
    """Map px from the woka's centre to a perched pet's anchor so the pet's inner side overlaps the hair by 1 px.

    The same rule as the page runtime (theme/pets/), so the preview shows what the engine draws.
    """
    xs = np.nonzero(mask.any(axis=0))[0]
    return HAIR_HALF - 1 + (ax - xs.min())


SCENE_ZOOM = 1.5  # screen px per map px in .dream-loop/pets/targets/baseline-cafe-lazer.png (measured on the woka)


def scaled(img, k):
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def frames_of(atlas, clip, mirror=False):
    out = []
    for i in clip['frames']:
        im = Image.fromarray(cell(atlas, i), 'RGBA')
        out.append(im.transpose(Image.FLIP_LEFT_RIGHT) if mirror else im)
    return out


def preview(out_dir):
    out_dir = Path(out_dir)
    m = json.loads((out_dir / f'{out_dir.name}.json').read_text())
    pv = out_dir / 'preview'
    pv.mkdir(exist_ok=True)
    atlases = [(v['id'], load_rgba(out_dir / v['atlas'])) for v in m['variants']]
    base = atlases[0][1]
    clips = dict(m['clips'])
    for name in list(clips):  # show the mirrored right next to its left
        if name.endswith('-left') and name.replace('-left', '-right') not in clips:
            clips[name.replace('-left', '-right')] = {**clips[name], 'mirror': True}
    k = 6
    label_w = 150
    width = label_w + max(len(c['frames']) for c in clips.values()) * (CELL * k + 6)
    sheet = Image.new('RGBA', (width, len(clips) * (CELL * k + 6) + 6), FLOOR)
    d = ImageDraw.Draw(sheet)
    ax, ay = m['anchor']
    for r, (name, clip) in enumerate(sorted(clips.items())):
        y = 6 + r * (CELL * k + 6)
        d.text((6, y + 6), f'{name}\n{len(clip["frames"])}f {clip["fps"]}fps', fill=(30, 30, 30, 255))
        for c, im in enumerate(frames_of(base, clip, clip.get('mirror'))):
            x = label_w + c * (CELL * k + 6)
            d.rectangle([x, y, x + CELL * k - 1, y + CELL * k - 1], outline=(200, 180, 150, 255))
            sheet.alpha_composite(scaled(im, k), (x, y))
            d.line([x, y + ay * k, x + CELL * k - 1, y + ay * k], fill=(220, 120, 120, 120))
        frames = [Image.alpha_composite(Image.new('RGBA', (CELL, CELL), FLOOR), im) for im in
                  frames_of(base, clip, clip.get('mirror'))]
        frames = [scaled(f, 4).convert('P', palette=Image.ADAPTIVE) for f in frames]
        frames[0].save(pv / f'{name}.gif', save_all=True, append_images=frames[1:],
                       duration=int(1000 / clip['fps']), loop=0)
    sheet.save(pv / 'contact.png')
    # every colour, idle-down and the first frames of a few clips, at 4x
    sw = Image.new('RGBA', (len(atlases) * (CELL * 4 + 8) + 8, CELL * 4 + 30), FLOOR)
    ds = ImageDraw.Draw(sw)
    first = clips.get('idle-down') or next(iter(clips.values()))
    for i, (vid, atlas) in enumerate(atlases):
        x = 8 + i * (CELL * 4 + 8)
        sw.alpha_composite(scaled(frames_of(atlas, first)[0], 4), (x, 4))
        ds.text((x, CELL * 4 + 10), vid, fill=(30, 30, 30, 255))
    sw.save(pv / 'colours.png')
    scene(m, base, clips, pv)
    print(f'preview: {pv}')


def scene(m, atlas, clips, pv):
    """The pet at the capture's zoom on the lounge floor, beside the QA avatar, with the runtime's shadow.

    The baseline capture (1440x900 window, the HUD's side panel open) shows the map at 1.5 screen px per map px: the
    engine picks 1.5 for a game area of about 1080x900 (HdpiManager: floor(sqrt(px / 307200)), 1.5 between 1.5 and 2),
    and the 32 px woka measures 47 px there. Pets are scaled by the same factor, nearest neighbour, as the engine does.
    """
    src = REPO / '.dream-loop/pets/targets/baseline-cafe-lazer.png'
    if not src.exists():
        return
    bg = Image.open(src).convert('RGBA').crop((960, 430, 1400, 660))  # avatar "QA Sede" and empty floor
    sw, sh = m['shadow']
    ax, ay = m['anchor']
    # the target's own poses first (the cat belly-up, the dog looking up at its person), then the everyday ones
    picks = [n for n in ('idle-down', 'look-up-left', 'bellyup-any', 'sit-down', 'fly-left', 'move-left', 'sleep-any',
                         'sleep-down', 'walk-left', 'idle-left', 'happy-down') if n in clips][:5]
    z = SCENE_ZOOM
    for j, name in enumerate(picks):
        im = frames_of(atlas, clips[name], clips[name].get('mirror'))[0]
        x0, y0 = 146 + j * 40, 40 + (j % 2) * 16  # screen pixels inside the crop, clear of the avatar, pool table and arcade
        # the runtime holds a floater 7 px up in every clip (stage.mjs), a bird only while it flies
        lift = 7 if m['plan'] == 'floater' else 10 if name.startswith(('fly', 'move')) and m['plan'] == 'bird' else 0
        w, h = round(sw * z), round(sh * z)
        sh_img = Image.new('RGBA', (w, h))
        ImageDraw.Draw(sh_img).ellipse([0, 0, w - 1, h - 1], fill=(20, 30, 40, 70))
        bg.alpha_composite(sh_img, (x0 + round(ax * z) - w // 2, y0 + round(ay * z) - h // 2))
        big = im.resize((round(CELL * z), round(CELL * z)), Image.NEAREST)
        bg.alpha_composite(big, (x0, y0 - round(lift * z)))
    owner_ok = not (isinstance(m.get('perch'), dict) and m['perch'].get('owner') is False)  # the bat never sits on its owner
    if 'perch-down' in clips and owner_ok:  # a bird on the avatar's shoulder, as in the in-engine target (feet on its right shoulder)
        im = frames_of(atlas, clips['perch-down'])[0]
        dx = shoulder_dx(np.array(im)[..., 3] > 0, ax)
        big = im.resize((round(CELL * z), round(CELL * z)), Image.NEAREST)
        bg.alpha_composite(big, (round(AVATAR_CX + dx * z - ax * z), SHOULDER_Y - round(ay * z)))
    bg.save(pv / 'scene.png')


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ('validate', 'build', 'preview'):
        sys.exit(__doc__)
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == 'validate':
        fails = validate(path)
        for f in fails:
            print(f'FAIL {Path(path).name}: {f}')
        print(f'{Path(path).name}: {"ok" if not fails else f"{len(fails)} failure(s)"}')
        sys.exit(1 if fails else 0)
    if cmd == 'build':
        sys.exit(build(path))
    preview(path)


if __name__ == '__main__':
    main()
