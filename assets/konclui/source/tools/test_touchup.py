"""Behaviour tests of hq-office/props/touchup.py (touch-ups by code for hand-drawn pieces that keep their drawing).

Run (from assets/konclui/source, isolated mode): python3 -I tools/test_touchup.py
Each touch-up is tested on a synthetic picture first; the recipes are then run on the drawings of hq-office/lounge.py (the
Konclui lamp, the two bird-of-paradise plants; MEASURED byte-identical to the built ones) and, when KONCLUI_DIST names a build,
on the two Mobilia lamps.
"""
import json
import os
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SOURCE / 'hq-office'))
import kinds as K  # noqa: E402
import proxy as P  # noqa: E402
from props import proxies as REG  # noqa: E402
from props import touchup as T  # noqa: E402

DIST = Path(os.environ['KONCLUI_DIST']) if os.environ.get('KONCLUI_DIST') else None
INK, BODY, LIGHT = (20, 24, 40), (60, 70, 100), (120, 140, 180)
WARM, PALE, WHITE = (250, 200, 90), (252, 231, 154), (255, 255, 255)


def blank(h=30, w=30):
    return np.zeros((h, w, 4), np.uint8)


def put(a, x, y, rgb, alpha=255):
    a[y, x] = (*rgb, alpha)


def fill(a, x0, y0, x1, y1, rgb, alpha=255):
    a[y0:y1 + 1, x0:x1 + 1] = (*rgb, alpha)


def solid_count(a):
    return int((a[..., 3] >= K.SOLID_ALPHA).sum())


def lounge():
    import lounge as L
    return L


def drawn(name):
    L = lounge()
    if name == 'arc_lamp.konclui':
        return np.asarray(L.lit_arc_lamp().convert('RGBA')).copy()
    if name == 'bird_of_paradise.alta':
        return np.asarray(L.bird_of_paradise(L.BIRD_TALLER).convert('RGBA')).copy()
    if name == 'bird_of_paradise.branco':
        return np.asarray(L.bird_of_paradise(L.BIRD_TALL, pot=(32, 71, 23, 17, 22)).convert('RGBA')).copy()
    raise KeyError(name)


def dist_sprite(key):
    if DIST is None or not (DIST / 'entities' / key).exists():
        raise unittest.SkipTest('KONCLUI_DIST is not set or lacks ' + key)
    return np.asarray(Image.open(DIST / 'entities' / key).convert('RGBA')).copy()


class Common(unittest.TestCase):
    def test_a_wrong_array_is_refused(self):
        for bad in (np.zeros((4, 4, 3), np.uint8), np.zeros((4, 4, 4), float), np.zeros((4, 4), np.uint8)):
            with self.assertRaises(ValueError):
                T.strip_light_pool(bad)

    def test_the_switch_is_off_by_default(self):
        self.assertFalse(T.enabled({}))
        self.assertFalse(T.enabled({'KONCLUI_TOUCHUPS': '0'}))
        self.assertTrue(T.enabled({'KONCLUI_TOUCHUPS': '1'}))
        self.assertEqual(T.ENV_SWITCH, 'KONCLUI_TOUCHUPS')


# -------------------------------------------------------------------------------------------------------- light pool

class LightPool(unittest.TestCase):
    def picture(self):
        a = blank()
        fill(a, 10, 5, 14, 20, BODY)                                       # the piece
        fill(a, 2, 12, 25, 24, (255, 236, 150), 90)                        # a pool of light over and around it ...
        put(a, 12, 8, BODY)                                                # ... the piece stays solid where it is
        fill(a, 12, 26, 20, 26, (20, 20, 30), 40)                          # a dark painted shadow: not a pool
        return a

    def test_bright_partial_pixels_go_and_nothing_else_changes(self):
        a = self.picture()
        solid0, dark0 = a[..., 3] >= 200, (a[..., 3] > 0) & (a[..., 3] < 200) & (a[..., :3].max(-1) < 128)
        out, rep = T.strip_light_pool(a)
        self.assertEqual(rep['removed_px'], int(T.pool_mask(a).sum()))
        self.assertGreater(rep['removed_px'], 100)
        self.assertEqual(rep['solid_changed_px'], 0)
        self.assertFalse(T.pool_mask(out).any())
        np.testing.assert_array_equal(out[solid0], a[solid0])
        np.testing.assert_array_equal(out[dark0], a[dark0])
        self.assertTrue((out[T.pool_mask(a)] == 0).all())

    def test_the_input_is_not_modified_and_the_result_is_stable(self):
        a = self.picture()
        before = a.copy()
        out, _ = T.strip_light_pool(a)
        np.testing.assert_array_equal(a, before)
        again, rep = T.strip_light_pool(out)
        np.testing.assert_array_equal(again, out)
        self.assertEqual(rep['removed_px'], 0)

    def test_a_pool_that_overlaps_nothing_solid_is_all_removed(self):
        a = blank()
        fill(a, 2, 2, 9, 9, (255, 236, 150), 125)
        out, rep = T.strip_light_pool(a)
        self.assertEqual(rep['removed_px'], 64)
        self.assertEqual(int(out[..., 3].max()), 0)

    def test_the_konclui_lamp_loses_exactly_its_pool(self):
        a = drawn('arc_lamp.konclui')
        out, rep = T.strip_light_pool(a)
        self.assertEqual(rep['removed_px'], 1841)                          # the audit's count
        self.assertEqual(solid_count(out), 739)
        self.assertEqual(solid_count(a), 739)


# ----------------------------------------------------------------------------------------------------- painted shadow

class PaintedShadow(unittest.TestCase):
    def picture(self):
        a = blank(40, 30)
        fill(a, 10, 5, 14, 30, BODY)                                       # silhouette rows 5..30: foot row 30
        fill(a, 8, 32, 17, 32, (60, 40, 40), 56)                           # the painted shadow: below the foot
        fill(a, 9, 33, 16, 33, (60, 40, 40), 40)
        fill(a, 10, 34, 15, 34, (60, 40, 40), 22)
        return a

    def test_the_kinds_rule_sees_it_and_the_result_is_clean(self):
        a = self.picture()
        self.assertTrue(K.painted_shadow(a))
        out, rep = T.strip_painted_shadow(a)
        self.assertTrue(rep['painted_before'])
        self.assertFalse(rep['painted_after'])
        self.assertFalse(K.painted_shadow(out))
        self.assertEqual(rep['removed_px'], 10 + 8 + 6)
        self.assertEqual(rep['solid_changed_px'], 0)

    def test_the_mask_is_the_rules_pixels_and_no_more(self):
        a = self.picture()
        put(a, 25, 6, (30, 30, 30), 60)                                    # a dark partial pixel up in the body rows: not the band
        put(a, 20, 33, (255, 240, 150), 100)                               # a bright partial one below the foot: a pool, not a shadow
        m = T.painted_shadow_mask(a)
        self.assertEqual(int(m.sum()), 24)
        self.assertFalse(m[6, 25])
        self.assertFalse(m[33, 20])
        out, _ = T.strip_painted_shadow(a)
        self.assertEqual(int(out[6, 25, 3]), 60)
        self.assertEqual(int(out[33, 20, 3]), 100)

    def test_a_picture_without_one_is_untouched(self):
        a = blank()
        fill(a, 5, 5, 9, 20, BODY)
        out, rep = T.strip_painted_shadow(a)
        np.testing.assert_array_equal(out, a)
        self.assertEqual((rep['removed_px'], rep['painted_before']), (0, False))

    def test_an_empty_picture_is_untouched(self):
        out, rep = T.strip_painted_shadow(blank())
        self.assertEqual(rep['removed_px'], 0)
        self.assertFalse(T.painted_shadow_mask(blank()).any())

    def test_the_three_row_strips_of_the_drawn_pieces(self):
        for name, n in (('arc_lamp.konclui', 67), ('bird_of_paradise.alta', 30), ('bird_of_paradise.branco', 30)):
            a = drawn(name)
            self.assertTrue(K.painted_shadow(a), name)
            out, rep = T.strip_painted_shadow(a)
            self.assertEqual(rep['removed_px'], n, name)                   # the audit counts 67 for the lamp, 30 for the plants
            self.assertFalse(K.painted_shadow(out), name)
            self.assertEqual(solid_count(out), solid_count(a), name)


# --------------------------------------------------------------------------------------------------------- clipped art

def blade(top=0, h=14, w=8):
    """A blade pointing up with outline-coloured edges and three stripes, cut flat by the canvas top at row `top` (its tip is
    above the canvas): 30 x 30 canvas, the blade at columns 10..10+w-1."""
    a = blank(30, 30)
    for y in range(top, top + h):
        fill(a, 10, y, 10 + w - 1, y, INK)
        fill(a, 11, y, 10 + w - 2, y, BODY)
        fill(a, 12, y, 12, y, LIGHT)
    return a


class Unclip(unittest.TestCase):
    def test_the_canvas_grows_where_the_art_touches_and_the_shift_is_reported(self):
        a = blade(top=0)
        out, rep = T.unclip(a, margin=2)
        self.assertEqual(rep['touching'], ['top'])
        self.assertEqual(rep['grown']['top'], 2 + 6)
        self.assertEqual(rep['shift'], (0, 8))
        self.assertEqual(out.shape, (30 + 8, 30, 4))
        self.assertEqual(rep['size'], [30, 38])
        self.assertEqual((rep['grown']['right'], rep['grown']['bottom'], rep['grown']['left']), (0, 0, 0))

    def test_the_art_is_where_the_shift_says(self):
        a = blade(top=0)
        out, rep = T.unclip(a, margin=2)
        dx, dy = rep['shift']
        body = (slice(dy + 1, dy + 30), slice(dx, dx + 30))                # all but the edge row, which the tip closing may repaint
        np.testing.assert_array_equal(out[body], a[1:])

    def test_a_margin_of_transparent_px_surrounds_the_art(self):
        for k in range(4):
            a = np.rot90(blade(top=0), k).copy()
            out, _ = T.unclip(a, margin=3)
            s = out[..., 3] >= K.SOLID_ALPHA
            ys, xs = np.nonzero(s)
            self.assertGreaterEqual(ys.min(), 3)
            self.assertGreaterEqual(xs.min(), 3)
            self.assertGreaterEqual(out.shape[0] - 1 - ys.max(), 3)
            self.assertGreaterEqual(out.shape[1] - 1 - xs.max(), 3)

    def test_the_tip_is_drawn_tapered_and_outlined(self):
        a = blade(top=0)
        out, rep = T.unclip(a, margin=2)
        dy = rep['shift'][1]
        widths = [int((out[y, :, 3] >= K.SOLID_ALPHA).sum()) for y in range(dy - 4, dy + 1)]
        self.assertEqual(rep['tips_closed'], 1)
        self.assertEqual(widths[-1], 8)
        self.assertEqual(widths[-2:], [6, 8])                              # 1 px narrower on each side per row ...
        self.assertTrue(all(x >= y for x, y in zip(widths[1:], widths[:-1])))  # ... never wider than the row below
        self.assertGreater(rep['added_px'], 0)
        top = int(np.nonzero((out[..., 3] >= K.SOLID_ALPHA).any(1))[0].min())
        self.assertGreaterEqual(top, 2)                                    # the tip stays inside the margin
        tip_row = out[top][out[top, :, 3] >= K.SOLID_ALPHA]
        self.assertTrue((tip_row[:, :3] == INK).all())                     # the topmost row is outline
        # the stripes carry on up the tip: the light stripe is in the first row above the old edge
        self.assertTrue((out[dy - 1, 12, :3] == LIGHT).all())

    def test_the_canvas_border_outline_is_replaced_by_the_leaf(self):
        a = blade(top=0)
        fill(a, 10, 0, 17, 0, INK)                                         # what the generator does at the border: a row of outline
        out, rep = T.unclip(a, margin=2)
        dy = rep['shift'][1]
        self.assertTrue((out[dy, 13, :3] == BODY).all())                   # the middle of the old edge row is leaf again
        self.assertTrue((out[dy, 10, :3] == INK).all() and (out[dy, 17, :3] == INK).all())

    def test_all_four_sides_are_alike(self):
        base = blade(top=0)
        ref, rep = T.unclip(base, margin=2)
        for k in (1, 2, 3):
            out, r = T.unclip(np.rot90(base, k).copy(), margin=2)
            np.testing.assert_array_equal(out, np.rot90(ref, k))
            self.assertEqual(r['tips_closed'], 1)

    def test_art_that_does_not_touch_is_left_alone(self):
        a = blade(top=4)
        out, rep = T.unclip(a, margin=2)
        np.testing.assert_array_equal(out, a)
        self.assertEqual((rep['shift'], rep['tips_closed'], rep['touching']), ((0, 0), 0, []))

    def test_close_to_the_edge_grows_by_the_missing_margin_only(self):
        a = blade(top=1)
        out, rep = T.unclip(a, margin=3)
        self.assertEqual(rep['grown']['top'], 2)
        self.assertEqual(rep['tips_closed'], 0)
        np.testing.assert_array_equal(out[2:], a)

    def test_without_tips_only_the_canvas_grows(self):
        a = blade(top=0)
        out, rep = T.unclip(a, margin=2, close_tips=False)
        self.assertEqual(rep['grown']['top'], 2)
        self.assertEqual(rep['tips_closed'], 0)
        np.testing.assert_array_equal(out[2:], a)

    def test_a_run_too_short_for_a_tip_is_not_made_up(self):
        a = blank()
        fill(a, 10, 0, 11, 10, BODY)                                       # 2 px wide
        out, rep = T.unclip(a, margin=2)
        self.assertEqual(rep['tips_closed'], 0)

    def test_an_empty_picture_is_unchanged(self):
        out, rep = T.unclip(blank())
        self.assertEqual((out.shape, rep['shift']), ((30, 30, 4), (0, 0)))

    def test_it_never_crops(self):
        a = blade(top=0)
        a[28:30, 3:6] = (*BODY, 255)
        out, rep = T.unclip(a, margin=1)
        self.assertGreaterEqual(out.shape[0], a.shape[0])
        self.assertGreaterEqual(out.shape[1], a.shape[1])
        self.assertEqual(solid_count(out) >= solid_count(a), True)

    def test_the_input_is_not_modified(self):
        a = blade(top=0)
        before = a.copy()
        T.unclip(a)
        np.testing.assert_array_equal(a, before)

    def test_negative_margin_is_refused(self):
        with self.assertRaises(ValueError):
            T.unclip(blade(), margin=-1)

    def test_the_tall_plant_is_clipped_and_comes_out_with_room_and_a_pointed_leaf(self):
        a = drawn('bird_of_paradise.alta')
        self.assertTrue(a[0, :, 3].any() and a[:, 63, 3].any())            # the top leaf and the right leaf touch the canvas
        out, rep = T.unclip(a)
        self.assertEqual(rep['touching'], ['right', 'top'])
        self.assertEqual(rep['tips_closed'], 2)
        s = out[..., 3] >= K.SOLID_ALPHA
        ys, xs = np.nonzero(s)
        self.assertGreaterEqual(min(ys.min(), xs.min(), out.shape[0] - 1 - ys.max(), out.shape[1] - 1 - xs.max()), 2)
        self.assertLess(int(s[ys.min()].sum()), 8)                         # the top row is a tip now, not the cut 8 px
        self.assertEqual(rep['shift'], (1, 8))                             # 1 px at the left (it was 1 px from the edge), 8 above

    def test_the_short_plant_needs_nothing(self):
        a = drawn('bird_of_paradise.branco')
        out, rep = T.unclip(a)
        np.testing.assert_array_equal(out, a)
        self.assertEqual(rep['touching'], [])


# -------------------------------------------------------------------------------------------------------------- domes

def dome(under=WARM, lo=PALE):
    """A 14 px wide dome: 6 rows of body (outline sides, two tones), then 3 rows of glowing underside, the last one narrower."""
    a = blank(20, 24)
    for y in range(4, 10):
        fill(a, 4, y, 17, y, INK)
        fill(a, 5, y, 16, y, BODY)
        fill(a, 5, y, 8, y, LIGHT)
    for y in (10, 11):
        fill(a, 4, y, 17, y, under)
        fill(a, 6, y, 15, y, lo)
    fill(a, 6, 12, 15, 12, under)
    return a


class Dome(unittest.TestCase):
    def test_the_glow_mask_is_warm_pixels_only(self):
        a = dome()
        put(a, 1, 1, WHITE)
        put(a, 2, 1, (120, 120, 120))
        put(a, 3, 1, BODY)
        put(a, 4, 1, (250, 200, 90), 90)                                   # warm but not solid: a pool, not the dome
        m = T.glow_mask(a)
        self.assertEqual(int(m.sum()), 14 * 2 + 10)
        self.assertFalse(m[1, 1:5].any())

    def test_the_white_mask_is_white_only(self):
        a = dome()
        put(a, 1, 1, WHITE)
        put(a, 2, 1, (240, 240, 240))
        self.assertEqual(int(T.white_mask(a).sum()), 1)

    def test_the_underside_takes_the_body_and_ends_in_the_rim(self):
        a = dome()
        out, rep = T.darken_underside(a, T.glow_mask(a), INK)
        self.assertEqual(rep['repainted_px'], 38)
        self.assertEqual((rep['solid_px_before'], rep['solid_px_after']), (solid_count(a), solid_count(a)))
        self.assertFalse(T.glow_mask(out).any())
        for x in (8, 12):                                                  # a column's run of three: body, body, rim
            above = out[9, x, :3]
            self.assertTrue((out[10, x, :3] == above).all(), x)
            self.assertTrue((out[11, x, :3] == above).all(), x)
            self.assertTrue((out[12, x, :3] == INK).all(), x)
        for x in (5, 16):                                                  # the run is two px here: body, rim
            self.assertTrue((out[10, x, :3] == out[9, x, :3]).all(), x)
            self.assertTrue((out[11, x, :3] == INK).all(), x)
        for x in (4, 17):
            self.assertTrue((out[11, x, :3] == INK).all(), x)              # the side's own run ends at row 11 there

    def test_only_the_glow_changes(self):
        a = dome()
        out, _ = T.darken_underside(a, T.glow_mask(a), INK)
        keep = ~T.glow_mask(a)
        np.testing.assert_array_equal(out[keep], a[keep])

    def test_a_run_with_no_body_above_takes_the_rim(self):
        a = blank()
        fill(a, 5, 5, 8, 6, WARM)
        out, _ = T.darken_underside(a, T.glow_mask(a), INK)
        self.assertTrue((out[5:7, 5:9, :3] == INK).all())

    def test_a_second_pass_changes_nothing(self):
        a = dome()
        once, _ = T.darken_underside(a, T.glow_mask(a), INK)
        twice, rep = T.darken_underside(once, T.glow_mask(once), INK)
        np.testing.assert_array_equal(once, twice)
        self.assertEqual(rep['repainted_px'], 0)

    def test_the_input_is_not_modified(self):
        a = dome()
        before = a.copy()
        T.darken_underside(a, T.glow_mask(a), INK)
        np.testing.assert_array_equal(a, before)

    def test_the_konclui_lamp_shows_no_glow_after_and_keeps_its_size(self):
        a = drawn('arc_lamp.konclui')
        pool, _ = T.strip_light_pool(a)
        out, rep = T.darken_underside(pool, T.glow_mask(pool), T.RIM_DARK)
        self.assertEqual(rep['repainted_px'], 109)
        self.assertFalse(T.glow_mask(out).any())
        self.assertEqual(solid_count(out), solid_count(a))
        np.testing.assert_array_equal(out[..., 3], pool[..., 3])
        ys, xs = np.nonzero(T.glow_mask(a))
        self.assertGreaterEqual(ys.min(), 27)                              # the glow is the dome's rows 27..31 only
        self.assertLessEqual(ys.max(), 31)

    def built_switch(self):
        manifest = DIST / 'fx' / 'manifest.json' if DIST else None
        value = json.loads(manifest.read_text()).get('volume') if manifest and manifest.is_file() else ''
        return {n for n in (value or '').split(',') if n}

    def test_the_mobilia_lamps_lose_their_white_rim(self):
        """On a default build the picture in the dist is the drawn one (15 px of pure white, which the touch-up repaints navy). On a
        build made with arc-lamp-proxy it already is the touched-up one: no white left, and the touch-up changes nothing more."""
        touched = 'arc-lamp-proxy' in self.built_switch()
        for key in (REG.get('arc_lamp.mobilia_right').keys[0], REG.get('arc_lamp.mobilia_left').keys[0]):
            a = dist_sprite(key)
            out = T.lamp_mobilia(a).rgba
            self.assertEqual(int(T.white_mask(out).sum()), 0)
            self.assertEqual(solid_count(out), solid_count(a))
            changed = (out != a).any(-1)
            if touched:
                self.assertEqual(int(T.white_mask(a).sum()), 0)
                self.assertEqual(int(changed.sum()), 0)                    # idempotent: the build already carries it
            else:
                self.assertEqual(int(T.white_mask(a).sum()), 15)           # the audit: 15 px of pure white
                self.assertEqual(int(changed.sum()), 15)
                self.assertTrue((out[changed][:, :3] == T.RIM_NAVY).all())


# -------------------------------------------------------------------------------------------------------------- foot

def pot(width=18, foot_ink=(124, 138, 153)):
    """A pot: rows 3..20, sides straight, the lowest row (20) one outline row."""
    a = blank(26, 30)
    x0 = (30 - width) // 2
    for y in range(3, 20):
        fill(a, x0, y, x0 + width - 1, y, (233, 238, 242))
        put(a, x0, y, foot_ink)
        put(a, x0 + width - 1, y, foot_ink)
    fill(a, x0 + 1, 20, x0 + width - 2, 20, foot_ink)
    return a


class Foot(unittest.TestCase):
    def test_the_corners_are_cut_and_the_middle_stays(self):
        a = pot()
        out, rep = T.curve_foot(a, depth=2)
        s = out[..., 3] >= K.SOLID_ALPHA
        self.assertEqual(rep['foot_row'], 20)
        self.assertTrue(s[20, 14] and s[20, 15])                           # the centre columns keep the foot row
        self.assertFalse(s[20, 6])                                         # the outer ones lose it
        self.assertFalse(s[19, 6] or s[19, 23])                            # the corner columns lose two rows
        self.assertEqual(int(s.sum()), int((a[..., 3] >= 200).sum()) - rep['cut_px'])
        self.assertGreater(rep['cut_px'], 0)
        self.assertLessEqual(rep['cut_px'], 2 * 3 * 2)                     # at most two rows over three columns at each corner

    def test_the_bottom_edge_is_an_arc_symmetric_about_the_axis(self):
        out, rep = T.curve_foot(pot(), depth=2)
        s = out[..., 3] >= K.SOLID_ALPHA
        bottoms = [int(np.nonzero(s[:, x])[0].max()) for x in range(6, 24)]
        self.assertEqual(bottoms, bottoms[::-1])
        self.assertEqual(max(bottoms), 20)
        self.assertEqual(min(bottoms), 18)                                 # depth rows at the corners
        mid = len(bottoms) // 2
        self.assertTrue(all(bottoms[i] >= bottoms[i - 1] for i in range(1, mid)))      # rising to the middle, never a dip

    def test_the_new_edge_is_outlined_in_the_foots_colour(self):
        ink = (124, 138, 153)
        out, _ = T.curve_foot(pot(foot_ink=ink), depth=2)
        s = out[..., 3] >= K.SOLID_ALPHA
        for x in range(6, 24):
            y = int(np.nonzero(s[:, x])[0].max())
            self.assertEqual(tuple(out[y, x, :3]), ink, x)

    def test_depth_zero_or_a_narrow_foot_changes_nothing(self):
        out, rep = T.curve_foot(pot(), depth=0)
        np.testing.assert_array_equal(out, pot())
        narrow, rep = T.curve_foot(pot(width=5))
        np.testing.assert_array_equal(narrow, pot(width=5))
        self.assertEqual(rep['cut_px'], 0)

    def test_an_empty_picture_is_unchanged(self):
        out, rep = T.curve_foot(blank())
        self.assertEqual((rep['cut_px'], rep['foot_row']), (0, None))

    def test_only_corner_pixels_go(self):
        a = pot()
        out, _ = T.curve_foot(a, depth=2)
        gone = (a[..., 3] >= 200) & (out[..., 3] < 200)
        ys, xs = np.nonzero(gone)
        self.assertGreaterEqual(ys.min(), 18)
        self.assertTrue(((xs <= 9) | (xs >= 20)).all())

    def test_the_input_is_not_modified(self):
        a = pot()
        before = a.copy()
        T.curve_foot(a)
        np.testing.assert_array_equal(a, before)

    def test_the_real_pot_loses_six_corner_pixels(self):
        a = T.strip_painted_shadow(drawn('bird_of_paradise.alta'))[0]
        out, rep = T.curve_foot(a)
        self.assertEqual((rep['foot_row'], rep['span'], rep['cut_px']), (92, [23, 40], 6))
        self.assertEqual(solid_count(out), solid_count(a) - 6)


# ----------------------------------------------------------------------------------------------------------- recipes

class Recipes(unittest.TestCase):
    def test_each_proxy_recipe_has_a_touch_up(self):
        self.assertEqual(sorted(T.RECIPES), REG.names())

    def test_the_konclui_lamp(self):
        a = drawn('arc_lamp.konclui')
        r = T.lamp_konclui(a)
        self.assertEqual([n for n, _ in r.steps], ['strip_light_pool', 'strip_painted_shadow'])
        self.assertEqual(r.shift, (0, 0))
        self.assertEqual(r.placement_shift, (0, 0))
        self.assertFalse(K.painted_shadow(r.rgba))
        self.assertFalse(T.pool_mask(r.rgba).any())
        self.assertEqual(int(T.glow_mask(r.rgba).sum()), int(T.glow_mask(a).sum()))        # the drawn glow band is kept
        self.assertEqual(int((r.rgba[..., 3] > 0).sum()), solid_count(a))  # nothing partial is left: binary alpha, the sheet check's rule
        self.assertEqual(int(((r.rgba[..., 3] > 0) & (r.rgba[..., 3] < 255)).sum()), 0)

    def test_the_runtime_bulb_rect_lands_on_the_drawn_glow(self):
        """Seen lit: the runtime paints an 8x2 bulb rect at the head (lights.ts: [hx - 4, hy + 3, 8, 2]); on a dome without the
        drawn glow band it is an olive smudge on navy. The recipe keeps the band, so every pixel of the rect is on glow."""
        import fx
        a = drawn('arc_lamp.konclui')
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as d:
            path = Path(d) / 'lamp.png'
            Image.fromarray(a).save(path)
            hx, hy = fx.sprite_light(path, 'pendant')['head']       # the kind the build gives this lamp: manifest head (43.77, 25.0)
        x0, y0 = int(round(hx - 4)), int(round(hy + 3))
        rect = (slice(y0, y0 + 2), slice(x0, x0 + 8))
        self.assertTrue(T.glow_mask(a)[rect].all(), 'the premise: today\'s dome has glow under the rect')
        self.assertTrue(T.glow_mask(T.lamp_konclui(a).rgba)[rect].all())
        self.assertFalse(T.glow_mask(T.lamp_konclui_dark_dome(a).rgba)[rect].any())    # the rejected variant: the smudge
        self.assertNotIn('arc_lamp.konclui', [n for n in T.RECIPES if T.RECIPES[n] is T.lamp_konclui_dark_dome])

    def test_the_recipes_leave_the_light_anchors_where_they_were(self):
        import fx
        from tempfile import TemporaryDirectory
        for name, kind in (('arc_lamp.konclui', 'pendant'),):
            a = drawn(name)
            r = T.RECIPES[name](a)
            with TemporaryDirectory() as d:
                Image.fromarray(a).save(Path(d) / 'a.png')
                Image.fromarray(r.rgba).save(Path(d) / 'b.png')
                self.assertEqual(fx.sprite_light(Path(d) / 'a.png', kind), fx.sprite_light(Path(d) / 'b.png', kind), name)

    def test_the_plant_and_its_proxy_still_align_after_the_canvas_grew(self):
        a = drawn('bird_of_paradise.alta')
        r = T.bird_of_paradise(a)
        self.assertEqual(r.shift, (1, 8))
        self.assertEqual(r.placement_shift, (-1, -8))
        self.assertFalse(K.painted_shadow(r.rgba))
        proxy = REG.get('bird_of_paradise.alta')
        stale = P.build(proxy, r.rgba, 'k').alignment                      # the recipe's origin is for the old canvas
        self.assertFalse(stale['ok'])
        res = P.build(proxy.moved(*r.shift), r.rgba, 'k')
        self.assertTrue(res.ok, res.alignment)
        self.assertEqual(res.alignment['best_offset'], [0, 0])
        self.assertGreaterEqual(res.alignment['covered_share'], 0.95)

    def test_the_short_plant_is_not_moved(self):
        r = T.bird_of_paradise(drawn('bird_of_paradise.branco'))
        self.assertEqual(r.shift, (0, 0))
        res = P.build(REG.get('bird_of_paradise.branco'), r.rgba, 'k')
        self.assertTrue(res.ok)

    def test_the_lamp_still_aligns_after_its_touch_up(self):
        r = T.lamp_konclui(drawn('arc_lamp.konclui'))
        res = P.build(REG.get('arc_lamp.konclui'), r.rgba, 'k')
        self.assertTrue(res.ok)
        self.assertGreaterEqual(res.alignment['covered_share'], 0.95)

    def test_the_mobilia_lamps_still_align(self):
        for name in ('arc_lamp.mobilia_right', 'arc_lamp.mobilia_left'):
            a = dist_sprite(REG.get(name).keys[0])
            r = T.RECIPES[name](a)
            self.assertTrue(P.build(REG.get(name), r.rgba, 'k').ok, name)

    def test_deterministic_and_the_input_is_kept(self):
        for name in ('arc_lamp.konclui', 'bird_of_paradise.alta', 'bird_of_paradise.branco'):
            a = drawn(name)
            before = a.copy()
            r1, r2 = T.RECIPES[name](a), T.RECIPES[name](a)
            np.testing.assert_array_equal(a, before)
            np.testing.assert_array_equal(r1.rgba, r2.rgba)
            self.assertEqual(r1.steps, r2.steps)


if __name__ == '__main__':
    unittest.main(verbosity=1)
