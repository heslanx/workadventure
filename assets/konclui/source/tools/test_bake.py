"""Behaviour tests of tools/bake.py (the volume baker), tools/projection.json and hq-office/props (the recipe registry).

The projection numbers below are written out here on purpose: these tests are the only independent proof that the baker
puts 1 metre of ground at 32 px (x) and 32 or 24 px (y), and 1 metre of height at 21 px.

Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_bake.py
Demonstration pieces (a wooden crate and a round side table, both projections, with 6x sheets):
    python3 -I tools/test_bake.py --demo OUT_DIR"""
import hashlib
import json
import math
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SOURCE / 'hq-office'))
import bake as B  # noqa: E402
import volume as V  # noqa: E402

TOP = (128, 128, 255)      # world +z, encoded (n + 1) / 2 * 255
SOUTH = (128, 0, 128)      # world +y (toward the viewer) is the map's -y: (0, -1, 0)


# ------------------------------------------------------------------------------------------ demonstration recipes

_OAK_WARM = V.PALETTE['FLOOR_RAMPS']['oak-warm'][0]


def demo_crate():
    """A 1 x 1 m crate, 17 px (0.81 m) high: a dark frame, three planks on the lid and the front. Painted on one box, the
    way a drawn crate is: the frame and the plank gaps are decals aligned to the pixel grid (1 px = 1/32 m on the ground,
    1/21 m of height)."""
    X, Z = 1 / 32, 1 / 21
    H = 17 * Z
    fr, rail = 4 * X, 2 * Z
    ink = V.INK
    mats = {
        'plank': V.Material('plank', (V.mix(_OAK_WARM, ink, 0.6), V.mix(_OAK_WARM, ink, 0.42), V.mix(_OAK_WARM, ink, 0.2), _OAK_WARM)),
        'frame': V.Material('frame', tuple(V.mix(_OAK_WARM, ink, m) for m in (0.78, 0.62, 0.44, 0.28))),
        'seam': V.flat_material('seam', V.mix(_OAK_WARM, ink, 0.55), ink=V.mix(_OAK_WARM, ink, 0.62)),
    }

    def frame_top(a, b):
        return (a < fr) | (a > 1 - fr) | (b < fr) | (b > 1 - fr)

    def seam_top(a, b):
        return ~frame_top(a, b) & (((b >= 12 * X) & (b < 13 * X)) | ((b >= 19 * X) & (b < 20 * X)))

    def frame_front(a, b):
        return (a < fr) | (a > 1 - fr) | (b < rail) | (b > H - rail)

    def seam_front(a, b):
        return ~frame_front(a, b) & (((a >= 12 * X) & (a < 13 * X)) | ((a >= 19 * X) & (a < 20 * X)))
    decals = [V.Decal('top', 'frame', frame_top), V.Decal('top', 'seam', seam_top),
              V.Decal('south', 'frame', frame_front), V.Decal('south', 'seam', seam_front)]
    return V.Recipe('demo-crate', [V.box(0, 0, 0, 1, 1, H, 'plank', decals=decals)], (1, 1),
                    anchors={'lid': (0.5, 0.5, H)}, colour_cap=16, materials=mats)


def demo_side_table():
    """A round drum side table: a plinth, a walnut drum with a teal band (a tube thinner than about 0.06 m falls under the 50%
    coverage rule on half its rows and bakes as dashes: seen in the 6x sheet, so the band is 0.06 m), a wood top with a
    walnut edge. Pushed to the front
    of its 1 x 1 footprint so the plinth reaches the front edge."""
    cx, cy = 0.5, 0.68
    z0, zt, e = 0.06, 0.52, 0.025
    plinth = [(0.0, 0.0), (0.28, 0.0)] + V.arc(0.28, 0.02, 0.02, -90, 0, 3) + [(0.30, z0), (0.0, z0)]
    top_r, z1 = 0.32, zt + 0.07
    top = [(0.0, zt), (top_r - e, zt)] + V.arc(top_r - e, zt + e, e, -90, 0, 4) + [(top_r, z1 - e)] + V.arc(top_r - e, z1 - e, e, 0, 90, 5) + [(0.0, z1)]
    top_mats = ['walnut'] * (len(top) - 1 - 6) + ['wood-warm'] * 6
    return V.Recipe('demo-side-table', [
        V.lathe(plinth, cx, cy, 'walnut', crease_deg=60, sharp=(len(plinth) - 2,)),
        V.frustum(cx, cy, z0, zt, 0.26, 0.26, 'walnut', top=False, bottom=False),
        V.ring(cx, cy, 0.30, 0.26, 0.03, 'ds-turquoise'),
        V.lathe(top, cx, cy, 'walnut', mats=top_mats, crease_deg=60)], (1, 1), anchors={'top': (cx, cy, z1)}, colour_cap=16)


def unit_box(name='box1', z1=1.0, **kw):
    return V.Recipe(name, [V.box(0, 0, 0, 1, 1, z1, 'wood')], (1, 1), **kw)


def classify(piece):
    """'top', 'south' or None for every pixel of the normal image."""
    n = piece.normal
    out = np.full(n.shape[:2], '', dtype='U5')
    opaque = n[..., 3] == 255
    out[opaque & (np.abs(n[..., :3].astype(int) - TOP).max(-1) <= 1)] = 'top'
    out[opaque & (np.abs(n[..., :3].astype(int) - SOUTH).max(-1) <= 1)] = 'south'
    return out


def sha(piece):
    h = hashlib.sha256()
    for im in piece.images().values():
        d = Path(tempfile.mkdtemp())
        try:
            im.save(d / 'x.png', format='PNG', optimize=False, compress_level=9)
            h.update((d / 'x.png').read_bytes())
        finally:
            shutil.rmtree(d)
    h.update(json.dumps(piece.to_json(), sort_keys=True).encode())
    return h.hexdigest()


# ------------------------------------------------------------------------------------------------------ projection

class Projection(unittest.TestCase):
    def test_the_two_projections_are_the_agreed_numbers(self):
        o, c = B.load_projection('oblique'), B.load_projection('camera75')
        self.assertEqual((o.sx, o.sy, o.sz), (32, 32, 21))
        self.assertEqual((c.sx, c.sy, c.sz), (32, 24, 21))
        self.assertEqual(B.load_projection().name, 'oblique')            # the default until the owner has seen both

    def test_oblique_is_the_decided_default_and_camera75_is_kept_for_comparison_only(self):
        self.assertEqual(json.loads(B.PROJECTION_FILE.read_text())['default'], 'oblique')
        o, c = B.load_projection('oblique'), B.load_projection('camera75')
        self.assertEqual((o.status, c.status), ('default', 'comparison-only'))
        self.assertEqual(B.load_projection().status, 'default')
        self.assertEqual((o.expect['rim_ratio'], c.expect['rim_ratio']), (1.0, 0.75))

    def test_the_command_says_when_a_projection_is_comparison_only(self):
        import contextlib
        import io
        d = Path(tempfile.mkdtemp())
        try:
            src = d / 'p.py'
            src.write_text('import sys\nsys.path.insert(0, %r)\nimport volume as V\n'
                           'RECIPE = V.Recipe("note-box", [V.box(0, 0, 0, 1, 1, 0.5, "wood")], (1, 1))\n' % str(HERE))
            notes = {}
            for proj in ('oblique', 'camera75'):
                err = io.StringIO()
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                    B.main([str(src), '--projection', proj, '--out', str(d / proj)])
                notes[proj] = err.getvalue()
            self.assertEqual(notes['oblique'], '')
            self.assertIn('comparison only', notes['camera75'])
        finally:
            shutil.rmtree(d)

    def test_an_unknown_projection_is_refused(self):
        with self.assertRaises(ValueError):
            B.load_projection('isometric')

    def test_the_light_has_no_left_right_component(self):
        light = B.load_projection().light
        self.assertEqual(light[0], 0.0)
        self.assertGreater(light[1], 0)                                   # a little from the viewer ...
        self.assertGreater(light[2], light[1])                            # ... more from above
        self.assertAlmostEqual(float(np.linalg.norm(light)), 1.0, places=12)

    def test_the_baker_reads_the_scale_from_the_file_and_hard_codes_none(self):
        data = json.loads(B.PROJECTION_FILE.read_text())
        data['projections']['stretch'] = {'sx_px_per_m': 32, 'sy_px_per_m': 40, 'sz_px_per_m': 30}
        d = Path(tempfile.mkdtemp())
        try:
            (d / 'projection.json').write_text(json.dumps(data))
            with mock.patch.object(B, 'PROJECTION_FILE', d / 'projection.json'):
                piece = B.bake(unit_box(), 'stretch')
        finally:
            shutil.rmtree(d)
        kinds = classify(piece)
        mid = piece.size[0] // 2
        self.assertEqual(((kinds[:, mid] == 'top').sum(), (kinds[:, mid] == 'south').sum()), (40, 30))


    # ---- every number of the "bake" block is read by the baker (review: coverage, margin_px and colour_cap were dead keys)

    def bake_with(self, recipe, projection='oblique', **bake_changes):
        """bake `recipe` with the projection file's "bake" block edited."""
        data = json.loads(B.PROJECTION_FILE.read_text())
        data['bake'].update(bake_changes)
        d = Path(tempfile.mkdtemp())
        try:
            (d / 'projection.json').write_text(json.dumps(data))
            with mock.patch.object(B, 'PROJECTION_FILE', d / 'projection.json'):
                return B.bake(recipe, projection, overrides=False)
        finally:
            shutil.rmtree(d)

    def test_every_numeric_key_of_the_bake_block_changes_the_output_or_the_violations(self):
        keys = set(json.loads(B.PROJECTION_FILE.read_text())['bake']) - {'light_note'}
        def table():                      # the demo declares its own cap of 16; this one follows the file
            r = demo_side_table()
            r.colour_cap = None
            return r
        base = B.bake(table(), 'oblique', overrides=False)
        base_box = B.bake(unit_box('k'), 'oblique', overrides=False)
        # key -> (new value, what must differ from the baseline)
        cases = {
            'supersample': (2, lambda p: (p.metrics['samples'], sha(p)) != (base.metrics['samples'], sha(base))),
            'coverage': (0.95, lambda p: p.metrics['opaque_px'] < base.metrics['opaque_px']),
            'margin_px': (5, lambda p: p.size[0] == base.size[0] + 8 and p.metrics['margin']['left'] == 5),
            'foot_gap_max': (0, lambda p: any(v.startswith('foot-gap') for v in p.violations)
                             and not any(v.startswith('foot-gap') for v in base.violations)),
            'crease_px': (0.25, lambda p: p.metrics['ink_px'] > base.metrics['ink_px']),
            'colour_cap': (3, lambda p: any(v.startswith('colours') for v in p.violations)),
            'light': ([0.0, 0.2, 0.98], lambda p: not (p.rgba == base.rgba).all()),
        }
        # override_budget is checked by the override test below (a patch of one pixel needs a non-zero budget)
        self.assertEqual(keys - {'override_budget'}, set(cases), 'a new bake key needs a case here and a reader in bake.py')
        self.assertTrue(base.ok and base_box.ok, base.violations + base_box.violations)
        for key, (value, differs) in cases.items():
            piece = self.bake_with(table(), **{key: value})
            self.assertTrue(differs(piece), f'bake.{key} = {value!r} changed nothing')

    def test_a_recipe_value_overrides_the_file_and_none_follows_it(self):
        box = unit_box('own', margin=3, coverage=0.5, colour_cap=3)
        piece = self.bake_with(box, margin_px=5, coverage=0.95, colour_cap=24)
        self.assertEqual((piece.meta['margin'], piece.meta['coverage'], piece.meta['colour_cap']), (3, 0.5, 3))
        self.assertEqual(piece.metrics['margin']['left'], 3)
        follow = self.bake_with(unit_box('own'), margin_px=5, coverage=0.7, colour_cap=9)
        self.assertEqual((follow.meta['margin'], follow.meta['coverage'], follow.meta['colour_cap']), (5, 0.7, 9))
        self.assertEqual(B.bake(unit_box('own'), 'oblique', overrides=False).meta['colour_cap'], 24)

    def test_a_projection_file_value_changes_the_recipe_hash_so_a_patch_goes_stale(self):
        a = self.bake_with(unit_box('h'))
        b = self.bake_with(unit_box('h'), margin_px=2)
        c = self.bake_with(unit_box('h'), coverage=0.6)
        self.assertEqual(len({a.provenance['recipe_hash'], b.provenance['recipe_hash'], c.provenance['recipe_hash']}), 3)
        explicit = B.bake(unit_box('h', margin=1, coverage=0.5, colour_cap=24), 'oblique', overrides=False)
        self.assertEqual(explicit.provenance['recipe_hash'], a.provenance['recipe_hash'])        # same values, same hash

    def test_a_file_value_out_of_range_is_refused(self):
        for key, bad in (('coverage', 0.0), ('margin_px', 0), ('colour_cap', 1)):
            with self.assertRaises(ValueError, msg=key):
                self.bake_with(unit_box('bad'), **{key: bad})


# --------------------------------------------------------------------------------------------------- the 1 m box

class Box(unittest.TestCase):
    def check(self, projection, ground_rows, total_rows):
        piece = B.bake(unit_box(), projection)
        a = piece.rgba[..., 3] > 0
        kinds = classify(piece)
        mid = piece.size[0] // 2
        self.assertEqual(int(a.any(0).sum()), 32, 'columns')
        self.assertEqual(int((kinds[:, mid] == 'top').sum()), ground_rows, 'top face rows')
        self.assertEqual(int((kinds[:, mid] == 'south').sum()), 21, 'front face rows')
        self.assertEqual(int(a.any(1).sum()), total_rows)
        self.assertEqual(int((kinds == 'top').sum()), 32 * ground_rows)
        self.assertEqual(int((kinds == 'south').sum()), 32 * 21)
        self.assertEqual(int(a.sum()), 32 * total_rows)
        return piece

    def test_oblique_1m_box_is_32_columns_a_32_row_top_and_a_21_row_front(self):
        self.check('oblique', 32, 53)

    def test_camera75_1m_box_is_32_columns_a_24_row_top_and_a_21_row_front(self):
        self.check('camera75', 24, 45)

    def test_a_half_metre_deep_box_is_half_the_ground_rows(self):
        r = V.Recipe('slab', [V.box(0, 0, 0, 1, 0.5, 1, 'wood')], (1, 0.5))
        piece = B.bake(r, 'oblique')
        kinds = classify(piece)
        self.assertEqual(int((kinds[:, piece.size[0] // 2] == 'top').sum()), 16)

    def test_top_normal_is_up_and_front_normal_is_the_map_minus_y(self):
        piece = B.bake(unit_box(), 'oblique')
        kinds = classify(piece)
        for name, want in (('top', (0, 0, 1)), ('south', (0, -1, 0))):
            rgb = piece.normal[kinds == name][:, :3].astype(float)
            self.assertGreater(len(rgb), 600)
            n = rgb / 255 * 2 - 1
            self.assertLess(np.abs(n - want).max(), 1 / 255 + 1e-9, name)
        self.assertEqual({tuple(p) for p in piece.normal[kinds == 'top']}, {(128, 128, 255, 255)})
        self.assertEqual({tuple(p) for p in piece.normal[kinds == 'south']}, {(128, 0, 128, 255)})

    def test_normals_are_unit_within_the_8_bit_bound_and_alpha_matches_exactly(self):
        for proj in ('oblique', 'camera75'):
            for recipe in (unit_box(), demo_crate(), demo_side_table()):
                piece = B.bake(recipe, proj)
                self.assertEqual(set(np.unique(piece.rgba[..., 3])) - {0, 255}, set())
                self.assertTrue((piece.normal[..., 3] == piece.rgba[..., 3]).all())
                op = piece.normal[..., 3] == 255
                n = piece.normal[op][:, :3].astype(float) / 255 * 2 - 1
                self.assertLess(np.abs(np.linalg.norm(n, axis=1) - 1).max(), 0.0136, f'{recipe.name} {proj}')
                self.assertEqual(piece.normal.dtype, np.uint8)

    def test_height_of_the_box_is_21_on_its_top_face_and_falls_down_the_front(self):
        piece = B.bake(unit_box(), 'oblique')
        kinds = classify(piece)
        self.assertEqual(set(np.unique(piece.height[kinds == 'top'])), {21})
        self.assertEqual(int(piece.height[piece.rgba[..., 3] == 0].max()), 0)
        mid = piece.size[0] // 2
        col = piece.height[:, mid][kinds[:, mid] == 'south']
        self.assertLessEqual(int(col[0]), 21)                    # the front face starts at the top edge ...
        self.assertGreaterEqual(int(col[0]), 20)
        self.assertLessEqual(int(col[-1]), 1)                     # ... and ends at the floor
        self.assertTrue((np.diff(col.astype(int)) <= 0).all())    # monotone
        self.assertEqual(piece.height.dtype, np.uint8)

    def test_east_west_and_north_faces_are_never_drawn(self):
        # a bevelled box has flat east, west and north faces and rounded edges all round; only what faces the camera shows
        r = V.Recipe('round', [V.box(0, 0, 0, 1, 1, 1, 'wood', bevel=0.1)], (1, 1))
        for proj in ('oblique', 'camera75'):
            p = B.bake(r, proj)
            self.assertEqual(int((p.rgba[..., 3] > 0).any(0).sum()), 32, proj)
            op = p.normal[..., 3] == 255
            n = p.normal[op][:, :3].astype(float) / 255 * 2 - 1
            self.assertLess(np.abs(n[:, 0]).max(), 0.99, proj)                      # no flat east or west face
            view = B.load_projection(proj).view
            world = np.stack([n[:, 0], -n[:, 1], n[:, 2]], 1)
            self.assertGreater((world @ view).min(), 0.0, proj)                      # nothing faces away from the camera

    def test_height_follows_sz_not_the_ground_scale(self):
        tall = B.bake(unit_box(z1=2.0), 'camera75')
        kinds = classify(tall)
        self.assertEqual(set(np.unique(tall.height[kinds == 'top'])), {42})

    def test_baked_tones_are_the_ramp_top_and_the_step_below_and_carry_no_left_right_light(self):
        piece = B.bake(unit_box(), 'oblique')
        ramp = [V.hex_rgb(c) for c in V.MATERIALS['wood'].ramp]
        kinds = classify(piece)
        interior = np.zeros(kinds.shape, bool)
        interior[3:-3, 4:-4] = True
        top_colours = {tuple(p[:3]) for p in piece.rgba[(kinds == 'top') & interior]}
        south_colours = {tuple(p[:3]) for p in piece.rgba[(kinds == 'south') & interior]}
        self.assertEqual(top_colours, {ramp[3]})
        self.assertEqual(south_colours, {ramp[2]})
        self.assertTrue((piece.rgba == piece.rgba[:, ::-1]).all())

    def test_a_sphere_is_lit_the_same_on_its_left_and_right(self):
        piece = B.bake(V.Recipe('ball', [V.sphere(0.5, 0.5, 0.5, 0.5, 'ds-mint')], (1, 1)), 'oblique')
        w = piece.size[0]
        left, right = piece.rgba[:, :w // 2], piece.rgba[:, w - w // 2:][:, ::-1]
        tolerance = max(4, 0.03 * piece.metrics['opaque_px'] / 2)
        for colour in np.unique(piece.rgba.reshape(-1, 4), axis=0):
            n_left, n_right = int(np.all(left == colour, -1).sum()), int(np.all(right == colour, -1).sum())
            self.assertAlmostEqual(n_left, n_right, delta=tolerance, msg=str(colour))
        # and the tones really do vary over the ball, so the comparison is not vacuous
        self.assertGreaterEqual(len({tuple(c) for c in piece.rgba.reshape(-1, 4) if c[3]}), 3)     # two tones and the ink


class Occlusion(unittest.TestCase):
    """The nearest sample owns the pixel. A short box in front of a tall one hides the lower part of the tall box's front face:
    the rows where they overlap belong to the short box's top, in its material, its normal and its height. A baker that kept
    the FARTHEST sample (a flipped z-buffer) would show the tall box through the short one."""

    def recipe(self):
        # tall: y 0..0.5, 1 m high (21 px): top face rows 1..16, front face rows 17..38 (canvas bottom is row 54 = the front edge,
        # so the tall box's front base is at 54 - 16 = 38). short: y 0.5..1, 0.3 m (6.3 px): top face rows 32..47, front 48..53.
        return V.Recipe('occlusion', [V.box(0, 0, 0, 1, 0.5, 1.0, 'wood'), V.box(0, 0.5, 0, 1, 1.0, 0.3, 'ds-mint')], (1, 1))

    def owner(self, p, row, col):
        rgb = tuple(int(v) for v in p.rgba[row, col, :3])
        for name in ('wood', 'ds-mint'):
            m = V.MATERIALS[name]
            if rgb in {V.hex_rgb(c) for c in m.ramp} | {V.hex_rgb(m.ink)}:
                return name
        return rgb

    def test_the_nearer_box_owns_the_rows_where_the_two_overlap(self):
        p = B.bake(self.recipe(), 'oblique', overrides=False)
        self.assertEqual(p.size, (34, 54))
        mid = p.size[0] // 2
        owners = [self.owner(p, y, mid) for y in range(1, 54)]
        self.assertEqual(set(owners[:31]), {'wood'}, owners[:31])                 # rows 1..31: the tall box, top then front face
        self.assertEqual(set(owners[31:]), {'ds-mint'}, owners[31:])               # rows 32..53: the short box; 32..38 are the overlap
        kinds = list(classify(p)[:, mid])
        self.assertEqual(set(kinds[1:17]), {'top'})
        self.assertEqual(set(kinds[17:32]), {'south'})
        self.assertEqual(set(kinds[32:48]), {'top'})                               # the short top, not the tall front face
        self.assertEqual(set(kinds[48:54]), {'south'})

    def test_the_height_map_follows_the_nearer_surface(self):
        p = B.bake(self.recipe(), 'oblique', overrides=False)
        mid = p.size[0] // 2
        # the tall front face falls 21 -> 7 over rows 17..31, then the short top is flat at 6.3 px (6) over the overlap
        self.assertEqual([int(p.height[y, mid]) for y in (16, 17, 31)], [21, 21, 7])
        self.assertEqual({int(p.height[y, mid]) for y in range(32, 48)}, {6})

    def test_the_order_of_the_solids_in_the_recipe_does_not_matter(self):
        a = B.bake(self.recipe(), 'oblique', overrides=False)
        r = self.recipe()
        r.solids = list(reversed(r.solids))
        b = B.bake(r, 'oblique', overrides=False)
        self.assertTrue((a.rgba == b.rgba).all() and (a.height == b.height).all())


class TwoSidedBlade(unittest.TestCase):
    def blade(self, pitch, yaw=0, **kw):
        return V.Recipe('blade', [V.leaf((0.4, 0.8, 0.8), yaw, pitch, 0.6, 0.3, 0, 'leaf', under='soil', **kw)], (1, 1), margin=2, kind='top')

    def colours(self, piece):
        return {tuple(c[:3]) for c in piece.rgba.reshape(-1, 4) if c[3]}

    def test_a_flat_blade_shows_its_upper_side_only(self):
        p = B.bake(self.blade(0), 'oblique')
        soil = {V.hex_rgb(c) for c in V.MATERIALS['soil'].ramp}
        self.assertTrue(self.colours(p) - soil)
        self.assertFalse(self.colours(p) & soil)
        # and its normal is the top face's (0, 0, 1)
        self.assertEqual(set(map(tuple, p.normal[p.normal[..., 3] == 255][:, :3])), {TOP})

    def test_a_blade_drooping_away_from_the_viewer_shows_its_underside_material(self):
        p = B.bake(self.blade(-70, yaw=270), 'oblique')
        soil = {V.hex_rgb(c) for c in V.MATERIALS['soil'].ramp}
        self.assertTrue(self.colours(p) & soil)


# --------------------------------------------------------------------------------------------------------- sphere

class Sphere(unittest.TestCase):
    R = 0.5

    def piece(self, projection):
        return B.bake(V.Recipe('ball', [V.sphere(0.5, 0.5, 0.5, self.R, 'ds-mint')], (1, 1)), projection)

    def test_silhouette_height_is_two_r_times_the_length_of_the_projected_up_axis(self):
        for proj, scale in (('oblique', math.hypot(32, 21)), ('camera75', math.hypot(24, 21))):
            p = self.piece(proj)
            x0, y0, x1, y1 = p.bounds
            self.assertAlmostEqual(y1 - y0, 2 * self.R * scale, delta=0.05, msg=proj)       # exact, to the sampling step
            self.assertAlmostEqual(x1 - x0, 2 * self.R * 32, delta=0.05, msg=proj)
            rows = int((p.rgba[..., 3] > 0).any(1).sum())
            self.assertLessEqual(abs(rows - 2 * self.R * scale), 1.5, f'{proj}: {rows} rows')
            self.assertEqual(int((p.rgba[..., 3] > 0).any(0).sum()), 32, proj)

    def test_the_pixel_at_the_centre_faces_the_camera(self):
        p = self.piece('oblique')
        view = np.array([0, 21, 32]) / math.hypot(21, 32)
        cx, cy = int((p.bounds[0] + p.bounds[2]) / 2), int((p.bounds[1] + p.bounds[3]) / 2)       # the pixel holding the centre
        n = p.normal[cy, cx, :3].astype(float) / 255 * 2 - 1
        want = np.array([view[0], -view[1], view[2]])           # the map's y points up
        # a sphere's normal changes by 1 / (R * px per metre) = 1/16 per pixel: the centre pixel is within one pixel of it
        self.assertLess(np.abs(n - want).max(), 0.07)
        self.assertGreater(n[2], 0.8)
        self.assertLess(n[1], -0.4)                              # leaning toward the viewer, which is down the map


# --------------------------------------------------------------------------------------------- determinism, canvas

class Determinism(unittest.TestCase):
    def test_a_rebake_gives_the_same_bytes(self):
        for recipe in (unit_box, demo_crate, demo_side_table):
            for proj in ('oblique', 'camera75'):
                a, b = B.bake(recipe(), proj), B.bake(recipe(), proj)
                self.assertEqual(sha(a), sha(b), f'{recipe.__name__} {proj}')
                self.assertEqual(a.provenance['recipe_hash'], b.provenance['recipe_hash'])

    def test_written_files_are_byte_identical_between_runs(self):
        d1, d2 = Path(tempfile.mkdtemp()), Path(tempfile.mkdtemp())
        try:
            B.bake(demo_side_table(), 'oblique').write(d1)
            B.bake(demo_side_table(), 'oblique').write(d2)
            names = sorted(p.name for p in d1.iterdir())
            self.assertEqual(names, ['demo-side-table.height.png', 'demo-side-table.json', 'demo-side-table.normal.png', 'demo-side-table.png'])
            for n in names:
                self.assertEqual((d1 / n).read_bytes(), (d2 / n).read_bytes(), n)
        finally:
            shutil.rmtree(d1)
            shutil.rmtree(d2)

    def test_provenance_records_the_tools_and_the_projection(self):
        import PIL
        p = B.bake(unit_box(), 'camera75').provenance
        self.assertEqual((p['numpy'], p['pillow'], p['projection']['name']), (np.__version__, PIL.__version__, 'camera75'))
        self.assertEqual((p['projection']['sx'], p['projection']['sy'], p['projection']['sz']), (32, 24, 21))
        self.assertRegex(p['recipe_hash'], r'^[0-9a-f]{16}$')


class RotatedBox(unittest.TestCase):
    """review: Solid.rotated_z on a plain (unbevelled) box dropped the faces a rotation turns toward the viewer."""

    def bake_rotated(self, deg):
        # 0.6 x 0.6 m, flush with the front edge of its footprint, turned about its own centre
        box = V.box(0.2, 0.4, 0, 0.8, 1.0, 0.5, 'wood').rotated_z(deg, about=(0.5, 0.7))
        return B.bake(V.Recipe('rot', [box], (1, 1), overhangs={'north': 0.3, 'south': 0.3, 'east': 0.3, 'west': 0.3}),
                      'oblique', overrides=False)

    def test_a_plain_box_turned_a_quarter_or_a_half_turn_bakes_the_same_picture_as_unturned(self):
        base = self.bake_rotated(0)
        self.assertEqual(base.metrics['opaque_px'], 600)
        k0 = classify(base)
        for deg in (90, 180, 270):
            with self.subTest(deg=deg):
                p = self.bake_rotated(deg)
                self.assertEqual(p.metrics['opaque_px'], 600)                    # was 380 at 90 and 180
                self.assertEqual(p.violations, [])
                k = classify(p)
                self.assertEqual(((k == 'top').sum(), (k == 'south').sum()), ((k0 == 'top').sum(), (k0 == 'south').sum()))
                self.assertGreater((k == 'south').sum(), 0)                      # the front face is there and faces south
                self.assertTrue((p.rgba == base.rgba).all())                     # a square box is its own rotation

    def test_an_eighth_turn_shows_two_front_faces(self):
        p = self.bake_rotated(45)
        self.assertGreater(p.metrics['opaque_px'], 600)                           # the diagonal is wider than the face
        n = p.normal[p.normal[..., 3] == 255][:, :3].astype(int)
        self.assertGreater(((n[:, 0] < 120)).sum(), 0)                            # a face turned to the left ...
        self.assertGreater(((n[:, 0] > 136)).sum(), 0)                            # ... and one to the right


class Canvas(unittest.TestCase):
    def test_last_row_is_the_front_edge_and_the_foot_gap_is_at_most_one(self):
        for proj in ('oblique', 'camera75'):
            for recipe in (unit_box(), demo_crate(), demo_side_table()):
                p = B.bake(recipe, proj)
                a = p.rgba[..., 3] > 0
                gap = p.size[1] - 1 - int(np.nonzero(a.any(1))[0].max())
                self.assertLessEqual(gap, 1, f'{recipe.name} {proj}')
                self.assertEqual(p.metrics['foot_gap'], gap)
                self.assertEqual(p.sort_line, p.size[1])
                self.assertEqual(p.depth_offset, 0)
                self.assertEqual(p.footprint['px']['y'] + p.footprint['px']['h'], p.size[1])

    def test_at_least_one_transparent_pixel_on_the_left_right_and_top(self):
        for proj in ('oblique', 'camera75'):
            for recipe in (unit_box(), demo_crate(), demo_side_table()):
                p = B.bake(recipe, proj)
                a = p.rgba[..., 3]
                self.assertFalse(a[0].any() or a[:, 0].any() or a[:, -1].any(), f'{recipe.name} {proj}')
        foliage = V.Recipe('f', [V.box(0, 0, 0, 1, 1, 1, 'wood')], (1, 1), margin=2)
        a = B.bake(foliage, 'oblique').rgba[..., 3]
        self.assertFalse(a[:2].any() or a[:, :2].any() or a[:, -2:].any())

    def test_foot_and_footprint_in_canvas_pixels(self):
        p = B.bake(unit_box(), 'oblique')
        self.assertEqual(p.size, (34, 54))
        self.assertEqual(p.footprint['px'], {'x': 1, 'y': 22, 'w': 32, 'h': 32})
        self.assertEqual(p.foot, (17.0, 54.0))
        two = B.bake(V.Recipe('wide', [V.box(0, 0, 0, 2, 1, 0.5, 'wood')], (2, 1), anchors={'seat': (0.5, 0.5, 0.45)}), 'camera75')
        self.assertEqual(two.footprint['px'], {'x': 1, 'y': two.size[1] - 24, 'w': 64, 'h': 24})
        # an anchor 0.5 m in from the left, half a metre deep and 0.45 m up
        self.assertAlmostEqual(two.anchors['seat'][0], 1 + 16.0, places=9)
        self.assertAlmostEqual(two.anchors['seat'][1], two.size[1] - 12 - 0.45 * 21, places=9)

    def test_placement_shift_keeps_the_foot_point_where_it_was(self):
        p = B.bake(unit_box(), 'oblique', old_canvas=(32, 64))
        self.assertEqual(p.shift, {'dx': -1, 'dy': 10, 'old_canvas': [32, 64], 'old_foot': [16.0, 64.0]})
        q = B.bake(unit_box(), 'oblique', old_canvas=(40, 60), old_foot=(20, 55))
        self.assertEqual((q.shift['dx'], q.shift['dy']), (3, 1))
        self.assertIsNone(B.bake(unit_box(), 'oblique').shift)

    def test_geometry_that_hangs_below_the_footprint_moves_the_sort_line_up(self):
        r = V.Recipe('hang', [V.box(0, 0, 0, 1, 1.25, 0.2, 'wood')], (1, 1), overhangs={'south': 0.3})
        p = B.bake(r, 'oblique')
        self.assertEqual(p.depth_offset, p.sort_line - p.size[1])
        self.assertEqual(p.sort_line, p.size[1] - 8)
        self.assertTrue(any('hangs' in w for w in p.warnings))
        self.assertTrue(p.ok)


class Violations(unittest.TestCase):
    def codes(self, recipe, proj='oblique'):
        return [v.split(':')[0] for v in B.bake(recipe, proj).violations]

    def test_a_floating_piece_breaks_the_foot_gap(self):
        r = V.Recipe('float', [V.box(0, 0, 0.5, 1, 1, 1.0, 'wood')], (1, 1))
        self.assertEqual(self.codes(r), ['foot-gap'])
        self.assertGreater(B.bake(r, 'oblique').metrics['foot_gap'], 1)

    def test_geometry_outside_the_footprint_is_a_violation_unless_declared(self):
        wide = [V.box(0, 0, 0, 1.4, 1, 0.5, 'wood')]
        self.assertEqual(self.codes(V.Recipe('w', wide, (1, 1))), ['footprint'])
        self.assertEqual(self.codes(V.Recipe('w', wide, (1, 1), overhangs={'east': 0.4})), [])
        self.assertEqual(self.codes(V.Recipe('w', wide, (1, 1), overhangs={'west': 0.4})), ['footprint'])

    def test_the_colour_cap_is_enforced(self):
        busy = demo_crate()
        busy.colour_cap = 3
        self.assertIn('colours', self.codes(busy))
        self.assertGreater(B.bake(busy, 'oblique').metrics['colours'], 3)
        busy.colour_cap = 24
        self.assertNotIn('colours', self.codes(busy))

    def test_a_tall_stand_piece_must_declare_it(self):
        pillar = [V.box(0, 0, 0, 1, 1, 3.0, 'wood')]
        self.assertEqual(self.codes(V.Recipe('p', pillar, (1, 1))), ['height'])
        self.assertEqual(self.codes(V.Recipe('p', pillar, (1, 1), tall=True)), [])
        self.assertEqual(self.codes(V.Recipe('p', pillar, (1, 1), kind='hang')), [])

    def test_a_piece_declared_symmetric_is_checked_against_its_mirror(self):
        lopsided = [V.box(0, 0, 0, 0.5, 1, 0.5, 'wood'), V.box(0.5, 0.5, 0, 1, 1, 0.5, 'wood')]
        self.assertEqual(self.codes(V.Recipe('s', lopsided, (1, 1), symmetric=True)), ['symmetry'])
        self.assertEqual(self.codes(V.Recipe('s', lopsided, (1, 1))), [])
        self.assertEqual(self.codes(unit_box('s', symmetric=True)), [])

    def test_a_clean_piece_is_ok(self):
        p = B.bake(demo_crate(), 'oblique')
        self.assertTrue(p.ok and not p.violations and not p.warnings)


# ------------------------------------------------------------------------------------------------------- outline

class Outline(unittest.TestCase):
    def boundary(self, piece):
        return B._boundary(piece.rgba[..., 3])

    def test_the_outline_covers_the_silhouette_in_each_materials_darkest_tone(self):
        for proj in ('oblique', 'camera75'):
            for recipe in (unit_box(), demo_crate(), demo_side_table()):
                p = B.bake(recipe, proj)
                table = recipe.materials_table()
                inks = {V.hex_rgb(table[n].ink) for s in recipe.solids for n in s.sample(0.05).names}
                bnd = self.boundary(p)
                on = np.array([tuple(c[:3]) in inks for c in p.rgba[bnd]])
                self.assertGreaterEqual(on.mean(), 0.9, f'{recipe.name} {proj}')
                self.assertGreaterEqual(p.metrics['outline_fraction'], 0.9)

    def test_without_the_outline_pass_the_boundary_is_not_ink(self):
        p = B.bake(unit_box(), 'oblique', outline=False)
        self.assertLess(p.metrics['outline_fraction'], 0.9)
        self.assertIn('outline', ' '.join(p.violations))

    def test_the_outline_is_one_pixel_and_inside_the_silhouette(self):
        p = B.bake(unit_box(), 'oblique')
        ink = V.hex_rgb(V.MATERIALS['wood'].ink)
        is_ink = np.all(p.rgba[..., :3] == ink, -1) & (p.rgba[..., 3] > 0)
        self.assertEqual(int(is_ink.sum()), 2 * 32 + 2 * 51)                 # a one pixel ring around 32 x 53
        self.assertTrue((is_ink == self.boundary(p)).all())

    def test_a_depth_crease_is_inked_on_the_farther_side_only(self):
        back = V.box(0, 0, 0, 1, 0.4, 1, 'wood')
        front = V.box(0.25, 0.5, 0, 0.75, 0.9, 0.2, 'ds-mint')
        r = V.Recipe('crease', [back, front], (1, 1))
        with_ink, without = B.bake(r, 'oblique'), B.bake(r, 'oblique', outline=False)
        wood_ink = V.hex_rgb(V.MATERIALS['wood'].ink)
        mint_ink = V.hex_rgb(V.MATERIALS['ds-mint'].ink)

        def interior_ink(p, colour):
            m = np.all(p.rgba[..., :3] == colour, -1) & (p.rgba[..., 3] > 0)
            return int((m & ~self.boundary(p)).sum())
        self.assertGreater(interior_ink(with_ink, wood_ink), 10)         # the back box's pixels along the near box's top edge
        self.assertEqual(interior_ink(without, wood_ink), 0)
        self.assertEqual(interior_ink(with_ink, mint_ink), 0)            # the nearer box is not inked inside

    def test_a_small_step_is_not_a_crease(self):
        r = V.Recipe('step', [V.box(0, 0, 0, 1, 1, 0.5, 'wood'), V.box(0.25, 0.25, 0.5, 0.75, 0.75, 0.55, 'wood')], (1, 1))
        p = B.bake(r, 'oblique')
        ink = V.hex_rgb(V.MATERIALS['wood'].ink)
        m = np.all(p.rgba[..., :3] == ink, -1) & (p.rgba[..., 3] > 0) & ~self.boundary(p)
        self.assertEqual(int(m.sum()), 0)


class CreaseSpecks(unittest.TestCase):
    def test_a_one_pixel_crease_is_dropped_and_a_crease_line_is_kept(self):
        solid = np.zeros((9, 9), bool)
        solid[1:8, 1:8] = True
        dep = np.zeros((9, 9))
        dep[4, 4] = -10.0                                           # one pixel far behind its neighbours
        edge, crease = B._outline_mask(solid, dep, 3.0)
        self.assertFalse(crease.any())
        self.assertEqual(int(edge.sum()), 24)
        dep[4, 3:6] = -10.0                                          # three in a row: a line
        edge, crease = B._outline_mask(solid, dep, 3.0)
        self.assertEqual(sorted(zip(*np.nonzero(crease))), [(4, 3), (4, 4), (4, 5)])


class Cleanup(unittest.TestCase):
    def arrays(self, solid):
        h, w = solid.shape
        mat = np.zeros((h, w), int)
        tone = np.full((h, w), 2, int)
        return solid, mat, tone, np.zeros((h, w, 3), np.float32) + [0, 0, 1], np.full((h, w), 5.0), np.zeros((h, w))

    def test_an_isolated_pixel_is_removed_and_a_detail_pixel_is_kept(self):
        solid = np.zeros((9, 9), bool)
        solid[2:7, 2:7] = True
        solid[0, 8] = True
        out = B._cleanup(*self.arrays(solid), protected=np.array([False]))
        self.assertFalse(out[0][0, 8])
        self.assertEqual(int(out[0].sum()), 25)
        out = B._cleanup(*self.arrays(solid), protected=np.array([True]))
        self.assertTrue(out[0][0, 8])

    def test_a_one_pixel_hole_is_filled_and_a_two_pixel_hole_is_not(self):
        solid = np.zeros((9, 9), bool)
        solid[1:8, 1:8] = True
        solid[4, 4] = False
        out = B._cleanup(*self.arrays(solid), protected=np.array([False]))
        self.assertTrue(out[0][4, 4])
        solid[4, 5] = False
        solid[4, 4] = False
        out = B._cleanup(*self.arrays(solid), protected=np.array([False]))
        self.assertFalse(out[0][4, 4] or out[0][4, 5])

    def test_a_lone_off_tone_pixel_takes_its_neighbours_tone(self):
        solid = np.zeros((9, 9), bool)
        solid[1:8, 1:8] = True
        s, mat, tone, n, h, d = self.arrays(solid)
        tone[4, 4] = 0
        out = B._cleanup(s, mat, tone, n, h, d, protected=np.array([False]))
        self.assertEqual(int(out[2][4, 4]), 2)
        tone[4, 4], tone[4, 5] = 0, 0                                   # a two pixel run is detail, not speckle
        out = B._cleanup(s, mat, tone, n, h, d, protected=np.array([False]))
        self.assertEqual((int(out[2][4, 4]), int(out[2][4, 5])), (0, 0))

    def test_baked_pieces_have_no_stray_pixels_or_holes(self):
        for recipe in (demo_crate(), demo_side_table()):
            for proj in ('oblique', 'camera75'):
                a = B.bake(recipe, proj).rgba[..., 3] > 0
                n8 = sum(B._shift(a.astype(int), dy, dx) for dy, dx in B.N8)
                n4 = sum(B._shift(a.astype(int), dy, dx) for dy, dx in B.N4)
                self.assertFalse((a & (n8 == 0)).any(), f'{recipe.name} {proj}: a stray pixel')
                self.assertFalse((~a & (n4 == 4)).any(), f'{recipe.name} {proj}: a one-pixel hole')


# ---------------------------------------------------------------------------------------------------- overrides

class CleanupInBake(unittest.TestCase):
    """The clean-up functions are tested alone above; these pin that bake() really runs them."""

    def specked(self):
        main = V.box(0, 0, 0, 1, 1, 0.3, 'wood')
        # one pixel wide and one row deep (1/32 m), 0.002 m thick, floating well above the box: a single isolated pixel
        speck = V.box(20 / 32, 10 / 32, 0.998, 21 / 32, 11 / 32, 1.0, 'wood')
        return V.Recipe('specked', [main, speck], (1, 1)), V.Recipe('specked', [main], (1, 1))

    @staticmethod
    def isolated(piece):
        a = piece.rgba[..., 3] > 0
        n8 = sum(B._shift(a.astype(int), dy, dx) for dy, dx in B.N8)
        return int((a & (n8 == 0)).sum())

    def test_bake_removes_a_stray_pixel_and_the_picture_is_the_one_without_it(self):
        with_speck, without = self.specked()
        raw = B.bake(with_speck, 'oblique', overrides=False, cleanup=False)
        self.assertEqual(self.isolated(raw), 1, 'the fixture must leave one stray pixel when the clean-up is off')
        clean = B.bake(with_speck, 'oblique', overrides=False)
        self.assertEqual(self.isolated(clean), 0)
        ref = B.bake(without, 'oblique', overrides=False)
        self.assertEqual(clean.size, ref.size)
        self.assertTrue((clean.rgba == ref.rgba).all() and (clean.normal == ref.normal).all() and (clean.height == ref.height).all())

    def test_the_cleanup_switch_changes_the_bake(self):
        with_speck, _ = self.specked()
        on, off = B.bake(with_speck, 'oblique', overrides=False), B.bake(with_speck, 'oblique', overrides=False, cleanup=False)
        self.assertGreater(off.size[1], on.size[1])                      # the speck 11 rows above the box grew the canvas


class Overrides(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.recipe = unit_box('ovr')
        self.piece = B.bake(self.recipe, 'oblique')
        self.text, self.legend = B.ascii_of(self.piece)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def write(self, text, name='ovr.txt'):
        (self.dir / name).write_text(text)

    def edit(self, changes, text=None):
        lines = (text or self.text).splitlines()
        head = [i for i, l in enumerate(lines) if l.startswith('#')]
        first = head[-1] + 1
        rows = [list(l) for l in lines[first:]]
        for (y, x), ch in changes.items():
            rows[y][x] = ch
        return '\n'.join(lines[:first] + [''.join(r) for r in rows]) + '\n'

    def bake(self, recipe=None, **kw):
        return B.bake(recipe or self.recipe, 'oblique', overrides_dir=self.dir, **kw)

    def test_the_skeleton_round_trips_to_the_same_picture(self):
        self.write(self.text)
        p = self.bake()
        self.assertTrue((p.rgba == self.piece.rgba).all())
        self.assertEqual(p.metrics['override'], {'file': 'ovr.txt', 'changed': 0, 'budget': int(0.08 * self.piece.metrics['opaque_px']),
                                                 'header': 'base'})

    def test_a_patch_within_budget_is_applied_and_keeps_alpha_and_normals_consistent(self):
        legend = self.text.replace('# legend: ', '# legend: z=#FF00AA ', 1)
        # (20, 10) recoloured; (30, 10) deleted; (21, 0) an empty pixel with an opaque neighbour made opaque; (0, 0) one with none
        self.assertEqual(self.piece.rgba[21, 0, 3], 0)
        self.assertEqual(self.piece.rgba[21, 1, 3], 255)
        self.write(self.edit({(20, 10): 'z', (30, 10): '_', (21, 0): 'z', (0, 0): 'z'}, legend))
        p = self.bake()
        self.assertEqual(p.metrics['override']['changed'], 4)
        self.assertEqual(tuple(p.rgba[20, 10]), (255, 0, 170, 255))
        self.assertEqual(tuple(p.rgba[30, 10]), (0, 0, 0, 0))
        self.assertEqual(tuple(p.normal[30, 10]), (128, 128, 255, 0))
        self.assertEqual(int(p.height[30, 10]), 0)
        self.assertEqual(tuple(p.rgba[21, 0]), (255, 0, 170, 255))
        self.assertEqual(tuple(p.normal[21, 0]), tuple(self.piece.normal[21, 1]))        # the neighbour's normal and height
        self.assertEqual(int(p.height[21, 0]), int(self.piece.height[21, 1]))
        self.assertEqual(tuple(p.normal[0, 0]), (128, 128, 255, 255))                    # no neighbour: flat
        self.assertEqual(set(np.unique(p.rgba[..., 3])) - {0, 255}, set())
        self.assertTrue((p.normal[..., 3] == p.rgba[..., 3]).all())
        self.assertTrue((p.height[p.rgba[..., 3] == 0] == 0).all())
        self.assertEqual(int((p.rgba != self.piece.rgba).any(-1).sum()), 4)

    def test_moving_an_edge_pixel_keeps_normal_alpha_equal_to_alpha_in_either_scan_order(self):
        # review: erase (30, 32) and add its right-hand neighbour (30, 33): the new pixel used to copy the erased pixel's
        # (128, 128, 255, 0) when the erased one came first in row-major order
        legend = self.text.replace('# legend: ', '# legend: z=#FF00AA ', 1)
        baked = self.piece
        self.assertEqual((baked.rgba[30, 32, 3], baked.rgba[30, 33, 3]), (255, 0))
        # right edge: the erased pixel comes BEFORE the added one in row-major order (the case that failed); left edge: after it
        self.assertEqual((baked.rgba[30, 1, 3], baked.rgba[30, 0, 3]), (255, 0))
        for erase, add in (((30, 32), (30, 33)), ((30, 1), (30, 0))):
            with self.subTest(erase=erase, add=add):
                text = legend
                changes = {erase: '_', add: 'z'}
                self.write(self.edit(changes, text))
                p = self.bake()
                self.assertTrue((p.normal[..., 3] == p.rgba[..., 3]).all())
                self.assertTrue((p.height[p.rgba[..., 3] == 0] == 0).all())
                added = [k for k, ch in changes.items() if ch == 'z'][0]
                gone = [k for k, ch in changes.items() if ch == '_'][0]
                self.assertEqual(p.rgba[added][3], 255)
                self.assertEqual(p.rgba[gone][3], 0)
                self.assertEqual(p.normal[added][3], 255)
                # it took a real normal and height from an opaque neighbour that survived, never from the erased pixel
                survivors = [(added[0] + dy, added[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                             if (dy or dx) and 0 <= added[0] + dy < p.size[1] and 0 <= added[1] + dx < p.size[0]
                             and baked.rgba[added[0] + dy, added[1] + dx, 3] and (added[0] + dy, added[1] + dx) != gone]
                self.assertIn(tuple(p.normal[added]), {tuple(baked.normal[q]) for q in survivors})
                self.assertIn(int(p.height[added]), {int(baked.height[q]) for q in survivors})

    def test_the_override_budget_comes_from_the_projection_file(self):
        self.write(self.edit({(20, 10): 'z'}, self.text.replace('# legend: ', '# legend: z=#FF00AA ', 1)))
        self.assertEqual(self.bake().metrics['override']['changed'], 1)
        data = json.loads(B.PROJECTION_FILE.read_text())
        data['bake']['override_budget'] = 0.0
        d = Path(tempfile.mkdtemp())
        try:
            (d / 'projection.json').write_text(json.dumps(data))
            with mock.patch.object(B, 'PROJECTION_FILE', d / 'projection.json'):
                with self.assertRaises(B.OversizedOverrideError):
                    self.bake()
        finally:
            shutil.rmtree(d)

    def test_an_oversized_patch_is_refused(self):
        budget = int(0.08 * self.piece.metrics['opaque_px'])
        cells = {(y, x): 'z' for y in range(5, 5 + budget // 20 + 2) for x in range(2, 22)}
        self.assertGreater(len(cells), budget)
        self.write(self.edit(cells, self.text.replace('# legend: ', '# legend: z=#FF00AA ', 1)))
        with self.assertRaises(B.OversizedOverrideError):
            self.bake()
        cells = dict(list(cells.items())[:budget])
        self.write(self.edit(cells, self.text.replace('# legend: ', '# legend: z=#FF00AA ', 1)))
        self.assertEqual(self.bake().metrics['override']['changed'], budget)

    def test_a_stale_patch_is_refused_when_the_recipe_changed(self):
        self.write(self.text)
        taller = unit_box('ovr', z1=0.95)
        with self.assertRaises(B.StaleOverrideError) as ctx:
            self.bake(taller)
        self.assertIn('base sha256', str(ctx.exception))
        self.assertIn('recipe hash', str(ctx.exception))

    def test_a_stale_patch_is_refused_when_the_canvas_changed(self):
        self.write(self.text.replace('# canvas: 34x54', '# canvas: 34x53'))
        with self.assertRaises(B.StaleOverrideError) as ctx:
            self.bake()
        self.assertIn('canvas', str(ctx.exception))
        self.write('\n'.join(self.text.splitlines()[:-1]) + '\n')
        with self.assertRaises(B.StaleOverrideError):
            self.bake()

    def test_a_stale_patch_can_be_forced_with_a_warning(self):
        self.write(self.text.replace(self.piece.provenance['base_sha256'], '0' * 64))
        p = self.bake(allow_stale=True)
        self.assertTrue(any('stale' in w for w in p.warnings))

    def test_a_patch_for_another_projection_is_skipped_with_a_warning(self):
        self.write(self.text.replace('# projection: oblique', '# projection: camera75'))
        p = self.bake()
        self.assertIsNone(p.metrics['override'])
        self.assertTrue(any('camera75' in w for w in p.warnings))
        self.write(self.text, 'ovr.oblique.txt')                    # a projection-named file is found first
        self.assertEqual(self.bake().metrics['override']['file'], 'ovr.oblique.txt')

    def test_a_character_outside_the_legend_is_an_error_and_overrides_can_be_turned_off(self):
        self.write(self.edit({(20, 10): 'q'}))
        with self.assertRaises(B.OverrideError):
            self.bake()
        p = self.bake(overrides=False)
        self.assertIsNone(p.metrics['override'])


# ----------------------------------------------------------------------------------------------------- recipes

    # ---- the metrics and the violations describe the FINAL picture, not the bake the patch started from

    def test_a_patch_that_lifts_the_foot_is_a_foot_gap_violation_and_the_metric_is_the_final_one(self):
        w, h = self.piece.size
        self.assertEqual((self.piece.metrics['foot_gap'], self.piece.ok), (0, True))
        for rows, gap, breaks in ((1, 1, False), (2, 2, True)):                   # the limit is 1 (the lost ink row breaks the outline too)
            with self.subTest(rows=rows):
                self.write(self.edit({(y, x): '_' for y in range(h - rows, h) for x in range(w)}))
                p = self.bake()
                self.assertEqual(p.metrics['foot_gap'], gap)
                self.assertEqual(any(v.startswith('foot-gap') for v in p.violations), breaks, p.violations)
                self.assertFalse(p.ok)

    def test_a_patch_that_paints_into_the_margin_is_a_margin_violation(self):
        w, h = self.piece.size
        legend = self.text.replace('# legend: ', '# legend: z=#FF00AA ', 1)
        self.assertEqual(self.piece.metrics['margin'], {'left': 1, 'right': 1, 'top': 1})
        self.assertFalse(any(v.startswith('margin') for v in self.piece.violations))
        for side, cell in (('left', (20, 0)), ('right', (20, w - 1)), ('top', (0, 10))):
            with self.subTest(side=side):
                self.write(self.edit({cell: 'z'}, legend))
                p = self.bake()
                self.assertEqual(p.metrics['margin'][side], 0)
                self.assertTrue(any(v.startswith('margin') and side in v for v in p.violations), p.violations)
                self.assertFalse(p.ok)

    def test_a_patch_inside_the_margin_keeps_the_margin_metric_and_stays_clean(self):
        legend = self.text.replace('# legend: ', '# legend: z=#FF00AA ', 1)
        self.write(self.edit({(20, 10): 'z'}, legend))
        p = self.bake()
        self.assertEqual(p.metrics['margin'], {'left': 1, 'right': 1, 'top': 1})
        self.assertTrue(p.ok, p.violations)

    def test_the_ink_count_follows_the_patch(self):
        legend = self.text.replace('# legend: ', '# legend: z=#FF00AA ', 1)
        self.assertEqual(self.piece.metrics['ink_px'], 2 * 32 + 2 * 51)
        for y in (30, 31, 32):
            self.assertEqual(tuple(self.piece.rgba[y, 1, :3]), V.hex_rgb(V.MATERIALS['wood'].ink))   # a left-edge ink pixel
        self.write(self.edit({(30, 1): 'z', (31, 1): 'z', (32, 1): 'z'}, legend))
        p = self.bake()
        self.assertEqual(p.metrics['ink_px'], self.piece.metrics['ink_px'] - 3)
        self.assertEqual(p.metrics['override']['changed'], 3)

    # ---- staleness covers every input that changes a pixel (the base: line)

    def test_ascii_of_stamps_the_pixels_of_the_bake_it_describes(self):
        head = dict(ln[1:].split(':', 1) for ln in self.text.splitlines() if ln.startswith('#'))
        self.assertEqual(head[' base'].strip(), self.piece.provenance['base_sha256'])
        self.assertEqual(self.piece.provenance['base_sha256'], B.pixels_sha256(self.piece.rgba))
        self.assertEqual(len(self.piece.provenance['base_sha256']), 64)


class StalePatchInputs(unittest.TestCase):
    """A patch is drawn on one baked picture. Anything that changes that picture makes the patch stale, whether or not it also
    changes the recipe hash or the canvas size (the two things the first header could see)."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.recipe = demo_side_table()
        self.piece = B.bake(self.recipe, 'oblique', overrides=False)
        self.text, _ = B.ascii_of(self.piece)
        self.name = f'{self.recipe.name}.txt'

    def tearDown(self):
        shutil.rmtree(self.dir)

    def baked(self, proj_edit=None, bake_edit=None, **kw):
        data = json.loads(B.PROJECTION_FILE.read_text())
        data['projections']['oblique'].update(proj_edit or {})
        data['bake'].update(bake_edit or {})
        d = Path(tempfile.mkdtemp())
        try:
            (d / 'projection.json').write_text(json.dumps(data))
            with mock.patch.object(B, 'PROJECTION_FILE', d / 'projection.json'):
                return B.bake(demo_side_table(), 'oblique', overrides_dir=self.dir, **kw)
        finally:
            shutil.rmtree(d)

    def legacy(self):
        return '\n'.join(ln for ln in self.text.splitlines() if not ln.startswith('# base:')) + '\n'

    # (what the file says, what the old check could see): light, crease_px and a height scale change the picture and neither
    CASES = {'light': dict(bake_edit={'light': [0.0, 0.2, 0.98]}),
             'crease_px': dict(bake_edit={'crease_px': 0.25}),
             'sz_px_per_m (same canvas)': dict(proj_edit={'sz_px_per_m': 21.4}),
             'supersample': dict(supersample=2),
             'sx_px_per_m': dict(proj_edit={'sx_px_per_m': 32.4})}

    def test_every_input_that_changes_a_pixel_makes_a_stamped_patch_stale(self):
        (self.dir / self.name).write_text(self.text)
        for label, changes in self.CASES.items():
            with self.subTest(label):
                other = self.baked(overrides=False, **changes)
                self.assertNotEqual(other.provenance['base_sha256'], self.piece.provenance['base_sha256'], f'{label} changed no pixel')
                with self.assertRaises(B.StaleOverrideError) as ctx:
                    self.baked(**changes)
                self.assertIn('base sha256', str(ctx.exception))

    def test_light_crease_and_height_scale_are_invisible_to_the_old_header(self):
        """Why the base line exists: for these three the recipe hash and the canvas are the same, so a legacy header
        (recipe + canvas only) accepts a patch drawn on a different picture."""
        legacy, _, _ = B._parse_patch(self.legacy())
        stamped, _, _ = B._parse_patch(self.text)
        for label in ('light', 'crease_px', 'sz_px_per_m (same canvas)'):
            with self.subTest(label):
                p = self.baked(overrides=False, **self.CASES[label])
                w, h = p.size
                self.assertEqual((p.provenance['recipe_hash'], p.size), (self.piece.provenance['recipe_hash'], self.piece.size))
                self.assertEqual(B._stale_reasons(legacy, p.provenance['recipe_hash'], p.provenance['base_sha256'], w, h), [])
                self.assertNotEqual(B._stale_reasons(stamped, p.provenance['recipe_hash'], p.provenance['base_sha256'], w, h), [])

    def test_an_input_that_changes_no_pixel_does_not_make_a_patch_stale(self):
        (self.dir / self.name).write_text(self.text)
        for changes in (dict(bake_edit={'foot_gap_max': 0}), dict(bake_edit={'override_budget': 0.5})):
            p = self.baked(**changes)
            self.assertEqual((p.metrics['override']['header'], p.metrics['override']['changed']), ('base', 0))

    def test_a_recipe_change_that_changes_no_pixel_keeps_the_patch(self):
        (self.dir / self.name).write_text(self.text)
        moved = demo_side_table()
        moved.anchors['lid'] = (0.5, 0.5, 0.1)                       # an anchor is in the recipe hash, not in a pixel
        self.assertNotEqual(V.recipe_hash(moved), V.recipe_hash(self.recipe))
        p = B.bake(moved, 'oblique', overrides_dir=self.dir)
        self.assertEqual(p.metrics['override']['changed'], 0)

    def test_a_stamped_patch_of_the_right_pixels_is_not_stale_and_a_wrong_stamp_is(self):
        (self.dir / self.name).write_text(self.text)
        self.assertEqual(B.bake(self.recipe, 'oblique', overrides_dir=self.dir).metrics['override']['header'], 'base')
        (self.dir / self.name).write_text(self.text.replace(self.piece.provenance['base_sha256'], 'f' * 64))
        with self.assertRaises(B.StaleOverrideError):
            B.bake(self.recipe, 'oblique', overrides_dir=self.dir)

    def test_a_patch_without_the_base_line_still_works_and_says_so(self):
        (self.dir / self.name).write_text(self.legacy())
        p = B.bake(self.recipe, 'oblique', overrides_dir=self.dir)
        self.assertEqual((p.metrics['override']['header'], p.warnings), ('legacy', []))
        stale = self.legacy().replace(self.piece.provenance['recipe_hash'], '0' * 16)
        (self.dir / self.name).write_text(stale)
        with self.assertRaises(B.StaleOverrideError):
            B.bake(self.recipe, 'oblique', overrides_dir=self.dir)


class Restamp(unittest.TestCase):
    """bake.restamp / `bake.py --restamp`: add the base line to a patch, change nothing else."""

    FIXTURE = (
        'import sys\nsys.path.insert(0, %r)\nimport volume as V\n'
        'RECIPE = V.Recipe("fx-stamp", [V.box(0, 0, 0, 1, 1, 0.3, "wood"), V.sphere(0.5, 0.5, 0.6, 0.25, "ds-mint")], (1, 1))\n')

    def setUp(self):
        import props
        self.props = props
        self.dir = Path(tempfile.mkdtemp())
        self.reg = self.dir / 'reg'
        self.reg.mkdir()
        (self.reg / 'fx_stamp.py').write_text(self.FIXTURE % str(HERE))
        self.props.__path__.append(str(self.reg))
        self.props.refresh()
        self.recipe = self.props.get('fx-stamp')
        self.piece = B.bake(self.recipe, 'oblique', overrides=False)
        text, _ = B.ascii_of(self.piece)
        self.text = '\n'.join(ln for ln in text.splitlines() if not ln.startswith('# base:')) + '\n'      # a legacy header
        self.file = self.dir / 'fx-stamp.oblique.txt'
        self.file.write_text(self.text)

    def tearDown(self):
        self.props.__path__.remove(str(self.reg))
        for m in [m for m in sys.modules if m.startswith('props.fx_')]:
            del sys.modules[m]
        self.props.refresh()
        shutil.rmtree(self.dir)

    def test_it_adds_exactly_one_header_line_and_keeps_every_other_byte(self):
        status, base = B.restamp(self.file)
        self.assertEqual((status, base), ('stamped', self.piece.provenance['base_sha256']))
        old, new = self.text.splitlines(), self.file.read_text().splitlines()
        self.assertEqual([ln for ln in new if ln != f'# base: {base}'], old)
        self.assertEqual(sum(ln.startswith('# base:') for ln in new), 1)
        self.assertLess(new.index(f'# base: {base}'), new.index(next(ln for ln in new if ln.startswith('# legend:'))))
        self.assertEqual(B.bake(self.recipe, 'oblique', overrides_dir=self.dir).metrics['override']['header'], 'base')

    def test_it_is_idempotent(self):
        B.restamp(self.file)
        once = self.file.read_bytes()
        self.assertEqual(B.restamp(self.file)[0], 'unchanged')
        self.assertEqual(self.file.read_bytes(), once)

    def test_it_refuses_a_patch_that_is_already_stale_and_leaves_the_file_alone(self):
        self.file.write_text(self.text.replace(self.piece.provenance['recipe_hash'], '0' * 16))
        before = self.file.read_bytes()
        with self.assertRaises(B.StaleOverrideError):
            B.restamp(self.file)
        self.assertEqual(self.file.read_bytes(), before)
        self.file.write_text(self.text.replace('# canvas: 34', '# canvas: 33'))
        with self.assertRaises(B.StaleOverrideError):
            B.restamp(self.file)

    def test_a_different_base_needs_force(self):
        B.restamp(self.file)
        self.file.write_text(self.file.read_text().replace(self.piece.provenance['base_sha256'], '1' * 64))
        with self.assertRaises(B.StaleOverrideError):
            B.restamp(self.file)
        self.assertEqual(B.restamp(self.file, force=True)[0], 'stamped')
        self.assertIn(self.piece.provenance['base_sha256'], self.file.read_text())

    def test_the_command_restamps_a_directory_and_a_dry_run_writes_nothing(self):
        import contextlib
        import io
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = B.main(['--restamp', '--dry-run', '--overrides-dir', str(self.dir)])
        self.assertEqual((code, self.file.read_text()), (0, self.text))
        self.assertIn('would stamp', out.getvalue())
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = B.main(['--restamp', '--overrides-dir', str(self.dir)])
        self.assertEqual(code, 0, err.getvalue())
        self.assertIn(f'# base: {self.piece.provenance["base_sha256"]}', self.file.read_text())

    def test_the_command_exits_one_and_names_a_patch_it_could_not_stamp(self):
        import contextlib
        import io
        self.file.write_text(self.text.replace(self.piece.provenance['recipe_hash'], '0' * 16))
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = B.main(['--restamp', str(self.file)])
        self.assertEqual(code, 1)
        self.assertIn('NOT restamped', err.getvalue())


class Mirror(unittest.TestCase):
    def test_a_mirrored_recipe_bakes_the_mirror_image_not_a_pixel_flip_of_a_lit_picture(self):
        r = V.Recipe('asym', [V.box(0, 0, 0, 1, 1, 0.4, 'wood'), V.box(0.1, 0.2, 0.4, 0.5, 0.6, 0.9, 'ds-mint'),
                              V.sphere(0.75, 0.7, 0.55, 0.15, 'ds-turquoise')], (1, 1), anchors={'seat': (0.2, 0.4, 0.9)})
        a, b = B.bake(r, 'oblique'), B.bake(r.mirrored(), 'oblique')
        self.assertEqual(a.size, b.size)
        self.assertTrue((b.rgba == a.rgba[:, ::-1]).all())
        self.assertTrue((b.height == a.height[:, ::-1]).all())
        flipped = a.normal[:, ::-1].copy().astype(int)
        flipped[..., 0] = np.where(flipped[..., 3] > 0, 255 - flipped[..., 0], flipped[..., 0])
        self.assertLessEqual(np.abs(b.normal.astype(int) - flipped).max(), 1)
        self.assertAlmostEqual(b.anchors['seat'][0], a.size[0] - a.anchors['seat'][0], places=2)

    def test_recolouring_changes_colours_only(self):
        r = demo_crate()
        c = r.recoloured({'plank': ('#102030', '#304050', '#506070', '#708090')}, name='demo-crate-blue')
        a, b = B.bake(r, 'oblique'), B.bake(c, 'oblique')
        self.assertTrue((a.rgba[..., 3] == b.rgba[..., 3]).all())
        self.assertTrue((a.normal == b.normal).all() and (a.height == b.height).all())
        self.assertFalse((a.rgba == b.rgba).all())


class Registry(unittest.TestCase):
    FIXTURE = '''import sys
sys.path.insert(0, %(tools)r)
import volume as V

def RECIPE():
    return V.Recipe('fixture-crate', [V.box(0, 0, 0, 1, 1, 0.5, 'wood')], (1, 1))
'''

    def setUp(self):
        import props
        self.props = props
        self.dir = Path(tempfile.mkdtemp())
        (self.dir / 'fx_crate.py').write_text(self.FIXTURE % {'tools': str(HERE)})
        (self.dir / '_private.py').write_text('raise RuntimeError("never imported")\n')
        (self.dir / 'fx_broken.py').write_text('raise RuntimeError("boom")\n')
        (self.dir / 'fx_plain.py').write_text('X = 1\n')
        self.props.__path__.append(str(self.dir))
        self.props.refresh()

    def tearDown(self):
        self.props.__path__.remove(str(self.dir))
        for m in [m for m in sys.modules if m.startswith('props.fx_') or m.startswith('props._private')]:
            del sys.modules[m]
        self.props.refresh()
        shutil.rmtree(self.dir)

    def test_the_registry_finds_a_fixture_module_and_bakes_it(self):
        self.assertIn('fixture-crate', self.props.names())
        r = self.props.get('fixture-crate')
        self.assertEqual(r.footprint, (1.0, 1.0))
        self.assertEqual(B.bake(r, 'oblique').size[0], 34)
        self.assertEqual(self.props.names(), sorted(self.props.names()))
        self.assertIn('fixture-crate', self.props.all())

    def test_a_broken_module_is_reported_not_hidden_and_does_not_hide_the_others(self):
        self.assertIn('fx_broken', self.props.errors())
        self.assertIn('boom', self.props.errors()['fx_broken'])
        self.assertIn('fixture-crate', self.props.names())
        self.assertNotIn('_private', self.props.errors())
        self.assertNotIn('fx_plain', self.props.errors())              # no RECIPE: not a piece module, not an error

    def test_an_unknown_name_is_a_key_error_that_lists_the_known_ones(self):
        with self.assertRaises(KeyError) as ctx:
            self.props.get('no-such-piece')
        self.assertIn('fixture-crate', str(ctx.exception))

    def test_a_duplicate_name_is_reported(self):
        (self.dir / 'fx_crate2.py').write_text(self.FIXTURE % {'tools': str(HERE)})
        self.props.refresh()
        self.assertIn('fx_crate2', self.props.errors())
        self.assertIn('duplicate', self.props.errors()['fx_crate2'])

    def test_a_list_of_recipes_is_a_set_of_variants_and_a_bad_recipe_is_an_error(self):
        (self.dir / 'fx_variants.py').write_text(
            'import sys\nsys.path.insert(0, %r)\nimport volume as V\n'
            'base = V.Recipe("fixture-v1", [V.box(0, 0, 0, 1, 1, 0.5, "wood")], (1, 1))\n'
            'RECIPE = [base, base.recoloured({"wood": ("#102030", "#405060", "#8090A0")}, name="fixture-v2")]\n' % str(HERE))
        (self.dir / 'fx_bad.py').write_text('RECIPE = 42\n')
        self.props.refresh()
        self.assertTrue({'fixture-v1', 'fixture-v2'} <= set(self.props.names()))
        self.assertIn('fx_bad', self.props.errors())

    def test_the_real_package_scans_without_a_fixture(self):
        self.props.__path__.remove(str(self.dir))
        try:
            self.props.refresh()
            self.assertIsInstance(self.props.names(), list)
            self.assertNotIn('fixture-crate', self.props.names())
        finally:
            self.props.__path__.append(str(self.dir))


# ------------------------------------------------------------------------------------------- the command line

class CommandLine(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.src = self.dir / 'crate_piece.py'
        self.src.write_text('import sys\nsys.path.insert(0, %r)\nimport volume as V\n'
                            'RECIPE = V.Recipe("cli-crate", [V.box(0, 0, 0, 1, 1, 0.5, "wood")], (1, 1))\n' % str(HERE))

    def tearDown(self):
        shutil.rmtree(self.dir)

    def run_cli(self, *args):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = B.main([str(a) for a in args])
        return code, out.getvalue()

    def test_it_writes_the_four_files_and_a_6x_sheet(self):
        out = self.dir / 'out'
        code, text = self.run_cli(self.src, '--projection', 'camera75', '--out', out, '--sheet')
        self.assertEqual(code, 0, text)
        names = sorted(p.name for p in out.iterdir())
        self.assertEqual(names, ['cli-crate.height.png', 'cli-crate.json', 'cli-crate.normal.png', 'cli-crate.png', 'cli-crate.sheet.png'])
        data = json.loads((out / 'cli-crate.json').read_text())
        self.assertEqual(data['projection'], 'camera75')
        self.assertEqual(data['provenance']['projection'], {'name': 'camera75', 'sx': 32, 'sy': 24, 'sz': 21})
        for key in ('size', 'footprint', 'sort_line', 'depth_offset', 'foot', 'anchors', 'shift', 'bounds', 'metrics', 'provenance', 'meta'):
            self.assertIn(key, data)
        w, h = data['size']
        for name, size, mode in (('cli-crate.png', (w, h), 'RGBA'), ('cli-crate.normal.png', (w, h), 'RGBA'),
                                 ('cli-crate.height.png', (w, h), 'L'), ('cli-crate.sheet.png', (2 * (w + 64) * 6 + 12, (h + 64) * 6), 'RGBA')):
            with Image.open(out / name) as im:
                self.assertEqual((im.size, im.mode), (size, mode), name)

    def test_the_default_projection_is_the_files_default(self):
        out = self.dir / 'out'
        self.run_cli(self.src, '--out', out)
        self.assertEqual(json.loads((out / 'cli-crate.json').read_text())['projection'], 'oblique')

    def test_a_violation_exits_nonzero_but_still_writes_the_files(self):
        self.src.write_text('import sys\nsys.path.insert(0, %r)\nimport volume as V\n'
                            'RECIPE = V.Recipe("cli-float", [V.box(0, 0, 0.6, 1, 1, 1, "wood")], (1, 1))\n' % str(HERE))
        out = self.dir / 'out'
        code, text = self.run_cli(self.src, '--out', out)
        self.assertEqual(code, 1)
        self.assertIn('VIOLATION foot-gap', text)
        self.assertTrue((out / 'cli-float.png').is_file())

    def test_the_sheet_marks_the_footprint_and_the_foot(self):
        p = B.bake(unit_box(), 'oblique')
        sheet = np.asarray(p.sheet())
        w, h = p.size
        self.assertEqual(sheet.shape[1], 2 * (w + 64) * 6 + 12)
        x, y = (p.footprint['px']['x'] + 32) * 6, (p.footprint['px']['y'] + 32) * 6 + 6 * 16
        teal = np.array([2, 168, 166])
        self.assertLess(np.abs(sheet[y + 2, x - 6:x + 3, :3].astype(int) - teal).sum(1).min(), 140)   # the footprint outline


# ----------------------------------------------------------------------------------------------- the demo pieces

class DemoPieces(unittest.TestCase):
    def test_both_demonstration_pieces_are_clean_in_both_projections(self):
        for recipe in (demo_crate, demo_side_table):
            for proj in ('oblique', 'camera75'):
                p = B.bake(recipe(), proj)
                self.assertTrue(p.ok, f'{recipe.__name__} {proj}: {p.violations}')
                self.assertLessEqual(p.metrics['colours'], 16)
                self.assertLessEqual(p.metrics['foot_gap'], 1)
                self.assertGreaterEqual(p.metrics['outline_fraction'], 0.9)

    def test_the_demo_pieces_use_only_ramp_tones_and_inks(self):
        for recipe in (demo_crate(), demo_side_table()):
            table = recipe.materials_table()
            allowed = set()
            for s in recipe.solids:
                for n in s.sample(0.05).names:
                    allowed |= {V.hex_rgb(c) for c in table[n].ramp} | {V.hex_rgb(table[n].ink)}
            for proj in ('oblique', 'camera75'):
                p = B.bake(recipe, proj)
                got = {tuple(c[:3]) for c in p.rgba.reshape(-1, 4) if c[3]}
                self.assertTrue(got <= allowed, f'{recipe.name} {proj}: {got - allowed}')


def demo(out):
    out = Path(out)
    for recipe in (demo_crate, demo_side_table):
        for proj in ('oblique', 'camera75'):
            p = B.bake(recipe(), proj)
            p.write(out / proj)
            p.sheet().save(out / proj / f'{p.name}.sheet.png')
            print(f'{proj:9s} {p.name:16s} {p.size[0]}x{p.size[1]}  colours {p.metrics["colours"]}  foot gap {p.metrics["foot_gap"]}  '
                  f'outline {p.metrics["outline_fraction"]:.0%}  {p.violations or "ok"}')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--demo':
        demo(sys.argv[2])
    else:
        unittest.main(verbosity=2)
