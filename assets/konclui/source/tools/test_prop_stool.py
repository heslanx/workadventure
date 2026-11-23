"""Behaviour tests of the bar stool piece (hq-office/props/stool.py), baked with tools/bake.py in both projections.

They pin what the asset audit found wrong in today's stool picture (lounge.py stool(), konclui-banqueta-turquesa): mixed views,
near and far feet 2 px apart, a straight foot bar, art floating 21 rows above the canvas bottom, three baked shadow rows, a
crown with no dark edge; what the art-director review of Wave 1's recipe found (an octagon silhouette, a hollow highlight ring,
no ink where cushion and legs meet, a ring that read as a crossbar, stray light pixels); and what the judge of Wave 1 found
(a flat drum on a hoop: no splayed legs, no crossbar, no cushion form, and no seat numbers). Round 2 added the tests of the
splay, of the far feet, of the foot ring, of the cushion's tones and of the seat numbers. Round 3 answers the art director's
review of round 2 (5 of 10: a smiley face of two far-leg stubs over a U-shaped ring arc, a 14 px cushion on a 22 px bell of legs,
3 px legs with a boot foot, a near-black outline round a lidded-jar cushion): the far legs are read beside the near ones, the
stance is narrower than the bell, the legs are 2 px posts with a plain foot, the top arc is dark teal and the top face has a
lighter lens-shaped oval in it, and no pixel is the brand turquoise that the camera pass keeps lit at night (found in the shader
lab). Each test says which defect it catches.

Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_prop_stool.py
To check a test against a deliberately broken recipe, point STOOL_FILE at a modified copy of stool.py:
    STOOL_NO_PATCH=1 STOOL_FILE=/tmp/mutant/stool.py python3 -I tools/test_prop_stool.py
(The picture has no hand-made pixel since round 3, so there is no patch to apply and none that a mutant could leave stale.
STOOL_OVERRIDES_DIR and STOOL_NO_PATCH are still read: a patch put in another directory is applied, and the test that no patch
is applied then fails by design.)"""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SOURCE / 'hq-office'))
import bake as B  # noqa: E402
import props  # noqa: E402
import volume as V  # noqa: E402


def _load_stool():
    path = os.environ.get('STOOL_FILE')
    if not path:
        from props import stool
        return stool
    spec = importlib.util.spec_from_file_location('stool_under_test', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


STOOL = _load_stool()
PROJECTIONS = ('oblique', 'camera75')
OLD_CANVAS_PX = 32 * 64        # today's picture: 2048 px of canvas
OLD_NEAR_FAR_FEET_PX = 2       # MEASURED in the audit: near feet end at row 42, far feet at row 40
TILE = 32
TURQ = V.PALETTE['FURNITURE_RAMPS']['ds-turquoise']
# the cushion's tones, read from palette.py and not from the recipe under test: the top face is the ramp's 2nd stop at the rim and
# its 4th (lighter) in an oval in the middle; the band under it is the 1st stop. The 3rd stop (the brand turquoise, #02D1CE) is not
# used: the camera pass keeps it lit at night (see test_no_pixel_is_the_brand_turquoise_that_glows_at_night)
TOP_TONE, LIGHT_TONE, BAND_TONE = TURQ[1], TURQ[3], TURQ[0]
RIM_INK = V.PALETTE['FURNITURE_RAMPS']['ds-petrol'][1]        # dark teal: the top arc
CUSHION_INK = V.PALETTE['FURNITURE_RAMPS']['ds-petrol'][0]    # near-black: the underside (the band, the welt)
PAD_TONES = [TOP_TONE, LIGHT_TONE, BAND_TONE, RIM_INK, CUSHION_INK]
FILL_TONES = [TOP_TONE, LIGHT_TONE, BAND_TONE]
TOP_FACE_TONES = [TOP_TONE, LIGHT_TONE]
INK_TONES = [RIM_INK, CUSHION_INK]
TODAY_ANCHOR_Y, TODAY_FOOT_Y = 29, 43     # today's picture: STOOL_SEAT's anchor row and the foot point (feet end at row 42), MEASURED in the audit
PROJ_FILE = json.loads((HERE / 'projection.json').read_text())

_cache = {}
NO_PATCH = bool(os.environ.get('STOOL_NO_PATCH'))
OVERRIDES_DIR = os.environ.get('STOOL_OVERRIDES_DIR') or None


def bake(projection, **kw):
    key = (projection, tuple(sorted(kw.items())))
    if key not in _cache:
        _cache[key] = B.bake(STOOL.build(), projection, old_canvas=STOOL.OLD_CANVAS, old_foot=STOOL.OLD_FOOT, overrides=not NO_PATCH, overrides_dir=OVERRIDES_DIR, **kw)
    return _cache[key]


def sha(piece):
    h = hashlib.sha256()
    for im in piece.images().values():
        h.update(np.asarray(im).tobytes())
    h.update(json.dumps(piece.to_json(), sort_keys=True).encode())
    return h.hexdigest()


def anchor_rows(piece, a, b):
    return abs(piece.anchors[a][1] - piece.anchors[b][1])


def ring_row_span(piece):
    """How many rows the foot ring's lowest pixel moves across the span between the legs: the ring is the opaque pixels at
    the ring's height (2 to 5 px) in the columns between the left and the right legs. A straight bar has span 0, a circle
    seen from above has the near arc's sag."""
    h, a = piece.height, piece.rgba[..., 3]
    x0 = int(piece.anchors['foot_near_left'][0]) + 3
    x1 = int(piece.anchors['foot_near_right'][0]) - 4          # a mirrored column pair: the right foot's column is int(x) - 1
    lows = []
    for c in range(x0, x1 + 1):
        rows = [r for r in range(h.shape[0]) if a[r, c] and 2 <= h[r, c] <= 5]
        lows.append(max(rows) if rows else -1)
    seen = [l for l in lows if l >= 0]
    return (max(seen) - min(seen) if seen else 0), lows


def ring_rows(piece):
    """How many distinct rows the ring's pixels (2 to 5 px above the floor) cover between the legs."""
    h, a = piece.height, piece.rgba[..., 3]
    x0 = int(piece.anchors['foot_near_left'][0]) + 3
    x1 = int(piece.anchors['foot_near_right'][0]) - 4
    return len({r for c in range(x0, x1 + 1) for r in range(h.shape[0]) if a[r, c] and 2 <= h[r, c] <= 5})


def pad_bottom_row(piece):
    """The last row that holds a cushion tone (its top, centre and band tones, the highlight or its petrol ink): the pad's underside."""
    tones = PAD_TONES
    return int(np.nonzero(colour_set(piece, tones).any(axis=1))[0].max())


def pad_width(piece):
    """The width of the cushion's widest row, in px (its columns between the outermost cushion tones)."""
    cols = np.nonzero(colour_set(piece, PAD_TONES).any(axis=0))[0]
    return int(cols.max() - cols.min() + 1)


def underside_width(piece):
    """How many px of cushion ink the pad's last row holds: the width of its underside, narrower than the pad's widest row (the
    pad's lower corners are rounded)."""
    r = pad_bottom_row(piece)
    return int(colour_set(piece, PAD_TONES)[r].sum())


def outer_columns(piece, rows):
    """(left, right) column of the outermost opaque pixel of each given row: under the pad that is the near legs' outer edge."""
    a = piece.rgba[..., 3] > 0
    return [(int(np.nonzero(a[r])[0].min()), int(np.nonzero(a[r])[0].max())) for r in rows]


def components(mask):
    """4-connected components of a boolean mask as a label image (0 is the background) and their count."""
    h, w = mask.shape
    lab = np.zeros((h, w), int)
    n = 0
    for r in range(h):
        for c in range(w):
            if mask[r, c] and not lab[r, c]:
                n += 1
                stack = [(r, c)]
                lab[r, c] = n
                while stack:
                    y, x = stack.pop()
                    for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = n
                            stack.append((yy, xx))
    return lab, n


def ring_dip(piece):
    """(first row, last row, lowest row per column) of the foot ring between the legs and under the pad: the opaque pixels at the
    ring's height (3 to 6 px above the floor) in the columns between the two near legs, below the pad. A hoop dips from where
    it meets the legs to its lowest point; a flat bar covers one row or two."""
    h, a = piece.height, piece.rgba[..., 3]
    x0 = int(piece.anchors['foot_near_left'][0]) + 2
    x1 = int(piece.anchors['foot_near_right'][0]) - 3
    below = range(pad_bottom_row(piece) + 1, h.shape[0])
    per_col = [[r for r in below if a[r, c] and 3 <= h[r, c] <= 6] for c in range(x0, x1 + 1)]
    rows = [r for col in per_col for r in col]
    if not rows:
        return None, None, []
    return min(rows), max(rows), [max(col) if col else -1 for col in per_col]


def wood_tones():
    """Every tone of the timber materials (the near legs and the far legs and hoop)."""
    return list(STOOL.TIMBER.ramp) + list(STOOL.TIMBER_NEAR.ramp)


def colour_set(piece, hexes):
    """Boolean mask of the opaque pixels whose colour is one of the given hex tones."""
    wanted = {V.hex_rgb(t) for t in hexes}
    px = piece.rgba
    return np.array([[bool(q[3]) and tuple(int(v) for v in q[:3]) in wanted for q in row] for row in px])


def neighbours4(mask):
    pad = np.pad(mask, 1)
    h, w = mask.shape
    return sum(pad[1 + dy:1 + dy + h, 1 + dx:1 + dx + w].astype(int) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)))


def leg_runs(piece, row):
    """Widths of the opaque runs of a row that lie in the left and right leg columns (outside the cushion's middle)."""
    a = piece.rgba[row, :, 3] > 0
    w = piece.size[0]
    runs, c = [], 0
    while c < w:
        if a[c]:
            e = c
            while e < w and a[e]:
                e += 1
            runs.append((c, e - c))
            c = e
        else:
            c += 1
    return runs


class Bakes(unittest.TestCase):
    """The piece exists in the registry and bakes clean in both projections."""

    def test_registered_once_without_errors(self):
        if os.environ.get('STOOL_FILE'):
            self.skipTest('a mutant is loaded from a file, not from the registry')
        self.assertIn('stool', props.names())
        self.assertNotIn('stool', props.errors())

    def test_both_projections_bake_without_violations_or_warnings(self):
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                self.assertEqual(piece.violations, [])
                self.assertEqual(piece.warnings, [])

    def test_canvas_is_small_and_smaller_than_today(self):
        # DEFECT: a 32 x 64 canvas holding a 20 x 32 picture. The plan allows 24 x 32 for a stool.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                w, h = bake(p).size
                self.assertLessEqual(w, 24)
                self.assertLessEqual(h, 32)
                self.assertLess(w * h, OLD_CANVAS_PX / 3)

    def test_footprint_depth_follows_the_projection(self):
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                fp = bake(p).footprint
                self.assertEqual(fp['tiles'], (0.5, 0.5))
                sx, sy = PROJ_FILE['projections'][p]['sx_px_per_m'], PROJ_FILE['projections'][p]['sy_px_per_m']
                self.assertAlmostEqual(fp['px']['w'], 0.5 * sx, delta=0.01)
                self.assertAlmostEqual(fp['px']['h'], 0.5 * sy, delta=0.01)


class Audit(unittest.TestCase):
    """The defects the audit measured in today's picture."""

    def test_feet_are_a_footprint_apart_on_screen(self):
        # DEFECT: near and far feet 2 px apart where the cushion's pitch needs about 8 or more. The plan asks for 9 or more.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                for side in ('left', 'right'):
                    gap = anchor_rows(piece, f'foot_near_{side}', f'foot_far_{side}')
                    self.assertGreaterEqual(gap, 9)
                    self.assertGreater(gap, 4 * OLD_NEAR_FAR_FEET_PX)
                # and the legs really end there: an opaque pixel within one px of every foot anchor
                a = piece.rgba[..., 3]
                for name in ('foot_far_left', 'foot_far_right', 'foot_near_left', 'foot_near_right'):
                    x, y = piece.anchors[name]
                    c, r = int(x), int(min(y, piece.size[1] - 1))
                    window = a[max(0, r - 1):r + 2, max(0, c - 1):c + 2]
                    self.assertTrue(window.any(), f'{name} at {(x, y)} has no leg under it')

    def test_feet_gap_into_the_footprint_depth(self):
        # the pair is the depth of the legs' stance apart: about 0.40 m of ground (the brief), whatever the projection's px per metre
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                sy = PROJ_FILE['projections'][p]['sy_px_per_m']
                metres = anchor_rows(bake(p), 'foot_near_left', 'foot_far_left') / sy
                self.assertGreaterEqual(metres, 0.38)
                self.assertLessEqual(metres, 0.43)

    def test_picture_stands_on_the_canvas_bottom(self):
        # DEFECT: foot_gap 21 (the art ends 21 rows above the canvas bottom) with depthOffset -36 to compensate.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                self.assertLessEqual(piece.metrics['foot_gap'], 1)
                self.assertEqual(piece.sort_line, piece.size[1])
                self.assertEqual(piece.depth_offset, 0)
                rows = np.nonzero(piece.rgba[..., 3].any(axis=1))[0]
                self.assertGreaterEqual(rows.max(), piece.size[1] - 2)

    def test_no_baked_shadow_and_no_translucent_pixel(self):
        # DEFECT: three baked contact-shadow rows (alpha 50, 50, 30) that the runtime shadow then doubles.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                alpha = bake(p).rgba[..., 3]
                self.assertTrue(set(np.unique(alpha)) <= {0, 255})
                self.assertEqual(bake(p).normal[..., 3].tolist(), alpha.tolist())

    def test_seat_top_is_16_px_above_the_floor(self):
        # the plan's bar-stool seat: 0.75 m at 21 px per metre of height (the recipe's 0.745 m rounds to the same 16 px)
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                top = int(bake(p).height.max())
                self.assertEqual(top, round(0.75 * PROJ_FILE['projections'][p]['sz_px_per_m']))
                self.assertAlmostEqual(STOOL.SEAT_TOP, 0.75, delta=0.01)

    def test_top_arc_is_dark_teal_and_the_underside_near_black(self):
        # DEFECT (art-director review of round 2): "a near-black navy outline round the whole top and sides reads as a lidded jar
        # or a gem". The top arc (the crown's first rows, down to the top face's widest row) is inked in dark teal; the near-black
        # ink is kept for the underside: the band's lower corners and the row under the band. Both inks are on the office palette.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                rim, under = colour_set(piece, [RIM_INK]), colour_set(piece, [CUSHION_INK])
                top = colour_set(piece, TOP_FACE_TONES)
                widest = int(top.sum(axis=1).argmax())
                self.assertTrue(rim[:widest + 1].sum() >= 14, 'the top arc is dark teal')
                self.assertEqual(int(under[:widest].sum()), 0, 'no near-black ink above the top face\'s widest row')
                self.assertTrue(under[pad_bottom_row(piece)].sum() >= 6, 'the underside row is near-black')
                self.assertGreater(int(under.sum()), 0)

    def test_crown_has_a_dark_edge(self):
        # DEFECT: the crown rows used the lighter teal (#1C7F88) as their outline, so the top had no ink edge while the legs did.
        # The edge must be one colour, darker than the darkest tone of the turquoise ramp the cushion is made of (read from
        # palette.py, not from the recipe under test).
        def luma(c):
            return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
        darkest_teal = V.hex_rgb(V.PALETTE['FURNITURE_RAMPS']['ds-turquoise'][0])
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                rgba = bake(p).rgba
                top = int(np.nonzero(rgba[..., 3].any(axis=1))[0].min())
                row = {tuple(int(v) for v in px[:3]) for px in rgba[top] if px[3]}
                self.assertEqual(len(row), 1, row)
                self.assertLess(luma(next(iter(row))), luma(darkest_teal))

    def test_foot_ring_is_a_hoop_that_dips_three_rows(self):
        # DEFECT: the foot ring was a straight 14 px bar; the first recipe's ring (0.10 m high, inscribed between the legs) was
        # still a bar with 1 px chamfers: 2 rows between the legs. The hoop meets the legs on one row and its lowest pixel is at
        # least 3 rows lower (4 rows covered), its ends are higher than its middle, and it is its own mirror image. (The far arc
        # of the hoop shows under the seat as an apron: the rows it covers count as the hoop's top.)
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                first, last, lows = ring_dip(bake(p))
                self.assertIsNotNone(first, 'no foot ring pixel between the legs, under the pad')
                self.assertGreaterEqual(last - first, 3, (first, last))
                self.assertEqual(lows, lows[::-1], 'the ring is symmetric')
                self.assertLess(lows[0], max(lows), 'the ring is curved: its ends are higher than its middle')

    def test_cushion_is_a_thin_flat_pad_not_a_jar(self):
        # DEFECT (art-director review, round 3): a 0.20 m drum, 16 wide and 19 rows tall over 11 rows of leg ("a glossy egg on
        # stubby legs"), shaded like a cylinder (a light rim, a dark ring inside it, a light centre in the band).
        # The pad is thin, no taller than wide, at most 56% of the sprite's height, and made of flat planes: down the middle
        # column the top tone, then 1 to 3 rows of the band's tone, then ink; no band tone in the upper half of the pad (no bevel
        # or piping ring) and no top tone under a band tone (no light centre in the band).
        top_tone, band_tone = TOP_TONE, BAND_TONE
        self.assertGreaterEqual(STOOL.PAD_T, 0.10)
        self.assertLessEqual(STOOL.PAD_T, 0.20)
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                top = colour_set(piece, TOP_FACE_TONES)
                band = colour_set(piece, [band_tone])
                pad = colour_set(piece, PAD_TONES)
                first, last = int(np.nonzero(pad.any(axis=1))[0].min()), pad_bottom_row(piece)
                pad_h = last - first + 1
                cols = np.nonzero(pad.any(axis=0))[0]
                pad_w = int(cols.max() - cols.min() + 1)
                self.assertLessEqual(pad_h, pad_w, 'the pad is not taller than wide')
                self.assertLessEqual(pad_h / piece.size[1], 0.56, (pad_h, piece.size[1]))
                x = int(piece.anchors['seat'][0])
                last_top = int(np.nonzero(top[:, x])[0].max())
                below = int(band[last_top + 1:, x].sum())
                self.assertGreaterEqual(below, 2, 'the cushion has a side band of 2 to 3 rows')
                self.assertLessEqual(below, 3)
                self.assertFalse(band[:first + pad_h // 2].any(), 'a bevel or piping ring of the band tone in the top face')
                for c in range(x - 4, x + 4):
                    rows = np.nonzero(band[:, c])[0]
                    if rows.size:
                        self.assertFalse(top[int(rows.min()):, c].any(), f'a top tone under the band at column {c}')

    def test_cushion_silhouette_is_round_not_an_octagon(self):
        # DEFECT (art-director review): the edge widened 1 px per side per row (6, 8, 10, 12, 14), a 45 degree chamfer. A pixel
        # circle has runs of 2, 1, 1, 0: at most two one-pixel steps in a row at the top.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                a = bake(p).rgba[..., 3] > 0
                rows = np.nonzero(a.any(axis=1))[0]
                widths = [int(a[r].sum()) for r in rows[:8]]
                steps = [(b - c) // 2 for b, c in zip(widths[1:], widths)]
                run = best = 0
                for st in steps:
                    run = run + 1 if st == 1 else 0
                    best = max(best, run)
                self.assertLessEqual(best, 2, widths)
                self.assertGreaterEqual(max(steps), 1)

    def test_ink_separates_cushion_and_legs(self):
        # DEFECT (art-director review, rounds 1 and 3): the teal band met the wood legs with no ink between them, and later the
        # timber's brown ink replaced the cushion's own outline at its lower corners (a leg top beside cushion fill). No cushion
        # fill tone may touch any timber tone, ink included: the cushion's petrol ink is the only thing between them.
        for p in ('oblique',):         # "camera75" is comparison only: its 8 row pad is a row shallower than its legs' tops
            with self.subTest(projection=p):
                piece = bake(p)
                teal = colour_set(piece, FILL_TONES)
                wood = colour_set(piece, wood_tones())
                touching = teal & (neighbours4(wood) > 0)
                self.assertEqual(int(touching.sum()), 0, np.argwhere(touching).tolist())

    def test_cushion_outline_is_one_closed_ink_ring(self):
        # DEFECT (art-director review, round 3): the outline changed colour mid-curve from teal ink to brown. Flood fill from the
        # transparent pixels over everything that is not cushion ink (the dark teal of the top arc or the near-black of the
        # underside): it must not reach a cushion fill tone, so the ink closes the cushion on every side (the legs and the
        # ring are reachable, the fill is not).
        for p in ('oblique',):         # "camera75" is comparison only (see test_ink_separates_cushion_and_legs)
            with self.subTest(projection=p):
                piece = bake(p)
                w, h = piece.size
                fill = colour_set(piece, FILL_TONES)
                ink = colour_set(piece, INK_TONES)
                seen = np.zeros((h, w), bool)
                stack = [(0, c) for c in range(w)]
                for r, c in stack:
                    seen[r, c] = True
                while stack:
                    r, c = stack.pop()
                    for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                        if 0 <= rr < h and 0 <= cc < w and not seen[rr, cc] and not ink[rr, cc] and not fill[rr, cc]:
                            seen[rr, cc] = True
                            stack.append((rr, cc))
                # a fill pixel with a reached 4-neighbour touches the outside without ink
                leak = fill & (neighbours4(seen) > 0)
                self.assertEqual(int(leak.sum()), 0, np.argwhere(leak).tolist())

    def test_legs_are_clean_two_pixel_posts_with_a_plain_foot(self):
        # DEFECT (art-director review of round 2): the near legs were 3 px wide (about 9 cm) with a centre highlight and ended in
        # a 3 px flat foot that read as a boot or a hoof, thicker than today's 1 to 2 px legs. Below the hoop every leg row is one
        # run of exactly 2 px in each leg column, down to the last row (the foot is as wide as the leg), and the two sides mirror.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                h = piece.size[1]
                ring_bottom = max(ring_row_span(piece)[1])
                self.assertGreaterEqual(h - 1 - ring_bottom, 3, 'a few leg rows under the hoop')
                for r in range(ring_bottom + 1, h):
                    runs = leg_runs(piece, r)
                    self.assertEqual([n for _, n in runs], [2, 2], (r, runs))
                    self.assertEqual(runs[0][0] + runs[1][0] + 2, piece.size[0], (r, runs))      # mirror images

    def test_legs_are_never_a_chunk_between_the_pad_and_the_foot(self):
        # DEFECT (rounds 2 to 14 of this round): legs that pulsed 3, 2, 4 px, or a knot where the far leg met the near one. From
        # the row under the pad's underside ("the apron" of the hoop's far arc) to the foot no leg row is wider than 6 px (and
        # only one is wider than 4: where the hoop meets the leg, 3 px of leg and 3 of tube), at most 8 rows are wider than 2 (the far leg beside the near
        # one, the hoop meeting it), and the last rows are 2 px.
        # Pixel-exact leg shape is asked of the default projection only: "camera75" is kept for comparison, its far legs end 9.8
        # rows above the near ones and share rows with the near legs' tops, which no leg-width rule can describe.
        piece = bake('oblique')
        widths = []
        far_arc = 0
        for r in range(pad_bottom_row(piece) + 2, piece.size[1]):
            runs = leg_runs(piece, r)
            if len(runs) == 1 and runs[0][1] > 8:        # the hoop's far arc: one bar across (round 4 lowered it a row, see HoopGap)
                far_arc += 1
                continue
            widths.append(max(runs[0][1], runs[-1][1]))
        self.assertLessEqual(far_arc, 2, 'the hoop\'s far arc is at most 2 rows thick')
        self.assertLessEqual(max(widths), 6, widths)       # the hoop's tube beside the leg: 3 and 3
        self.assertLessEqual(sum(1 for w in widths if w > 4), 1, widths)       # the one row where the hoop leaves a leg
        self.assertLessEqual(sum(1 for w in widths if w > 2), 8, widths)
        self.assertEqual(widths[-6:], [2] * 6)

    def test_no_isolated_light_pixel(self):
        # DEFECT (art-director review): two single light pixels on the ring's ends. No non-ink tone is a pixel alone: each has
        # an 8-neighbour of its own colour (a leg's mid tone is a one pixel line that steps one column every few rows: its pixels
        # touch by a corner). Round 3: the hoop at 0.20 m high and 0.195 m in radius left one where it met a leg (MEASURED on a
        # grid of 20 radius / height pairs: 14 of them do). Asked of the default projection only: "camera75" is comparison only.
        for p in ('oblique',):
            with self.subTest(projection=p):
                piece = bake(p)
                inks = set(INK_TONES) | {STOOL.TIMBER.ink, STOOL.TIMBER_NEAR.ink}
                tones = {tuple(int(v) for v in q[:3]) for q in piece.rgba.reshape(-1, 4) if q[3]}
                for t in tones:
                    hexed = '#%02X%02X%02X' % t
                    if hexed in inks:
                        continue
                    m = colour_set(piece, [hexed])
                    pad8 = np.pad(m, 1)
                    h8, w8 = m.shape
                    n8 = sum(pad8[1 + dy:1 + dy + h8, 1 + dx:1 + dx + w8].astype(int) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy, dx) != (0, 0))
                    alone = m & (n8 == 0)
                    self.assertEqual(int(alone.sum()), 0, (hexed, np.argwhere(alone).tolist()))


class Splay(unittest.TestCase):
    """Wave 1's judge: "no splayed legs". The legs are four slim posts that stand wider apart on the floor than under the seat."""

    def test_near_feet_are_wider_apart_than_the_seats_underside(self):
        # DEFECT (Wave 1): the near feet stood 0.41 m... under the pad, as a U: the stool read as a drum on a hoop. The near
        # feet are further apart than the seat's underside (the pad's last row, 10 px: the legs leave the pad at its lower
        # corners) and than the cushion is wide, and every pixel of the leg at the foot lies outside the cushion's columns.
        # DEFECT (round 2, the director): the stance was 22 px for a 14 px cushion (0.70, today's 0.85): a bell. The outer
        # width of the legs is at most 1.4 times the cushion's.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                feet = abs(piece.anchors['foot_near_right'][0] - piece.anchors['foot_near_left'][0])
                self.assertGreaterEqual(feet, underside_width(piece) + 4, (feet, underside_width(piece)))
                self.assertGreaterEqual(feet, pad_width(piece), (feet, pad_width(piece)))
                cush = colour_set(piece, PAD_TONES).any(axis=0)
                cols = np.nonzero(cush)[0]
                (left, right), = outer_columns(piece, [piece.size[1] - 1])
                self.assertLess(left, int(cols.min()))
                self.assertGreater(right, int(cols.max()))
                self.assertLessEqual(pad_width(piece) / (right - left + 1), 1.0)
                self.assertGreaterEqual(pad_width(piece) / (right - left + 1), 1 / 1.4, 'the stance is not a bell round a small seat')

    def test_far_feet_stand_closer_together_than_the_near_feet(self):
        # the far pair is narrower, so the far legs are seen inside the near ones. Not 'a pair of stubs 4 px apart under the
        # cushion's centre' (the director's smiley face): at least 8 px apart.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                a = bake(p).anchors
                near = a['foot_near_right'][0] - a['foot_near_left'][0]
                far = a['foot_far_right'][0] - a['foot_far_left'][0]
                self.assertLess(far, near * 0.6)
                self.assertGreaterEqual(far, 8, 'far feet at least 8 px apart: not two stubs')

    def test_each_near_leg_leans_outward_all_the_way_down(self):
        # DEFECT (Wave 1): vertical legs. From the row under the pad to the foot the outermost pixel of each row moves outward
        # (never back in) by at least 3 px in total, and the two sides mirror each other.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                rows = range(pad_bottom_row(piece) + 2, piece.size[1])
                edges = outer_columns(piece, rows)
                lefts = [l for l, _ in edges]
                rights = [r for _, r in edges]
                self.assertEqual(lefts, sorted(lefts, reverse=True), lefts)
                self.assertEqual(rights, sorted(rights), rights)
                self.assertGreaterEqual(lefts[0] - lefts[-1], 3, lefts)
                self.assertGreaterEqual(rights[-1] - rights[0], 3, rights)
                self.assertEqual([l + r for l, r in edges], [piece.size[0] - 1] * len(edges), edges)


class FarLegs(unittest.TestCase):
    """The two far legs stand a stance's depth behind the near ones, so they end higher on the screen and show under the pad."""

    def test_far_feet_end_higher_than_the_near_feet_by_the_stances_depth(self):
        # DEFECT (today's picture): near and far feet 2 px apart. The far feet are FOOT_DEPTH (0.41 m, 13 rows in "oblique",
        # 9.8 in "camera75") above the near ones on the screen, the depth the footprint leaves the stance (0.5 m).
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                sy = PROJ_FILE['projections'][p]['sy_px_per_m']
                piece = bake(p)
                for side in ('left', 'right'):
                    near, far = piece.anchors[f'foot_near_{side}'][1], piece.anchors[f'foot_far_{side}'][1]
                    self.assertAlmostEqual(near - far, 0.41 * sy, delta=0.2)
                    self.assertLess(far, near - 9)
                self.assertLess(0.41, bake(p).footprint['tiles'][1])

    def test_far_legs_show_beside_the_near_legs_under_the_pad(self):
        # DEFECT (round 2, the director): two dark far-leg stubs 4 px apart ended in mid-air under the cushion's centre and read as
        # the eyes of a smiley face over the hoop's smile. The far legs now stand beside the near ones, on the same sides: on each
        # side the pair is one chunk 3 px wide or more in the rows from the pad's underside to the far foot's row, and 2 px (the
        # near leg alone) in the rows under it. The far leg's column holds timber in one run on those rows (3 at the least) and
        # it stays clear of the hoop: the run ends on its foot anchor row, no further.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                dark = colour_set(piece, wood_tones())
                first = pad_bottom_row(piece) + 2
                for side in ('left', 'right'):
                    x, y = piece.anchors[f'foot_far_{side}']
                    c, last = int(round(x)) - (0 if side == 'left' else 1), int(y)
                    own = [r for r in range(first, last + 2) if dark[r, c]]
                    self.assertGreaterEqual(len(own), 3, (side, own))
                    self.assertEqual(own, list(range(own[0], own[0] + len(own))), 'one run, no gap')
                    self.assertGreaterEqual(own[-1], last - 1, 'the leg ends on its foot anchor')
                    self.assertLessEqual(own[-1], last + 1)
                if p == 'oblique':
                    x, y = piece.anchors['foot_far_left']
                    last = int(y)
                    for r in range(last - 3, last + 1):
                        self.assertGreaterEqual(leg_runs(piece, r)[0][1], 3, f'row {r}: the far leg beside the near one')
                    for r in range(last + 1, last + 4):
                        self.assertEqual(leg_runs(piece, r)[0][1], 2, f'row {r}: the near leg alone')


class FootRing(unittest.TestCase):
    """Wave 1's judge: "no crossbar". The stool has a ring joining its legs at about a third of their height."""

    def test_a_ring_joins_the_two_near_legs(self):
        # DEFECT: no ring (the legs hang from the pad). Below the pad's ink the two near feet are one connected piece of
        # timber: left leg, ring, right leg.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                wood = colour_set(piece, wood_tones())
                wood[:pad_bottom_row(piece) + 1] = False
                lab, n = components(wood)
                a = piece.anchors
                left = lab[int(a['foot_near_left'][1]) - 2, int(a['foot_near_left'][0])]       # two rows above the foot: the leg's own pixels
                right = lab[int(a['foot_near_right'][1]) - 2, int(a['foot_near_right'][0])]
                self.assertTrue(left and left == right, (left, right, n))

    def test_ring_stands_at_about_a_third_of_the_leg_height(self):
        # DEFECT: a bar at the leg's very bottom or half way up. The ring's lowest pixel is 3 to 6 px above the floor and
        # that is 0.25 to 0.40 of the height of the seat's top (the height map, in px above the floor): a third of the stool.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                first, last, lows = ring_dip(piece)
                self.assertIsNotNone(first)
                x = int(piece.foot[0])
                ring_h = int(piece.height[last, x])
                seat_h = int(piece.height.max())
                self.assertTrue(3 <= ring_h <= 6, ring_h)          # the hoop's lowest pixel: the tube's lower edge
                self.assertTrue(0.25 <= ring_h / seat_h <= 0.40, (ring_h, seat_h))


class RoundFour(unittest.TestCase):
    """The art director's review of round 3 (7 of 10, "ship with one small fix"): stippled light pixels on the legs and pale feet, a
    cushion that bulges like a bun, an outline that changes colour at the side's middle, a hoop that touches the cushion's
    underside, and four legs that read as two. Each test names the defect it catches."""

    def wood_pixels(self, piece):
        return colour_set(piece, [STOOL.TIMBER.ramp[0], STOOL.TIMBER_NEAR.ramp[0]])

    def test_the_wood_has_two_flat_tones_and_no_stipple(self):
        # DEFECT: a third, light taupe tone, 14 lone pixels in all, drawn from the ribbon's normal: "rivets" on the legs and four
        # pale feet. Every timber pixel of the picture is the near legs' tone or the far legs' (the hoop shares it).
        near, far = V.hex_rgb(STOOL.TIMBER_NEAR.ramp[0]), V.hex_rgb(STOOL.TIMBER.ramp[0])
        self.assertNotEqual(near, far)
        piece = bake('oblique')
        cushion = {V.hex_rgb(t) for t in PAD_TONES}
        tones = {tuple(int(v) for v in q[:3]) for q in piece.rgba.reshape(-1, 4) if q[3]} - cushion
        self.assertEqual(tones, {near, far})

    def test_the_feet_are_dark_wood(self):
        # DEFECT: four light pixels at the foot ends read as pale pads on the floor. The last 4 rows of every leg are the near
        # (darkest) tone and nothing lighter.
        piece = bake('oblique')
        near = V.hex_rgb(STOOL.TIMBER_NEAR.ramp[0])
        h = piece.size[1]
        for r in range(h - 4, h):
            for c in range(piece.size[0]):
                if piece.rgba[r, c, 3]:
                    self.assertEqual(tuple(int(v) for v in piece.rgba[r, c, :3]), near, (r, c))

    def test_far_legs_are_a_step_lighter_than_the_near_legs(self):
        # DEFECT: "two legs plus a hoop": the far legs showed only as a widening of the near legs for 4 rows. The far pair (and the
        # hoop, which stands behind them) is a lighter tone than the near pair, so the second leg of each side separates from the
        # first. Measured on the picture: the pixel beside each near leg in the rows where the far leg shows.
        piece = bake('oblique')
        px = piece.rgba
        near, far = V.hex_rgb(STOOL.TIMBER_NEAR.ramp[0]), V.hex_rgb(STOOL.TIMBER.ramp[0])
        luma = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
        self.assertGreater(luma(far), luma(near) + 10)
        x, y = piece.anchors['foot_far_left']
        row = int(y) - 2
        got = {tuple(int(v) for v in px[row, c, :3]) for c in range(piece.size[0] // 2) if px[row, c, 3]}
        self.assertEqual(got, {near, far}, 'the far leg beside the near leg is the lighter tone (row %d)' % row)

    def test_the_cushion_is_flat_with_square_lower_corners(self):
        # DEFECT: 14 wide by 11 rows with the widest row in the first row of the top face, a band of 4 rows and an underside that
        # fell away over 4 rows: a bun or an acorn. The pad is at most 10 rows, its underside (the last row) at least 10 px wide
        # (the lower corners are square: 70% of the pad's width), and the band 3 rows at most.
        piece = bake('oblique')
        pad = colour_set(piece, PAD_TONES)
        rows = np.nonzero(pad.any(axis=1))[0]
        self.assertLessEqual(int(rows.max() - rows.min() + 1), 10)
        self.assertGreaterEqual(underside_width(piece), 10)
        self.assertGreaterEqual(underside_width(piece) / pad_width(piece), 0.7)
        # the lower corners: the last row but one is as wide as the pad, not a step narrower than the underside
        widths = [int(pad[r].sum()) for r in rows]
        self.assertGreaterEqual(widths[-2], pad_width(piece) - 2, widths)

    def test_the_side_has_one_ink_and_the_underside_the_other(self):
        # DEFECT: dark teal on the upper half of the side and near-black on the lower one: a visible step that made two stacked
        # parts. From the top face's widest row down to the row above the underside, the outermost cushion pixel of each row is
        # dark teal; near-black is for the last two rows only.
        piece = bake('oblique')
        rim = colour_set(piece, [RIM_INK])
        under = colour_set(piece, [CUSHION_INK])
        pad = colour_set(piece, PAD_TONES)
        last = pad_bottom_row(piece)
        widest = int(colour_set(piece, TOP_FACE_TONES).sum(axis=1).argmax())
        for r in range(widest, last - 1):
            cols = np.nonzero(pad[r])[0]
            self.assertTrue(rim[r, cols.min()] and rim[r, cols.max()], f'row {r}: the side is dark teal')
        self.assertEqual(int(under[:last - 1].sum()), 0, 'near-black is the underside only (the last two rows)')
        self.assertGreaterEqual(int(under[last].sum()), 6)

    def test_a_row_of_floor_separates_the_cushion_from_the_hoops_far_arc(self):
        # DEFECT: the far arc of the hoop touched the cushion's underside: they read as one dark blob at 1:1 and the hoop hung from
        # the cushion. In the middle column at least one transparent row lies between the underside and the hoop's far arc.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                x = int(piece.anchors['seat'][0])
                a = piece.rgba[..., 3] > 0
                last = pad_bottom_row(piece)
                below = [r for r in range(last + 1, piece.size[1]) if a[r, x]]
                self.assertTrue(below, 'the hoop shows under the pad')
                self.assertGreaterEqual(below[0] - last, 2, 'one row of floor between the underside and the far arc')


class CushionForm(unittest.TestCase):
    """Wave 1's judge: "no cushion form". A padded disc: a round top face in two tones, a darker band under it."""

    def test_top_face_has_a_lighter_oval_in_the_middle(self):
        # DEFECT (Wave 1): one flat cyan, a coin. DEFECT (round 2, the director): "the lighter centre tone is just a 4 px stripe
        # right under the top outline: no soft, rounded lighter area". The top face shows the top tone at the rim and a lighter
        # oval in the middle (6 x 4 px: wider than tall, at least 3 rows, at least 6 px wide, a lens whose rows grow then shrink),
        # centred on the cushion's column, every one of its pixels with the top face's fill on its four sides (never at the rim; a lens may touch the rim's ink
        # by a corner at its top and bottom).
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                top, light = colour_set(piece, [TOP_TONE]), colour_set(piece, [LIGHT_TONE])
                fill = colour_set(piece, TOP_FACE_TONES)
                self.assertTrue(top.any() and light.any())
                self.assertGreaterEqual(int(light.sum()), 12)
                around = neighbours4(fill)
                if p == 'oblique':        # "camera75" has a top face 5 rows deep: its centre reaches the rim, it is only compared
                    self.assertTrue((around[light] == 4).all(), 'a lighter pixel at the rim of the top face (4-neighbours)')
                    lr, lc = np.nonzero(light)
                    self.assertGreaterEqual(int(lc.max() - lc.min() + 1), 6, 'the lighter oval is at least 6 px wide')
                    self.assertGreaterEqual(int(lr.max() - lr.min() + 1), 3, 'and at least 3 rows deep')
                    self.assertGreater(int(lc.max() - lc.min() + 1), int(lr.max() - lr.min() + 1), 'wider than deep')
                    self.assertEqual(int(lc.min() + lc.max()), piece.size[0] - 1, 'centred on the cushion')
                    rows = [int(light[r].sum()) for r in range(light.shape[0]) if light[r].any()]
                    self.assertEqual(rows, rows[::-1], 'a lens: its rows mirror each other, no 4 over 2 (a smile)')
                    self.assertEqual(max(rows), rows[len(rows) // 2], 'and the widest is in the middle')
                    self.assertGreater(int(lr.min()), int(np.nonzero(top.any(axis=1))[0].min()), 'the lighter oval is not on the top row')

    def test_no_pixel_is_the_brand_turquoise_that_glows_at_night(self):
        # DEFECT (the shader lab, round 17 to 20): the cushion's mid-light ring (ds-turquoise #02D1CE) glowed like a neon sign on
        # the dark cushion at 22 h. The camera pass (shaders.ts "brand": cmax > 0.8, saturation > 0.6, g >= r, g + 0.02 >= b,
        # b > r + 0.25) keeps such a pixel lit. No pixel of the picture may satisfy that test.
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                px = bake(p).rgba
                bad = []
                for r in range(px.shape[0]):
                    for c in range(px.shape[1]):
                        if not px[r, c, 3]:
                            continue
                        R, G, B = (int(v) / 255 for v in px[r, c, :3])
                        mx, mn = max(R, G, B), min(R, G, B)
                        if mx > 0.8 and (mx - mn) / mx > 0.6 and G >= R and G + 0.02 >= B and B > R + 0.25:
                            bad.append((r, c))
                self.assertEqual(bad, [])

    def test_the_band_is_darker_than_the_top_and_the_top_than_its_centre(self):
        # DEFECT: a band as light as the top (no side). Luma of the three cushion tones the picture holds.
        def luma(hexed):
            c = V.hex_rgb(hexed)
            return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
        self.assertLess(luma(BAND_TONE), luma(TOP_TONE))
        self.assertLess(luma(TOP_TONE), luma(LIGHT_TONE))
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                for tone in FILL_TONES:
                    self.assertTrue(colour_set(piece, [tone]).any(), tone)

    def test_the_band_is_below_the_top_face_and_two_to_three_rows_deep_in_every_column_of_the_middle(self):
        # the cushion's side: in the six middle columns the band is 2 or 3 rows under the top face's last row
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                top = colour_set(piece, TOP_FACE_TONES)
                band = colour_set(piece, [BAND_TONE])
                x = int(piece.anchors['seat'][0])
                for c in range(x - 3, x + 3):
                    self.assertTrue(top[:, c].any(), c)
                    last_top = int(np.nonzero(top[:, c])[0].max())
                    self.assertIn(int(band[last_top + 1:, c].sum()), (2, 3), (c, last_top))


class Drawn(unittest.TestCase):
    """The look rules of decision (c): flat ramps, no speckle, outlined, no left or right light."""

    def test_colours_within_the_cap_and_a_flat_ramp(self):
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                cap = PROJ_FILE['bake']['colour_cap']
                self.assertLessEqual(piece.metrics['colours'], cap)
                self.assertLessEqual(piece.metrics['colours'], 10)     # 3 cushion tones, 2 inks, 3 timber (2 inks, one mid tone) (today's: 12)
                self.assertGreaterEqual(piece.metrics['colours'], 5)

    def test_outline_covers_the_silhouette(self):
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                self.assertGreaterEqual(bake(p).metrics['outline_fraction'], 0.9)

    def test_no_stray_pixels(self):
        # no opaque pixel without an opaque 8-neighbour, and no transparent pixel with four opaque 4-neighbours
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                a = bake(p).rgba[..., 3] > 0
                pad = np.pad(a, 1)
                h, w = a.shape
                n8 = sum(pad[1 + dy:1 + dy + h, 1 + dx:1 + dx + w].astype(int) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy, dx) != (0, 0))
                n4 = sum(pad[1 + dy:1 + dy + h, 1 + dx:1 + dx + w].astype(int) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)))
                self.assertEqual(int((a & (n8 == 0)).sum()), 0)
                self.assertEqual(int((~a & (n4 == 4)).sum()), 0)

    def test_no_left_or_right_light_in_the_colour_picture(self):
        # decision (b): the runtime lighting adds direction; a baked tone must not favour one side. The picture is its own
        # mirror image (the highlight arc included).
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                rgba = bake(p).rgba
                flipped = rgba[:, ::-1]
                both = (rgba[..., 3] > 0) & (flipped[..., 3] > 0)
                same = (rgba[..., :3] == flipped[..., :3]).all(-1) & both
                self.assertGreaterEqual(same.sum() / max(1, (rgba[..., 3] > 0).sum()), 0.98)

    def test_normal_map_matches_the_picture(self):
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                n = piece.normal.astype(float)
                opaque = piece.normal[..., 3] == 255
                vec = n[..., :3] / 255 * 2 - 1
                length = np.linalg.norm(vec[opaque], axis=1)
                self.assertLess(abs(length - 1).max(), 0.0136 + 0.02)   # 8-bit rounding of a unit vector
                # the middle of the cushion's top points out of the floor
                x, y = (int(v) for v in piece.anchors['seat'][:2])
                self.assertGreater(vec[y + 2, x, 2], 0.9)

    def test_no_hand_made_pixel(self):
        # Round 3 has no override patch: the picture is the recipe's alone (round 2 drew a highlight stroke, a flat foot and a
        # contact pixel by hand, which the new legs and the lighter ovals make unnecessary). A patch file for the stool would be
        # applied (and refused as stale when it is not in step), so none may be left over in hq-office/art/overrides.
        left = sorted(f.name for f in (SOURCE / 'hq-office' / 'art' / 'overrides').glob('stool*.txt'))
        if OVERRIDES_DIR or NO_PATCH:
            self.skipTest('a mutant run reads another directory or none')
        self.assertEqual(left, [])
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                self.assertIsNone(bake(p).metrics['override'])
        self.assertFalse(hasattr(STOOL, 'PATCH_CELLS'), 'the patch generator is gone with the patch')

    def test_a_stale_patch_would_be_refused_so_a_leftover_one_cannot_hide_a_geometry_change(self):
        # The baker ties a patch to the geometry. A patch written for ANOTHER recipe (the stool of round 2) is refused when it is
        # put beside this one: the old file is kept in the picture folder of the lane, not in hq-office, and is read from there.
        old = Path('/tmp/asset-proto/wave1b/stool/stool.oblique.r9.txt')
        if not old.exists():
            self.skipTest('the round 2 patch is not on this machine')
        d = Path(tempfile.mkdtemp())
        try:
            shutil.copy(old, d / 'stool.oblique.txt')
            with self.assertRaises(B.StaleOverrideError):
                B.bake(STOOL.build(), 'oblique', overrides_dir=str(d))
        finally:
            shutil.rmtree(d)


class Reproducible(unittest.TestCase):
    def test_rebake_gives_the_same_bytes(self):
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                first = B.bake(STOOL.build(), p, old_canvas=STOOL.OLD_CANVAS, old_foot=STOOL.OLD_FOOT, overrides=not NO_PATCH, overrides_dir=OVERRIDES_DIR)
                second = B.bake(STOOL.build(), p, old_canvas=STOOL.OLD_CANVAS, old_foot=STOOL.OLD_FOOT, overrides=not NO_PATCH, overrides_dir=OVERRIDES_DIR)
                self.assertEqual(sha(first), sha(second))
                self.assertEqual(first.provenance['recipe_hash'], second.provenance['recipe_hash'])

    def test_write_round_trip(self):
        out = Path(tempfile.mkdtemp())
        try:
            paths = bake('oblique').write(out)
            self.assertEqual(sorted(p.name for p in paths), ['stool.height.png', 'stool.json', 'stool.normal.png', 'stool.png'])
            meta = json.loads((out / 'stool.json').read_text())
            self.assertEqual(meta['size'], list(bake('oblique').size))
            self.assertEqual(meta['depth_offset'], 0)
        finally:
            shutil.rmtree(out)


class Palette(unittest.TestCase):
    def test_cushion_is_on_the_office_palette_and_timber_is_the_off_palette_material(self):
        # PINNED: the cushion, its band, its welt and its lighter oval use ds-turquoise and ds-petrol stops only (the top
        # arc's ink is the 2nd petrol stop, the underside's the 1st). The kit has no brown in palette.py, so the timber (the
        # near legs' four tones, the far legs' four, and the ring's first three) is NOT in tools/palettes/office.hex. When
        # palette.py gains a timber, this test must change on purpose.
        if not V.ON_PALETTE:
            self.skipTest('tools/palettes/office.hex is missing')
        local = STOOL.build().materials
        off = V.off_palette(local)
        self.assertEqual(sorted(off), ['stool-ring', 'stool-timber', 'stool-timber-near'])
        # round 4: each timber is ONE flat tone (no ramp to stipple): the near legs, the far legs, and the hoop (the far legs' tone)
        self.assertEqual(len(off['stool-timber']), 1)
        self.assertEqual(len(off['stool-timber-near']), 1)
        self.assertTrue(set(off['stool-ring']) <= set(off['stool-timber']))
        for tone in PAD_TONES:
            self.assertIn(tone, V.ON_PALETTE)


class SeatNumbers(unittest.TestCase):
    """What build.py needs of the new picture (nothing here edits build.py).

    The rule (hq-office/build.py sit_between and place_pieces, read here, not copied): a seat piece is placed so that its prefab's
    anchorOffset lands on the middle of the sitting tile, SEAT_LIFT px above it; its depthOffset is anchorOffset.y - 1 - image
    height; the pose is the sitter's hair row and the rows cropped from its legs; the front layer is what the picture draws in
    front of the sitter. The numbers asked of this picture are checked against that rule and against today's stool."""

    TODAY_ANCHOR = (16, TODAY_ANCHOR_Y)
    TODAY_FOOT = (16, TODAY_FOOT_Y)

    def setUp(self):
        gather = (SOURCE / 'office' / 'gather.py').read_text()
        m = re.search(r'^SEAT_LIFT\s*=\s*(\d+)', gather, re.M)
        self.assertIsNotNone(m, 'office/gather.py no longer defines SEAT_LIFT')
        self.lift = int(m.group(1))
        build = (SOURCE / 'hq-office' / 'build.py').read_text()
        self.assertIn("seat['anchorOffset']['y'] - 1 - img.height", build, 'build.py changed its seating depth rule')
        self.assertIn("pose=dict(dy=hair + WOKA_HEAD - a['y'], crop=10 if seat['direction'] == 'up' else 0)", build,
                      'build.py changed its seat pose')
        m = re.search(r"^SITTING_HEAD\s*=\s*\{[^}]*'up':\s*(\d+)", build, re.M)
        w = re.search(r'^WOKA_HEAD\s*=\s*(\d+)', build, re.M)
        self.assertTrue(m and w, 'build.py no longer defines SITTING_HEAD and WOKA_HEAD')
        self.sitting_head, self.woka_head = int(m.group(1)), int(w.group(1))

    def placed_top_left(self, anchor, tile):
        """place_pieces(): x = sx*T + T/2 - a.x, y = sy*T + T/2 - SEAT_LIFT - a.y."""
        sx, sy = tile
        return sx * TILE + TILE // 2 - anchor['x'], sy * TILE + TILE // 2 - self.lift - anchor['y']

    def test_new_anchor_keeps_the_feet_where_they_are_today(self):
        old = dict(x=self.TODAY_ANCHOR[0], y=self.TODAY_ANCHOR[1])
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                new = STOOL.seat_numbers(piece)['anchorOffset']
                for tile in ((68, 36), (69, 36), (70, 36)):          # the three stools at the bar
                    ox, oy = self.placed_top_left(old, tile)
                    nx, ny = self.placed_top_left(new, tile)
                    self.assertEqual(ox + self.TODAY_FOOT[0], nx + piece.foot[0])
                    self.assertEqual(oy + self.TODAY_FOOT[1], ny + piece.foot[1])

    def test_depth_offset_follows_the_seating_rule_not_zero(self):
        # the critic's item 3: for a seat, depthOffset = anchor.y - 1 - image height, so it is not 0
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                s = STOOL.seat_numbers(piece)
                self.assertEqual(s['depthOffset'], s['anchorOffset']['y'] - 1 - piece.size[1])
                self.assertLess(s['depthOffset'], 0)
                self.assertGreater(s['depthOffset'], -36)          # today's value
        self.assertEqual(STOOL.seat_numbers(bake('oblique'))['depthOffset'], -15)
        self.assertEqual(STOOL.seat_numbers(bake('oblique'))['anchorOffset'], dict(x=10, y=16))      # round 4: the picture is 30 rows (one less on top)

    def test_pose_and_front_overlay(self):
        # pose.dy cancels the anchor (hair = anchor.y + LIFT - 48 + SITTING_HEAD; dy = hair + WOKA_HEAD - anchor.y) and a stool
        # has no front layer: it has no backrest, and the sitter is drawn over the whole picture
        s = STOOL.seat_numbers(bake('oblique'))
        self.assertEqual(s['pose'], dict(dy=self.lift - 48 + self.sitting_head + self.woka_head, crop=10))
        self.assertEqual(s['direction'], 'up')
        self.assertIsNone(s['front'])
        self.assertEqual(s['pose']['dy'], 2)

    def test_the_sitter_lands_where_it_lands_today_on_the_seat(self):
        # DEFECT (Wave 1): no seat numbers, depthOffset 0 from the baker. Today the anchor is 14 rows above the feet and 12 rows
        # under the middle of the cushion's top face (anchor 29, feet 43, cushion top centre at row 17). The new picture keeps
        # both within one row, so the sitter sits on the cushion the same way. (The feet row and the cushion differ by 1 row.)
        for p in ('oblique',):
            with self.subTest(projection=p):
                piece = bake(p)
                a = STOOL.seat_numbers(piece)['anchorOffset']
                self.assertEqual(piece.foot[1] - a['y'], self.TODAY_FOOT[1] - self.TODAY_ANCHOR[1])
                self.assertLessEqual(abs((a['y'] - piece.anchors['seat'][1]) - 12), 1)

    def test_anchor_is_inside_the_canvas_and_under_the_cushion(self):
        for p in PROJECTIONS:
            with self.subTest(projection=p):
                piece = bake(p)
                a = STOOL.seat_numbers(piece)['anchorOffset']
                self.assertTrue(0 <= a['x'] < piece.size[0] and 0 <= a['y'] < piece.size[1])
                self.assertEqual(a['x'], int(piece.foot[0]))
                self.assertGreaterEqual(a['y'], piece.anchors['seat'][1])
                self.assertGreater(a['y'], pad_bottom_row(piece), 'the sitter is under the pad, between the legs')

    def test_the_recipe_carries_the_seat_numbers_as_an_anchor_and_notes(self):
        r = STOOL.build()
        self.assertIn('sit', r.anchors)
        self.assertIn('anchorOffset', r.notes)
        self.assertIn('depthOffset', r.notes)
        self.assertIn('front', r.notes)


if __name__ == '__main__':
    unittest.main(verbosity=1)
