"""Behaviour tests of tools/proxy.py (proxy volumes over hand-drawn sprites) and of the recipes in hq-office/props/proxies.

Run (from assets/konclui/source, isolated mode): python3 -I tools/test_proxy.py
The tests that need the Mobilia pictures read them from a built map: KONCLUI_DIST=/path/to/dist (they skip without it). The
Konclui lamp and the two bird-of-paradise pictures are drawn by hq-office/lounge.py (MEASURED byte-identical to the built ones), so
their tests need no build.

What the synthetic tests pin: the baker's own box is its own proxy (alignment 100 %, height and normals back exactly, at any canvas
offset), a recipe off by 2 px is caught and one off by 1 is not, the nearest-pixel fill and its radius, the frame's scales read
from projection.json, `flattened` keeps normals and squashes positions, a `Sheet` lands on the pixels it is authored in.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SOURCE / 'hq-office'))
import bake as B  # noqa: E402
import proxy as P  # noqa: E402
import volume as V  # noqa: E402
from props import proxies as REG  # noqa: E402

DIST = Path(os.environ['KONCLUI_DIST']) if os.environ.get('KONCLUI_DIST') else None
FLAT = np.array(P.FLAT_NORMAL, np.uint8)


def box_recipe(w=1.0, d=0.5, h=0.8, name='box'):
    mat = V.Material('m', ('#202020', '#606060', '#C0C0C0'))
    return V.Recipe(name, [V.box(0, 0, 0, w, d, h, 'm')], (w, d), {}, materials={'m': mat}, kind='stand')


def box_proxy(**kw):
    return P.ProxyRecipe('box', box_recipe(), (0, 0), **kw)


def baked_box():
    return P.bake_proxy(box_proxy())


def on_canvas(piece, at, shape):
    """The baked piece's picture pasted at `at` = (x, y) of an empty canvas of `shape`, and the recipe origin that lands it there."""
    H, W = shape
    canvas = np.zeros((H, W, 4), np.uint8)
    ph, pw = piece.rgba.shape[:2]
    canvas[at[1]:at[1] + ph, at[0]:at[0] + pw] = piece.rgba
    fp = piece.footprint['px']
    return canvas, (fp['x'] + at[0], fp['y'] + at[1])


def lounge():
    import lounge as L
    return L


def sprite_of(name):
    L = lounge()
    if name == 'arc_lamp.konclui':
        return np.asarray(L.lit_arc_lamp().convert('RGBA'))
    if name == 'bird_of_paradise.alta':
        return np.asarray(L.bird_of_paradise(L.BIRD_TALLER).convert('RGBA'))
    if name == 'bird_of_paradise.branco':
        return np.asarray(L.bird_of_paradise(L.BIRD_TALL, pot=(32, 71, 23, 17, 22)).convert('RGBA'))
    raise KeyError(name)


def dist_sprite(key):
    if DIST is None or not (DIST / 'entities' / key).exists():
        raise unittest.SkipTest('KONCLUI_DIST is not set or lacks ' + key)
    return np.asarray(Image.open(DIST / 'entities' / key).convert('RGBA'))


# ------------------------------------------------------------------------------------------------------------- ruler

class Ruler(unittest.TestCase):
    def test_scales_come_from_projection_json(self):
        proj = B.load_projection('oblique')
        F = P.Frame((0, 0), 'oblique')
        self.assertEqual((F.sx, F.sy, F.sz), (proj.sx, proj.sy, proj.sz))
        self.assertEqual((F.sx, F.sy, F.sz), (32.0, 32.0, 21.0))          # the figures the integrator decided (README: oblique)

    def test_px_to_metres_and_back(self):
        F = P.Frame((10, 20), 'oblique')
        self.assertAlmostEqual(F.x(42), 1.0)
        self.assertAlmostEqual(F.y(52), 1.0)
        self.assertAlmostEqual(F.z(21), 1.0)
        self.assertAlmostEqual(F.r(16), 0.5)
        self.assertEqual(F.m(42, 52, 21), (1.0, 1.0, 1.0))

    def test_a_point_is_drawn_straight_up_from_its_ground_row(self):
        F = P.Frame((0, 0), 'oblique')
        x, y, z = F.m(5, 30, 12)                                           # in the vertical plane of floor row 30, 12 px up
        self.assertAlmostEqual(F.sy * y - F.sz * z, 18.0, places=6)        # the screen row of (y, z): 30 - 12

    def test_path_maps_every_point(self):
        F = P.Frame((0, 0), 'oblique')
        pts = F.path([(10, 20), (12, 15)], 30)
        self.assertEqual(pts[0], F.m(10, 30, 10))
        self.assertEqual(pts[1], F.m(12, 30, 15))


# ----------------------------------------------------------------------------------------------------------- recipe

class RecipeChecks(unittest.TestCase):
    def test_origin_is_whole_px(self):
        with self.assertRaises(ValueError):
            P.ProxyRecipe('x', box_recipe(), (1.5, 0))
        with self.assertRaises(ValueError):
            P.ProxyRecipe('x', box_recipe(), (0,))

    def test_name_and_ground_and_radii_are_checked(self):
        with self.assertRaises(ValueError):
            P.ProxyRecipe('', box_recipe(), (0, 0))
        with self.assertRaises(ValueError):
            P.ProxyRecipe('x', box_recipe(), (0, 0), ground=(0, 0, 0, 1))
        with self.assertRaises(ValueError):
            P.ProxyRecipe('x', box_recipe(), (0, 0), fill_radius=-1)

    def test_ground_defaults_to_the_footprint(self):
        self.assertEqual(box_proxy().ground, (0.0, 0.0, 1.0, 0.5))

    def test_moved_shifts_only_the_origin(self):
        p = P.ProxyRecipe('x', box_recipe(), (3, 4), keys=('a/b.png',), ground=(0, 0, 1, 0.5), search=5)
        q = p.moved(2, -1)
        self.assertEqual(q.origin, (5, 3))
        self.assertEqual((q.keys, q.ground, q.search, q.recipe), (p.keys, p.ground, p.search, p.recipe))
        self.assertEqual(p.origin, (3, 4))

    def test_flattened_squashes_positions_and_keeps_normals(self):
        inner = V.frustum(0.5, 0.5, 0.0, 0.3, 0.4, 0.3, 'm')
        flat = P.flattened(inner, 0.25, 0.5)
        a, b = inner.sample(0.05), flat.sample(0.05)
        np.testing.assert_allclose(b.P[:, 1] - 0.5, (a.P[:, 1] - 0.5) * 0.25)
        np.testing.assert_allclose(b.P[:, [0, 2]], a.P[:, [0, 2]])
        np.testing.assert_array_equal(a.N, b.N)
        with self.assertRaises(ValueError):
            P.flattened(inner, 0.0, 0.5)

    def test_a_sheet_lands_on_the_pixels_it_is_authored_in(self):
        F = P.Frame((0, 0), 'oblique')

        def outline(t, u):
            return 10 + 14 * (u * 0.5 + 0.5), 12 + 20 * t                  # a 14 x 20 px rectangle, columns 10..24, rows 12..32

        sheet = P.Sheet(F, outline, 'm', 32.0, 0.0, 0.0)
        mat = V.Material('m', ('#202020', '#606060', '#C0C0C0'))
        r = V.Recipe('sheet', [sheet], (1.0, 1.0), {}, materials={'m': mat}, kind='stand', coverage=0.5, margin=1)
        piece = B.bake(r, None, overrides=False, outline=False, cleanup=False)
        dx, dy = P.placement(piece, (0, 0))
        ys, xs = np.nonzero(piece.rgba[..., 3] > 0)
        box = (xs.min() + dx, ys.min() + dy, xs.max() + dx, ys.max() + dy)
        self.assertLessEqual(abs(box[0] - 10), 1)
        self.assertLessEqual(abs(box[2] - 24), 1)
        self.assertLessEqual(abs(box[1] - 12), 1)
        self.assertLessEqual(abs(box[3] - 32), 1)

    def test_a_sheet_leaning_back_still_projects_onto_its_pixels_and_changes_the_normals(self):
        F = P.Frame((0, 0), 'oblique')

        def outline(t, u):
            return 10 + 14 * (u * 0.5 + 0.5), 12 + 20 * t

        mat = V.Material('m', ('#202020', '#606060', '#C0C0C0'))
        boxes, normals = [], []
        for tilt in (0.0, 30.0):
            r = V.Recipe('s', [P.Sheet(F, outline, 'm', 32.0, 0.0, tilt)], (1.0, 1.0), {}, materials={'m': mat}, kind='stand',
                         coverage=0.5, margin=1)
            piece = B.bake(r, None, overrides=False, outline=False, cleanup=False)
            ys, xs = np.nonzero(piece.rgba[..., 3] > 0)
            boxes.append((xs.max() - xs.min(), ys.max() - ys.min()))
            normals.append(piece.normal[ys, xs][:, :3].astype(int).mean(0))
        self.assertLessEqual(abs(boxes[0][0] - boxes[1][0]) + abs(boxes[0][1] - boxes[1][1]), 2)
        self.assertGreater(abs(normals[0] - normals[1]).max(), 5)


# --------------------------------------------------------------------------------------------------- the box is its own proxy

class BoxIsItsOwnProxy(unittest.TestCase):
    def setUp(self):
        self.piece = baked_box()
        self.canvas, self.origin = on_canvas(self.piece, (5, 7), (60, 70))
        self.proxy = P.ProxyRecipe('box', box_recipe(), self.origin)

    def test_alignment_is_total_at_the_pasted_offset(self):
        res = P.build(self.proxy, self.canvas, 'k', piece=self.piece)
        al = res.alignment
        self.assertEqual(al['covered_share'], 1.0)
        self.assertEqual(al['stray_share'], 0.0)
        self.assertEqual(al['iou'], 1.0)
        self.assertEqual(al['best_offset'], [0, 0])
        self.assertTrue(al['ok'] and res.ok)

    def test_height_and_normals_come_back_exactly(self):
        res = P.build(self.proxy, self.canvas, 'k', piece=self.piece)
        opaque = self.canvas[..., 3] >= P.SOLID_ALPHA
        self.assertTrue(opaque.any())
        ph, pw = self.piece.rgba.shape[:2]
        win = (slice(7, 7 + ph), slice(5, 5 + pw))
        m = opaque[win]
        np.testing.assert_array_equal(res.height[win][m], self.piece.height[m])
        np.testing.assert_array_equal(res.normal[win][..., :3][m], self.piece.normal[..., :3][m])
        self.assertEqual(res.counts['filled_px'], 0)
        self.assertEqual(res.counts['flat_px'], 0)

    def test_nothing_is_written_off_the_sprite(self):
        res = P.build(self.proxy, self.canvas, 'k', piece=self.piece)
        off = self.canvas[..., 3] < P.SOLID_ALPHA
        self.assertEqual(int(res.height[off].max()), 0)
        self.assertTrue((res.normal[off] == (128, 128, 255, 0)).all())
        self.assertTrue((res.normal[~off][:, 3] == 255).all())

    def test_the_height_of_the_box_is_its_height_in_px(self):
        res = P.build(self.proxy, self.canvas, 'k', piece=self.piece)
        self.assertEqual(res.caster['height_px'], round(0.8 * 21))

    def test_the_top_is_flat_and_the_front_faces_the_viewer(self):
        res = P.build(self.proxy, self.canvas, 'k', piece=self.piece)
        top = res.normal[..., :3][res.height == res.caster['height_px']]
        self.assertTrue((top == FLAT).all())
        south = (res.normal[..., :3] == np.array([128, 0, 128], np.uint8)).all(-1)
        self.assertGreater(int(south.sum()), 0)

    def test_the_bakers_full_picture_is_covered_too(self):
        full = B.bake(box_recipe(), None, overrides=False)               # outline and clean-up on, as a drawn sprite
        canvas, origin = on_canvas(full, (5, 7), (60, 70))
        res = P.build(P.ProxyRecipe('box', box_recipe(), origin), canvas, 'k')
        self.assertGreaterEqual(res.alignment['covered_share'], 0.99)
        self.assertEqual(res.alignment['best_offset'], [0, 0])

    def test_caster_summary(self):
        res = P.build(self.proxy, self.canvas, 'k', piece=self.piece)
        c = res.caster
        self.assertEqual(c['foot_row'], self.origin[1] + 16 - 1)           # the footprint is 0.5 m deep: rows y0 .. y0 + 15
        self.assertEqual(c['foot_span'], [self.origin[0], self.origin[0] + 31])
        self.assertLessEqual(c['foot_row'], c['sprite_foot_row'])
        self.assertLessEqual(c['height_p95_px'], c['height_px'])

    def test_a_ground_rectangle_sets_the_foot(self):
        p = P.ProxyRecipe('box', box_recipe(), self.origin, ground=(0.25, 0.25, 0.75, 0.5))
        c = P.build(p, self.canvas, 'k', piece=self.piece).caster
        self.assertEqual(c['foot_span'], [self.origin[0] + 8, self.origin[0] + 23])


# ---------------------------------------------------------------------------------------------------- a shifted proxy is caught

class ShiftIsCaught(unittest.TestCase):
    def setUp(self):
        self.piece = baked_box()
        self.canvas, self.origin = on_canvas(self.piece, (10, 10), (60, 70))

    def build(self, dx, dy):
        p = P.ProxyRecipe('box', box_recipe(), (self.origin[0] + dx, self.origin[1] + dy))
        return P.build(p, self.canvas, 'k', piece=self.piece).alignment

    def test_two_px_off_fails_and_names_the_offset(self):
        al = self.build(2, 0)
        self.assertFalse(al['ok'])
        self.assertEqual(al['best_offset'], [-2, 0])
        self.assertLess(al['covered_share'], 1.0)
        self.assertGreater(al['stray_share'], 0.0)

    def test_vertical_and_diagonal_shifts_are_caught(self):
        self.assertEqual(self.build(0, -3)['best_offset'], [0, 3])
        self.assertEqual(self.build(-2, 2)['best_offset'], [2, -2])
        self.assertFalse(self.build(0, -3)['ok'])

    def test_one_px_off_is_the_limit_and_passes(self):
        al = self.build(1, -1)
        self.assertTrue(al['ok'])
        self.assertEqual(al['best_offset'], [-1, 1])
        self.assertEqual(P.MAX_OFFSET_PX, 1)

    def test_the_cli_exits_1_on_a_failed_alignment(self):
        reg = REG.get('bird_of_paradise.alta')
        sprite = sprite_of('bird_of_paradise.alta')
        moved = np.zeros_like(sprite)
        moved[:, 5:] = sprite[:, :-5]                                      # the picture 5 px to the right of where the recipe is
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / 'in' / 'moved.png'
            src.parent.mkdir()
            Image.fromarray(moved, 'RGBA').save(src)
            with contextlib.redirect_stdout(io.StringIO()) as out:
                rc = P.main(['bird_of_paradise.alta', '--sprite', str(src), '--out', str(Path(d) / 'out')])
        self.assertEqual(rc, 1)
        self.assertIn('FAIL', out.getvalue())
        self.assertIsNotNone(reg)

    def test_an_empty_sprite_is_not_aligned_and_does_not_crash(self):
        empty = np.zeros((40, 40, 4), np.uint8)
        al = P.build(P.ProxyRecipe('box', box_recipe(), (3, 3)), empty, 'k').alignment
        self.assertEqual(al['sprite_px'], 0)
        self.assertEqual(al['covered_share'], 0.0)


# -------------------------------------------------------------------------------------------------------------- fill

class NearestFill(unittest.TestCase):
    def arrays(self, H=9, W=9):
        height = np.zeros((H, W), np.uint8)
        normal = np.zeros((H, W, 3), np.uint8)
        normal[:] = FLAT
        covered = np.zeros((H, W), bool)
        return height, normal, covered

    def test_a_neighbour_within_the_radius_is_copied(self):
        h, n, c = self.arrays()
        h[4, 4], n[4, 4], c[4, 4] = 40, (10, 20, 30), True
        opaque = c.copy()
        opaque[4, 6] = True                                                # two px to the right
        fh, fn, filled, flat = P.fill(h, n, c, opaque, 3)
        self.assertEqual(int(fh[4, 6]), 40)
        self.assertEqual(tuple(fn[4, 6]), (10, 20, 30))
        self.assertTrue(filled[4, 6] and not flat.any())

    def test_beyond_the_radius_is_flat_and_counted(self):
        h, n, c = self.arrays(9, 12)
        h[4, 1], n[4, 1], c[4, 1] = 40, (10, 20, 30), True
        opaque = c.copy()
        opaque[4, 5] = True                                                # four px away
        for radius, expect in ((3, 'flat'), (4, 'filled')):
            fh, fn, filled, flat = P.fill(h, n, c, opaque, radius)
            if expect == 'flat':
                self.assertEqual(int(fh[4, 5]), 0)
                self.assertEqual(tuple(fn[4, 5]), P.FLAT_NORMAL)
                self.assertTrue(flat[4, 5] and not filled[4, 5])
            else:
                self.assertEqual(int(fh[4, 5]), 40)
                self.assertTrue(filled[4, 5] and not flat[4, 5])

    def test_the_euclidean_radius_not_the_square(self):
        h, n, c = self.arrays()
        h[2, 2], c[2, 2] = 40, True
        opaque = c.copy()
        opaque[4, 4] = True                                                # (2, 2) away: 2.83 px
        self.assertTrue(P.fill(h, n, c, opaque, 3)[2][4, 4])
        self.assertTrue(P.fill(h, n, c, opaque, 2)[3][4, 4])

    def test_the_nearer_one_wins_then_the_one_above_then_the_left(self):
        h, n, c = self.arrays()
        h[4, 3], n[4, 3], c[4, 3] = 30, (1, 1, 1), True                    # left of (4, 5): 2 px
        h[4, 6], n[4, 6], c[4, 6] = 60, (2, 2, 2), True                    # right: 1 px
        opaque = c.copy()
        opaque[4, 5] = True
        self.assertEqual(int(P.fill(h, n, c, opaque, 3)[0][4, 5]), 60)     # the nearer
        h, n, c = self.arrays()
        h[3, 5], c[3, 5] = 11, True                                        # above (4, 5)
        h[4, 4], c[4, 4] = 22, True                                        # left of it, equally near
        opaque = c.copy()
        opaque[4, 5] = True
        self.assertEqual(int(P.fill(h, n, c, opaque, 3)[0][4, 5]), 11)     # the one above
        h, n, c = self.arrays()
        h[4, 4], c[4, 4] = 22, True
        h[4, 6], c[4, 6] = 33, True
        opaque = c.copy()
        opaque[4, 5] = True
        self.assertEqual(int(P.fill(h, n, c, opaque, 3)[0][4, 5]), 22)     # the left one

    def test_covered_and_transparent_pixels_are_untouched(self):
        h, n, c = self.arrays()
        h[4, 4], n[4, 4], c[4, 4] = 40, (10, 20, 30), True
        h[4, 5], n[4, 5], c[4, 5] = 7, (9, 9, 9), True
        opaque = c.copy()
        fh, fn, filled, flat = P.fill(h, n, c, opaque, 3)
        self.assertEqual(int(fh[4, 5]), 7)
        self.assertEqual(tuple(fn[4, 5]), (9, 9, 9))
        self.assertEqual(int(fh[0, 0]), 0)                                 # transparent, nothing asked for it
        self.assertFalse(filled.any() or flat.any())

    def test_radius_zero_fills_nothing(self):
        h, n, c = self.arrays()
        h[4, 4], c[4, 4] = 40, True
        opaque = c.copy()
        opaque[4, 5] = True
        _, _, filled, flat = P.fill(h, n, c, opaque, 0)
        self.assertFalse(filled.any())
        self.assertTrue(flat[4, 5])

    def test_the_input_is_not_modified(self):
        h, n, c = self.arrays()
        h[4, 4], c[4, 4] = 40, True
        opaque = c.copy()
        opaque[4, 5] = True
        before = (h.copy(), n.copy())
        P.fill(h, n, c, opaque, 3)
        np.testing.assert_array_equal(h, before[0])
        np.testing.assert_array_equal(n, before[1])

    def test_a_sprite_bigger_than_the_proxy_is_filled_and_reported(self):
        piece = baked_box()
        canvas, origin = on_canvas(piece, (5, 7), (60, 70))
        row = 7 + piece.rgba.shape[0] // 2
        xmax = int(np.nonzero(canvas[row, :, 3] > 0)[0].max())
        near = canvas.copy()
        near[row, xmax + 1:xmax + 3] = (255, 0, 0, 255)                    # 2 px of art the proxy lacks, 1 and 2 px from it
        res = P.build(P.ProxyRecipe('box', box_recipe(), origin), near, 'k', piece=piece)
        self.assertEqual((res.counts['filled_px'], res.counts['flat_px']), (2, 0))
        self.assertEqual(int(res.height[row, xmax + 2]), int(res.height[row, xmax]))
        far = canvas.copy()
        far[row, xmax + 6] = (255, 0, 0, 255)                              # 6 px from the proxy: beyond fill_radius 3
        res = P.build(P.ProxyRecipe('box', box_recipe(), origin, fill_radius=3), far, 'k', piece=piece)
        self.assertEqual((res.counts['filled_px'], res.counts['flat_px']), (0, 1))
        self.assertEqual(tuple(res.normal[row, xmax + 6]), (128, 128, 255, 255))
        self.assertEqual(int(res.height[row, xmax + 6]), 0)


# ------------------------------------------------------------------------------------------------------------ outputs

class Outputs(unittest.TestCase):
    def setUp(self):
        self.piece = baked_box()
        self.canvas, self.origin = on_canvas(self.piece, (5, 7), (60, 70))
        self.res = P.build(P.ProxyRecipe('box', box_recipe(), self.origin), self.canvas, 'box1', piece=self.piece)

    def test_write_makes_the_four_files(self):
        with tempfile.TemporaryDirectory() as d:
            paths = self.res.write(d, scale=2)
            self.assertEqual(sorted(p.name for p in paths), ['box1.height.png', 'box1.normal.png', 'box1.overlay.png', 'box1.proxy.json'])
            with Image.open(Path(d) / 'box1.height.png') as im:
                self.assertEqual(im.size, (70, 60))
            n = np.asarray(Image.open(Path(d) / 'box1.normal.png'))
            np.testing.assert_array_equal(n, self.res.normal)
            h = np.asarray(Image.open(Path(d) / 'box1.height.png'))
            np.testing.assert_array_equal(h, self.res.height)
            data = json.loads((Path(d) / 'box1.proxy.json').read_text())
            self.assertEqual(data['api'], P.API_VERSION)
            self.assertEqual(data['sprite_size'], [70, 60])
            self.assertEqual(data['alignment']['best_offset'], [0, 0])
            self.assertIn('foot_row', data['caster'])

    def test_the_same_input_gives_the_same_bytes(self):
        again = P.build(P.ProxyRecipe('box', box_recipe(), self.origin), self.canvas.copy(), 'box1')
        self.assertEqual(again.to_json(), self.res.to_json())
        np.testing.assert_array_equal(again.height, self.res.height)
        np.testing.assert_array_equal(again.normal, self.res.normal)
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            self.res.write(a, 3)
            again.write(b, 3)
            for name in ('box1.height.png', 'box1.normal.png', 'box1.overlay.png', 'box1.proxy.json'):
                self.assertEqual((Path(a) / name).read_bytes(), (Path(b) / name).read_bytes(), name)

    def test_the_sprite_is_not_modified(self):
        before = self.canvas.copy()
        P.build(P.ProxyRecipe('box', box_recipe(), self.origin), self.canvas, 'box1')
        np.testing.assert_array_equal(before, self.canvas)

    def test_a_pil_image_is_accepted(self):
        res = P.build(P.ProxyRecipe('box', box_recipe(), self.origin), Image.fromarray(self.canvas, 'RGBA'), 'box1')
        self.assertEqual(res.alignment['covered_share'], 1.0)


# ----------------------------------------------------------------------------------------------------------- shadows

class Shadows(unittest.TestCase):
    def test_a_pole_throws_a_shadow_as_long_as_it_is_tall(self):
        H, W = 60, 40
        height = np.zeros((H, W), np.uint8)
        opaque = np.zeros((H, W), bool)
        for y in range(10, 40):                                            # a pole at column 20, foot row 39, 29 px up
            height[y, 20] = 39 - y
            opaque[y, 20] = True
        s = P.sweep_shadow(height, opaque, P.KEY_DIRECTIONS['lower-right'], 0.5)
        ys, xs = np.nonzero(s > 0.5)
        self.assertGreater(xs.max(), 20 + 5)                               # leans to the right ...
        self.assertGreater(ys.max(), 39)                                   # ... and lies on the floor in front of the foot
        left = P.sweep_shadow(height, opaque, P.KEY_DIRECTIONS['lower-left'], 0.5)
        self.assertLess(np.nonzero(left > 0.5)[1].min(), 20 - 5)

    def test_the_height_decides_not_the_row(self):
        """The same silhouette, a pole in one and a thing lying on the floor in the other: the height sweep tells them apart, the
        rows method (today's) throws the same shadow for both."""
        H, W = 90, 40
        opaque = np.zeros((H, W), bool)
        opaque[10:40, 20] = True
        pole = np.zeros((H, W), np.uint8)
        pole[10:40, 20] = 39 - np.arange(10, 40)
        flat = np.zeros((H, W), np.uint8)
        d = P.KEY_DIRECTIONS['lower-right']
        tall, low = P.sweep_shadow(pole, opaque, d, 0.5), P.sweep_shadow(flat, opaque, d, 0.5)
        ty, tx = np.nonzero(tall > 0.5)
        ly, lx = np.nonzero(low > 0.5)
        self.assertGreaterEqual(tx.max(), 20 + 8)                          # the pole's shadow reaches out across the floor ...
        self.assertGreater(ty.max(), 39)
        self.assertEqual((int(lx.max()), int(ly.max())), (20, 39))        # ... what lies on the floor shades only itself
        self.assertTrue(np.array_equal(P.rows_shadow(opaque, d, 0.5, shape=(H, W)), P.rows_shadow(opaque, d, 0.5, shape=(H, W))))

    def test_rows_shadow_follows_todays_rule_and_cap(self):
        opaque = np.zeros((120, 40), bool)
        opaque[10:90, 18:22] = True                                        # 80 rows tall
        capped = P.rows_shadow(opaque, P.KEY_DIRECTIONS['down'], 0.5, shape=(140, 40), cap=True)
        free = P.rows_shadow(opaque, P.KEY_DIRECTIONS['down'], 0.5, shape=(140, 40), cap=False)
        self.assertEqual(int(np.nonzero(capped.any(1))[0].max()) - 89, P.SHADOW_CAP_PX)
        self.assertEqual(int(np.nonzero(free.any(1))[0].max()) - 89, 40)


# ------------------------------------------------------------------------------------------------------------ registry

class Registry(unittest.TestCase):
    def test_every_module_imports(self):
        self.assertEqual(REG.errors(), {})

    def test_names_and_keys(self):
        self.assertEqual(REG.names(), ['arc_lamp.konclui', 'arc_lamp.mobilia_left', 'arc_lamp.mobilia_right', 'bird_of_paradise.alta',
                                       'bird_of_paradise.branco'])
        for name in REG.names():
            p = REG.get(name)
            self.assertEqual(p.name, name)
            self.assertEqual(len(p.keys), 1)
            self.assertEqual(REG.by_key(p.keys[0]).name, name)
        self.assertIsNone(REG.by_key('nothing/here.png'))
        with self.assertRaises(KeyError):
            REG.get('nope')

    def test_the_piece_registry_passes_over_the_package(self):
        import props
        self.assertTrue(all('proxy' not in n for n in props.names()))
        self.assertNotIn('proxies', props.errors())

    def test_the_bird_numbers_are_lounges(self):
        from props.proxies import bird_of_paradise as BP
        L = lounge()
        self.assertEqual(BP.BIRD_TALL, L.BIRD_TALL)
        self.assertEqual(BP.BIRD_TALLER, L.BIRD_TALLER)
        self.assertEqual(BP.SIZE, (64, 96))
        self.assertEqual(BP.POT_DEFAULT, (32, 66, 23, 17, 27))

    def test_the_proxy_keys_are_the_placed_ones(self):
        if DIST is None or not (DIST / 'office.wam').exists():
            self.skipTest('KONCLUI_DIST is not set')
        wam = (DIST / 'office.wam').read_text(encoding='utf-8')
        for name in REG.names():
            stem = Path(REG.get(name).keys[0]).stem
            self.assertIn(stem.split('-', 1)[1] if stem.startswith('konclui-') else stem, wam)


# ------------------------------------------------------------------------------------------------- the real recipes

PLACED = {'arc_lamp.konclui': 1, 'arc_lamp.mobilia_right': 3, 'arc_lamp.mobilia_left': 1, 'bird_of_paradise.alta': 2,
          'bird_of_paradise.branco': 2}                                     # placements in office.wam (MEASURED, 8 in all)


class RealRecipes(unittest.TestCase):
    def check(self, name, sprite):
        proxy = REG.get(name)
        res = P.build(proxy, sprite, name)
        al = res.alignment
        self.assertTrue(res.ok, al)
        self.assertEqual(al['best_offset'], [0, 0], name)
        self.assertGreaterEqual(al['covered_share'], 0.95, name)
        self.assertLessEqual(al['stray_share'], 0.2, name)
        self.assertEqual(res.counts['flat_px'], 0, name)
        self.assertLessEqual(res.counts['filled_share'], 0.05, name)
        self.assertGreater(res.caster['height_px'], 30, name)
        return res

    def test_konclui_lamp(self):
        res = self.check('arc_lamp.konclui', sprite_of('arc_lamp.konclui'))
        a = res.anchors
        self.assertLess(a['light_head'][0], a['foot'][0])                  # the dome is on the left, the base on the right
        self.assertLess(a['light_head'][1], a['foot'][1])
        self.assertEqual(res.caster['sprite_foot_row'], 70)                # the base's last solid row (the painted shadow is not solid)

    def test_bird_of_paradise_pictures(self):
        for name in ('bird_of_paradise.alta', 'bird_of_paradise.branco'):
            res = self.check(name, sprite_of(name))
            self.assertLess(abs(res.caster['foot_row'] - res.caster['sprite_foot_row']), 3, name)

    def test_a_painted_pool_is_not_the_piece(self):
        """The lamp's baked pool is 1841 partial-alpha px: not opaque, so not counted in the alignment."""
        sprite = sprite_of('arc_lamp.konclui')
        res = P.build(REG.get('arc_lamp.konclui'), sprite, 'k')
        self.assertEqual(res.counts['opaque_px'], int((sprite[..., 3] >= P.SOLID_ALPHA).sum()))
        self.assertEqual(res.counts['opaque_px'], 739)
        self.assertEqual(int(res.height[sprite[..., 3] < P.SOLID_ALPHA].max()), 0)

    def test_the_mobilia_lamps(self):
        right = dist_sprite(REG.get('arc_lamp.mobilia_right').keys[0])
        left = dist_sprite(REG.get('arc_lamp.mobilia_left').keys[0])
        np.testing.assert_array_equal(left, right[:, ::-1])               # the audit: the one is the other mirrored
        self.check('arc_lamp.mobilia_right', right)
        self.check('arc_lamp.mobilia_left', left)

    def test_the_mirrored_recipe_mirrors_the_arrays(self):
        right = dist_sprite(REG.get('arc_lamp.mobilia_right').keys[0])
        a = P.build(REG.get('arc_lamp.mobilia_right'), right, 'r')
        b = P.build(REG.get('arc_lamp.mobilia_left'), right[:, ::-1].copy(), 'l')
        self.assertEqual(a.alignment['covered_share'], b.alignment['covered_share'])
        np.testing.assert_array_equal(a.height[:, ::-1], b.height)

    def test_the_dist_pictures_equal_the_drawn_ones(self):
        for name in ('arc_lamp.konclui', 'bird_of_paradise.alta', 'bird_of_paradise.branco'):
            built = dist_sprite(REG.get(name).keys[0])
            np.testing.assert_array_equal(built, sprite_of(name), name)

    def test_a_leaf_has_its_own_normal(self):
        res = P.build(REG.get('bird_of_paradise.alta'), sprite_of('bird_of_paradise.alta'), 'k')
        leaves = res.normal[:60, :, :3][res.opaque[:60]]
        self.assertGreater(len({tuple(v) for v in leaves}), 40)            # a ridge fans the normals out, not one flat colour
        self.assertGreater(len(np.unique(res.height[:60][res.opaque[:60]])), 20)

    def test_the_pot_is_lower_than_the_leaves(self):
        res = P.build(REG.get('bird_of_paradise.alta'), sprite_of('bird_of_paradise.alta'), 'k')
        pot = res.height[70:90][res.opaque[70:90]]
        top = res.height[:30][res.opaque[:30]]
        self.assertLess(pot.max(), top.min())

    def test_the_lamp_base_is_on_the_floor_and_the_dome_is_high(self):
        res = P.build(REG.get('arc_lamp.konclui'), sprite_of('arc_lamp.konclui'), 'k')
        bx, by = res.anchors['base']
        hx, hy = res.anchors['light_head']
        self.assertLessEqual(int(res.height[int(by), int(bx)]), 3)
        self.assertGreater(int(res.height[int(hy) - 3, int(hx)]), 40)

    def test_deterministic(self):
        a = P.build(REG.get('bird_of_paradise.alta'), sprite_of('bird_of_paradise.alta'), 'k')
        b = P.build(REG.get('bird_of_paradise.alta'), sprite_of('bird_of_paradise.alta'), 'k')
        self.assertEqual(a.to_json(), b.to_json())

    def test_the_cli_writes_and_lists(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / 'src' / 'lamp.png'
            src.parent.mkdir()
            Image.fromarray(np.ascontiguousarray(sprite_of('arc_lamp.konclui')), 'RGBA').save(src)
            with contextlib.redirect_stdout(io.StringIO()):
                rc = P.main(['arc_lamp.konclui', '--sprite', str(src), '--out', str(Path(d) / 'out'), '--scale', '2'])
            self.assertEqual(rc, 0)
            self.assertEqual(sorted(p.name for p in (Path(d) / 'out').iterdir()),
                             ['lamp.height.png', 'lamp.normal.png', 'lamp.overlay.png', 'lamp.proxy.json'])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(P.main(['--list']), 0)
        self.assertIn('bird_of_paradise.alta', out.getvalue())


if __name__ == '__main__':
    unittest.main(verbosity=1)
