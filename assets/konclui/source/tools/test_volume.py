"""Behaviour tests of tools/volume.py, the volume kit: materials, solids (positions and analytic normals), transforms, the
recipe and its hash. Pure geometry; nothing here rasterises (tools/test_bake.py does).
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_volume.py"""
import ast
import math
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import volume as V  # noqa: E402

STEP = 0.01


def unit(a):
    return np.abs(np.linalg.norm(a, axis=1) - 1).max()


class Materials(unittest.TestCase):
    def test_ramp_length_is_three_to_five_tones(self):
        V.Material('ok3', ('#000000', '#808080', '#FFFFFF'))
        V.Material('ok5', ('#000000', '#202020', '#808080', '#C0C0C0', '#FFFFFF'))
        for n in (1, 2, 6):
            with self.assertRaises(ValueError, msg=f'{n} tones'):
                V.Material('bad', tuple('#%02X%02X%02X' % ((i * 20,) * 3) for i in range(n)))

    def test_a_flat_material_may_have_one_tone_and_a_bad_colour_is_refused(self):
        m = V.flat_material('paint', '#F8FBFC', ink='#1E454D')
        self.assertEqual((m.ramp, m.ink, m.flat), (('#F8FBFC',), '#1E454D', True))
        with self.assertRaises(ValueError):
            V.Material('bad', ('#000000', '#808080', 'red'))

    def test_ink_defaults_to_the_darkest_tone_and_can_be_set(self):
        m = V.Material('m', ('#102030', '#405060', '#8090A0'))
        self.assertEqual(m.ink, '#102030')
        self.assertEqual(V.Material('m', m.ramp, ink='#000000').ink, '#000000')

    def test_every_catalogue_material_is_a_valid_ramp(self):
        self.assertGreaterEqual(len(V.MATERIALS), 10)
        for name, m in V.MATERIALS.items():
            self.assertTrue(3 <= len(m.ramp) <= 5, name)
            self.assertEqual(m.ink, m.ramp[0], name)

    def test_design_system_ramps_are_the_palette_ones(self):
        self.assertEqual(V.MATERIALS['ds-petrol'].ramp, ('#0F262C', '#1E454D', '#2C626C', '#3F7C86'))
        self.assertEqual(V.MATERIALS['ds-mint'].ramp, ('#0E7F66', '#00D7A1', '#53FFC8', '#B6FFE7'))
        # and they are what palette.py says, read independently of volume.py
        tree = ast.parse((HERE.parent / 'hq-office' / 'palette.py').read_text(encoding='utf-8'))
        for node in tree.body:
            if isinstance(node, ast.Assign) and getattr(node.targets[0], 'id', '') == 'FURNITURE_RAMPS':
                ramps = ast.literal_eval(node.value)
        for name in ('ds-petrol', 'ds-ink', 'ds-mint', 'ds-turquoise', 'ds-slate'):
            self.assertEqual(V.MATERIALS[name].ramp, tuple(ramps[name]))

    def test_derived_wood_is_the_floor_oak_pulled_toward_ink(self):
        oak = ('#C6AB8B', '#D5BE9F', '#E1CDB2', '#EBDDC8')
        self.assertEqual(V.MATERIALS['wood'].ramp[2:], (oak[0], oak[2]))
        self.assertEqual(V.MATERIALS['wood'].ramp[0], V.mix(oak[0], '#0A0A3D', 0.5))

    def test_mix_and_shade_ramp(self):
        self.assertEqual(V.mix('#000000', '#FFFFFF', 0.0), '#000000')
        self.assertEqual(V.mix('#000000', '#FFFFFF', 1.0), '#FFFFFF')
        self.assertEqual(V.mix('#000000', '#FFFFFF', 0.5), '#808080')
        r = V.shade_ramp(('#C6AB8B', '#D5BE9F', '#E1CDB2', '#EBDDC8'))
        self.assertEqual(len(r), 5)
        self.assertEqual(r[-1], '#EBDDC8')


class PaletteStatus(unittest.TestCase):
    """review: the derived tones are not in tools/palettes/office.hex. This pins exactly which, so a change is deliberate:
    editing a ramp, or adding the tones to palette.py and regenerating office.hex, makes this test say so."""
    OFF = {
        'wood': ['#685B64', '#9D887A'],
        'wood-warm': ['#76666B', '#B09783'],
        'walnut': ['#443B56', '#655764', '#8A7774', '#B09783'],
        'porcelain': ['#868CA4'],
        'mist': ['#838AA1'],
        'leaf': ['#08A781', '#0C4A54', '#0D6D60'],
        'soil': ['#29244A', '#483F57', '#675965'],
    }

    def test_the_office_palette_file_is_read(self):
        self.assertEqual(len(V.ON_PALETTE), 51)
        self.assertIn('#0A0A3D', V.ON_PALETTE)                                         # INK

    def test_the_off_palette_tones_are_exactly_the_listed_ones(self):
        self.assertEqual(V.off_palette(), self.OFF)

    def test_the_design_system_materials_are_fully_on_palette(self):
        on = sorted(set(V.MATERIALS) - set(self.OFF))
        self.assertEqual(on, ['ds-ink', 'ds-mint', 'ds-petrol', 'ds-slate', 'ds-turquoise'])
        for name in on:
            for tone in (*V.MATERIALS[name].ramp, V.MATERIALS[name].ink):
                self.assertIn(tone, V.ON_PALETTE, name)

    def test_off_palette_accepts_a_recipe_table_and_reports_a_new_off_palette_material(self):
        m = V.Material('odd', ('#010203', V.INK, V.PALETTE['PAPER']))
        self.assertEqual(V.off_palette({'odd': m}), {'odd': ['#010203']})


class Box(unittest.TestCase):
    def test_samples_lie_on_the_surface_with_axis_normals_and_none_on_a_bound(self):
        b = V.box(0.1, 0.2, 0.0, 0.9, 0.7, 0.5, 'wood')
        s = b.sample(STEP)
        lo, hi = np.array([0.1, 0.2, 0.0]), np.array([0.9, 0.7, 0.5])
        self.assertTrue((s.P >= lo).all() and (s.P <= hi).all())
        on_face = ((np.abs(s.P - lo) < 1e-9) | (np.abs(s.P - hi) < 1e-9)).any(1)
        self.assertTrue(on_face.all())
        self.assertLess(unit(s.N), 1e-9)
        self.assertEqual(set(map(tuple, np.abs(s.N).round(6))), {(0.0, 0.0, 1.0), (0.0, 1.0, 0.0)})   # top and south only
        # a face never samples its own edge: the next pixel over would be touched
        edge = ((s.P[:, 0] == lo[0]) | (s.P[:, 0] == hi[0])) & (np.abs(s.N[:, 2]) == 1)
        self.assertFalse(edge.any())

    def test_the_six_faces_are_sampled_when_bevelled(self):
        s = V.box(0, 0, 0, 1, 1, 1, 'wood', bevel=0.1).sample(0.02)
        self.assertTrue((s.N[:, 0] > 0.99).any() and (s.N[:, 0] < -0.99).any() and (s.N[:, 1] < -0.99).any())

    def test_bevel_is_an_exact_rounded_box(self):
        r = 0.08
        s = V.box(0, 0, 0, 1, 0.6, 0.4, 'wood', bevel=r).sample(0.01)
        inner_lo, inner_hi = np.array([r, r, r]), np.array([1 - r, 0.6 - r, 0.4 - r])
        c = np.clip(s.P, inner_lo, inner_hi)
        self.assertLess(np.abs(np.linalg.norm(s.P - c, axis=1) - r).max(), 1e-9)       # every sample is r from the inner box
        self.assertLess(np.abs((s.P - c) / r - s.N).max(), 1e-9)                         # and its normal points away from it
        self.assertTrue((s.P >= -1e-9).all() and (s.P <= [1 + 1e-9, 0.6 + 1e-9, 0.4 + 1e-9]).all())

    def test_a_bevel_larger_than_half_the_smallest_side_is_refused(self):
        with self.assertRaises(ValueError):
            V.box(0, 0, 0, 1, 1, 0.1, 'wood', bevel=0.06)
        with self.assertRaises(ValueError):
            V.box(0, 0, 0, 0, 1, 1, 'wood')

    def test_per_face_materials(self):
        s = V.box(0, 0, 0, 1, 1, 1, 'a', top='b', south='c').sample(0.05)
        name = lambda mask: {s.names[i] for i in s.mat[mask]}
        self.assertEqual(name(s.N[:, 2] > 0.5), {'b'})
        self.assertEqual(name(s.N[:, 1] > 0.5), {'c'})

    def test_decals_change_only_the_masked_part_of_their_face(self):
        d = V.Decal('top', 'paint', lambda a, b: (a > 0.25) & (a < 0.5))
        f = V.Decal('south', 'ink', lambda a, b: b < 0.1)
        s = V.box(0, 0, 0, 1, 1, 0.5, 'wood', decals=[d, f]).sample(0.01)
        paint = s.names.index('paint')
        top = s.N[:, 2] > 0.5
        masked = top & (s.P[:, 0] > 0.25) & (s.P[:, 0] < 0.5)
        self.assertTrue((s.mat[masked] == paint).all() and masked.any())
        self.assertFalse((s.mat[top & ~masked] == paint).any())
        south = s.N[:, 1] > 0.5
        self.assertTrue((s.mat[south & (0.5 - s.P[:, 2] < 0.1)] == s.names.index('ink')).all())     # b counts down from the top edge
        self.assertFalse((s.mat[south & (0.5 - s.P[:, 2] >= 0.1)] == s.names.index('ink')).any())
        with self.assertRaises(ValueError):
            V.Decal('north', 'x', lambda a, b: a > 0)

    def test_ascii_decals_paint_a_bitmap_in_metres(self):
        rows = ['#.', '.o']
        decs = V.ascii_decals('top', rows, {'#': 'dark', 'o': 'light'}, cell=0.25, origin=(0.5, 0.25))
        s = V.box(0, 0, 0, 1, 1, 0.1, 'wood', decals=decs).sample(0.01)
        top = s.N[:, 2] > 0.5

        def at(x, y):
            i = np.argmin(np.hypot(s.P[:, 0] - x, s.P[:, 1] - y) + (~top) * 9)
            return s.names[s.mat[i]]
        self.assertEqual(at(0.6, 0.35), 'dark')
        self.assertEqual(at(0.85, 0.6), 'light')
        self.assertEqual(at(0.85, 0.35), 'wood')
        self.assertEqual(at(0.2, 0.2), 'wood')


class Lathe(unittest.TestCase):
    def test_a_cylinder_has_radial_side_normals_and_vertical_cap_normals(self):
        cx, cy, R = 0.4, 0.6, 0.3
        s = V.frustum(cx, cy, 0.0, 0.5, R, R, 'wood').sample(0.01)
        rho = np.hypot(s.P[:, 0] - cx, s.P[:, 1] - cy)
        side = np.abs(s.N[:, 2]) < 1e-9
        self.assertLess(np.abs(rho[side] - R).max(), 1e-9)
        radial = np.stack([(s.P[side, 0] - cx) / R, (s.P[side, 1] - cy) / R, np.zeros(side.sum())], 1)
        self.assertLess(np.abs(radial - s.N[side]).max(), 1e-9)
        top, bottom = s.N[:, 2] > 0.999, s.N[:, 2] < -0.999
        self.assertTrue(top.any() and bottom.any())
        self.assertLess(np.abs(s.P[top, 2] - 0.5).max(), 1e-9)
        self.assertLess(np.abs(s.P[bottom, 2]).max(), 1e-9)
        self.assertEqual(side.sum() + top.sum() + bottom.sum(), len(s))

    def test_a_cone_frustum_normal_leans_up_by_the_slope(self):
        s = V.frustum(0, 0, 0.0, 1.0, 0.5, 0.25, 'wood', top=False, bottom=False).sample(0.01)
        slope = 0.25                       # radius shrinks 0.25 over a height of 1
        want = np.array([1.0, slope]) / math.hypot(1, slope)
        rho = np.hypot(s.P[:, 0], s.P[:, 1])
        nr = (s.N[:, 0] * s.P[:, 0] + s.N[:, 1] * s.P[:, 1]) / rho
        self.assertLess(np.abs(nr - want[0]).max(), 1e-9)
        self.assertLess(np.abs(s.N[:, 2] - want[1]).max(), 1e-9)

    def test_a_sphere_is_a_sphere_with_exact_outward_normals(self):
        c, R = np.array([0.5, 0.4, 0.7]), 0.35
        s = V.sphere(*c, R, 'wood').sample(0.01)
        d = s.P - c
        self.assertLess(np.abs(np.linalg.norm(d, axis=1) - R).max(), 1e-9)          # arcs are circles, not chords
        self.assertLess(np.abs(d / R - s.N).max(), 1e-9)
        self.assertLess(np.abs(s.P.max(0) - (c + R)).max(), 2e-3)

    def test_profile_normals_follow_the_right_hand_rule_and_creases_stay_hard(self):
        # a base runs outward (normal down), a side up (outward), a top inward (up); the corners are creases
        s = V.lathe([(0, 0), (0.3, 0), (0.3, 0.2), (0, 0.2)], 0, 0, 'wood').sample(0.01)
        ups = s.N[np.abs(s.N[:, 2]) > 0.5][:, 2]
        self.assertEqual(set(np.round(ups, 6)), {-1.0, 1.0})
        self.assertEqual(len(set(np.round(np.abs(s.N[:, 2]), 3))), 2)           # only 0 and 1: no smoothed corners
        s2 = V.lathe([(0, 0), (0.3, 0), (0.3, 0.2), (0, 0.2)], 0, 0, 'wood', crease_deg=179).sample(0.01)
        self.assertGreater(len(set(np.round(np.abs(s2.N[:, 2]), 2))), 5)         # a loose limit smooths them

    def test_arcs_carry_exact_normals_and_arc_deg_limits_the_sweep(self):
        pts = V.arc(0.1, 0.2, 0.05, 0, 90, 9)
        for r, z, nr, nz in pts:
            self.assertAlmostEqual(math.hypot(r - 0.1, z - 0.2), 0.05, places=9)
            self.assertAlmostEqual(math.hypot(nr, nz), 1.0, places=9)
        half = V.lathe([(0, 0), (0.3, 0), (0.3, 0.2), (0, 0.2)], 0, 0, 'wood', arc_deg=(0, 180)).sample(0.02)
        self.assertGreaterEqual(half.P[:, 1].min(), -1e-9)

    def test_per_segment_materials(self):
        s = V.lathe([(0, 0), (0.3, 0), (0.3, 0.2), (0, 0.2)], 0, 0, 'wood', mats=['a', 'b', 'c']).sample(0.02)
        self.assertEqual({s.names[i] for i in s.mat[s.N[:, 2] > 0.5]}, {'c'})
        with self.assertRaises(ValueError):
            V.lathe([(0, 0), (0.3, 0), (0.3, 0.2)], 0, 0, 'wood', mats=['a'])


class Tube(unittest.TestCase):
    def test_a_straight_tube_is_a_cylinder_around_its_path(self):
        R = 0.05
        s = V.tube([(0.1, 0.5, 0.3), (0.9, 0.5, 0.3)], R, 'wood', caps=False).sample(0.005)
        dist = np.hypot(s.P[:, 1] - 0.5, s.P[:, 2] - 0.3)
        self.assertLess(np.abs(dist - R).max(), 1e-9)
        self.assertLess(np.abs(s.N[:, 0]).max(), 1e-9)
        self.assertLess(np.abs(s.N[:, 1] * (s.P[:, 1] - 0.5) + s.N[:, 2] * (s.P[:, 2] - 0.3) - R).max(), 1e-9)
        self.assertTrue((s.P[:, 0] > 0.1).all() and (s.P[:, 0] < 0.9).all())

    def test_caps_close_the_ends_with_axial_normals(self):
        s = V.tube([(0.0, 0.0, 0.0), (0.0, 0.0, 1.0)], 0.1, 'wood', caps=True).sample(0.01)
        self.assertTrue((s.N[:, 2] > 0.99).any() and (s.N[:, 2] < -0.99).any())
        open_ = V.tube([(0.0, 0.0, 0.0), (0.0, 0.0, 1.0)], 0.1, 'wood', caps=False).sample(0.01)
        self.assertLess(np.abs(open_.N[:, 2]).max(), 1e-9)

    def test_a_tapered_tube_normal_tilts_toward_the_thin_end(self):
        s = V.tube([(0, 0, 0), (1, 0, 0)], (0.1, 0.0), 'wood', caps=False).sample(0.01)
        self.assertTrue((s.N[:, 0] > 0).all())                       # the radius falls along +x: the normal leans to +x
        self.assertLess(unit(s.N), 1e-9)

    def test_a_bezier_path_is_followed(self):
        path = V.bezier([(0, 0, 0), (0, 0, 1), (1, 0, 1), (1, 0, 0)], 64)
        self.assertEqual(path.shape, (64, 3))
        self.assertLess(np.abs(path[0]).max(), 1e-12)
        self.assertLess(np.abs(path[-1] - [1, 0, 0]).max(), 1e-12)
        self.assertAlmostEqual(path[32, 0], 0.5, delta=0.02)
        dense = V.bezier([(0, 0, 0), (0, 0, 1), (1, 0, 1), (1, 0, 0)], 1500)
        s = V.tube(dense, 0.03, 'wood', caps=False).sample(0.005)
        # every sample is 0.03 from the curve (to the dense path's resolution)
        d = np.min(np.linalg.norm(s.P[::997, None, :] - dense[None, :, :], axis=2), axis=1)
        self.assertLess(np.abs(d - 0.03).max(), 0.004)

    def test_a_bad_path_is_refused(self):
        with self.assertRaises(ValueError):
            V.tube([(0, 0, 0)], 0.1, 'wood')
        with self.assertRaises(ValueError):
            V.tube([(0, 0, 0), (0, 0, 0)], 0.1, 'wood').sample(0.01)


class Ring(unittest.TestCase):
    def test_a_ring_is_a_torus_with_exact_normals(self):
        c, R, r = (0.5, 0.4, 0.2), 0.3, 0.02
        s = V.ring(*c, R, r, 'wood').sample(0.004)
        rho = np.hypot(s.P[:, 0] - c[0], s.P[:, 1] - c[1])
        self.assertLess(np.abs(np.hypot(rho - R, s.P[:, 2] - c[2]) - r).max(), 1e-9)
        centre = np.stack([c[0] + (s.P[:, 0] - c[0]) * R / rho, c[1] + (s.P[:, 1] - c[1]) * R / rho, np.full(len(s), c[2])], 1)
        self.assertLess(np.abs((s.P - centre) / r - s.N).max(), 1e-9)

    def test_an_arc_ring_covers_only_its_sweep_and_a_fat_tube_is_refused(self):
        s = V.ring(0, 0, 0, 0.3, 0.02, 'wood', arc_deg=(0, 180)).sample(0.01)
        self.assertGreaterEqual(s.P[:, 1].min(), -1e-9)
        with self.assertRaises(ValueError):
            V.ring(0, 0, 0, 0.02, 0.05, 'wood')


class Leaf(unittest.TestCase):
    def blade(self, **kw):
        a = dict(base=(0.5, 0.5, 0.3), yaw_deg=0, pitch_deg=45, length=0.6, width=0.16, bend_deg=30, mat='leaf')
        a.update(kw)
        return V.leaf(a.pop('base'), a.pop('yaw_deg'), a.pop('pitch_deg'), a.pop('length'), a.pop('width'), a.pop('bend_deg'), a.pop('mat'), **a)

    def test_both_sides_are_emitted_with_opposite_normals_and_their_own_material(self):
        s = self.blade(under='soil').sample(0.01)
        self.assertEqual(len(s) % 2, 0)
        half = len(s) // 2
        self.assertLess(np.abs(s.P[:half] - s.P[half:]).max(), 1e-12)
        self.assertLess(np.abs(s.N[:half] + s.N[half:]).max(), 1e-9)
        self.assertEqual({s.names[i] for i in s.mat[:half]}, {'leaf'})
        self.assertEqual({s.names[i] for i in s.mat[half:]}, {'soil'})
        self.assertTrue((s.N[:half, 2] >= -1e-9).all())               # the first set is the upper side

    def test_the_blade_has_the_declared_length_width_and_a_tapered_tip(self):
        s = self.blade(pitch_deg=0, bend_deg=0, length=0.6, width=0.16).sample(0.005)
        along = s.P[:, 0] - 0.5
        self.assertAlmostEqual(along.max(), 0.6, delta=0.01)
        self.assertGreaterEqual(along.min(), -1e-9)
        self.assertLessEqual(np.ptp(s.P[:, 1]), 0.16 + 1e-6)
        self.assertAlmostEqual(np.ptp(s.P[:, 1]), 0.16, delta=0.01)
        tip = s.P[along > 0.57]
        self.assertLess(np.ptp(tip[:, 1]), 0.16 * 0.4)

    def test_bend_lowers_the_tip_and_pitch_raises_it(self):
        tip = lambda **kw: self.blade(**kw).sample(0.01).P[:, 2].max()
        self.assertGreater(tip(bend_deg=0, pitch_deg=45), tip(bend_deg=60, pitch_deg=45))
        self.assertGreater(tip(pitch_deg=70, bend_deg=0), tip(pitch_deg=20, bend_deg=0))

    def test_yaw_turns_the_blade_on_the_ground(self):
        s = self.blade(yaw_deg=90, pitch_deg=0, bend_deg=0).sample(0.01)
        self.assertAlmostEqual(s.P[:, 1].max(), 1.1, delta=0.01)
        self.assertLess(np.ptp(s.P[:, 0]), 0.17)

    def test_fold_lifts_the_edges_and_shapes_are_selectable(self):
        flat = self.blade(pitch_deg=0, bend_deg=0, fold=0.0).sample(0.01).P[:, 2]
        vee = self.blade(pitch_deg=0, bend_deg=0, fold=0.5).sample(0.01).P[:, 2]
        self.assertAlmostEqual(np.ptp(flat), 0.0, places=6)
        self.assertAlmostEqual(np.ptp(vee), 0.5 * 0.08, delta=0.004)
        for shape in ('lance', 'paddle', 'strap', lambda t: np.ones_like(t) * 0.5):
            self.assertGreater(len(self.blade(shape=shape).sample(0.02)), 0)
        with self.assertRaises(ValueError):
            self.blade(length=0)


class SoftBox(unittest.TestCase):
    def test_a_cushion_is_inside_its_box_with_unit_normals_and_a_crown(self):
        s = V.soft_box(0, 0, 0, 0.5, 0.4, 0.2, 'wood', radius=0.08, crown=0.03).sample(0.01)
        self.assertLess(unit(s.N), 1e-9)
        self.assertTrue((s.P[:, :2] >= -1e-9).all() and (s.P[:, 0] <= 0.5 + 1e-9).all() and (s.P[:, 1] <= 0.4 + 1e-9).all())
        self.assertAlmostEqual(s.P[:, 2].max(), 0.2 + 0.03, delta=0.002)
        flat = V.soft_box(0, 0, 0, 0.5, 0.4, 0.2, 'wood', radius=0.08).sample(0.01)
        self.assertAlmostEqual(flat.P[:, 2].max(), 0.2, places=6)
        # at the crown's centre the surface is level; toward the left edge it tilts that way (normal x < 0)
        left = s.P[:, 0] < 0.15
        top = s.N[:, 2] > 0.5
        self.assertLess(s.N[left & top & (s.P[:, 2] > 0.2)][:, 0].mean(), 0)

    def test_the_radius_cannot_exceed_half_the_smallest_side(self):
        with self.assertRaises(ValueError):
            V.soft_box(0, 0, 0, 1, 1, 0.1, 'wood', radius=0.08)


class Transforms(unittest.TestCase):
    def setUp(self):
        self.b = V.box(0.1, 0.2, 0.0, 0.4, 0.5, 0.3, 'wood', bevel=0.02)

    def test_moved(self):
        a, m = self.b.sample(0.02), self.b.moved(1, 2, 3).sample(0.02)
        self.assertLess(np.abs(m.P - a.P - [1, 2, 3]).max(), 1e-12)
        self.assertLess(np.abs(m.N - a.N).max(), 1e-12)
        self.assertLess(np.abs(self.b.moved(1, 0, 0).moved(0, 2, 0).sample(0.02).P - a.P - [1, 2, 0]).max(), 1e-12)

    def test_mirrored_flips_x_about_the_axis_and_the_normal_with_it(self):
        a, m = self.b.sample(0.02), self.b.mirrored_x(0.5).sample(0.02)
        self.assertLess(np.abs(m.P[:, 0] - (1.0 - a.P[:, 0])).max(), 1e-12)
        self.assertLess(np.abs(m.N[:, 0] + a.N[:, 0]).max(), 1e-12)
        self.assertLess(np.abs(m.P[:, 1:] - a.P[:, 1:]).max(), 1e-12)

    def test_rotated_a_quarter_turn_about_a_point(self):
        a, r = self.b.sample(0.02), self.b.rotated_z(90, about=(0.5, 0.5)).sample(0.02)
        # (x, y) -> about (0.5, 0.5): (0.5 - (y - 0.5), 0.5 + (x - 0.5))
        self.assertLess(np.abs(r.P[:, 0] - (1.0 - a.P[:, 1])).max(), 1e-12)
        self.assertLess(np.abs(r.P[:, 1] - a.P[:, 0]).max(), 1e-12)
        self.assertLess(np.abs(r.N[:, 0] + a.N[:, 1]).max(), 1e-12)
        self.assertLess(np.abs(r.N[:, 1] - a.N[:, 0]).max(), 1e-12)

    def test_a_plain_box_samples_every_face_once_it_is_rotated_but_not_when_moved_or_mirrored(self):
        # review: a plain box skips bottom, north, east and west, which a rotation turns toward the viewer
        plain = V.box(0.1, 0.2, 0.0, 0.4, 0.5, 0.3, 'wood')

        def faces(solid):
            n = np.round(solid.sample(0.02).N).astype(int)
            return {tuple(v) for v in n}
        four = {(0, 0, 1), (0, 1, 0)}
        self.assertEqual(faces(plain), four)                                         # top and south only
        self.assertEqual(faces(plain.moved(1, 1, 0)), four)
        self.assertEqual(faces(plain.mirrored_x(0.5)), four)
        self.assertEqual(faces(plain.rotated_z(90, about=(0.5, 0.5))),
                         {(0, 0, 1), (0, 0, -1), (0, 1, 0), (0, -1, 0), (1, 0, 0), (-1, 0, 0)})
        self.assertEqual(faces(plain.rotated_z(0)), four)                            # the identity rotation changes nothing
        self.assertEqual(len(faces(plain.rotated_z(90).moved(1, 0, 0))), 6)          # a move after a rotation keeps them
        self.assertEqual(len(faces(V.union(plain, plain.moved(1, 0, 0)).rotated_z(180))), 6)

    def test_rotated_all_faces_have_the_same_area_as_a_bevelled_all_face_box(self):
        plain = V.box(0.1, 0.2, 0.0, 0.4, 0.5, 0.3, 'wood').rotated_z(37, about=(0.3, 0.3)).sample(0.02)
        self.assertEqual(len(plain), len(V.box(0.1, 0.2, 0.0, 0.4, 0.5, 0.3, 'wood').sample(0.02, all_faces=True)))
        self.assertGreater(len(plain), len(V.box(0.1, 0.2, 0.0, 0.4, 0.5, 0.3, 'wood').sample(0.02)))

    def test_union_is_a_flat_collection(self):
        a, b = V.box(0, 0, 0, 1, 1, 1, 'wood'), V.sphere(0.5, 0.5, 0.5, 0.2, 'leaf')
        u = V.union(a, V.union(b, a))
        self.assertEqual(len(u.solids), 3)
        s = u.sample(0.02)
        self.assertEqual(len(s), 2 * len(a.sample(0.02)) + len(b.sample(0.02)))
        self.assertEqual(set(s.names), {'wood', 'leaf'})

    def test_sampling_is_deterministic(self):
        a, b = self.b.sample(0.02), self.b.sample(0.02)
        self.assertTrue((a.P == b.P).all() and (a.N == b.N).all() and (a.mat == b.mat).all())


class RecipeAndHash(unittest.TestCase):
    def recipe(self, **kw):
        a = dict(name='r', solids=[V.box(0, 0, 0, 1, 1, 0.5, 'wood')], footprint=(1, 1))
        a.update(kw)
        return V.Recipe(**a)

    def test_the_foot_anchor_defaults_to_the_front_centre(self):
        r = self.recipe(footprint=(2, 1), anchors={'seat': (0.5, 0.5, 0.45)})
        self.assertEqual(r.anchors['foot'], (1.0, 1.0, 0.0))
        self.assertEqual(r.anchors['seat'], (0.5, 0.5, 0.45))

    def test_validation(self):
        for bad in (dict(footprint=(0, 1)), dict(footprint=(1.25, 1)), dict(solids=[]), dict(colour_cap=2), dict(coverage=0.0),
                    dict(margin=0), dict(enlarge=1.3), dict(overhangs={'up': 0.1}), dict(anchors={'seat': (1, 2)}), dict(name='')):
            with self.assertRaises(ValueError, msg=str(bad)):
                self.recipe(**bad)
        self.recipe(footprint=(1.5, 0.5), enlarge=1.25, overhangs={'east': 0.3})

    def test_mirrored_flips_geometry_anchors_and_overhangs_about_the_footprint_centre(self):
        r = self.recipe(footprint=(2, 1), anchors={'seat': (0.25, 0.5, 0.45)}, overhangs={'east': 0.4})
        m = r.mirrored()
        self.assertEqual(m.anchors['seat'], (1.75, 0.5, 0.45))
        self.assertEqual(m.anchors['foot'], r.anchors['foot'])
        self.assertEqual(m.overhangs, {'west': 0.4})
        self.assertLess(np.abs(m.sample(0.05).P[:, 0] - (2 - r.sample(0.05).P[:, 0])).max(), 1e-12)

    def test_recoloured_keeps_the_geometry_and_changes_the_ramp(self):
        r = self.recipe()
        c = r.recoloured({'wood': ('#102030', '#405060', '#8090A0')}, name='r-blue')
        self.assertEqual(c.materials_table()['wood'].ramp, ('#102030', '#405060', '#8090A0'))
        self.assertEqual(r.materials_table()['wood'].ramp, V.MATERIALS['wood'].ramp)
        self.assertEqual(c.name, 'r-blue')
        self.assertTrue((c.sample(0.05).P == r.sample(0.05).P).all())

    def test_the_hash_is_stable_and_follows_geometry_materials_and_metadata(self):
        h = V.recipe_hash(self.recipe())
        self.assertEqual(h, V.recipe_hash(self.recipe()))
        self.assertEqual(len(h), 16)
        taller = self.recipe(solids=[V.box(0, 0, 0, 1, 1, 0.52, 'wood')])
        self.assertNotEqual(h, V.recipe_hash(taller))
        self.assertNotEqual(h, V.recipe_hash(self.recipe().recoloured({'wood': ('#102030', '#405060', '#8090A0')})))
        self.assertNotEqual(h, V.recipe_hash(self.recipe(anchors={'seat': (0.5, 0.5, 0.4)})))
        self.assertNotEqual(h, V.recipe_hash(self.recipe(colour_cap=12)))
        self.assertNotEqual(h, V.recipe_hash(self.recipe(solids=[V.box(0, 0, 0, 1, 1, 0.5, 'wood').moved(0.0, 0.0, 0.01)])))


if __name__ == '__main__':
    unittest.main(verbosity=2)
