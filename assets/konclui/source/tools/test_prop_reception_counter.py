"""Behaviour tests of the reception counter (hq-office/props/reception_counter.py), baked by tools/bake.py.

What these pin is what the owner and the asset audit said was wrong with the picture it replaces (signature.reception_desk() as
drawn before: a 36 px navy slab, a K with stray pixels, an oak top without thickness, an almost black outline) and what the recipe
promises: a 22 px face (the owner's counter anchor), the K as the only white group of the face (fx.py's 'sign' light reads it), a
symmetric face, the tops' tones taken from tools/palettes/office.hex for the tops, no black. Since 2026-11-24 also: the working desk
is a box behind the ledge with a visible front face (the owner could not tell it from "a bridge, a rug, a wall" when it was one flat
rectangle), the computer's foot stands on its top face at SURFACE_ROW, and the K is the logo's (tools/test_kmark.py measures the
bitmap against the official vector).

Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_prop_reception_counter.py"""
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SOURCE / 'hq-office'))
import bake as B  # noqa: E402
import contract as C  # noqa: E402
import volume as V  # noqa: E402
from props import reception_counter as RC  # noqa: E402

_cache = {}


def baked():
    if 'p' not in _cache:
        _cache['p'] = B.bake(RC.recipe(), overrides=False)
    return _cache['p']


def art():
    """The 160 px wide picture without the 1 px margins, the way signature.reception_desk() uses it."""
    return baked().rgba[:, 1:1 + RC.W_PX]


def hexes(a):
    return ['#%02X%02X%02X' % tuple(int(v) for v in px[:3]) for px in a]


class ReceptionCounter(unittest.TestCase):
    def test_bakes_clean_on_the_front_tile_row(self):
        p = baked()
        self.assertEqual(p.violations, [])
        self.assertEqual(p.warnings, [])
        self.assertEqual(p.metrics['foot_gap'], 0)
        self.assertEqual(art().shape[1], 5 * 32)
        self.assertLessEqual(p.rgba.shape[0] - 1, 64)         # the 2-tile picture holds it

    def test_the_face_is_22_px_and_the_whole_48(self):
        """A reed column from the foot upward: a 1 px dark oak base, 19 px of body, 2 px lip (22), then the ledge's 10 rows of top,
        then the working desk's 17 rows: an outline row where it meets the ledge, 6 rows of its front face and 10 of its top (the top
        row is the outline): 48 px."""
        col = art()[:, 20]
        solid = np.nonzero(col[:, 3])[0]
        top, bottom = solid.min(), solid.max()
        self.assertEqual(bottom - top + 1, 48)
        tones = hexes(col[solid])
        plinth = [i for i, t in enumerate(tones) if t in RC.PLINTH]
        self.assertEqual(len(plinth), 1)
        self.assertEqual(plinth[-1], len(tones) - 1)
        self.assertEqual(RC.LEDGE_Z, 22)

    def test_the_desk_is_a_box_with_a_front_face_above_the_ledge(self):
        """The oblique projection draws a top and a front face and no end faces. The desk used to be flush against the ledge, which
        hid its front: one flat rectangle. Now its front edge is set back, so 6 rows of the front show above the ledge's back edge,
        in a darker tone than the top, and the outline in the desk's own dark tone runs between the front and the ledge. The top's
        board joint is a tone between the top's and the front's, so the only dark band of the desk is the front."""
        col = art()[:, 20]
        tones = hexes(col[np.nonzero(col[:, 3])[0]])
        self.assertEqual(tones[0], RC.DESK[0])                         # the top's back edge, outlined
        face = [i for i, t in enumerate(tones) if t == RC.DESK[2] and i > 7]
        self.assertEqual(len(face), 6)                                 # the front face, 6 rows
        self.assertEqual(face, list(range(face[0], face[0] + 6)))      # in one run
        self.assertEqual(tones[face[-1] + 1], RC.DESK[0])              # then the contact line with the ledge
        self.assertTrue(all(t in (RC.DESK[3], RC.DESK_TOP_SEAM) for t in tones[1:face[0]]))   # above it the desk's top (a seam is a tone between)
        self.assertGreater(face[0] - 1, 8)                             # a top of 10 rows
        lum = lambda h: 0.299 * V.hex_rgb(h)[0] + 0.587 * V.hex_rgb(h)[1] + 0.114 * V.hex_rgb(h)[2]
        self.assertGreaterEqual(lum(RC.DESK[3]) - lum(RC.DESK[2]), 40)  # the front is a clear step darker than the top, about the 50 of the office desks
        self.assertLess(lum(RC.DESK_TOP_SEAM), lum(RC.DESK[3]))        # the top's joint is darker than the top ...
        self.assertGreater(lum(RC.DESK_TOP_SEAM), lum(RC.DESK[2]) + 15)  # ... but well above the front: the joint never reads as a second front band

    def test_the_desk_front_has_two_seams_and_the_footprint_is_the_front_tile_row(self):
        a = art()
        seam = np.array(V.hex_rgb(RC.DESK[1]))
        cols = sorted({int(x) for x in np.nonzero((a[..., :3] == seam).all(-1).any(0))[0]})
        seams = [x for x in cols if x in RC.FRONT_SEAMS]
        self.assertEqual(seams, list(RC.FRONT_SEAMS))
        self.assertEqual(RC.FRONT_SEAMS[0] + RC.FRONT_SEAMS[1], RC.W_PX - 1)        # symmetric
        # the whole counter, desk included, stands inside the front tile row (the collision grid [[0] * 5, [1] * 5] of signature.py)
        self.assertTrue(0 <= RC.DESK_Y0 < RC.DESK_Y1 <= RC.LEDGE_Y0 <= 32)

    def test_the_computers_foot_stands_on_the_desk_top(self):
        """RECEPTION_SURFACE (signature.py) is this row of the 2-tile picture: the baked 'top' anchor, which the recipe places on the
        desk's top face, and the pixel there is the desk's top."""
        p = baked()
        h = p.rgba.shape[0]
        row = int(round(p.anchors['top'][1])) + 64 - h
        self.assertEqual(row, RC.SURFACE_ROW)
        top_rows = (64 - h + 1, 64 - h + 10)                           # the desk's top, in the 64 row picture (the first row is the outline)
        self.assertTrue(top_rows[0] < RC.SURFACE_ROW <= top_rows[1] + 1)
        px = art()[RC.SURFACE_ROW - (64 - h), 40]
        self.assertIn('#%02X%02X%02X' % tuple(int(v) for v in px[:3]), (RC.DESK[3], RC.DESK_TOP_SEAM))

    def test_the_k_is_the_only_white_group_of_the_face(self):
        a = art()
        white = (a[..., :3].min(-1) > 200) & (a[..., 3] > 0)
        white[:int(a.shape[0] * 0.25)] = False                # what fx.py's 'sign' light leaves out: the counter top
        ys, xs = np.nonzero(white)
        self.assertEqual(int(white.sum()), sum(r.count('#') for r in RC.K))
        self.assertEqual((xs.max() - xs.min() + 1, ys.max() - ys.min() + 1), (len(RC.K[0]), len(RC.K)))
        brand = (a[..., 1] > 170) & (a[..., 2] > 140) & (a[..., 0] < 140) & (a[..., 3] > 0)
        brand[:int(a.shape[0] * 0.25)] = False
        self.assertEqual(int(brand.sum()), 0)                  # no turquoise or mint pixel to widen the light's glyph box

    def test_the_k_sits_in_the_panel(self):
        a = art()
        white = (a[..., :3].min(-1) > 200) & (a[..., 3] > 0)
        white[:int(a.shape[0] * 0.25)] = False
        ys, xs = np.nonzero(white)
        self.assertGreaterEqual(xs.min(), RC.PANEL_X0 + 12)
        self.assertLessEqual(xs.max(), RC.PANEL_X1 - 12)
        self.assertEqual(ys.max() - ys.min() + 1, 15)          # a 15 px K on a 19 px panel
        base = a.shape[0] - 1                                  # the 1 px base
        self.assertLessEqual(ys.max(), base - 3)               # the lowest rows of the face are an avatar's, not the mark's

    def test_the_silhouette_and_the_panel_are_symmetric(self):
        a = art()
        self.assertTrue((a[..., 3] == a[:, ::-1, 3]).all())
        navy = ((a[..., :3] == np.array(V.hex_rgb(RC.NAVY_PANEL))).all(-1) | (a[..., :3] == np.array(V.hex_rgb(RC.NAVY_EDGE))).all(-1))
        cols = np.nonzero(navy.any(0))[0]
        self.assertEqual((cols.min(), cols.max()), (RC.PANEL_X0, RC.PANEL_X1))
        self.assertEqual(cols.min() + cols.max(), RC.W_PX - 1)

    def test_no_black_and_the_ink_is_the_materials_own(self):
        a = art()
        solid = a[a[..., 3] > 0][:, :3]
        self.assertGreater(int(solid.max(-1).min()), 8)        # no pixel of black, the darkest is the plinth's ink navy
        self.assertEqual(baked().metrics['outline_fraction'], 1.0)

    def test_the_tops_tones_are_the_palettes(self):
        for ramp in (RC.OAK[2:], RC.DESK[3:]):                  # the ledge's, the desk's top: the desk's front [2], its seams and joint are tones the palette lacks
            for tone in ramp:
                self.assertIn(tone.upper(), V.ON_PALETTE, tone)
        self.assertNotIn(RC.DESK[2].upper(), V.ON_PALETTE)
        self.assertIn(RC.NAVY_PANEL.upper(), V.ON_PALETTE)
        self.assertIn(RC.CYAN.upper(), V.ON_PALETTE)
        self.assertIn(RC.WHITE.upper(), V.ON_PALETTE)

    def test_the_brand_cyan_is_a_thin_line_on_the_panel_and_the_base_is_wood(self):
        a = art()
        cyan = (a[..., :3] == np.array(V.hex_rgb(RC.CYAN))).all(-1)
        ys, xs = np.nonzero(cyan)
        self.assertEqual(ys.max() - ys.min() + 1, 1)                     # one pixel row, as the wordmark's line
        self.assertEqual(xs.max() - xs.min() + 1, RC.PANEL_X1 - RC.PANEL_X0 + 3)   # the panel and its two frame pixels
        solid = a[a[..., 3] > 0][:, :3]
        navy_ink = np.array(V.hex_rgb('#0A0A3D'))
        self.assertFalse((solid == navy_ink).all(-1).any())              # no ink-navy bar under the counter: the base is dark oak

    def test_the_ledges_ends_on_the_pictures_edge_are_ink(self):
        """The 5.0 m ledge fills the 5 tile picture, so its two end columns are the canvas's left and right edge. The drawing contract
        (tools/contract.py edge_touch) reads a solid run of 3 px or more there as a cut picture unless it is ink: the ends are the
        face's dark oak, 10 px each, and the contract finds no problem in the counter (the picture's other rules are the baker's own)."""
        a = art()
        runs = C.edge_runs(a)
        for edge in ('left', 'right'):
            self.assertEqual([length for _, length, _ in runs[edge]], [10], edge)
            self.assertTrue(all(inked for _, _, inked in runs[edge]), edge)
            column = a[:, 0 if edge == 'left' else -1]
            self.assertEqual({'#%02X%02X%02X' % tuple(int(v) for v in px[:3]) for px in column[column[..., 3] > 0]}, {RC.SLAT[0]})
        self.assertEqual(C.sprite_problems(a, 'stand', {'symmetric'}), {})

    def test_the_ledge_and_the_desk_tops_are_a_clear_step_apart(self):
        step = sum(abs(x - y) for x, y in zip(V.hex_rgb(RC.OAK[4]), V.hex_rgb(RC.DESK[3])))
        self.assertGreaterEqual(step, 45)


if __name__ == '__main__':
    unittest.main()
