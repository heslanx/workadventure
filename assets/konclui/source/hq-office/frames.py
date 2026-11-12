"""Framed pictures of the brand, of Koru and of the restaurants Koncluí serves (owner, 18/10/2026: "Cadê os quadros da
marca? Da Koru? Da área / ICP?"), hung on the HQ's solid walls.

One frame for the whole series, so they read as a set and weigh the same: the brand's ink, 2 px (the inner ring lit on
the top and left), a 1 px paper mat, a faint shadow line under it. The map shows one art pixel per map pixel, so a
picture's detail is its size; the wall face (64 px, about 50 usable) and the free span of each wall bound it. Sizes:
  L   48 x 34 outside, a 42 x 28 picture, on a 64 x 64 canvas from its row 19: the catalogue's blueprint (46 x 32)
  P   34 x 44 outside, a 28 x 38 picture, on a 64 x 64 canvas from its row 11: the botanical illustration (36 x 44)
  XL  64 x 48 outside, a 58 x 42 picture, from row 9: the feature pieces where a wall has room (owner, 18/10/2026:
      "maiores onde couber"): the reception's feature wall and the meeting rooms; one size for both
Booths, auditorium and café keep L and P: their walls hold no more.
Each picture is its own type in the "Koncluí" collection ('Koncluí: quadro <id>'), named in Portuguese, so the editor
lists, places and duplicates it like any other piece. No collision; depthOffset -1, as the catalogue's wall pictures.

Pictures:
  brand   drawn from the official vectors (konclui-platform assets): the K, the wordmark
  Koru    generated with the official Koru as reference (any pose: owner, 18/10/2026); 'comemorando' is the official
          celebration vector itself
  ICP     generated restaurant scenes, one subject on a flat ground, as the catalogue's pictures are
Generated originals, prompts, references, routes and hashes: design/interiors/2026-10-18/brand-frames/ (runs.jsonl).
Conversion: crop to the picture's aspect, area-average down to its pixels, at most 12 colours without dither, then
lone pixels merged into the colour around them.
"""
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

from palette import INK, MINT, NAVY, PAPER, rgb

T = 32
REPO = Path(__file__).resolve().parent.parent
SOURCES = REPO / 'design/interiors/2026-10-18/brand-frames'
SIZES = {'L': ((42, 28), 19), 'P': ((28, 38), 11), 'XL': ((58, 42), 9)}   # picture size, canvas row of the frame's top
FRAME = (rgb(INK), rgb('#1B2A6B'))                           # outer ring, inner ring's lit side
MAT = rgb(PAPER)
SHADOW = (10, 10, 61, 40)                                    # as the feature wall's floor channel

# id -> (size, source, name). Source: 'gen' (originals/<id>.png), 'svg:<file>' (an official vector on a flat ground),
# 'brand:<kind>' (drawn here). FOCUS: the part of a generated original to frame when its whole scene would not read at
# the picture's size: (x0, y0, x1, y1) as fractions, or 'subject' (the figure found against the flat background, with
# a margin): every Koru pose, so Koru fills its frame instead of floating in the ground.
ART = {
    'marca-k': ('P', 'brand:k-navy', 'Quadro: o K da Koncluí'),
    'marca-k-menta': ('P', 'brand:k-mint', 'Quadro: o K em menta'),
    'marca-palavra': ('L', 'brand:wordmark', 'Quadro: Koncluí'),
    'koru-acenando': ('XL', 'gen', 'Quadro: Koru acenando'),
    'koru-apresentando': ('P', 'gen', 'Quadro: Koru apresentando'),
    'koru-comemorando': ('P', 'gen', 'Quadro: Koru comemorando'),
    'koru-notebook': ('P', 'gen', 'Quadro: Koru no notebook'),
    'koru-checklist': ('P', 'gen', 'Quadro: Koru com o checklist'),
    'koru-cafe': ('L', 'gen', 'Quadro: Koru no café'),
    'icp-cozinha': ('XL', 'gen', 'Quadro: a cozinha'),
    'icp-salao': ('XL', 'gen', 'Quadro: o salão'),
    'icp-gestor': ('XL', 'gen', 'Quadro: a gestora e o checklist'),
    'icp-equipe': ('XL', 'gen', 'Quadro: a equipe'),
    'icp-prato': ('L', 'gen', 'Quadro: o prato'),
    'icp-fachada': ('XL', 'gen', 'Quadro: o restaurante'),
    'icp-cafe': ('L', 'gen', 'Quadro: o café'),
}
FOCUS = {'icp-salao': (0.2, 0.22, 0.84, 0.94),               # the waiter between two tables
         **{i: 'subject' for i in ART if i.startswith('koru-')}}


def _subject(img, margin=0.1):
    """The box of what differs from the flat background (the corners' colour), grown by `margin` of its size."""
    a = np.asarray(img.convert('RGB')).astype(int)
    corners = np.array([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]])
    ground = np.median(corners, axis=0)
    ys, xs = np.nonzero(np.abs(a - ground).sum(-1) > 60)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    mx, my = (x1 - x0) * margin, (y1 - y0) * margin
    return (max(0, int(x0 - mx)), max(0, int(y0 - my)), min(img.width, int(x1 + mx)), min(img.height, int(y1 + my)))


def _fit(img, w, h, ground):
    """img centred on a ground of the picture's aspect, whole (no crop): for a figure wider or taller than the frame."""
    W, H = img.size
    if W / H > w / h:
        cw, ch = W, round(W * h / w)
    else:
        cw, ch = round(H * w / h), H
    out = Image.new('RGB', (cw, ch), ground)
    out.paste(img.convert('RGB'), ((cw - W) // 2, (ch - H) // 2))
    return out


def _crop_to(img, w, h):
    """The centred part of img with the picture's aspect."""
    W, H = img.size
    if W / H > w / h:
        cw = round(H * w / h)
        return img.crop(((W - cw) // 2, 0, (W - cw) // 2 + cw, H))
    ch = round(W * h / w)
    return img.crop((0, (H - ch) // 2, W, (H - ch) // 2 + ch))


def _merge_lone(a):
    """A pixel that shares its colour with none of its 8 neighbours takes their most common colour."""
    h, w = a.shape[:2]
    out = a.copy()
    for y in range(h):
        for x in range(w):
            ns = [tuple(a[j, i]) for j in range(max(0, y - 1), min(h, y + 2)) for i in range(max(0, x - 1), min(w, x + 2))
                  if (i, j) != (x, y)]
            if tuple(a[y, x]) not in ns:
                out[y, x] = max(set(ns), key=ns.count)
    return out


def convert(img, w, h, colours=12):
    small = _crop_to(img.convert('RGB'), w, h).resize((w, h), Image.Resampling.BOX)
    q = small.quantize(colors=colours, method=Image.Quantize.MEDIANCUT, kmeans=4, dither=Image.Dither.NONE)
    return Image.fromarray(_merge_lone(np.asarray(q.convert('RGB'))), 'RGB')


def _brand(kind, w, h):
    from signature import crisp, svg              # here: signature.py imports this module for its pieces
    ground, mark = {'k-navy': (NAVY, MINT), 'k-mint': ('#CFF7EA', NAVY), 'wordmark': (NAVY, '#FFFFFF')}[kind]
    img = Image.new('RGBA', (w, h), (*rgb(ground), 255))
    if kind == 'wordmark':
        logo = crisp(svg('logo-konclui-white.svg', width=w - 8), mark)
        img.alpha_composite(logo, ((w - logo.width) // 2, (h - logo.height) // 2 - 2))
        y = (h + logo.height) // 2 + 2
        img.paste((*rgb(MINT), 255), ((w - 16) // 2, y, (w + 16) // 2, y + 1))   # the mint line, as on the LED wall
    else:
        logo = crisp(svg('logo-konclui-icon.svg', height=h - 14), mark)
        img.alpha_composite(logo, ((w - logo.width) // 2, (h - logo.height) // 2))
    return img.convert('RGB')


@lru_cache(maxsize=None)
def picture(art_id):
    size, source, _ = ART[art_id]
    w, h = SIZES[size][0]
    if source.startswith('brand:'):
        return _brand(source[6:], w, h)
    if source.startswith('svg:'):                              # an official vector on the pale mint of the series
        art = Image.open(SOURCES / 'refs' / source[4:]).convert('RGBA')
        art = art.crop(art.getbbox())
        pad = int(max(art.size) * 0.08)
        ground = Image.new('RGBA', (art.width + 2 * pad, art.height + 2 * pad), (*rgb('#DDF5EC'), 255))
        ground.alpha_composite(art, (pad, pad))
        return convert(_fit(ground, w, h, rgb('#DDF5EC')), w, h)
    img = Image.open(SOURCES / 'originals' / f'{art_id}.png')
    focus = FOCUS.get(art_id)
    if focus == 'subject':
        img = img.crop(_subject(img))
        img = _fit(img, w, h, tuple(int(v) for v in np.median(np.asarray(img.convert('RGB'))[[0, 0, -1, -1], [0, -1, 0, -1]], axis=0)))
    elif focus:
        fx0, fy0, fx1, fy1 = focus
        img = img.crop((round(img.width * fx0), round(img.height * fy0), round(img.width * fx1), round(img.height * fy1)))
    return convert(img, w, h)


def framed(art_id):
    """The picture in its frame, on the canvas it hangs from: 64 px tall, 64 px wide or the frame's width and 2 px."""
    size = ART[art_id][0]
    (w, h), top = SIZES[size]
    ow, oh = w + 6, h + 6
    cw = max(2 * T, ow + 2)
    canvas = Image.new('RGBA', (cw, 2 * T))
    x0 = (cw - ow) // 2
    frame = Image.new('RGBA', (ow, oh), (*FRAME[0], 255))
    frame.paste((*FRAME[1], 255), (1, 1, ow - 1, 2))             # the inner ring's lit top and left
    frame.paste((*FRAME[1], 255), (1, 1, 2, oh - 1))
    frame.paste((*MAT, 255), (2, 2, ow - 2, oh - 2))
    frame.paste(picture(art_id).convert('RGBA'), (3, 3))
    canvas.alpha_composite(frame, (x0, top))
    canvas.paste(SHADOW, (x0 + 1, top + oh, x0 + ow, top + oh + 1))
    return canvas


def pieces():
    """{'Koncluí: quadro <id>': {'ink': dict(image, collisionGrid, depthOffset)}} for signature.pieces()."""
    return {f'Koncluí: quadro {i}': {'ink': dict(image=framed(i), collisionGrid=None, depthOffset=-1)} for i in ART}


NAMES = {f'Koncluí: quadro {i}': name for i, (_, _, name) in ART.items()}
