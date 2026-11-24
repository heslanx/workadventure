"""What the room's shaders (theme/fx/) need from the plan, written by build.py to dist/fx/. The effects read it from the
map's folder; a room without dist/fx/manifest.json gets no effects.

  water.png       the pool region's open water in its still colours (the floor tiles show the same in every frame)
  water-data.png  per pixel of the region: R the colour's step in pool.WATER (255 = not a water tone: reflection,
                  waterline), G depth from the shore in px (capped), B flags 1 calm, 2 reflection, 4 shade
  glass.png       full map, the glass of the walls layer: 255 the tinted panes, 128 their painted white streaks
  tv-slide.png    what a meeting room's TV shows during a meeting, at the size of the TV's screen
  occluders.png   half size, the walls at floor level (the runtime adds furniture footprints: the occlusion field)
  masks.png       full map, opaque: R 255 outside (lawn, path, the lawn seen through the north glass) or 96 a
                  wall (faces and caps), G 255 polished
                  floor (hall porcelain, reception terrazzo) or 128 a facade's glass, B 255 walkable lawn or 128 open water
  normal.png      the map-space normal texture of the placed sprites, tools/normals.py: spritefusion-sprite-normals when it
                  is installed, else the luminance fallback, and the build prints which one ran. Written by default;
                  KONCLUI_FX_NORMALS=0 leaves it out. The manifest advertises it ("normal": true). The runtime asks for it
                  only when its night-lit setting is on and ignores a missing or wrong-sized file, so the default costs
                  no frame time; tools/README.md has the decision and the determinism check
  manifest.json   sizes, the water region and palette, lights by sprite, static lights, lockable rooms, every room's
                  floor (light stays in its room), the lawn palette, each standing sprite's footprint (its shadow), "kinds"
                  and "painted" (below), and "tools": the versions and hashes of the three SpriteFusion tools that made the
                  build (tool_record; the runtime ignores it)
Two optional manifest keys describe what each placed piece is to the lighting (tools/kinds.py has the one rule; version stays 1,
an older build has neither and the runtime classifies by prefab):
  kinds     {"<collection folder>/<image path>": "stand" | "top" | "hang" | "floor"} for every placed sprite (the keys of
            "shadows"). A "floor" piece (rug, mat, carpet) is left out of normal.png, so it gets no relief
  painted   ["<key>", ...] the stand or top pieces whose picture already draws its own contact shadow: the declared
            baked-shadow layer of translucent.py (the lounge's painted rows, the catalogue's own shadows) plus any picture
            with PAINTED_MIN_PX or more partial-alpha pixels in the bottom quarter of its silhouette (tools/kinds.py
            painted_shadow). The runtime draws no contact shadow over these; KONCLUI_PAINTED_SHADOWS=0 builds the lounge
            pieces without their shade rows and the list shrinks to what is still drawn
Three more optional keys exist only in a build made with KONCLUI_VOLUME_PIECES set (lounge.py; empty by default, and then the
manifest is byte for byte what it was). The manifest stays version 1 and the runtime ignores keys it does not know:
  volume        the switch as the build read it: "air-hockey,arc-lamp-proxy,plant-proxy" (translucent.volume_value); verify.py judges
                the build by it, not by its own environment
  volumePieces  {"<key>": "volume" | "proxy"}: the sprites the switch replaced ("volume": the picture is baked from a recipe, held to the
                whole drawing contract) or touched up ("proxy": the hand-drawn picture kept, a proxy volume behind it)
  casters       {"<key>": {"h": px, "foot": row, "span": [x0, x1]}}: h the height of the piece in px above the floor (21 px per
                metre), foot the last picture row of its ground contact, span the columns [x0, x1) of that contact (x1 EXCLUSIVE, as
                effectsManifest.ts casterSpec reads it). For the pieces "volumePieces" lists, from their recipe or proxy volume, and
                for no other piece: turning on one piece changes the shadow of that piece only. With the switch value "casters-all"
                (alone or beside the others) EVERY placed "stand" sprite has one: the others take tools/contract.py's curated caster
                (hq-office/contract/pieces.json), else its generic rule, so the legacy shadows can be judged alone. The runtime reads it
                (effectsManifest.ts casterSpec, shadeBake.ts placedCaster, since f8a9f93a7): a piece with an entry throws its shadow from `h`, not from its rows, for the key shadow and the lamp shadows
  python3 hq-office/fx.py --dump-kinds DIST OUT.json   the shared classifier fixture [{key, name, tags, depthOffset, kind}]
Lights follow the objects as placed: the runtime lights every scene image whose sprite is listed under "lights", so
a lamp moved in the editor moves its light.
"""
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import kinds as KINDS  # noqa: E402  (tools/kinds.py: the stand / top / hang / floor rule)
import normals as NORMALS  # noqa: E402  (tools/normals.py)
import toolchain as TOOLCHAIN  # noqa: E402  (tools/toolchain.py)
import glass as GL
import lawn as LAWN
import pool as POOL
import translucent as TRANSLUCENT
from palette import rgb

T = 32
DEPTH_CAP = 96
# Sprite names (any collection) -> light kind. The runtime gives each kind its colour, reach and where on the sprite
# it shines from (theme/fx/core.mjs LIGHT_KINDS).
LIGHT_NAMES = [
    (r'^Luminária pendente|^Luminária de arco com cúpula', 'pendant'),
    (r'^Luminária de arco', 'arc'),
    (r'^Luminária de chão', 'floor'),
    (r'^Luminária (molecular|de mesa)', 'desk'),
    (r'^Computador iMac|^Monitor ligado|^Monitor duplo|^Computador com dois monitores', 'screen'),
    (r'^TV de parede', 'tv'),
    (r'^Telão de LED', 'led'),
    (r'^Totem com o K', 'totem'),
    (r'^Geladeira|^Máquina de lanches', 'appliance'),
    (r'^Fliperama', 'arcade'),
    (r'^Balcão de recepção Koncluí|^Tapete de entrada com o K|^Letreiro neon', 'sign'),
]


def _bbox(alpha, rows=None):
    """(x0, y0, x1, y1) of the opaque pixels, optionally only within a band of rows (fractions of the height)."""
    a = alpha.copy()
    if rows:
        h = a.shape[0]
        a[:int(h * rows[0])] = False
        a[int(h * rows[1]):] = False
    ys, xs = np.nonzero(a)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _longest_run(flags):
    """The longest run of True in a 1-D boolean array, as a mask."""
    best, start, out = (0, 0), None, np.zeros_like(flags)
    for i, f in enumerate([*flags, False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            best = max(best, (i - start, start))
            start = None
    out[best[1]:best[1] + best[0]] = True
    return out


def sprite_light(path, kind):
    """Where on its sprite a light shines from, measured on the picture: the shade of a lamp, a screen's glass."""
    img = np.asarray(Image.open(path).convert('RGBA')).astype(int)
    alpha = img[..., 3] > 127
    box = _bbox(alpha)
    if not box:
        return None
    x0, y0, x1, y1 = box
    bottom = alpha.copy()
    bottom[:int(y1 - (y1 - y0) * 0.15)] = False              # the base: the bottom rows of the silhouette
    base_x = float(np.nonzero(bottom)[1].mean())
    spec = dict(kind=kind, w=img.shape[1], h=img.shape[0], foot=[base_x, y1])
    if kind == 'pendant':                                    # a shade that shines down from under it (a pendant, an
        widths = alpha.sum(1)                                # arc lamp's dome): the runtime's arc lamp with its head
        wide = widths >= widths.max() * 0.8                  # just above the rim, the bottom of the topmost run of
        rim = int(np.nonzero(wide)[0][0])                    # wide rows (a floor lamp's base is wide too, lower down)
        while rim + 1 < len(wide) and wide[rim + 1]:
            rim += 1
        xs = np.nonzero(alpha[rim])[0]
        spec.update(kind='arc', head=[float(xs.mean()), float(rim - 4)])
        return spec
    if kind in ('arc', 'floor', 'totem'):
        top = alpha.copy()
        top[int(y0 + (y1 - y0) * 0.35):] = False             # the head: the top third of the silhouette
        ys, xs = np.nonzero(top)
        if kind == 'arc':                                    # an arc lamp's shade hangs at the far end of the arc
            far = np.abs(xs - base_x)
            keep = far >= np.percentile(far, 60)
            xs, ys = xs[keep], ys[keep]
        spec['head'] = [float(xs.mean()), float(ys.mean())]
    if kind in ('sign', 'totem'):                            # the K: white or brand turquoise and mint pixels
        rgb_ = img[..., :3]
        white = rgb_.min(-1) > 200
        brand = (rgb_[..., 1] > 170) & (rgb_[..., 2] > 140) & (rgb_[..., 0] < 140)
        glyph = alpha & (white | brand)
        if kind == 'sign':
            glyph[:int(img.shape[0] * 0.25)] = False             # not the desk's counter top
        if glyph.sum() > 4:
            g = _bbox(glyph)
            spec['glyph'] = list(g)
    if kind in ('screen', 'tv', 'led', 'appliance', 'arcade'):
        lum = img[..., :3].mean(-1)
        dark = alpha & (lum < (110 if kind == 'tv' else 70))  # a switched-off screen: its dark glass
        bright = alpha & (img[..., 2] > img[..., 0] + 30)    # a lit screen: blue over red
        glass = dark if kind == 'tv' else alpha if kind in ('appliance', 'led') else \
            (bright if bright.sum() > 6 else dark)
        rows = _longest_run(glass.sum(1) >= glass.sum(1).max() * 0.5)   # the glass is one block: no shadow lines,
        glass &= rows[:, None]                                              # keyboards or edges beside it
        glass &= _longest_run(glass.sum(0) >= glass.sum(0).max() * 0.5)[None, :]
        g = _bbox(glass)
        spec['screen'] = list(g) if g else [x0, y0, x1, y1]
    return spec


# Sprites that lie flat or hang on a wall cast no shadow on the floor.
FLAT = re.compile(r'tapete|rug|carpet|capacho|quadro|frame|pôster|poster|relógio|clock|^tv |tela|painel|placa|janela|'
                  r'cortina|prateleira flutuante|luminária de parede|espelho|mancha|grama|flor solta|folhas|letreiro|'
                  r'pendente|'
                  # the lounge's own pieces draw their contact shadow in their picture (lounge.py)
                  r'^ave-do-paraíso grande|^costela-de-adão grande|^par de pufes|^banqueta de bar|'
                  r'^sofá de três lugares|^criado-mudo|cúpula|^mesinha redonda|^mesa de centro oval|'
                  r'^balcão de bar de teca|^aparador baixo|^mesa de air hockey|^suporte de tacos|^banquinho|'
                  r'^mesa com lig 4|^pebolim do salão', re.I)


def footprint(path):
    """Where a standing object meets the floor, [x0, y0, x1, y1] on its sprite: the bottom quarter of its silhouette,
    a little narrower than it. The runtime turns these into soft contact shadows (and long ones at sunset)."""
    alpha = np.asarray(Image.open(path).convert('RGBA'))[..., 3] > 127
    box = _bbox(alpha)
    if not box:
        return None
    x0, y0, x1, y1 = box
    h, w = y1 - y0, x1 - x0
    if h < 6 or w < 4:
        return None
    return [round(x0 + w * 0.12), round(y1 - max(4, h * 0.22)), round(x1 - w * 0.12), y1]


FLAT_FOLDERS = ('/walldecor/', '/floors/', '/walls/', '/doors/')


def placed_sprites(dist):
    """Sprite keys of the objects the built map places (the editor may add others: the runtime measures those)."""
    wam = json.loads((dist / 'office.wam').read_text())
    keys = {}
    for path in sorted((dist / 'entities').glob('*/collection.json')):
        doc = json.loads(path.read_text())
        for entry in doc.get('collection', []):
            keys[(doc.get('collectionName'), entry.get('id'))] = (f"{path.parent.name}/{entry.get('imagePath')}", entry)
    used = {}
    for e in wam['entities'].values():
        hit = keys.get((e['prefabRef']['collectionName'], e['prefabRef']['id']))
        if hit:
            used[hit[0]] = hit[1]
    return used


def placed_entries(dist):
    """{'<collection folder>/<image path>': [prefab entry, ...]} of the objects the built map places (tools/kinds.py)."""
    return KINDS.placed_entries(dist)


kind_of = KINDS.entry_kind


def kinds(dist):
    """{key: kind} of every placed sprite (tools/kinds.py kinds_of); a picture whose prefabs disagree stops the build."""
    try:
        return KINDS.kinds_of(dist)
    except ValueError as error:
        raise SystemExit(str(error))


def painted(dist, kind_map):
    """The sorted keys of the stand and top pieces whose picture carries its own contact shadow (see the module docstring)."""
    declared = set(TRANSLUCENT.ENTITY_LAYERS['baked-shadow'][1]) - TRANSLUCENT.unpainted_names(TRANSLUCENT.configured())
    entries = placed_entries(dist)
    out = []
    for key, kind in kind_map.items():
        if kind not in ('stand', 'top'):
            continue
        if any(e.get('name') in declared for e in entries[key]) or \
                KINDS.painted_shadow(np.asarray(Image.open(dist / 'entities' / key.split('/', 1)[0] / key.split('/', 1)[1])
                                                .convert('RGBA'))):
            out.append(key)
    return sorted(out)


def shadows(dist, volume=None):
    """{'<collection folder>/<image path>': footprint, or None for flat things} for the placed sprites. Flat ones are
    listed too, so the runtime does not measure them as if they stood on the floor. `volume` is the build's switch and records
    (write): a piece whose picture no longer paints its own shadow (translucent.VOLUME_UNPAINTED) is not FLAT, and one with a
    volume record takes the footprint of its recipe (the ground rectangle it stands on) over the bottom quarter of its picture."""
    out = {}
    switch = (volume or {}).get('switch') or frozenset()
    records = (volume or {}).get('records') or {}
    unpainted = TRANSLUCENT.unpainted_names(switch)
    for key, entry in sorted(placed_sprites(dist).items()):
        folder, image = key.split('/', 1)
        name = entry.get('name', '')
        if (FLAT.search(name) and name not in unpainted) or any(f in '/' + image for f in FLAT_FOLDERS):
            out[key] = None
            continue
        if key in records and records[key].get('footprint'):
            out[key] = [int(v) for v in records[key]['footprint']]
            continue
        f = footprint(dist / 'entities' / folder / image)
        if f:
            out[key] = f
    return out


FOOT_ROWS = 4                       # the rows at the bottom of a picture that count as its feet when a caster has no recipe


def feet_of(rgba):
    """(foot row, [x0, x1]) of a picture: its last solid row (alpha 200 or more, tools/kinds.py SOLID_ALPHA) and the columns of the
    solid pixels in that row and the FOOT_ROWS - 1 above it. None for a picture with no solid pixel."""
    solid = rgba[..., 3] >= KINDS.SOLID_ALPHA
    rows = np.nonzero(solid.any(1))[0]
    if not len(rows):
        return None
    foot = int(rows[-1])
    cols = np.nonzero(solid[max(0, foot - FOOT_ROWS + 1):foot + 1].any(0))[0]
    return foot, [int(cols.min()), int(cols.max())]


def casters(dist, kind_map, records=None, legacy=False):
    """{key: {h, foot, span}} for the placed `stand` sprites (kind_map: kinds()): h the piece's height in px above the floor, foot
    the last picture row of its ground contact, span the columns [x0, x1) there (the runtime's casterSpec).
    By default only the pieces with a volume record (a recipe or a proxy) get one, and take all three from it: a build with one switch
    name changes the shadow of that piece and of no other. With `legacy` (the switch value "casters-all", translucent.VOLUME_CASTERS_ALL)
    every other stand piece gets one too: h from tools/contract.py's curated caster (hq-office/contract/pieces.json: a measured front
    face, an anchor or the rows), else from its generic rule (tag caps over the rows), foot and span from its own pixels."""
    import contract
    records = records or {}
    pieces = contract.load_json('pieces.json') or {}
    curated = pieces.get('casters') or {}
    entries = placed_entries(dist)
    out = {}
    for key, kind in sorted(kind_map.items()):
        if kind != 'stand':
            continue
        record = (records.get(key) or {}).get('caster')
        if record:                                          # a record's span is inclusive (tools/proxy.py foot_span)
            out[key] = dict(h=int(record['h']), foot=int(record['foot']), span=[int(record['span'][0]), int(record['span'][1]) + 1])
            continue
        if not legacy:
            continue
        folder, image = key.split('/', 1)
        rgba = np.asarray(Image.open(dist / 'entities' / folder / image).convert('RGBA'))
        feet = feet_of(rgba)
        rows = int((rgba[..., 3] >= KINDS.SOLID_ALPHA).any(1).sum())
        if key in curated:
            h = int(curated[key]['h'])
        else:
            h = contract.generic_height([t for e in entries[key] for t in e.get('tags', [])], rows)
        if feet:
            out[key] = dict(h=max(1, h), foot=feet[0], span=[feet[1][0], feet[1][1] + 1])
    return out


def occluders(wall_art, P):
    """Half-size map of what blocks light at floor level: the walls (their faces and thin strips). The runtime adds
    the furniture's footprints and blurs it into the occlusion field."""
    a = np.asarray(wall_art)[..., 3] > 150
    h, w = a.shape
    q = a[:h - h % 2, :w - w % 2].reshape(h // 2, 2, w // 2, 2).mean((1, 3)) > 0.25
    return Image.fromarray((q * 255).astype(np.uint8), 'L')


ANCHOR_TOLERANCE = 2.0              # px: how far a proxy volume's named anchor may move a lamp's light from where the pixels put it


def anchors_agree(spec, named, tolerance=ANCHOR_TOLERANCE):
    """True when the proxy's named anchors ({'light_head': [x, y], 'foot': [x, y]}) lie within `tolerance` px, on both axes, of the head and
    the foot the pixel heuristic measured (`spec`, sprite_light). The proxy refines the heuristic; it does not overrule it: a recipe
    whose head sits 6 px lower than the lamp's shade (MEASURED on the Mobilia arc lamps: head y 17.99 against 24.0) would leave the
    runtime's bulb glow (lights.ts, [hx - 4, hy + 3, 8, 2]) off the shade at night, so that lamp keeps the heuristic."""
    return all(abs(a - b) <= tolerance for want, got in ((spec['head'], named['light_head']), (spec['foot'], named['foot']))
               for a, b in zip(want, got))


def lights(dist, anchors=None):
    """{'<collection folder>/<image path>': spec} for every sprite of the room's collections that gives light. `anchors` is
    {key: {'light_head': [x, y], 'foot': [x, y]}}, the named anchors of a proxy volume: a lamp that has them AND whose heuristic head and
    foot are within ANCHOR_TOLERANCE of them (anchors_agree) takes them instead of the pixel heuristic (sprite_light)."""
    out = {}
    anchors = anchors or {}
    for path in sorted((dist / 'entities').glob('*/collection.json')):
        doc = json.loads(path.read_text())
        for entry in doc.get('collection', []):
            kind = next((k for pattern, k in LIGHT_NAMES if re.search(pattern, entry.get('name', ''))), None)
            if not kind or not entry.get('imagePath'):
                continue
            spec = sprite_light(path.parent / entry['imagePath'], kind)
            if spec:
                key = f"{path.parent.name}/{entry['imagePath']}"
                named = anchors.get(key)
                if named and 'head' in spec and 'light_head' in named and 'foot' in named and anchors_agree(spec, named):
                    spec['head'], spec['foot'] = list(named['light_head']), list(named['foot'])
                out[key] = spec
    return out


def water(pool):
    f = pool.fx
    h, w = f['open'].shape
    pal = np.array(POOL.WATER)
    match = (f['rgb'][..., None, :] == pal[None, None]).all(-1)
    step = np.where(match.any(-1), match.argmax(-1), 255)
    colour = np.zeros((h, w, 4), np.uint8)
    colour[f['open'], :3] = f['rgb'][f['open']]
    colour[f['open'], 3] = 255
    data = np.zeros((h, w, 4), np.uint8)
    data[..., 0] = step
    data[..., 1] = np.clip(f['depth'], 0, DEPTH_CAP).round().astype(np.uint8)
    calm = f['open'] & ~f['reflect'] & ~f['shade']
    data[..., 2] = calm * 1 + (f['reflect'] & f['open']) * 2 + (f['shade'] & f['open']) * 4
    data[..., 3] = f['open'] * 255
    return Image.fromarray(colour, 'RGBA'), Image.fromarray(data, 'RGBA')


def glass_mask(wall_art):
    """The panes: the walls layer's tinted glass and its painted reflections (glass.py: GLASS at alpha 64, white at 52
    or 70) and the glass line of thin glass walls (GLASS at 200, white at 210); rails, posts, mullions, film, shadows
    and solid walls are left out."""
    px = np.asarray(wall_art).astype(int)
    a, c = px[..., 3], px[..., :3]
    glass_c = (np.abs(c - np.array(GL.GLASS)).sum(-1) < 6)
    white = (c.min(-1) > 248)
    pane = ((a >= 40) & (a <= 110) & glass_c) | ((np.abs(a - 200) <= 2) & glass_c)
    streak = ((a >= 40) & (a <= 110) & white) | ((np.abs(a - 210) <= 2) & white)
    return Image.fromarray((pane * 255 + streak * 128).astype(np.uint8), 'L')


def masks(kind_map, pool, P, glass, wall_art):
    h, w = kind_map.shape
    out = np.zeros((h, w, 4), np.uint8)
    outside = np.isin(kind_map, ['lawn', 'path'])
    lawn = kind_map == 'lawn'
    lawn[P.BY0 * T:(P.BY0 + 2) * T, P.vb(P.BX0) * T:P.vb(P.BX1) * T] = False   # the lawn behind the north glass is seen, not walked
    out[..., 0] = outside * 255
    walls = (np.asarray(wall_art)[..., 3] > 150) & ~glass & ~outside   # wall faces and caps: no sun shafts, own light
    out[walls, 0] = 96
    out[..., 1] = np.isin(kind_map, ['hall', 'reception']) * 255
    facade = np.zeros_like(glass)                            # the facades' glass (128): dark at night, warm by the door
    for row in (P.BY0, P.BY1):
        facade[row * T:(row + 2) * T] = glass[row * T:(row + 2) * T]
    for row, g, w in P.DOORS_H:                              # and the entrance's sliding doors, glass too
        if row == P.BY1:
            facade[row * T:(row + 2) * T, g * T:(g + w) * T] = True
    out[facade, 1] = 128
    out[..., 2] = lawn * 255
    out[..., 3] = 255                                        # opaque: the browser premultiplies alpha into colour
    rx, ry = pool.region
    ph, pw = pool.fx['open'].shape
    region = out[ry:ry + ph, rx:rx + pw]
    painted = np.asarray(pool.frames[0])[..., 3] > 0         # water, bank, deck and bridge cover the hall floor there
    region[painted, :3] = 0
    region[pool.fx['open'], :3] = (0, 0, 128)                # the water is neither floor nor lawn
    return Image.fromarray(out, 'RGBA')


def rooms(P, lockable):
    """Lockable rooms with the rectangle the effects blur from outside: the floor and the glass that shows it."""
    out = []
    for room in lockable:
        l, t, r, b = P.ROOMS[room['key']]
        x0, x1 = P.vb(l) * T + 2, P.vb(r) * T - 2
        y0, y1 = (t + 2) * T, b * T
        glass_r = any(c == r and m == 'glass' and a <= t + 2 and z >= b for c, a, z, m in P.V_WALLS)
        glass_b = any(row == b and row != P.BY1 and m == 'glass' and P.vb(a0) <= P.vb(l) and P.vb(a1) >= P.vb(r)
                      for row, a0, a1, _, m in P.H_WALLS)              # a partition, not the facade below it
        if glass_r:
            x1 = P.vb(r) * T + 2
        if glass_b:
            y1 = (b + 2) * T
        out.append(dict(key=room['key'], name=room['name'], layer=room['layer'], rect=[x0, y0, x1 - x0, y1 - y0],
                        floor=[room['rect']['x'], room['rect']['y'], room['rect']['width'], room['rect']['height']]))
    return out


def spaces(P):
    """Every walled room's floor [x, y, w, h]: a lamp inside one lights that room only (walls stop light)."""
    return [[P.vb(l) * T, t * T + 4, (P.vb(r) - P.vb(l)) * T, (b - t) * T] for l, t, r, b in P.ROOMS.values()]


def static_lights(P, pool):
    """Light that no object carries. The entrance at night: a strip on the lobby floor along the doors, the panes either
    side of the doors warm, a carpet of light down the path (a rectangle fading away) and a cooler wash on the lawn
    beside it, each kept on its side of the facade by a clip. And the fountain and a glow in the water."""
    out = []
    building = [P.vb(P.BX0) * T, P.BY0 * T, (P.vb(P.BX1) - P.vb(P.BX0)) * T, (P.BY1 - P.BY0) * T]
    facade = [0, P.BY1 * T, P.W * T, 2 * T]
    south = [0, (P.BY1 + 2) * T, P.W * T, (P.H - P.BY1 - 2) * T]
    for row, g, w in P.DOORS_H:
        if row == P.BY1:
            cx = (g + w / 2) * T
            out.append(dict(kind='door', at=[cx, row * T - 14], r=245, squash=0.22, power=0.85, clip=building))
            # squash 0: a band that fades only sideways (the panes either side of the doors, the lawn under them)
            out.append(dict(kind='door', at=[cx, (row + 1) * T], r=300, squash=0, power=1, clip=facade))
            out.append(dict(kind='door', at=[cx, (row + 2) * T], r=330, squash=0, power=0.45,
                            clip=[0, (row + 2) * T, P.W * T, 26]))
            out.append(dict(kind='door', rect=[g * T - 4, (row + 2) * T, w * T + 8, 150]))
            out.append(dict(kind='doorLawn', at=[cx, (row + 2) * T + 12], r=200, squash=0.55, clip=south))
    fx_, fy_ = pool.fx['fountain']
    out.append(dict(kind='fountain', at=[float(fx_), float(fy_)]))
    lx0, ly0, lx1, ly1 = P.POOL['lake']
    out.append(dict(kind='pool', at=[(lx0 + lx1 + 1) * T / 2, (ly0 + ly1 + 1) * T / 2], r=(lx1 - lx0 + 1) * T * 0.55))
    return out


def tv_slide(width, height):
    """What a meeting room's TV shows while a meeting is on: the K on a petrol-to-turquoise slide, in bands."""
    top, mid, bottom = rgb('#0E6E78'), rgb('#1C9DA3'), rgb('#23C3C4')
    img = np.zeros((height, width, 4), np.uint8)
    for y in range(height):
        img[y, :, :3] = top if y < height / 3 else mid if y < height * 2 / 3 else bottom
    img[..., 3] = 255
    k_h = max(5, round(height * 0.62))
    big = POOL.raster_svg(POOL.LOGO, k_h * 8)
    k = np.asarray(big.resize((big.width * k_h // big.height, k_h), Image.Resampling.BOX))[..., 3] > 110
    ky, kx = (height - k.shape[0]) // 2, (width - k.shape[1]) // 2
    img[ky:ky + k.shape[0], kx:kx + k.shape[1]][k, :3] = (255, 255, 255)
    img[-2, 2:width // 3, :3] = rgb('#53FFC8')                       # the mint underline of the brand
    return Image.fromarray(img, 'RGBA')


def glass_faces(P):
    """[x0, x1, foot y] of every glass face along a horizontal wall: where people in front of it are mirrored
    (theme/fx, the glass mirror). The foot is the face's floor channel (glass.py: row 60 of the 64 px face)."""
    return [[P.vb(a) * T, P.vb(b) * T, row * T + 60] for row, a, b, _, material in P.H_WALLS if material == 'glass']


def tool_record():
    """Which tools made this build, for the manifest's "tools" entry (tools/publish.py copies it into the release ledger, so a
    published map says which tool versions made it): toolchain.versions() without the build host's paths and raw --version
    output (the manifest is served to browsers), and the missing tools by name only."""
    found = TOOLCHAIN.versions()
    keep = ('version', 'pinnedVersion', 'pinnedCommit', 'sha256', 'matches')
    return dict(tools={name: {k: ident[k] for k in keep} for name, ident in found['tools'].items()},
                missing=sorted(found['missing']))


def write(dist, *, pool, kind_map, wall_art, P, lockable, volume=None):
    """Write dist/fx/. `volume` is {'switch': set of switch names, 'records': {sprite key: record}} (build.py, lounge.py): with a
    non-empty switch the manifest gains "volume", "volumePieces" and "casters" (module docstring), the lamps of a proxy take their
    anchors from it, and normal.png takes its normals; with none the files are what they were."""
    volume = dict(volume or {})
    volume.setdefault('switch', frozenset())
    volume.setdefault('records', {})
    out = dist / 'fx'
    out.mkdir(parents=True, exist_ok=True)
    colour, data = water(pool)
    colour.save(out / 'water.png', optimize=True)
    data.save(out / 'water-data.png', optimize=True)
    glass = glass_mask(wall_art)
    glass.save(out / 'glass.png', optimize=True)
    masks(kind_map, pool, P, np.asarray(glass) > 0, wall_art).save(out / 'masks.png', optimize=True)
    occluders(wall_art, P).save(out / 'occluders.png', optimize=True)
    proxied = volume['switch'] & {'arc-lamp-proxy'}
    found = lights(dist, {k: r['anchors'] for k, r in volume['records'].items() if proxied and r.get('anchors')})
    tv = next((v['screen'] for v in found.values() if v['kind'] == 'tv'), [0, 0, 43, 23])
    tv_slide(tv[2] - tv[0], tv[3] - tv[1]).save(out / 'tv-slide.png', optimize=True)
    rx, ry = pool.region
    ph, pw = pool.fx['open'].shape
    kind_map = kinds(dist)
    manifest = dict(
        version=1, map=[P.W * T, P.H * T], tile=T,
        water=dict(rect=[rx, ry, pw, ph], palette=[list(c) for c in POOL.WATER], glint=[list(c) for c in POOL.GLINT],
                   waterline=list(POOL.WATERLINE), depthCap=DEPTH_CAP),
        building=[P.vb(P.BX0) * T, P.BY0 * T, (P.vb(P.BX1) - P.vb(P.BX0)) * T, (P.BY1 + 2 - P.BY0) * T],
        lawn={k: list(v) for k, v in LAWN.GRASS.items()},
        lights=found, shadows=shadows(dist, volume), staticLights=static_lights(P, pool), rooms=rooms(P, lockable),
        spaces=spaces(P), glassFaces=glass_faces(P),
        kinds=kind_map, painted=painted(dist, kind_map),
        ink=list(rgb('#0A0A3D')), tools=tool_record())
    records = {k: r for k, r in volume['records'].items() if k in kind_map}       # a record of a sprite nothing places says nothing
    if volume['switch']:
        manifest['volume'] = TRANSLUCENT.volume_value(volume['switch'])
        manifest['volumePieces'] = {k: records[k]['kind'] for k in sorted(records)}
        manifest['casters'] = casters(dist, kind_map, records, legacy=TRANSLUCENT.VOLUME_CASTERS_ALL in volume['switch'])
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
    add_normals(dist, out, manifest, volume={dist / 'entities' / k.split('/', 1)[0] / k.split('/', 1)[1]: r['normal']
                                             for k, r in records.items() if r.get('normal') is not None})
    return manifest


def add_normals(dist, out, manifest, environ=os.environ, volume=None):
    """Write fx/normal.png and advertise it in the manifest ("normal": true), unless KONCLUI_FX_NORMALS=0. Runs after
    the manifest is on disk: the composer reads the map size from it. Prints which method made the texture. Returns
    True when it wrote the file. `volume` is {sprite path: normal image}: the pieces whose normals a recipe or a proxy volume
    supplies (tools/normals.py), which the normals tool is not run on."""
    if environ.get('KONCLUI_FX_NORMALS') == '0':
        return False
    print(f"fx/normal.png: method {NORMALS.describe(NORMALS.write(dist, out / 'normal.png', 'auto', volume=volume))}")
    manifest['normal'] = True
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
    return True


def dump_kinds(dist, target):
    """The shared classifier fixture the runtime lane's casterKind tests read: [{key, name, tags, depthOffset, kind}] for every
    placed sprite (the first prefab that uses it), in key order. Returns the rows."""
    dist = Path(dist)
    rows = []
    for key, entries in placed_entries(dist).items():
        e = entries[0]
        rows.append(dict(key=key, name=e.get('name'), tags=e.get('tags', []), depthOffset=e.get('depthOffset', 0),
                         kind=kind_of(key, e)))
    Path(target).write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n')
    return rows


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--dump-kinds':
        print(f'{len(dump_kinds(sys.argv[2], sys.argv[3]))} rows -> {sys.argv[3]}')
    else:
        raise SystemExit('usage: python3 hq-office/fx.py --dump-kinds DIST OUT.json')
