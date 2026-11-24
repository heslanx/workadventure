"""Relief only where a surface curves (audit rule R12): a flat face keeps the flat normal, a bevel runs along a real edge, a curved piece
keeps a soft curve. Tests of tools/kinds.py (the picture evidence of a box: flat_face, box_body, box_evidence, relief_profile) and of
tools/normals.py (limit_lean, grounded, ground_foot, tool_normals on synthetic sprites).
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_normals_flat.py
The classes that run spritefusion-sprite-normals are skipped, with the reason, on a host that lacks the pinned tool; `BuiltRelief` runs
only with KONCLUI_DIST set (a built map: hq-office/build.py --out DIR --renders DIR2) and measures the real placed set.

Seen failing (how each rule was shown to bite): `BuiltRelief` on the build of HEAD before this change (/tmp/kv/dist3) reports 45% of the
opaque pixels of fx/normal.png leaning more than 0.8 (the bound is 2%) and the white planter's face leaning from 0.0 to 0.9 across it;
the synthetic `box` test on the old rule (`domed` for every soft-furnishing tag) shows the dome across the face; the pure tests fail on
the old modules with an AttributeError (they name functions that did not exist)."""
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
import kinds as K  # noqa: E402
import normals as N  # noqa: E402
import toolchain as TC  # noqa: E402

TOOL_OK = TC.problem('sprite-normals') is None
NEEDS_TOOL = unittest.skipUnless(TOOL_OK, 'spritefusion-sprite-normals is missing; python3 -I tools/toolchain.py status prints '
                                          'the install command')
FLAT = np.array(N.FLAT[:3], np.uint8)
LEAN_BOUND = 0.02                                       # the stated bound: the share of a built map's opaque pixels leaning more than 0.8


def lean_of(normals):
    v = normals[..., :3].astype(float) / 255 * 2 - 1
    return np.hypot(v[..., 0], v[..., 1])


def box_picture(w=60, h=30, colour=(235, 238, 240)):
    """An opaque box: a one-colour face with a 1 px darker outline, the way a planter or a cabinet is drawn."""
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[...] = colour + (255,)
    rgba[0] = rgba[-1] = rgba[:, 0] = rgba[:, -1] = (90, 95, 100, 255)
    return rgba


def disc_picture(r=14, colour=(180, 90, 60), shaded=True):
    """A round pot seen from above: a disc shaded from its lit side to its dark one (no big rectangle of one colour in it)."""
    size = 2 * r + 4
    yy, xx = np.mgrid[:size, :size]
    d = np.hypot(yy - size / 2 + .5, xx - size / 2 + .5)
    rgba = np.zeros((size, size, 4), np.uint8)
    shade = 1 - 0.5 * (xx - size / 2) / size - 0.3 * (yy - size / 2) / size if shaded else np.ones((size, size))
    for i, c in enumerate(colour):
        rgba[..., i] = np.clip(c * shade, 0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(d <= r, 255, 0)
    return rgba


def planter_picture():
    """A white box 58 wide with a rim and soil on its face, and thin reeds 14 rows tall standing out of it."""
    w, h = 64, 48
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[26:46, 3:61] = box_picture(58, 20)
    rgba[26:28, 3:61, :3] = (248, 250, 247)
    for x in range(6, 58, 3):
        rgba[12:26, x] = (60, 130 + x, 70, 255)
    return rgba


def tufted_sofa_picture():
    """A sofa back: three cushion panels of 26 x 8 with a button, separated by seams, on a wide base."""
    rgba = np.zeros((40, 96, 4), np.uint8)
    rgba[...] = (40, 80, 90, 255)
    rgba[:, :, :3] += (np.arange(40)[:, None, None] // 4 % 2 * 14).astype(np.uint8)      # the bands of a cushion's light and shade
    for k in range(3):
        rgba[6:14, 6 + 30 * k:32 + 30 * k] = (50, 100, 110, 255)
        rgba[9, 19 + 30 * k] = (20, 40, 50, 255)
    return rgba


def on_canvas(rgba, shape):
    canvas = np.zeros(shape + (4,), np.uint8)
    canvas[:rgba.shape[0], :rgba.shape[1]] = rgba
    return canvas


class BoxEvidence(unittest.TestCase):
    """kinds.flat_face and box_evidence: what the picture says, not what the tag says."""

    def test_a_planter_and_a_flat_box_are_boxes(self):
        self.assertTrue(K.box_evidence(box_picture()))
        self.assertTrue(K.box_evidence(planter_picture()))
        area, x, y, w, h = K.flat_face(planter_picture())
        self.assertGreaterEqual(area, K.BOX_MIN_AREA)
        self.assertEqual((x >= 3, x + w <= 61, y >= 26), (True, True, True))   # the rectangle is on the box, not on the reeds

    def test_a_round_pot_a_tufted_sofa_and_a_plant_are_not(self):
        self.assertFalse(K.box_evidence(disc_picture()))
        self.assertFalse(K.box_evidence(tufted_sofa_picture()))
        plant = np.zeros((40, 40, 4), np.uint8)
        yy, xx = np.mgrid[:40, :40]
        plant[..., :3] = np.stack([20 + 5 * xx, 120 + 3 * yy, 30 + 2 * (xx + yy)], -1) % 256
        plant[..., 3] = 255
        self.assertFalse(K.box_evidence(plant))

    def test_a_name_that_says_a_box_lowers_the_bar_but_never_replaces_the_picture(self):
        small = box_picture(30, 16)                                              # 28 x 14 = 392 px: under BOX_MIN_AREA
        self.assertFalse(K.box_evidence(small, 'Vaso de cerâmica'))
        self.assertTrue(K.box_evidence(small, 'Floreira pequena'))
        self.assertFalse(K.box_evidence(disc_picture(), 'Floreira redonda'))   # the name alone is not enough
        self.assertFalse(K.box_evidence(small, 'Floreirada'))                    # a whole word, never a substring

    def test_the_body_of_a_box_is_its_rows_without_what_stands_out_of_it(self):
        body = K.box_body(planter_picture())
        rows = np.nonzero(body.any(axis=1))[0]
        self.assertEqual((int(rows[0]), int(rows[-1])), (26, 45))              # the reeds (rows 12 to 25) are not the body
        self.assertEqual(int(body.sum()), 58 * 20)
        self.assertIsNone(K.box_body(np.zeros((4, 4, 4), np.uint8)))             # nothing opaque, no body

    def test_the_profile_of_a_soft_tagged_piece_follows_the_picture(self):
        soft = ['Plantas']
        self.assertEqual(K.relief_profile('stand', soft, None, box=True), 'box')
        self.assertEqual(K.relief_profile('stand', soft, None, box=False), 'domed')
        self.assertEqual(K.relief_profile('stand', soft), 'domed')               # no picture evidence given: the old rule
        self.assertEqual(K.relief_profile('stand', ['Sofás e poltronas'], None, box=False), 'domed')
        self.assertEqual(K.relief_profile('top', soft, None, box=True), 'bevel')   # only a standing piece is a soft one at all
        self.assertEqual(K.relief_profile('stand', ['Mesas'], None, box=False), 'bevel')
        self.assertEqual(K.relief_profile('stand', soft, 'arc', box=True), 'flat')
        self.assertEqual(K.relief_profile('floor', soft, None, box=True), 'none')
        self.assertIn('box', K.RELIEF_PROFILES)


class LeanAndFoot(unittest.TestCase):
    """normals.limit_lean, grounded and ground_foot: pure numpy."""

    def _ramp(self):
        n = np.zeros((1, 21, 4), np.uint8)
        lean = np.linspace(0, 0.99, 21)
        v = np.stack([lean, np.zeros(21), np.sqrt(1 - lean ** 2)], -1)
        n[0, :, :3] = np.round((v + 1) / 2 * 255)
        n[..., 3] = 255
        return n

    def test_limit_lean_keeps_the_order_the_direction_and_unit_length_and_caps_the_lean(self):
        n = self._ramp()
        out = N.limit_lean(n, np.ones((1, 21), bool), 0.7)
        before, after = lean_of(n)[0], lean_of(out)[0]
        self.assertLess(after.max(), 0.7)
        self.assertTrue((np.diff(after) > 0).all())                              # a smooth cap, never a plateau
        self.assertTrue(np.allclose(after[:3], before[:3], atol=0.02))           # a gentle slope is itself
        v = out[..., :3].astype(float) / 255 * 2 - 1
        self.assertTrue(np.allclose(np.linalg.norm(v, axis=-1), 1, atol=0.01))
        self.assertTrue((v[..., 0] >= -1e-9).all() and (np.abs(v[..., 1]) < 0.01).all())

    def test_limit_lean_never_touches_a_pixel_outside_the_mask(self):
        n = self._ramp()
        mask = np.zeros((1, 21), bool)
        mask[0, :10] = True
        out = N.limit_lean(n, mask, 0.5)
        self.assertTrue((out[0, 10:] == n[0, 10:]).all())

    def test_a_piece_on_the_floor_is_grounded_and_a_slab_on_legs_is_not(self):
        counter = np.zeros((40, 80), bool)
        counter[5:40, 2:78] = True
        desk = np.zeros((40, 80), bool)
        desk[5:25, 2:78] = True
        desk[25:40, 4:8] = desk[25:40, 70:74] = True
        self.assertTrue(N.grounded(counter))
        self.assertFalse(N.grounded(desk))
        self.assertFalse(N.grounded(np.zeros((5, 5), bool)))

    def test_ground_foot_squares_the_foot_and_leaves_what_is_not_grounded(self):
        solid = np.zeros((30, 40), bool)
        solid[4:30, 2:38] = True
        n = np.zeros((30, 40, 4), np.uint8)
        n[...] = N.FLAT[:3] + (255,)
        n[solid & (np.arange(30)[:, None] >= 26)] = (130, 20, 200, 255)          # a bevel along the foot
        n[:, 2:6] = (20, 128, 200, 255)                                          # and the left edge
        out = N.ground_foot(n, solid)
        self.assertTrue((out[26:30, 10:30] == N.FLAT[:3] + (255,)).all())        # the foot's bevel is gone under the face
        self.assertTrue((out[26:30, 2:6] == (20, 128, 200, 255)).all())          # the side bevel runs straight down
        self.assertTrue((out[:26] == n[:26]).all())
        floating = solid.copy()
        floating[26:, 6:34] = False                                              # legs only
        self.assertTrue((N.ground_foot(n, floating) == n).all())


@NEEDS_TOOL
class SyntheticPieces(unittest.TestCase):
    """tool_normals on small synthetic sprites, with the pinned normals tool."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='test-normals-flat-')
        self.addCleanup(self.tmp.cleanup)

    def run_piece(self, rgba, piece, standing=False):
        path = str(Path(self.tmp.name) / f'{piece}-{rgba.shape[0]}x{rgba.shape[1]}-{int(standing)}.png')
        Image.fromarray(rgba, 'RGBA').save(path)
        return N.tool_normals({path}, N.DOMED, {path: piece}, {path} if standing else None)[path]

    def test_a_flat_box_is_flat_inside_its_edge_and_its_edge_is_a_chamfer(self):
        rgba = on_canvas(box_picture(96, 48), (50, 100))
        n = self.run_piece(rgba, 'bevel')
        solid = rgba[..., 3] == 255
        deep = N.inside(solid, N.BEVEL_PX)
        self.assertGreater(int(deep.sum()), 2000)
        self.assertTrue((n[deep][:, :3] == FLAT).all(), 'a face of a box keeps the flat normal from one end to the other')
        self.assertTrue((n[deep][:, 3] == 255).all())
        edge = solid & ~deep
        self.assertLessEqual(lean_of(n)[edge].max(), N.EDGE_LEAN + 0.01)
        self.assertGreater(lean_of(n)[edge].max(), 0.4, 'a bevel exists along the real edge')

    def test_a_box_that_stands_on_the_floor_has_no_bevel_at_its_foot(self):
        rgba = on_canvas(box_picture(96, 48), (50, 100))
        floating = self.run_piece(rgba, 'bevel', standing=False)
        standing = self.run_piece(rgba, 'bevel', standing=True)
        foot = (slice(44, 48), slice(12, 84))                                    # the foot, clear of the side edges
        self.assertGreater(lean_of(floating)[foot].max(), 0.4)                   # a slab in the air: an edge, with its bevel
        self.assertTrue((standing[foot][..., :3] == FLAT).all())                 # a piece on the floor: nothing turns there
        self.assertEqual(lean_of(standing)[10:40, 2].round(1).max() > 0.3, True)   # its side edge keeps its bevel to the floor

    def test_a_round_pot_keeps_a_soft_curve(self):
        rgba = disc_picture(14, shaded=False)
        n = self.run_piece(rgba, 'domed')
        solid = rgba[..., 3] == 255
        lean = lean_of(n)
        self.assertLessEqual(lean[solid].max(), N.SOFT_LEAN + 0.01)
        self.assertGreater(lean[solid].max(), 0.45, 'the rim of a round pot turns away from the viewer')
        centre = lean[rgba.shape[0] // 2 - 1:rgba.shape[0] // 2 + 1, rgba.shape[1] // 2 - 1:rgba.shape[1] // 2 + 1]
        self.assertLess(centre.max(), 0.3)                                       # its middle faces up (0.19 measured, the rim 0.58)
        self.assertGreater(lean[solid].max() - centre.max(), 0.25)               # and the lean grows towards the rim: a curve
        self.assertLess((n[solid][:, :3] == FLAT).all(axis=-1).mean(), 0.1, 'a curve is not a plane')

    def test_a_planter_is_a_flat_box_with_its_reeds_still_curved(self):
        rgba = planter_picture()
        self.assertTrue(K.box_evidence(rgba, 'Floreira branca'))
        box = self.run_piece(rgba, 'box', standing=True)
        body = K.box_body(rgba)
        deep = N.inside(body, N.BEVEL_PX)
        self.assertTrue((box[deep][:, :3] == FLAT).all(), 'no dome across the planter\'s face')
        reeds = (rgba[..., 3] == 255) & ~body
        self.assertGreater(lean_of(box)[reeds].max(), 0.2, 'what stands out of the box keeps the curve of a plant')
        self.assertLessEqual(lean_of(box)[body].max(), N.EDGE_LEAN + 0.01)
        # what the old rule did (a Plantas tag meant a dome): the wedges across the face, which is what R12 removes
        domed = self.run_piece(rgba, 'domed')
        self.assertGreater((lean_of(domed)[deep] > 0.3).mean(), 0.3)

    def test_the_normals_of_every_profile_are_unit_length_and_opaque_exact(self):
        for piece, rgba in (('bevel', box_picture(60, 30)), ('domed', disc_picture(12)), ('box', planter_picture()), ('flat', box_picture(20, 20))):
            n = self.run_piece(rgba, piece, standing=True)
            solid = rgba[..., 3] == 255
            self.assertTrue(((n[..., 3] == 255) == solid).all(), piece)
            v = n[solid][:, :3].astype(float) / 255 * 2 - 1
            self.assertLess(np.abs(np.linalg.norm(v, axis=-1) - 1).max(), 0.007, piece)   # tools/verify.py NORMAL_TOLERANCE


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST is unset: build with `python3 hq-office/build.py --out DIR --renders DIR2` '
                                                     'and rerun with KONCLUI_DIST=DIR')
class BuiltRelief(unittest.TestCase):
    """The real build: the measured counts of fx/normal.png and of every placed sprite fall under their bounds."""

    @classmethod
    def setUpClass(cls):
        import json
        cls.dist = Path(os.environ['KONCLUI_DIST'])
        cls.manifest = json.loads((cls.dist / 'fx' / 'manifest.json').read_text())
        cls.map = np.array(Image.open(cls.dist / 'fx' / 'normal.png').convert('RGBA'))
        cls.profiles = N.piece_profiles(cls.dist, cls.manifest)
        sprites = {p for _, _, p, _ in N.placed(cls.dist)} & set(cls.profiles)
        cls.sprites = sprites
        standing = N.standing_sprites(cls.dist, cls.manifest)
        cls.maps = N.tool_normals(sprites, N.DOMED, cls.profiles, standing)

    def test_few_pixels_of_the_map_lean_more_than_0_8(self):
        solid = self.map[..., 3] == 255
        share = float((lean_of(self.map) > 0.8)[solid].mean())
        print(f'\nfx/normal.png: {int(solid.sum())} opaque px, {int((lean_of(self.map) > 0.8)[solid].sum())} lean more than 0.8 '
              f'({share:.3%}), {int((lean_of(self.map) > 0.5)[solid].sum())} more than 0.5; the bound is {LEAN_BOUND:.0%}')
        self.assertLessEqual(share, LEAN_BOUND, f'{share:.1%} of the opaque pixels of fx/normal.png lean more than 0.8')

    def test_no_face_of_a_flat_piece_has_relief(self):
        offenders = []
        for path, profile in sorted(self.profiles.items()):
            if profile not in ('bevel', 'box') or path not in self.maps:
                continue
            rgba = N.geometry(N.PG.load_rgba(path))
            solid = rgba[..., 3] == 255
            if profile == 'box':
                solid = K.box_body(rgba)
            deep = N.inside(solid, N.BEVEL_PX)
            if not deep.any():
                continue
            share = float((lean_of(self.maps[path])[deep] > 0.05).mean())
            if share > 0.02:
                offenders.append((Path(path).name, profile, round(share, 3)))
        self.assertEqual(offenders, [], 'pixels deeper than BEVEL_PX from the edge that lean (the dome R12 removes)')

    def test_a_soft_piece_never_leans_more_than_soft_lean_and_a_slab_edge_more_than_edge_lean(self):
        worst = []
        for path, n in self.maps.items():
            solid = n[..., 3] == 255
            cap = N.SOFT_LEAN if self.profiles[path] == 'domed' else N.EDGE_LEAN
            if self.profiles[path] == 'box':
                cap = max(N.SOFT_LEAN, N.EDGE_LEAN)
            if self.profiles[path] != 'flat' and solid.any() and lean_of(n)[solid].max() > cap + 0.01:
                worst.append((Path(path).name, round(float(lean_of(n)[solid].max()), 3)))
        self.assertEqual(worst, [])

    def test_the_white_planter_has_no_dome_across_its_face(self):
        planter = [p for p in self.sprites if 'planter-white' in p]
        self.assertTrue(planter, 'the build has no white planter')
        self.assertEqual(self.profiles[planter[0]], 'box')
        rgba = N.geometry(N.PG.load_rgba(planter[0]))
        deep = N.inside(K.box_body(rgba), N.BEVEL_PX)
        self.assertGreater(int(deep.sum()), 500)
        self.assertLess(float(lean_of(self.maps[planter[0]])[deep].max()), 0.01)        # (128, 128, 255) is 0.0055 off the vertical to a byte

    def test_the_sofas_keep_a_soft_relief(self):
        sofas = [p for p in self.sprites if 'couch' in p or 'seating' in p]
        self.assertTrue(sofas)
        for path in sofas:
            if self.profiles[path] != 'domed':
                continue
            n = self.maps[path]
            solid = n[..., 3] == 255
            self.assertGreater(float((lean_of(n)[solid] > 0.05).mean()), 0.5, Path(path).name)   # shaded, not made flat
            self.assertLessEqual(float(lean_of(n)[solid].max()), N.SOFT_LEAN + 0.01, Path(path).name)

    def test_office_normals_still_passes(self):
        import verify as V
        result = V.normals_result(self.dist)
        self.assertNotEqual(result.status, V.FAIL, result.summary if hasattr(result, 'summary') else result)


if __name__ == '__main__':
    unittest.main()
