"""Touch-ups by code for HAND-DRAWN pieces that keep their drawing: pure functions over RGBA arrays that fix one audited defect
each, without redrawing the piece. numpy only; deterministic; no function touches a pixel outside the defect it names.

Every function takes an (h, w, 4) uint8 array and returns (new array, report dict); the input is never modified. A report counts
what changed, so a touch-up is measurable: how many pixels went, how many solid ones were touched (0 unless the function is a
repaint), the canvas shift when the canvas grew.

    strip_light_pool(rgba)         the picture's own baked pool of light (lounge.py `light_pool`: bright pixels with a partial
                                   alpha, 90 to 125, tools/translucent.py layer `lamp-light-pool`) becomes transparent
    strip_painted_shadow(rgba)     the picture's own soft shadow rows (dark pixels with a partial alpha near the foot or below it:
                                   the SAME band and thresholds as tools/kinds.py `painted_shadow`, read from its constants)
                                   become transparent, so `painted_shadow(result)` is False
    unclip(rgba, margin, ...)      art that touches the canvas edge: the canvas grows so that at least `margin` transparent px
                                   surround the art, and a run of art that the edge cut flat gets its leaf tip back (tapered,
                                   outlined, colours of the stripes it was cut across). Returns the shift of the art in the new
                                   canvas: the placement of the entity moves by minus that
    darken_underside(rgba, glow, rim)   a dome that shows its glowing underside: the glow pixels take the dome's own body colour
                                   from the pixel above them, the lowest one of each column takes the rim colour. The runtime lamp
                                   supplies the glow; the picture no longer needs a camera below the shade
    curve_foot(rgba, depth)        a pot whose foot is a straight line: the foot's corners are cut along an ellipse arc
                                   `depth` rows deep and re-outlined, so the foot reads as the round base it is on the ground

and one recipe per piece, composed of the above (what the integrator calls):

    lamp_konclui(rgba)   pool + painted shadow. The orange underside STAYS: it is what the runtime's bulb rect (lights.ts, 8x2 px at
                         the head) is painted over at night; without it the rect is a khaki smudge on a dark dome (seen lit)
    lamp_konclui_dark_dome(rgba)   the same + the dark underside: NOT in RECIPES, kept only to reproduce that finding
    lamp_mobilia(rgba)   the white underside rim (both Mobilia arc lamps: the second is the first mirrored)
    bird_of_paradise(rgba)   painted shadow + a clipped canvas + a curved foot

NOT done, and why: a rounder pot rim needs more rows of rim than the picture has, and the picture's 6 rows are a bucket seen from
the side that the proxy volume shades as a round pot (tools/proxy.py `flattened`); a repaint of those rows did not read as drawn
(see the report). Sizes ("too big") are not a touch-up: a resample of pixel art is a redraw.

`enabled(environ)` is the switch: nothing replaces art in a default build, KONCLUI_TOUCHUPS=1 turns the recipes on.
"""
import os
import sys
from dataclasses import dataclass
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[2] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

import numpy as np  # noqa: E402

import kinds as K  # noqa: E402

SOLID_ALPHA = K.SOLID_ALPHA
ENV_SWITCH = 'KONCLUI_TOUCHUPS'
GLOW_MIN_RED, GLOW_MIN_WARMTH = 190, 80         # a warm glow pixel: red high and red - blue at least this (the rim #C9772A, #FAC85A, #FCE79A)
WHITE_MIN = 250                                 # the Mobilia lamp's under-shade rim is pure white (255, 255, 255)
RIM_DARK = (0x0D, 0x10, 0x18)                   # the Konclui lamp's own outline colour
RIM_NAVY = (0x30, 0x32, 0x5E)                   # the Mobilia lamp's own outline colour


def enabled(environ=os.environ):
    """False (the default) unless KONCLUI_TOUCHUPS=1."""
    return environ.get(ENV_SWITCH, '0') == '1'


def _rgba(a):
    a = np.asarray(a)
    if a.ndim != 3 or a.shape[2] != 4 or a.dtype != np.uint8:
        raise ValueError(f'an (h, w, 4) uint8 RGBA array is expected, got {a.shape} {a.dtype}')
    return a.copy()


def _clear(a, mask):
    a[mask] = 0


# ----------------------------------------------------------------------------------------------------- light pool

def pool_mask(rgba):
    """Partial-alpha pixels that are BRIGHT (some channel at or over kinds.PAINTED_DARK_BELOW): a baked pool of light. A dark one
    is a painted shadow, a solid one is the piece."""
    a = np.asarray(rgba)
    alpha = a[..., 3]
    return (alpha > 0) & (alpha < K.PAINTED_ALPHA_BELOW) & (a[..., :3].max(-1) >= K.PAINTED_DARK_BELOW)


def strip_light_pool(rgba):
    out = _rgba(rgba)
    m = pool_mask(out)
    _clear(out, m)
    return out, {'removed_px': int(m.sum()), 'solid_changed_px': 0}


# --------------------------------------------------------------------------------------------------- painted shadow

def painted_shadow_mask(rgba):
    """The pixels tools/kinds.py `painted_shadow` counts: dark (every channel under PAINTED_DARK_BELOW) with 0 < alpha <
    PAINTED_ALPHA_BELOW, in the last ceil(PAINTED_BOTTOM * height) rows of the silhouette or in any row below its foot. Empty when
    the picture has no solid pixel."""
    a = np.asarray(rgba)
    alpha = a[..., 3]
    m = np.zeros(alpha.shape, bool)
    rows = K.silhouette_rows(alpha)
    if rows is None:
        return m
    top, foot = rows
    first = foot - int(np.ceil((foot - top + 1) * K.PAINTED_BOTTOM)) + 1
    band = (alpha > 0) & (alpha < K.PAINTED_ALPHA_BELOW) & (a[..., :3].max(-1) < K.PAINTED_DARK_BELOW)
    m[first:] = band[first:]
    return m


def strip_painted_shadow(rgba):
    out = _rgba(rgba)
    before = K.painted_shadow(out)
    m = painted_shadow_mask(out)
    _clear(out, m)
    return out, {'removed_px': int(m.sum()), 'solid_changed_px': 0, 'painted_before': bool(before),
                 'painted_after': bool(K.painted_shadow(out))}


# ----------------------------------------------------------------------------------------------------- clipped art

def _runs(row):
    """[(x0, x1)] of the runs of True in a 1-D bool array."""
    idx = np.nonzero(row)[0]
    if not idx.size:
        return []
    cuts = np.nonzero(np.diff(idx) > 1)[0]
    starts = np.concatenate([[idx[0]], idx[cuts + 1]])
    ends = np.concatenate([idx[cuts], [idx[-1]]])
    return list(zip(starts.tolist(), ends.tolist()))


def _same(p, q):
    return bool((p[:3] == q[:3]).all())


def _close_top(a, edge, max_tip):
    """Close the runs of solid pixels on row `edge` (the original top row, with transparent rows above it) in place. Returns the
    number of runs closed and the pixels added."""
    solid = a[..., 3] >= SOLID_ALPHA
    closed = added = 0
    for x0, x1 in _runs(solid[edge]):
        w = x1 - x0 + 1
        if w < 3 or edge + 1 >= a.shape[0]:
            continue
        outline_l, outline_r = a[edge, x0].copy(), a[edge, x1].copy()
        for x in range(x0 + 1, x1):                              # the canvas border made an outline here: the leaf goes on
            below = a[edge + 1, x]
            if below[3] >= SOLID_ALPHA and (_same(a[edge, x], outline_l) or _same(a[edge, x], outline_r)) \
                    and not _same(below, outline_l) and not _same(below, outline_r):
                a[edge, x] = below
        n = min(max_tip, max(1, (w - 1) // 2 - 1))
        half = (x1 - x0) / 2.0
        for k in range(1, n + 1):
            s = int(round(k * half / (n + 1)))
            row = edge - k
            if row < 0:
                break
            lo, hi = x0 + s, x1 - s
            for x in range(lo, hi + 1):
                p = a[edge, x].copy()
                if x == lo or x == hi or k == n:
                    p = outline_l if x <= (x0 + x1) // 2 else outline_r
                a[row, x] = p
                added += 1
        closed += 1
    return closed, added


def unclip(rgba, margin=2, close_tips=True, max_tip=6):
    """Grow the canvas so no solid pixel is within `margin` px of an edge (never crops), and close the leaf tips the canvas cut.
    Returns (array, report); report['shift'] = (dx, dy) is where the old canvas's (0, 0) lands in the new one (the art moved
    right by dx and down by dy inside the picture: the entity's placement moves by (-dx, -dy) to keep the art where it was)."""
    a = _rgba(rgba)
    if margin < 0 or max_tip < 0:
        raise ValueError('margin and max_tip are not negative')
    solid = a[..., 3] >= SOLID_ALPHA
    if not solid.any():
        return a, {'shift': (0, 0), 'grown': {'top': 0, 'right': 0, 'bottom': 0, 'left': 0}, 'tips_closed': 0, 'added_px': 0,
                   'touching': [], 'size': [a.shape[1], a.shape[0]]}
    H, W = solid.shape
    free = {'top': int(np.argmax(solid.any(1))), 'bottom': int(np.argmax(solid.any(1)[::-1])),
            'left': int(np.argmax(solid.any(0))), 'right': int(np.argmax(solid.any(0)[::-1]))}
    touching = sorted(s for s, f in free.items() if f == 0)
    grow = {s: max(0, margin - f) for s, f in free.items()}
    if close_tips:
        for s in touching:
            grow[s] += max_tip
    # array.pad is (top, bottom), (left, right); `rot` turns each side to the top: top 0, right 1 (ccw), bottom 2, left 3
    padded = np.zeros((H + grow['top'] + grow['bottom'], W + grow['left'] + grow['right'], 4), np.uint8)
    padded[grow['top']:grow['top'] + H, grow['left']:grow['left'] + W] = a
    closed = added = 0
    if close_tips:
        for s, k in (('top', 0), ('right', 1), ('bottom', 2), ('left', 3)):
            if s not in touching:
                continue
            r = np.rot90(padded, k).copy()
            c, ad = _close_top(r, grow[s], max_tip)       # the art's outermost row sits `grow[s]` rows from the top
            closed += c
            added += ad
            padded = np.rot90(r, -k).copy()
    return padded, {'shift': (grow['left'], grow['top']), 'grown': grow, 'tips_closed': closed, 'added_px': added,
                    'touching': touching, 'size': [padded.shape[1], padded.shape[0]]}


# ----------------------------------------------------------------------------------------------------------- domes

def glow_mask(rgba):
    """Solid pixels of a warm glow: red at least GLOW_MIN_RED and red minus blue at least GLOW_MIN_WARMTH (white and grey are not warm)."""
    a = np.asarray(rgba)
    warmth = a[..., 0].astype(int) - a[..., 2].astype(int)
    return (a[..., 3] >= SOLID_ALPHA) & (a[..., 0] >= GLOW_MIN_RED) & (warmth >= GLOW_MIN_WARMTH)


def white_mask(rgba):
    """Solid pixels of pure white (the Mobilia lamp's under-shade rim): every channel at or over WHITE_MIN."""
    a = np.asarray(rgba)
    return (a[..., 3] >= SOLID_ALPHA) & (a[..., :3].min(-1) >= WHITE_MIN)


def darken_underside(rgba, glow, rim):
    """Repaint the pixels of `glow` (bool mask): in each column, a vertical run of them takes the colour of the pixel above its top
    (the dome's body) when that pixel is solid and not glow, else `rim`; the lowest pixel of the run takes `rim`. A pixel with
    neither a body above it nor a run below takes `rim`. Returns (array, report)."""
    out = _rgba(rgba)
    glow = np.asarray(glow, bool)
    H, W = glow.shape
    solid_before = int((out[..., 3] >= SOLID_ALPHA).sum())
    changed = 0
    rim = np.array(rim, np.uint8)
    for x in range(W):
        for y0, y1 in _runs(glow[:, x]):
            above = out[y0 - 1, x] if y0 > 0 else None
            body = above is not None and above[3] >= SOLID_ALPHA and not glow[y0 - 1, x]
            for y in range(y0, y1 + 1):
                out[y, x, :3] = out[y0 - 1, x, :3] if (body and y < y1) else rim
                out[y, x, 3] = 255
                changed += 1
    return out, {'repainted_px': changed, 'solid_px_before': solid_before, 'solid_px_after': int((out[..., 3] >= SOLID_ALPHA).sum())}


# ------------------------------------------------------------------------------------------------------------- foot

def curve_foot(rgba, depth=2):
    """Cut the corners of the straight foot of a pot along an ellipse arc `depth` rows deep (the middle stays on the foot row) and
    outline the new edge in the foot's own colour. The foot is the lowest solid row; the body is the row above it. Returns
    (array, report); a picture whose foot is narrower than 6 px is left as it is."""
    out = _rgba(rgba)
    solid = out[..., 3] >= SOLID_ALPHA
    rows = np.nonzero(solid.any(1))[0]
    if rows.size == 0 or depth < 1:
        return out, {'cut_px': 0, 'foot_row': None}
    F = int(rows[-1])
    body = _runs(solid[F - 1]) if F >= 1 else []
    if not body:
        return out, {'cut_px': 0, 'foot_row': F}
    b0, b1 = max(body, key=lambda r: r[1] - r[0])
    if b1 - b0 + 1 < 6 or F - depth < 0:
        return out, {'cut_px': 0, 'foot_row': F}
    ink = out[F, (b0 + b1) // 2].copy()
    c, half = (b0 + b1) / 2.0, (b1 - b0) / 2.0          # the outermost columns are the arc's ends: full depth there
    cut_px = 0
    solid_before = int(solid.sum())
    for x in range(b0, b1 + 1):
        t = min(1.0, abs(x - c) / half)
        cut = int(round(depth * (1.0 - np.sqrt(1.0 - t * t))))
        yb = F - cut
        for y in range(yb + 1, F + 1):
            if out[y, x, 3] >= SOLID_ALPHA:
                out[y, x] = 0
                cut_px += 1
        if cut and out[yb, x, 3] >= SOLID_ALPHA:
            out[yb, x] = ink
    return out, {'cut_px': cut_px, 'foot_row': F, 'depth': depth, 'span': [int(b0), int(b1)],
                 'solid_px_before': solid_before, 'solid_px_after': int((out[..., 3] >= SOLID_ALPHA).sum())}


# ----------------------------------------------------------------------------------------------------------- recipes

@dataclass
class TouchUp:
    rgba: np.ndarray
    shift: tuple               # (dx, dy): where the old canvas's (0, 0) is in the new one
    steps: list                # [(name, report)]

    @property
    def placement_shift(self):
        return (-self.shift[0], -self.shift[1])


def _chain(rgba, steps):
    a, shift, log = _rgba(rgba), (0, 0), []
    for name, fn in steps:
        a, rep = fn(a)
        if 'shift' in rep:
            shift = (shift[0] + rep['shift'][0], shift[1] + rep['shift'][1])
        log.append((name, rep))
    return TouchUp(a, shift, log)


def lamp_konclui(rgba):
    return _chain(rgba, [('strip_light_pool', strip_light_pool), ('strip_painted_shadow', strip_painted_shadow)])


def lamp_konclui_dark_dome(rgba):
    """Measured lit (shader lab, lounge preset, hours 15.5 and 22): by day a clean bell, at night the runtime's bulb rect is an
    olive 8x2 smudge on a navy dome and the lamp no longer reads as on. Worse than the drawn orange band; not a recipe."""
    return _chain(rgba, [('strip_light_pool', strip_light_pool), ('strip_painted_shadow', strip_painted_shadow),
                         ('darken_underside', lambda a: darken_underside(a, glow_mask(a), RIM_DARK))])


def lamp_mobilia(rgba):
    return _chain(rgba, [('darken_underside', lambda a: darken_underside(a, white_mask(a), RIM_NAVY))])


def bird_of_paradise(rgba):
    return _chain(rgba, [('strip_painted_shadow', strip_painted_shadow), ('curve_foot', curve_foot), ('unclip', unclip)])


RECIPES = {'arc_lamp.konclui': lamp_konclui, 'arc_lamp.mobilia_right': lamp_mobilia, 'arc_lamp.mobilia_left': lamp_mobilia,
           'bird_of_paradise.alta': bird_of_paradise, 'bird_of_paradise.branco': bird_of_paradise}
