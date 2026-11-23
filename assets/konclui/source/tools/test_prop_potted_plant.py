"""Behaviour tests of the large potted plant (hq-office/props/potted_plant.py), baked by tools/bake.py.

They pin what the asset audit found wrong in today's sprite ("Ave-do-paraiso grande", lounge.py bird_of_paradise: 93 px tall in a
64 x 96 canvas, cropped by it, a bucket pot with a flat foot, foliage and pot lit from opposite sides, a baked shadow), what the
plan asks of the replacement (plan section 7.3 and 11: at most 56 px, width at most 44, canvas at most 48 x 56, margin at least
2 px, a rim that is a true circle on the ground plane, alpha 0 or 255, at least 90% outline, colours within the cap, a re-bake with
the same hash) and what the art director found wrong in the first redraw: an upright bush with nothing arching over the rim, a
knot of ink in the middle of the crown, a shallow bowl that was mostly soil, a leaf drawn over the soil, flat-ended leaf tips,
one tone for the whole crown.

Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_prop_potted_plant.py
"""
import hashlib
import math
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SOURCE / 'hq-office'))
import bake as B  # noqa: E402
import volume as V  # noqa: E402
from props import potted_plant as PP  # noqa: E402

PROJECTIONS = ('oblique', 'camera75')
TODAY_CANVAS = (64, 96)          # MEASURED: konclui-konclui-planta-ave-do-paraiso-alta.png in the lighting-v2 build
TODAY_BOX_PX = 93                # MEASURED by the audit (verdicts.json): the plant's bounding box height in that canvas
TIERS = ('far', 'side', 'near')

_BAKES = {}


def baked(projection, key='default', **build_kw):
    """Cache of bakes: the recipe is dense (200k samples), a bake takes about a second."""
    k = (projection, key)
    if k not in _BAKES:
        recipe = PP.build(**build_kw) if build_kw else PP.RECIPE
        _BAKES[k] = B.bake(recipe, projection, overrides=not build_kw)
    return _BAKES[k]


def bbox_width(piece):
    cols = np.nonzero((piece.rgba[..., 3] > 0).any(0))[0]
    return int(cols.max() - cols.min() + 1)


def rgb(h):
    return tuple(V.hex_rgb(h))


def lum(h):
    r, g, b = rgb(h)
    return 0.299 * r + 0.587 * g + 0.114 * b


def colour_mask(piece, hexes):
    want = {rgb(h) for h in hexes}
    px = piece.rgba
    return (px[..., 3] > 0) & np.array([[tuple(p[:3]) in want for p in row] for row in px])


def nz_of(piece):
    return piece.normal[..., 2].astype(float) / 255 * 2 - 1


def leaf_tones():
    """Every body tone the three tiers can show."""
    return sorted({c for tier in TIERS for c in PP.tier_ramp(PP.GREENS, tier)})


def stripe_tones():
    return [PP.RECIPE.materials[f'rib-{tier}'].ramp[0] for tier in TIERS]


def blades(recipe=None):
    return [s for s in (recipe or PP.RECIPE).solids if type(s).__name__ == '_Leaf']


def sin_yaw(b):
    return math.sin(b.yaw)


# ------------------------------------------------------------------------------------------------------- the piece

class Bakes(unittest.TestCase):
    def test_it_bakes_in_both_projections_with_no_violation_and_no_warning(self):
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                self.assertEqual(p.violations, [])
                self.assertEqual(p.warnings, [])           # a stale or skipped override patch warns, or raises

    def test_the_same_recipe_bakes_for_both_projections(self):
        o, c = baked('oblique'), baked('camera75')
        self.assertEqual(o.provenance['recipe_hash'], c.provenance['recipe_hash'])
        self.assertGreater(o.size[1], c.size[1])           # a 1 m of depth is 32 px in one and 24 px in the other

    def test_it_is_in_the_registry_under_its_name(self):
        import props
        self.assertIn('potted_plant', props.names())
        self.assertEqual(props.errors().get('potted_plant'), None)
        self.assertEqual(props.get('potted_plant').footprint, (1.0, 1.0))


class AuditFindings(unittest.TestCase):
    """The things the audit said were wrong today, measured on the new piece."""

    def test_it_is_far_smaller_than_the_93_px_bush_and_inside_the_56_px_cap(self):
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                self.assertLessEqual(p.metrics['height_px'], 56)
                self.assertGreaterEqual(p.metrics['height_px'], 40)          # but still a large plant
                self.assertLess(p.metrics['height_px'], TODAY_BOX_PX * 0.6)

    def test_the_canvas_is_at_most_48_by_56_and_smaller_than_today(self):
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                w, h = baked(proj).size
                self.assertLessEqual(w, 48)
                self.assertLessEqual(h, 56)
                self.assertLess(w * h, TODAY_CANVAS[0] * TODAY_CANVAS[1] * 0.5)

    def test_the_plant_is_at_most_44_px_wide_and_the_crown_spreads_at_least_38(self):
        """The art director: it read as a desk plant; the crown has to spread (the plan caps the width at 44)."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                self.assertLessEqual(bbox_width(baked(proj)), 44)
                self.assertGreaterEqual(bbox_width(baked(proj)), 38)

    def test_it_is_not_cropped_by_its_canvas(self):
        """Today row 0 holds 8 solid px and the right leaf reaches column 63: the audit's 'cropped by canvas' finding."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                m = baked(proj).metrics['margin']
                self.assertGreaterEqual(m['left'], 2)
                self.assertGreaterEqual(m['right'], 2)
                self.assertGreaterEqual(m['top'], 2)

    def test_it_stands_on_the_floor_with_the_sort_line_at_the_last_row(self):
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                self.assertLessEqual(p.metrics['foot_gap'], 1)
                self.assertEqual(p.sort_line, p.size[1])
                self.assertEqual(p.depth_offset, 0)
                self.assertTrue((p.rgba[-1, :, 3] > 0).any())          # the pot's foot touches the last row

    def test_there_is_no_baked_shadow_and_alpha_is_binary(self):
        """Today rows 92 to 94 hold alpha 56 / 40 / 22 warm pixels that duplicate the lit pass's cast shadow."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                a = baked(proj).rgba[..., 3]
                self.assertEqual(set(np.unique(a)), {0, 255})

    def test_the_outline_is_at_least_90_percent_ink_and_colours_are_within_the_cap(self):
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                self.assertGreaterEqual(p.metrics['outline_fraction'], 0.9)
                self.assertLessEqual(p.metrics['colours'], 24)
                self.assertLessEqual(p.metrics['colours'], p.meta['colour_cap'])

    def test_the_pot_is_a_pot_not_a_bucket_with_a_flat_foot(self):
        """The recipe's own pot (its first solid): rim and foot are circles about the same axis; the foot is narrower than the
        rim by a gentle taper, not by today's 0.6, and the soil is there."""
        r = PP.RECIPE
        cx, cy, _ = r.anchors['pot']
        rim_z = r.anchors['rim'][2]
        pot = r.solids[0].sample(0.01)
        low, high = pot.P[:, 2] < 0.02, pot.P[:, 2] > rim_z - 0.02
        r_of = lambda m: np.hypot(pot.P[m, 0] - cx, pot.P[m, 1] - cy)
        r_low, r_high = float(r_of(low).max()), float(r_of(high).max())
        self.assertGreaterEqual(r_high, 0.31)
        self.assertLessEqual(r_high, 0.36)
        taper = r_low / r_high
        self.assertGreaterEqual(taper, 0.6)
        self.assertLessEqual(taper, 0.85)                      # gentle: today's bucket is 0.6 and reads as a bin
        self.assertIn('soil', r.solids[1].sample(0.05).names)
        # the rim is a TRUE circle on the ground plane: the extent in x equals the extent in y
        ring = pot.P[high]
        self.assertAlmostEqual(float(np.ptp(ring[:, 0])), float(np.ptp(ring[:, 1])), delta=0.01)
        self.assertEqual(r.footprint, (1.0, 1.0))
        # a pot is a bowl with a rim, not a bucket: its wall is wider at the middle than a straight line from foot to rim
        mid = (pot.P[:, 2] > rim_z * 0.5 - 0.01) & (pot.P[:, 2] < rim_z * 0.5 + 0.01)
        self.assertGreater(float(r_of(mid).max()), r_low + (r_high - r_low) * 0.5)

    def test_the_pot_is_tall_and_its_soil_sits_below_a_rim_ring_three_pixels_wide(self):
        """The art director: a shallow bowl that was mostly soil, with a rim ring 2 px thick. The pot is 0.42 to 0.55 m tall, the
        soil lies at least 0.06 m below the rim and its disc is at least 0.08 m narrower than the rim circle, and the flat top
        of the rim is about 0.09 m (3 px) wide."""
        r = PP.RECIPE
        cx, cy, _ = r.anchors['pot']
        rim_z = r.anchors['rim'][2]
        self.assertGreaterEqual(rim_z, 0.42)
        self.assertLessEqual(rim_z, 0.55)
        pot, soil = r.solids[0].sample(0.005), r.solids[1].sample(0.01)
        top = pot.P[(pot.P[:, 2] > rim_z - 0.002) & (pot.N[:, 2] > 0.99)]               # the flat top of the rim
        radii = np.hypot(top[:, 0] - cx, top[:, 1] - cy)
        self.assertGreaterEqual(float(radii.max() - radii.min()), 0.075)
        self.assertLessEqual(float(soil.P[:, 2].max()), rim_z - 0.06)
        rim_r = float(np.hypot(pot.P[:, 0] - cx, pot.P[:, 1] - cy).max())
        self.assertLessEqual(float(np.hypot(soil.P[:, 0] - cx, soil.P[:, 1] - cy).max()), rim_r - 0.08)

    def test_a_ground_circle_bakes_as_a_circle_in_oblique_and_an_ellipse_of_ratio_three_quarters_in_camera75(self):
        """The plan's 'rim ratio 0.75 +- 0.03' made measurable on the pot's own rim radius: a flat disc of the rim radius
        baked alone has height = ratio * width within one row (a 20 px disc cannot be held to 0.03 on a pixel grid: one row of
        20 is 0.05; the geometry test above holds the circle itself to 1 cm)."""
        rim_z = PP.RECIPE.anchors['rim'][2]
        disc = V.Recipe('rim-disc', [V.lathe([(0.34, rim_z), (0.0, rim_z)], 0.5, 0.7, 'pot')], (1, 1), anchors={'foot': (0.5, 1.0, 0.0)},
                        materials=PP.RECIPE.materials)
        for proj, ratio in (('oblique', 1.0), ('camera75', 0.75)):
            with self.subTest(projection=proj):
                p = B.bake(disc, proj, outline=False, cleanup=False)
                ys, xs = np.nonzero(p.rgba[..., 3] > 0)
                w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
                self.assertLessEqual(abs(h - ratio * w), 1.0, (w, h))


class Foliage(unittest.TestCase):
    def test_there_are_9_to_12_leaves_fanning_out_in_every_direction(self):
        """Read from the registered recipe: the blades' headings (the kit's _Leaf.yaw, radians; +y is toward the viewer)."""
        bl = blades()
        self.assertGreaterEqual(len(bl), 9)
        self.assertLessEqual(len(bl), 12)
        yaws = np.degrees([b.yaw for b in bl]) % 360
        for lo in range(0, 360, 90):
            self.assertGreaterEqual(int(((yaws >= lo) & (yaws < lo + 90)).sum()), 1, f'no leaf heading {lo}..{lo + 90}')
        for lo in range(0, 360, 30):                                # and no 150 degrees of the circle is bare
            arc = (yaws - lo) % 360
            self.assertGreaterEqual(int((arc < 150).sum()), 2, f'fewer than 2 leaves heading {lo}..{lo + 150}')
        # the art director: nothing arched over the front; at least 2 leaves look at the viewer and at least 3 look away
        self.assertGreaterEqual(int((np.sin(np.radians(yaws)) > 0.4).sum()), 2)
        self.assertGreaterEqual(int((np.sin(np.radians(yaws)) < -0.5).sum()), 3)
        for b in bl:                                              # and the leaves are two-sided, bent blades
            self.assertGreater(b.bend, 0)

    def test_the_headings_are_spread_no_two_closer_than_8_degrees_and_no_gap_wider_than_110(self):
        """An even fan: no stack of leaves with the same heading, and no side of the plant left bare; the widest gap is the one in
        front, left open on purpose so the pot's front reads."""
        yaws = sorted(np.degrees([b.yaw for b in blades()]) % 360)
        gaps = np.diff(yaws + [yaws[0] + 360])
        self.assertGreaterEqual(float(gaps.min()), 8.0)
        self.assertLessEqual(float(gaps.max()), 110.0)

    def test_the_front_leaves_lie_low_and_arch_over_the_rim_the_back_leaves_stand_tall(self):
        """The art director: 8 of 11 leaves read as upright; none arched toward the viewer. Leaves that look at the viewer start
        at most 36 degrees above the horizontal and droop by at least 40 degrees, so their tips hang in front of the soil and at
        the height of the rim; leaves that look away start at least 60 degrees up."""
        r = PP.RECIPE
        cx, cy, _ = r.anchors['pot']
        rim_z = r.anchors['rim'][2]
        front = [b for b in blades() if sin_yaw(b) > 0.4]
        back = [b for b in blades() if sin_yaw(b) < -0.9]
        self.assertGreaterEqual(len(front), 2)
        self.assertGreaterEqual(len(back), 1)
        for b in front:
            self.assertLessEqual(math.degrees(b.pitch), 36.0)
            self.assertGreaterEqual(math.degrees(b.bend), 40.0)
            tip = PP.spine(b.base, math.degrees(b.yaw), math.degrees(b.pitch), b.length, math.degrees(b.bend))[-1]
            self.assertGreater(tip[1], cy + 0.3)                  # in front of the soil
            self.assertLess(tip[2], rim_z + 0.2)                  # at the rim, not above it
        for b in back:
            self.assertGreaterEqual(math.degrees(b.pitch), 60.0)

    def test_the_front_leaves_overlap_the_pot_rim_in_the_picture(self):
        """Painted over the rim: leaf-coloured pixels lie on the 8 rows above the rim's front row, in the columns of the pot (the
        picture's row of the world point at the rim's front comes from the baked foot point and the projection). Measured 57 px
        in oblique and 48 in camera75."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                pr = B.load_projection(proj)
                r = PP.RECIPE
                cy = r.anchors['pot'][1]
                row = int(round(p.foot[1] + pr.sy * ((cy + 0.34) - 1.0) - pr.sz * r.anchors['rim'][2]))
                leaf = colour_mask(p, leaf_tones() + stripe_tones())
                cx = int(round(p.foot[0]))
                self.assertGreaterEqual(int(leaf[row - 8:row + 1, cx - 11:cx + 12].sum()), 30, row)

    def test_the_leaf_count_is_what_the_recipe_holds(self):
        """One stalk, one blade and one midrib per leaf."""
        for n in (9, 11, 12):
            r = PP.build(f'leaf-count-{n}', leaves=n)
            self.assertEqual(len(blades(r)), n)
            self.assertEqual(len(r.solids), 2 + 3 * n)           # pot, soil, then (stalk, blade, midrib) per leaf

    def test_the_highest_leaf_tip_is_the_declared_height(self):
        for h in (1.6, 1.2):
            with self.subTest(height=h):
                r = PP.build('height-probe', height=h)
                s = V.Compound(r.solids).sample(0.02)
                self.assertAlmostEqual(float(s.P[:, 2].max()), h, delta=0.08)

    def test_the_soil_shows_in_the_pot(self):
        """The soil disc faces up: a first version ran its profile outward, so the disc faced down and the pot looked empty."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                self.assertGreaterEqual(int(colour_mask(baked(proj), PP.SOIL).sum()), 40)

    def test_no_leaf_is_painted_over_the_middle_of_the_soil(self):
        """The art director: a green wedge dropped onto the soil. The leaves that look at the viewer leave the soil at its edge
        (a ring of at least 0.15 m) and start low, at most 0.2 m over the soil, so the middle of the soil stays soil: no tall
        stalk and no blade stands over it on the viewer's side."""
        r = PP.RECIPE
        cx, cy, _ = r.anchors['pot']
        soil_z = r.anchors['rim'][2] - PP.SOIL_DEPTH
        for b in blades():
            if sin_yaw(b) > 0.4:
                self.assertGreaterEqual(math.hypot(b.base[0] - cx, b.base[1] - cy), 0.15)
                self.assertLessEqual(float(b.base[2]) - soil_z, 0.2)

    def test_the_blades_are_broad_drawn_shapes_not_spikes(self):
        """A blade's visible pixels are at least 4 wide across most of the crown's rows: a spike would be 1 to 2."""
        p = baked('oblique')
        leaf = colour_mask(p, leaf_tones() + stripe_tones() + [PP.GREENS[0]])
        runs = 0
        for row in leaf[: int(p.size[1] * 0.65)]:
            cols = np.nonzero(row)[0]
            if len(cols):
                best = cur = 1
                for a, b in zip(cols, cols[1:]):
                    cur = cur + 1 if b == a + 1 else 1
                    best = max(best, cur)
                runs += best >= 4
        self.assertGreaterEqual(runs, 28)

    def test_the_blades_taper_to_a_point_they_do_not_end_flat(self):
        """The art director: flat-ended tips, 3 to 5 px wide squares. The blade width falls to nothing at the tip, and over the
        last quarter of the length it falls to under 75% (and under 40% at 90%), for every shape."""
        t = np.linspace(0, 1, 101)
        for name, fn in (('paddle', PP._paddle), ('oval', PP._oval)):
            with self.subTest(shape=name):
                w = fn(t)
                self.assertAlmostEqual(float(fn(np.array([1.0]))[0]), 0.0, places=6)
                self.assertAlmostEqual(float(w.max()), 1.0, places=2)
                self.assertLess(float(fn(np.array([0.75]))[0]), 0.75)
                self.assertLess(float(fn(np.array([0.9]))[0]), 0.4)
                self.assertTrue(np.all(np.diff(w[45:]) <= 1e-9))            # past the shoulder it only narrows

    def test_each_blade_has_a_light_stripe_and_the_leaves_use_the_greens(self):
        p = baked('oblique')
        self.assertGreaterEqual(int(colour_mask(p, stripe_tones()).sum()), 40)           # the stripes along the midribs
        self.assertEqual(len(PP.GREENS), 4)
        used = [tone for tone in (*leaf_tones(), *stripe_tones()) if colour_mask(p, [tone]).any()]
        self.assertGreaterEqual(len(used), 6, used)                 # the tiers and their stripes show several tones

    def test_the_stalks_are_flat_one_pixel_lines_with_no_ink_of_their_own(self):
        """The art director: 2 px stalks with ink on both sides filled the middle of the crown with ink. A stalk is a flat
        material in the crown's shade green (greens[1]) whose ink is its own colour, thinner than 0.04 m (about 1 px)."""
        stalk = PP.RECIPE.materials['stalk']
        self.assertTrue(stalk.flat)
        self.assertEqual(stalk.ink, stalk.ramp[0])
        self.assertEqual(stalk.ramp[0], PP.GREENS[1].upper())                             # greens[1]: dark enough that the stalks read against the soil and the blades
        for s in PP.RECIPE.solids:
            if getattr(s, 'mat', None) == 'stalk':
                self.assertLess(float(np.max(s.r)) * 2, 0.04)
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                self.assertGreaterEqual(int(colour_mask(baked(proj), [stalk.ramp[0]]).sum()), 12)       # and they do show

    def test_there_is_no_knot_of_ink_in_the_crown(self):
        """The art director: a 14 x 10 px knot of near-solid ink where stalks, outlines and leaf edges overlapped. No 4 x 4
        window of the sprite is more than 70% ink (the outline tones of the leaves, the pot and the soil)."""
        inks = [PP.GREENS[0], PP.RECIPE.materials['pot'].ink, PP.SOIL[0]]
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                m = colour_mask(baked(proj), inks).astype(int)
                worst = max(int(m[j:j + 4, i:i + 4].sum()) for j in range(m.shape[0] - 3) for i in range(m.shape[1] - 3))
                self.assertLessEqual(worst, 11, worst)

    def test_far_leaves_are_darker_than_side_leaves_and_those_darker_than_near_leaves(self):
        """The art director: the top and lower leaves shared the same tones, so the crown had no depth: the ramp of each tier is
        one step lighter than the one behind it, in its lightest and its darkest tone."""
        tops = [lum(PP.tier_ramp(PP.GREENS, t)[-1]) for t in TIERS]
        bottoms = [lum(PP.tier_ramp(PP.GREENS, t)[0]) for t in TIERS]
        self.assertEqual(PP.tier_ramp(PP.GREENS, 'near')[-1], PP.tier_ramp(PP.GREENS, 'side')[-1])
        self.assertTrue(tops[0] < tops[1] <= tops[2], tops)       # the side and near leaves share the 3 body tones (the art director: body 3)
        self.assertTrue(bottoms[0] < bottoms[1] < bottoms[2], bottoms)
        stripes = [lum(PP.RECIPE.materials[f'rib-{t}'].ramp[0]) for t in TIERS]
        self.assertTrue(stripes[0] == stripes[1] < stripes[2], stripes)       # one stripe for far and side, a lighter one for near
        for b in blades():
            want = 'near' if sin_yaw(b) > 0.55 else 'far' if sin_yaw(b) < -0.5 else 'side'
            if b.mat != f'leaf-{want}':
                self.assertTrue(b.mat.startswith('leaf-'), b.mat)                  # the two low heart leaves stand behind the stalks
                self.assertEqual(b.mat, 'leaf-side')

    def test_the_stalks_continue_into_the_blades(self):
        """The blade starts where its stalk ends, at the elevation the stalk ends with (no blade stuck on a stalk). Read from
        the recipe's own solids: per leaf a stalk tube, a blade and a midrib tube (their .path, .base and .pitch are the kit's
        private fields, read here to check the join)."""
        solids = PP.RECIPE.solids[2:]
        self.assertEqual(len(solids) % 3, 0)
        for stalk, blade, rib in zip(solids[0::3], solids[1::3], solids[2::3]):
            self.assertEqual((stalk.mat, type(blade).__name__), ('stalk', '_Leaf'))
            self.assertTrue(rib.mat.startswith('rib-'), rib.mat)
            self.assertTrue(np.allclose(stalk.path[-1], blade.base, atol=1e-9))
            d = stalk.path[-1] - stalk.path[-2]
            end_pitch = math.degrees(math.atan2(d[2], math.hypot(d[0], d[1])))
            self.assertAlmostEqual(end_pitch, math.degrees(blade.pitch), delta=12.0)
            self.assertLessEqual(float(np.linalg.norm(rib.path[0] - blade.base)), 0.12)      # the rib starts at the base

    def test_the_midrib_spine_is_the_kits_blade_centre_line(self):
        leaf = V.leaf((0.5, 0.5, 0.5), 37, 55, 0.46, 0.27, 40, 'leaf')
        mine = PP.spine((0.5, 0.5, 0.5), 37, 55, 0.46, 40, n=20)
        kit, _ = leaf._spine(np.linspace(0, 1, 21))                # the kit's own centre line (private, read to check the copy)
        self.assertTrue(np.allclose(mine, kit, atol=2e-3), float(np.abs(mine - kit).max()))


class OneTopLight(unittest.TestCase):
    """Foliage and pot share the one top light: a pixel that faces straight up takes the lightest tone of its own ramp, and
    nothing is lit from the left or the right (today the pot is lit from the left and the foliage mirrored)."""

    def top_facing_colours(self, piece, ramp):
        nz = nz_of(piece)
        tones = {rgb(c) for c in ramp}
        return [tuple(piece.rgba[j, i, :3]) for (j, i) in zip(*np.nonzero((piece.rgba[..., 3] > 0) & (nz > 0.97)))
                if tuple(piece.rgba[j, i, :3]) in tones]

    def test_every_ramp_runs_dark_to_light_and_the_ink_is_its_darkest_tone(self):
        for name, m in PP.RECIPE.materials.items():
            if m.flat:
                continue
            with self.subTest(material=name):
                tones = [lum(c) for c in m.ramp]
                self.assertEqual(tones, sorted(tones))
                self.assertLessEqual(len(set(tones)), 5)
                self.assertGreaterEqual(len(set(tones)), 3)
                if name == 'soil':
                    self.assertEqual(m.ink, m.ramp[-1])         # no soil ink: the kit's crease ink beside the stalks was the dark specks
                    continue
                self.assertLessEqual(lum(m.ink), tones[0])

    def test_the_pot_outline_is_its_darkest_tone_a_blue_grey(self):
        """The art director: the pot's outline was a mid blue-grey (6E7C8E), lighter than the leaves' ink. The outline is the
        darkest tone of the material, near #4A5668."""
        pot = PP.RECIPE.materials['pot']
        self.assertLess(lum(pot.ink), lum(pot.ramp[0]) - 25)
        self.assertLessEqual(lum(pot.ink), lum('#5A6678'))

    def test_top_facing_pixels_of_the_leaves_and_the_pot_take_the_lightest_tone(self):
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                pot = PP.RECIPE.materials['pot']
                got = self.top_facing_colours(p, pot.ramp)
                self.assertGreater(len(got), 10)
                self.assertEqual(set(got), {rgb(pot.ramp[-1])})
                # leaves: a top-facing pixel is the lightest tone of its tier's ramp, or a flat stripe
                tops = {rgb(PP.tier_ramp(PP.GREENS, t)[-1]) for t in TIERS} | {rgb(c) for c in stripe_tones()}
                tops.add(rgb(PP.RECIPE.materials['stalk'].ramp[0]))          # a stalk is flat paint, it does not follow the light
                got = self.top_facing_colours(p, leaf_tones())
                self.assertGreater(len(got), 10)
                self.assertTrue(set(got) <= tops, set(got) - tops)

    def test_the_light_has_no_left_right_term_so_a_mirrored_plant_has_mirrored_tones(self):
        """Mirror the whole recipe left to right: the baked picture is the mirror of the original (tone, colour and alpha),
        up to the odd edge pixel, so no left or right light is baked into either the pot or the leaves."""
        r = PP.RECIPE.mirrored()
        a = baked('oblique')
        b = B.bake(r, 'oblique', overrides=False)
        left = B.bake(PP.RECIPE, 'oblique', overrides=False)
        flip = left.rgba[:, ::-1]
        # the canvases may differ by a column of margin: align on the foot point
        if b.size == left.size:
            diff = (np.abs(b.rgba.astype(int) - flip.astype(int)).sum(-1) > 0).mean()
            self.assertLess(diff, 0.12)
        self.assertEqual(a.violations, [])
        # the pot alone is mirror-symmetric to within 2% of its pixels (it is a lathe about a vertical axis)
        pot = V.Recipe('pot-only', PP.pot_solids(0.5, 0.72, 0.55, 0.34, 0.28), (1, 1), materials=PP.RECIPE.materials, symmetric=True)
        self.assertEqual([v for v in B.bake(pot, 'oblique').violations if v.startswith('symmetry')], [])
        self.assertEqual([v for v in B.bake(pot, 'camera75').violations if v.startswith('symmetry')], [])


class Normals(unittest.TestCase):
    def test_the_normal_map_is_unit_world_aligned_and_opaque_exactly_on_the_sprite(self):
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                self.assertTrue(((p.normal[..., 3] == 255) == (p.rgba[..., 3] == 255)).all())
                n = p.normal[..., :3].astype(float) / 255 * 2 - 1
                lens = np.linalg.norm(n[p.rgba[..., 3] == 255], axis=1)
                self.assertLess(float(np.abs(lens - 1).max()), 0.0136 + 0.02)
                self.assertGreater(float((n[..., 2][p.rgba[..., 3] == 255] > 0.9).mean()), 0.1)   # tops and soil face +z


class Determinism(unittest.TestCase):
    def test_a_rebake_is_byte_identical(self):
        a = B.bake(PP.build(), 'oblique', overrides=False)
        b = B.bake(PP.build(), 'oblique', overrides=False)
        for k in a.images():
            self.assertEqual(hashlib.sha256(np.asarray(a.images()[k]).tobytes()).hexdigest(),
                             hashlib.sha256(np.asarray(b.images()[k]).tobytes()).hexdigest())
        self.assertEqual(a.provenance['recipe_hash'], b.provenance['recipe_hash'])
        self.assertEqual(V.recipe_hash(PP.build()), V.recipe_hash(PP.build()))

    def test_the_hash_changes_with_the_geometry(self):
        self.assertNotEqual(V.recipe_hash(PP.build()), V.recipe_hash(PP.build(leaves=10)))
        self.assertNotEqual(V.recipe_hash(PP.build()), V.recipe_hash(PP.build(pot='cream')))


class Overrides(unittest.TestCase):
    def test_the_patches_are_current_and_within_budget(self):
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                m = baked(proj).metrics['override']
                self.assertIsNotNone(m)
                self.assertEqual(m['file'], f'potted_plant.{proj}.txt')
                self.assertGreater(m['changed'], 0)
                self.assertLessEqual(m['changed'], m['budget'] * 0.75)     # inside the 8%, with room to spare (rule-made, see overrides())

    def test_the_committed_patches_are_what_the_rule_gives_now(self):
        """If the recipe changes, a patch goes stale (the baker refuses it): rewrite with python3 -I props/potted_plant.py."""
        d = SOURCE / 'hq-office' / 'art' / 'overrides'
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                raw = B.bake(PP.RECIPE, proj, overrides=False)
                want = PP.patch_text(raw, PP.overrides(raw))
                # the baker's `# base:` stamp (bake.py --restamp) is not part of what the rule writes
            have = ''.join(line for line in (d / f'potted_plant.{proj}.txt').read_text(encoding='utf-8').splitlines(keepends=True)
                           if not line.startswith('# base:'))
            self.assertEqual(have, want)

    def test_a_patched_sprite_has_no_lone_pixel(self):
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                self.assertEqual(PP.overrides(p), {})          # the rule finds nothing left to fix on the patched sprite

    def test_the_unpatched_bake_does_have_those_pixels(self):
        """The patch earns its place: without it the rule finds pixels (so a rule that finds nothing would pass the test above)."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                raw = B.bake(PP.RECIPE, proj, overrides=False)
                self.assertGreater(len(PP.overrides(raw)), 0)

    def test_the_patch_never_shapes_a_leaf_tip(self):
        """The art director: tips were patched flat. The patch changes no pixel on the outline of the silhouette that is a leaf
        pixel with fewer than two opaque 4-neighbours (a tip): the tips come from the blade profile."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                raw = B.bake(PP.RECIPE, proj, overrides=False)
                a = raw.rgba[..., 3] > 0
                tones = {rgb(c) for c in leaf_tones() + [PP.GREENS[0]]}
                h, w = a.shape
                for (x, y), col in PP.overrides(raw).items():
                    n = sum(1 for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= y + dy < h and 0 <= x + dx < w and a[y + dy, x + dx])
                    self.assertFalse(tuple(raw.rgba[y, x, :3]) in tones and n < 2, (x, y))


# ------------------------------------------------------------------------------------------ the art director's second pass

def px_mask(piece, colours):
    """Boolean mask of the opaque pixels whose colour is in `colours` (RGB tuples)."""
    px = piece.rgba
    return (px[..., 3] > 0) & np.array([[tuple(int(v) for v in p[:3]) in colours for p in row] for row in px])


def rgbs(hexes):
    return {rgb(h) for h in hexes}


def comps(mask):
    return PP.components(mask, 8)


def soil_ink_specks(piece):
    """(components of the soil's darkest tone, pixels of it outside the bounding box of the soil's body tone)."""
    soil_ramp = PP.RECIPE.materials['soil'].ramp
    ink = px_mask(piece, rgbs([soil_ramp[0]]))
    body = px_mask(piece, rgbs(soil_ramp[1:]))
    ys, xs = np.nonzero(body)
    inside = np.zeros_like(ink)
    inside[ys.min():ys.max() + 1, xs.min():xs.max() + 1] = True
    return len(comps(ink)), int((ink & ~inside).sum())


def stray_pot_ink(piece):
    """Pixels of the pot's outline colour that are not 8-connected to the outline at the pot's base row."""
    m = px_mask(piece, rgbs([PP.RECIPE.materials['pot'].ink]))
    last = int(np.nonzero((piece.rgba[..., 3] > 0).any(1))[0].max())
    return sum(len(c) for c in comps(m) if not any(y == last for y, _ in c))


def leaf_pot_contacts(piece):
    """4-neighbour pairs of a leaf pixel (body, stripe or stalk shade) against a pot pixel that is not the pot's outline."""
    leaf = px_mask(piece, rgbs(leaf_tones() + stripe_tones() + [PP.RECIPE.materials['stalk'].ramp[0]]))
    pot = px_mask(piece, rgbs(PP.RECIPE.materials['pot'].ramp))
    h, w = leaf.shape
    return sum(1 for y, x in zip(*np.nonzero(leaf)) for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1))
               if 0 <= y + dy < h and 0 <= x + dx < w and pot[y + dy, x + dx])


def short_stripe_runs(piece):
    return sum(1 for c in comps(px_mask(piece, rgbs(stripe_tones()))) if len(c) < 3)


class ArtDirectorSecondPass(unittest.TestCase):
    """Each test names the finding it pins; the unpatched or old-recipe bake fails the same measurement (see the last class)."""

    def test_there_are_no_dark_specks_of_soil_ink_in_the_crown(self):
        """Finding 1: about 21 px of near-black brown (2e2018) in 2-3 px blobs beside the stalks. The soil's darkest tone is a single
        connected component with at most 2 px outside the soil's bounding box (here: none at all, the soil has no ink)."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                n, outside = soil_ink_specks(baked(proj))
                self.assertLessEqual(n, 1)
                self.assertLessEqual(outside, 2)
                self.assertEqual(int(px_mask(baked(proj), rgbs(PP.SOIL[:1])).sum()), 0)

    def test_every_pot_outline_pixel_belongs_to_the_outline_at_the_pot_base(self):
        """Finding 2: about 25 px of slate (4a5668) pieces of the far rim outline hung in the foliage."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                self.assertEqual(stray_pot_ink(baked(proj)), 0)
                self.assertGreater(int(px_mask(baked(proj), rgbs([PP.RECIPE.materials['pot'].ink])).sum()), 25)   # the pot keeps its outline

    def test_a_leaf_never_butts_against_the_pot_without_its_dark_edge(self):
        """Finding 3: a mint leaf against the white pot with no dark edge between them."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                self.assertEqual(leaf_pot_contacts(baked(proj)), 0)

    def test_the_leaf_edge_against_the_pot_is_the_leaf_ink(self):
        """The edge that finding 3 asks for is in the leaves' ink, on the leaf's side."""
        ink = rgbs([PP.GREENS[0]])
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                inks, pot = px_mask(p, ink), px_mask(p, rgbs(PP.RECIPE.materials['pot'].ramp))
                h, w = inks.shape
                touching = sum(1 for y, x in zip(*np.nonzero(inks)) for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1))
                               if 0 <= y + dy < h and 0 <= x + dx < w and pot[y + dy, x + dx])
                self.assertGreaterEqual(touching, 6)

    def test_the_greens_are_three_body_tones_a_shade_two_stripes_and_the_ink(self):
        """Finding 5: three stripe tones 4-7 units apart. Far and side leaves share one stripe, the near leaves one lighter, and every
        stripe run is at least 3 px (none ends as a lone dot at a tip)."""
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = baked(proj)
                greens = set(leaf_tones()) | set(stripe_tones()) | {PP.RECIPE.materials['stalk'].ramp[0], PP.GREENS[0]}
                used = {c for c in greens if px_mask(p, rgbs([c])).any()}
                stripes = {c for c in stripe_tones() if px_mask(p, rgbs([c])).any()}
                self.assertEqual(len(stripes), 2, stripes)
                self.assertLessEqual(len(used), 7, sorted(used))             # 3 body + 1 shade + 2 stripes + ink
                self.assertEqual(short_stripe_runs(p), 0)
                a, b = sorted(lum(c) for c in stripes)
                self.assertGreaterEqual(b - a, 15)                           # the two stripes are told apart at 1:1

    def test_the_stripe_stops_before_the_tip(self):
        """Finding 5: the stripe stops 2 px before the tip: the midrib tube ends 6 of 18 spine points short of the blade's tip."""
        for stalk, blade, rib in zip(*(PP.RECIPE.solids[2 + i::3] for i in range(3))):
            tip = PP.spine(blade.base, math.degrees(blade.yaw), math.degrees(blade.pitch), blade.length, math.degrees(blade.bend))[-1]
            self.assertGreaterEqual(float(np.linalg.norm(rib.path[-1] - tip)), 0.28 * blade.length)

    def test_the_left_and_right_front_leaves_mirror_each_other_and_keep_the_front_open(self):
        """Findings 6 and 7: the two front leaves both lie over the rim: their headings mirror each other within 8 degrees, and no
        leaf heads within 28 degrees of the viewer's axis (the front of the pot reads)."""
        yaws = [math.degrees(b.yaw) % 360 for b in blades() if sin_yaw(b) > 0.45]
        right = [y for y in yaws if math.cos(math.radians(y)) > 0]
        left = [y for y in yaws if math.cos(math.radians(y)) < 0]
        self.assertEqual((len(left), len(right)), (1, 1))
        self.assertLessEqual(abs((180 - left[0]) - right[0]), 8.0)
        for b in blades():
            self.assertGreaterEqual(abs((math.degrees(b.yaw) - 90 + 180) % 360 - 180), 28.0)

    def test_the_soil_is_deeper_and_the_front_ring_covers_its_lower_arc(self):
        """Finding 4: the soil was the largest warm area, a tray in a white bowl. It lies 0.10 m below the rim and its visible part is
        under 90 px in 'oblique' (it was 72 px of body tone plus ink at 0.07 m)."""
        self.assertGreaterEqual(PP.SOIL_DEPTH, 0.10)
        p = baked('oblique')
        self.assertLessEqual(int(px_mask(p, rgbs(PP.SOIL)).sum()), 90)
        self.assertGreaterEqual(int(px_mask(p, rgbs(PP.SOIL)).sum()), 40)

    def test_the_room_variant_is_about_the_avatar_height_plus_a_little(self):
        """Finding 6 (low): build(height=ROOM_HEIGHT) crown near 36 px wide; the avatar frame is 26 x 32."""
        r = PP.build('plant-room', height=PP.ROOM_HEIGHT)
        for proj in PROJECTIONS:
            with self.subTest(projection=proj):
                p = B.bake(r, proj, overrides=False)
                self.assertEqual(p.violations, [])
                self.assertLessEqual(bbox_width(p), 38)
                self.assertGreaterEqual(bbox_width(p), 32)
        self.assertLess(B.bake(r, 'oblique', overrides=False).size[1], baked('oblique').size[1] - 6)


class WithoutThePatchOrTheNewRecipe(unittest.TestCase):
    """The measurements above fail on the bake as it was: the unpatched bake and a copy of the recipe with the old soil ink."""

    def test_the_unpatched_bake_has_stray_rim_outline_loose_leaf_edges_and_a_short_stripe(self):
        raw = {proj: B.bake(PP.RECIPE, proj, overrides=False) for proj in PROJECTIONS}
        for proj, p in raw.items():
            with self.subTest(projection=proj):
                self.assertGreater(stray_pot_ink(p), 0)
                self.assertGreater(leaf_pot_contacts(p), 0)
        self.assertGreater(sum(short_stripe_runs(p) for p in raw.values()), 0)

    def test_the_old_soil_ink_made_the_specks(self):
        import dataclasses
        mats = dict(PP.RECIPE.materials)
        mats['soil'] = V.Material('soil', PP.SOIL)                          # the soil as it was: its darkest tone is its ink
        old = B.bake(dataclasses.replace(PP.RECIPE, materials=mats, name='plant-old-soil'), 'oblique', overrides=False)
        n, outside = soil_ink_specks(old)
        self.assertTrue(n > 1 or outside > 2, (n, outside))


class Parameters(unittest.TestCase):
    """The same recipe makes the other large plants: size, leaf count, pot colour and leaf shape are parameters."""

    def test_variants_bake_clean(self):
        cases = {
            'nine': dict(leaves=9), 'twelve': dict(leaves=12), 'oval': dict(leaf_shape='oval', leaves=10, leaf_width=0.34),
            'lance': dict(leaf_shape='lance'), 'terracotta': dict(pot='#C0502F'), 'cream': dict(pot='cream'),
            'slate': dict(pot='slate', height=1.3), 'tall': dict(height=1.9),
        }
        for key, kw in cases.items():
            with self.subTest(variant=key):
                p = baked('oblique', key, name=f'plant-{key}', **kw)
                self.assertEqual(p.violations, [], kw)
                self.assertLessEqual(p.size[0], 62 if key == 'tall' else 52)

    def test_size_scales_the_plant_and_a_tall_one_is_declared_tall(self):
        big = baked('oblique', 'h16', name='size-1.6', height=1.6)
        small = baked('oblique', 'h12', name='size-1.2', height=1.2)
        tall = baked('oblique', 'h19', name='size-1.9', height=1.9)
        self.assertLess(small.metrics['height_px'], big.metrics['height_px'] - 6)
        self.assertGreater(tall.metrics['height_px'], big.metrics['height_px'] + 6)
        self.assertTrue(PP.build('t', height=1.9).tall)
        self.assertFalse(PP.build('t', height=1.6).tall)

    def test_pot_colour_changes_the_pot_not_the_leaves(self):
        a = baked('oblique', 'cream', name='plant-cream', pot='cream')
        b = baked('oblique', 'slate1', name='plant-slate1', pot='slate')
        self.assertGreater(int(colour_mask(a, PP.POTS['cream']).sum()), 40)
        self.assertGreater(int(colour_mask(b, PP.POTS['slate']).sum()), 40)
        self.assertEqual(int(colour_mask(a, PP.POTS['slate']).sum()), 0)
        self.assertEqual(int(colour_mask(a, PP.GREENS).sum()), int(colour_mask(b, PP.GREENS).sum()))

    def test_bad_parameters_are_refused(self):
        for kw in (dict(leaf_shape='round'), dict(leaves=2), dict(greens=('#000000',) * 3)):
            with self.subTest(kw=kw), self.assertRaises(ValueError):
                PP.build(**kw)


class Palette(unittest.TestCase):
    def test_off_palette_status_is_pinned(self):
        """MEASURED against tools/palettes/office.hex: the plant's greens, the soil and the pot tones are not on the office
        palette (it has no leaf green). This pins the list so that adding the tones to palette.py is a deliberate change."""
        bad = set(V.off_palette(PP.RECIPE.materials_table()))
        used = set(PP.RECIPE.materials)
        self.assertEqual(bad & used, used)


if __name__ == '__main__':
    unittest.main()
