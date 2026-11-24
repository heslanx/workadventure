"""Measured checks of the water zone's art: the canal, the bridge, the K deck, the fountain and its basin, the banks and the
surface's glints and ripples (hq-office/pool.py, fountain.py, flora.py). Each class names the audit item it keeps fixed
(/tmp/asset-audit-2/round2.md: I05, I14, I17, I32, I33, N16, N17, N53, N54) and the picture rule behind it: nothing carries its
own cast shadow (R1), the ground is 1:1 and height goes straight up (21 px a metre), one plank pitch for every boardwalk.
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_water_art.py
No external tool but rsvg-convert (the K and the Koru are rasterised from the brand's SVGs); pool.build() is run once for the
file, a few seconds. Nothing here needs a built map."""
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'hq-office'))
import fountain as FOUNTAIN  # noqa: E402
import plan as P  # noqa: E402
import pool as POOL  # noqa: E402
import signature as SIG  # noqa: E402

T = 32
_CACHE = {}


def built():
    """The pool of the map, built once for the file."""
    if 'pool' not in _CACHE:
        _CACHE['pool'] = POOL.build(P)
    return _CACHE['pool']


def frame_rgba(frame=0):
    return np.asarray(built().frames[frame])


def geometry():
    """Region origin and the places the plan puts things at, in region px."""
    x0, y0 = built().region
    cx0, cy0, cx1, cy1 = P.POOL['canal']
    bx0, by0, bx1, by1 = P.POOL['bridge']
    return dict(x0=x0, y0=y0, canal_top=cy0 * T, canal_cx=(cx0 + cx1 + 1) * T / 2,
                span=(bx0 * T - 2, (bx1 + 1) * T + 2), bridge_rows=(by0 * T, (by1 + 1) * T))


def same(rgb, colour):
    return (rgb == np.array(colour)).all(-1)


class Shading(unittest.TestCase):
    """I05, rule R1: the water is not shaded on one side of what touches it. The runtime casts the shadows, and this
    picture is a floor tile it does not shade: a band painted 7 px down and 5 px right of the K deck, of every stone and
    reed, and under the bridge, read as a shadow at noon, from the west and at night alike."""

    def test_the_contact_line_is_the_same_on_every_side_and_two_px_at_most(self):
        thing = np.zeros((40, 40), bool)
        thing[14:22, 10:30] = True
        water = ~thing
        ring1, ring2 = POOL.contact(thing, water)
        for flip in (np.fliplr, np.flipud):
            r1, r2 = POOL.contact(flip(thing), flip(water))
            self.assertTrue((flip(ring1) == r1).all() and (flip(ring2) == r2).all(), 'a ring that has a side')
        grown = POOL.dilate(thing, 2)
        self.assertTrue(((ring1 | ring2) & ~grown).sum() == 0, 'the contact line reaches further than 2 px')
        for rows, cols in ((slice(11, 14), slice(15, 25)), (slice(22, 25), slice(15, 25)),     # north, south
                           (slice(15, 21), slice(7, 10)), (slice(15, 21), slice(30, 33))):      # west, east
            self.assertEqual(int((ring1 | ring2)[rows, cols].sum()), int((ring1 | ring2)[11:14, 15:25].sum()) * (
                (rows.stop - rows.start) * (cols.stop - cols.start)) // 30, 'unequal on one side')

    def test_everything_the_map_shades_in_the_water_is_within_two_px_of_what_it_touches(self):
        f = frame_rgba()
        pool = built()
        rgb, a = f[..., :3].astype(int), f[..., 3]
        water = np.zeros(a.shape, bool)
        for c in list(POOL.WATER) + list(POOL.REFLECT) + [POOL.WATERLINE]:
            water |= same(rgb, c)
        thing = (a == 255) & ~water
        shade = pool.fx['shade']
        self.assertGreater(int(shade.sum()), 2000)
        far = shade & ~POOL.dilate(thing, 2)
        self.assertEqual(int(far.sum()), 0, f'{int(far.sum())} shaded px more than 2 px from anything: a cast shadow')

    def test_the_water_south_of_the_k_deck_is_no_darker_than_the_water_north_of_it(self):
        """The audit's 7 px band was under the deck's south edge only. Measured as the mean step of the water ramp 1 to 7 px
        from the deck's edge minus the mean 12 to 19 px away, per side: at HEAD south +1.45, north +0.29 (a gap of 1.16
        steps); the sides of a deck in a lake of broad depth patches differ by chance, not by a gap of a third of a step."""
        f = frame_rgba()
        rgb, a = f[..., :3].astype(int), f[..., 3]
        idx = np.full(a.shape, -1)
        for i, c in enumerate(POOL.WATER):
            idx[same(rgb, c) & (a == 255)] = i
        oak = np.zeros(a.shape, bool)
        for c in POOL.OAK:
            oak |= same(rgb, c)
        g = geometry()
        lx0, ly0, lx1, ly1 = P.POOL['lake']
        sl = (slice((ly0 + 2) * T - g['y0'], ly1 * T - g['y0']), slice((lx0 + 2) * T - g['x0'], (lx1 - 1) * T - g['x0']))
        oak, idx = oak[sl], idx[sl]
        gap = {}
        for side, (dy, dx) in dict(south=(1, 0), north=(-1, 0)).items():
            near, far = [], []
            for y, x in zip(*np.nonzero(oak)):
                if not oak[y + dy, x + dx]:
                    ray = lambda ks: [idx[y + dy * k, x + dx * k] for k in ks
                                      if 0 <= y + dy * k < oak.shape[0] and 0 <= x + dx * k < oak.shape[1]]
                    n, fr = ray(range(1, 8)), ray(range(12, 20))
                    if len(n) == 7 and len(fr) == 8 and min(n) >= 0 and min(fr) >= 0:
                        near.append(np.mean(n))
                        far.append(np.mean(fr))
            self.assertGreater(len(near), 100, side)
            gap[side] = float(np.mean(near) - np.mean(far))
        self.assertLess(abs(gap['south'] - gap['north']), 0.35, f'south {gap["south"]:+.2f}, north {gap["north"]:+.2f}')


class Bridge(unittest.TestCase):
    """I17: the bridge is a deck raised 5 px over the canal: a front face on its south edge only, no ink bar on the
    north edge, the boardwalk's own planks across it, a break at each abutment."""

    @classmethod
    def setUpClass(cls):
        g = geometry()
        cls.g = g
        cls.f = frame_rgba()
        cls.x0, cls.x1 = g['span'][0] - g['x0'], g['span'][1] - g['x0']
        cls.y0, cls.y1 = g['bridge_rows'][0] - g['y0'], g['bridge_rows'][1] - g['y0']

    def test_the_south_edge_has_a_5_px_front_face_of_the_oak_shade(self):
        face = self.f[self.y1:self.y1 + POOL.FACE, self.x0:self.x1, :3]
        self.assertTrue(same(face, POOL.OAK[0]).all(), 'the front face is not one oak shade all along the span')
        below = self.f[self.y1 + POOL.FACE, self.x0 + 20:self.x1 - 20, :3]
        self.assertFalse(same(below, POOL.OAK[0]).any(), 'the face is taller than FACE')

    def test_the_north_edge_has_no_ink_bar_and_no_face(self):
        top = self.f[self.y0 - POOL.FACE:self.y0, self.x0 + 20:self.x1 - 20, :3]
        self.assertFalse(same(top, POOL.OAK[0]).any(), 'a face on the north edge')
        ink = (self.f[self.y0 - 1:self.y1, self.x0:self.x1, :3] == np.array((10, 10, 61))).all(-1)
        self.assertEqual(int(ink.sum()), 0, 'ink rails on the span')
        row = self.f[self.y0, self.x0 + 4:self.x1 - 4, :3]
        self.assertTrue(same(row, POOL.OAK[4]).all(), 'the north edge is not the lit rim')

    def test_the_planks_are_the_boardwalks_own_so_the_approaches_run_on_into_the_span(self):
        boards = np.asarray(SIG.tile_pattern('boardwalk'))[..., :3].astype(int)
        ys, xs = np.mgrid[self.y0 + 2:self.y1 - 2, self.x0 + 4:self.x1 - 4]
        mine = self.f[ys, xs, :3].astype(int)
        theirs = boards[(ys + self.g['y0']) % 64, (xs + self.g['x0']) % 64]
        self.assertTrue((mine == theirs).all(), f'{int((mine != theirs).any(-1).sum())} px differ from the approach tile')

    def test_each_abutment_is_a_dark_break_across_the_planks(self):
        for x in (self.x0, self.x0 + 1, self.x1 - 2, self.x1 - 1):
            self.assertTrue(same(self.f[self.y0:self.y1, x, :3], POOL.OAK[0]).all(), f'column {x} is not the break')


class Planks(unittest.TestCase):
    """I17 and N16: one plank pitch for the K deck, the bridge and the boardwalk (6 px, the approaches' own)."""

    def test_the_boardwalk_tile_and_the_pool_share_the_pitch(self):
        boards = np.asarray(SIG.tile_pattern('boardwalk'))[..., :3].astype(int)
        # the boardwalk's seam tone is the oak's second step to within the grain's noise (a few levels)
        for row in (8, 30, 50):
            seams = np.nonzero(np.abs(boards[row] - np.array(POOL.OAK[1])).sum(-1) <= 6)[0]
            gaps = np.diff(seams).tolist()
            # the tile is 64 px wide, not a multiple of 6: one short plank where it wraps (4 px) is signature.py's own
            self.assertEqual(set(gaps) - {POOL.PLANK}, {4} if row != 30 else set(), f'row {row}: {gaps}')
            self.assertGreaterEqual(gaps.count(POOL.PLANK), 9)

    def test_the_k_deck_is_laid_along_each_limb_at_one_pitch(self):
        """N16: planks run down the stem and the foot (6 px across, the boardwalk's), along the upper arm and along the lower leg
        (at 45 degrees: 8 px of x + y between seams, 5.7 across). At HEAD every limb carried horizontal seams, which cut the arms
        into stairs."""
        logo = np.asarray(POOL.raster_svg(POOL.LOGO, 300))[..., 3] > 127
        limb = POOL.logo_limbs(logo)
        h, w = logo.shape
        ys, xs = np.mgrid[:h, :w]
        self.assertEqual(sorted(np.unique(limb[logo]).tolist()), [1, 2, 3])
        self.assertTrue((limb[~logo] == 0).all())
        self.assertGreater(xs[limb == 3].mean(), xs[limb == 1].mean() + 60, 'the leg is the right-hand limb below the arm')
        self.assertLess(ys[limb == 2].mean(), ys[limb == 3].mean(), 'the arm is above the leg')
        rgb = POOL.deck_planks(xs, ys, np.where(logo, limb, 0), np.random.default_rng(1)).astype(int)
        seam = same(rgb, POOL.OAK[1])
        for k, (axis, pitch) in {1: (xs, POOL.PLANK), 2: (xs + ys, POOL.DIAG), 3: (xs - ys, POOL.DIAG)}.items():
            sel = limb == k
            on = np.zeros(axis.max() - axis.min() + 1, bool)
            # a seam is a line of constant `across`: the values where most of the limb's pixels on that line are seam colour
            for v in np.unique(axis[sel]):
                line = sel & (axis == v)
                on[v - axis.min()] = line.sum() > 20 and seam[line].mean() > 0.9
            lines = np.nonzero(on)[0]
            self.assertGreater(len(lines), 8, f'limb {k}')
            self.assertEqual(set(np.diff(lines).tolist()), {pitch}, f'limb {k}: seams {lines.tolist()}')


class Banks(unittest.TestCase):
    """I14 and I33: no white sliver under the team rooms' glass beside the canal; waterlines and banks are not ruled."""

    def test_the_bank_lies_under_the_glass_so_no_plaza_white_shows_through_it(self):
        f = frame_rgba()
        g = geometry()
        cx0, cy0, cx1, cy1 = P.POOL['canal']
        walls_l, walls_r = P.vb(cx0 - 1) * T + 2, P.vb(cx1 + 1) * T - 2
        rows = slice(g['canal_top'] + 8 - g['y0'], P.POOL['slot_end'] * T - 8 - g['y0'])
        for x in (walls_l - 2, walls_l - 1, walls_r, walls_r + 1):
            self.assertTrue((f[rows, x - g['x0'], 3] == 255).all(), f'column {x} of the glass strip is bare floor')

    def test_the_waterline_of_the_lake_wanders(self):
        depth = built().fx['depth']
        g = geometry()
        lx0, ly0, lx1, ly1 = P.POOL['lake']
        edge = []
        for y in range((ly0 + 3) * T - g['y0'], (ly1 - 3) * T - g['y0']):
            xs = np.nonzero(depth[y] > 0)[0]
            edge.append(xs.max())
        edge = np.array(edge, float)
        self.assertGreater(edge.std(), 1.3, 'the east waterline is a ruler')
        self.assertGreater(int((np.diff(edge) != 0).sum()), 30)

    def test_the_walkable_ground_is_the_one_the_collision_was_made_for(self):
        # the art moved the waterline by a few px; what people can walk on must not have moved with it
        import hashlib
        self.assertEqual(len(built().blocked), 235)
        self.assertEqual(hashlib.sha1(repr(sorted(built().blocked)).encode()).hexdigest(),
                         '07a0c904b5055afb774aba17429d49268741d46e')


class Basin(unittest.TestCase):
    """N17: the fountain's basin is a round shape on the ground plane with a rim of real height; the stream lands in it."""

    @classmethod
    def setUpClass(cls):
        g = geometry()
        pool = built()
        h, w = pool.frames[0].size[1], pool.frames[0].size[0]
        cls.g = g
        cls.impact = (int(g['canal_cx'] - g['x0']), int(g['canal_top'] + 26 - g['y0']))
        cls.b = FOUNTAIN.basin(g['x0'], g['y0'], w, h, g['canal_cx'], g['canal_top'], g['canal_top'] + 26)

    def test_the_rim_is_a_circle_of_the_declared_radius(self):
        b, R, H = self.b, FOUNTAIN.BASIN['R'], FOUNTAIN.BASIN['H']
        ys, xs = np.nonzero(b['footprint'])
        cx = self.impact[0]
        cy = self.impact[1] + H - FOUNTAIN.BASIN['water']
        south = ys > cy
        r = np.hypot(xs[south] - cx, ys[south] - cy)
        self.assertLessEqual(float(r.max()), R + 0.6)
        self.assertGreaterEqual(float(r.max()), R - 0.6)
        # round, not flattened: as wide as it is deep on the south half (east-west extent against north-south from the centre)
        self.assertAlmostEqual((xs.max() - xs.min() + 1) / 2, R, delta=1.0)
        self.assertAlmostEqual(ys.max() - cy, R, delta=1.0)

    def test_the_rim_stands_its_height_over_the_ground_and_is_as_wide_as_declared_on_top(self):
        b, H, rim = self.b, FOUNTAIN.BASIN['H'], FOUNTAIN.BASIN['rim']
        col = self.impact[0]
        stone = b['rim'][:, col]
        ys = np.nonzero(stone)[0]
        south = ys[ys > self.impact[1]]
        # the column through the centre, going down: the top's rim, then its face, to the ground circle's south edge
        self.assertEqual(int(south.max() - south.min() + 1), rim + H, 'top width plus face height')
        art = b['layer'][..., :3].astype(int)
        top = np.nonzero(same(art[:, col], FOUNTAIN.STONE[1]) | same(art[:, col], FOUNTAIN.STONE[0]) | same(art[:, col], FOUNTAIN.STONE[2]))[0]
        self.assertEqual(int((top[top > self.impact[1]]).size), rim)

    def test_the_water_inside_is_open_and_the_stream_lands_in_it_with_room_for_the_rings(self):
        b = self.b
        ix, iy = self.impact
        self.assertTrue(b['interior'][iy, ix])
        reach = 4 + 6 * 2.7                                   # the widest ring, px from the landing
        ys, xs = np.mgrid[:b['interior'].shape[0], :b['interior'].shape[1]]
        ring_zone = np.hypot(xs - ix, ys - iy) <= reach
        self.assertTrue(b['interior'][ring_zone].all(), 'a ring would meet the stone')

    def test_the_basin_is_stone_in_the_statue_layer_so_the_walls_layer_is_cut_out_behind_it(self):
        pool = built()
        a = np.asarray(pool.statue)[..., 3] > 0
        self.assertTrue(a[self.b['rim']].all())


class Rings(unittest.TestCase):
    """I32 and N54: rings are circles on the 1:1 ground (the decor's ripples and the fountain's), and the fountain's
    8 frames close: the first follows the last, with nothing that pops."""

    def test_the_decor_ripples_are_circles(self):
        for r in POOL.RIPPLE_RADII:
            px = POOL.circle(r)
            xs, ys = zip(*px)
            self.assertEqual((max(xs) - min(xs), max(ys) - min(ys)), (2 * r, 2 * r))
        steps = POOL._ripple_steps(dict(cx=16, cy=16), 3)
        for img in steps:
            a = np.asarray(img)[..., 3] > 0
            ys, xs = np.nonzero(a)
            self.assertEqual(xs.max() - xs.min(), ys.max() - ys.min())

    def test_the_fountain_rings_are_circles(self):
        g = geometry()
        pool = built()
        h, w = pool.frames[0].size[1], pool.frames[0].size[0]
        bx, iy = int(g['canal_cx'] - g['x0']), int(g['canal_top'] + 26 - g['y0'])
        basin_water = np.zeros((h, w), bool)
        basin_water[iy - 40:iy + 40, bx - 40:bx + 40] = True
        for k in range(8):
            s = FOUNTAIN.stream(k, g['x0'], g['y0'], w, h, bx + g['x0'], iy - 30 + g['y0'], iy + g['y0'], basin_water)
            ring = (s[..., :3].astype(int) == np.array(FOUNTAIN.RING[1])).all(-1) | (
                s[..., :3].astype(int) == np.array(FOUNTAIN.RING[0])).all(-1)
            ring &= s[..., 3] > 0
            ys, xs = np.nonzero(ring)
            near = (np.abs(xs - bx) < 30) & (np.abs(ys - iy) < 30) & (np.hypot(xs - bx, ys - iy) > 5)
            self.assertGreater(int(near.sum()), 60, f'frame {k}: no rings')
            # circles: the wide-and-tall extents of the ring pixels agree
            wide, tall = np.ptp(xs[near]), np.ptp(ys[near])
            self.assertLess(abs(int(wide) - int(tall)) / max(wide, tall), 0.22, f'frame {k}: {wide} x {tall}')

    def test_the_fountain_loops_without_a_pop(self):
        g = geometry()
        pool = built()
        h, w = pool.frames[0].size[1], pool.frames[0].size[0]
        bx, iy = int(g['canal_cx'] - g['x0']) + g['x0'], int(g['canal_top'] + 26)
        everywhere = np.ones((h, w), bool)
        fr = [FOUNTAIN.stream(k, g['x0'], g['y0'], w, h, bx, iy - 30, iy, everywhere).astype(int) for k in range(9)]
        steps = [np.abs(fr[k + 1] - fr[k]).sum() for k in range(8)]          # k -> k+1, the last being 7 -> 8, which wraps to 0
        wrap = np.abs(fr[8] - fr[0]).sum()
        self.assertLess(wrap, 0.02 * np.mean(steps), 'frame 8 is not frame 0 again')


class Glints(unittest.TestCase):
    """N53: glints read on the water they lie on, are at least 2 x 2 px, and do not flash together."""

    def lum(self, rgb):
        c = np.asarray(rgb, float) / 255
        c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
        return float(c @ [0.2126, 0.7152, 0.0722])

    def test_every_glint_stands_out_from_the_water_step_it_lies_on(self):
        for level in range(8):
            g = dict(shape='spark', x=10, y=10)
            dim, bright = POOL._glint_steps(g, level)[0], POOL._glint_steps(g, level)[1]
            water = self.lum(POOL.WATER[level])
            for img, floor in ((bright, 0.12), (dim, 0.06)):
                a = np.asarray(img)
                lit = a[a[..., 3] > 0][:, :3]
                self.assertGreater(self.lum(lit[0]) - water, floor, f'level {level}')

    def test_a_bright_glint_is_at_least_2_by_2(self):
        for name, px in POOL.GLINT_SHAPES.items():
            g = dict(shape=name, x=10, y=10)
            bright = np.asarray(POOL._glint_steps(g, 3)[2])[..., 3] > 0
            ys, xs = np.nonzero(bright)
            self.assertGreaterEqual(int(xs.max() - xs.min() + 1), 2, name)
            self.assertGreaterEqual(int(ys.max() - ys.min() + 1), 2, name)
            top = bright[10:12, 10:12]
            self.assertTrue(top.all(), f'{name}: no 2 x 2 block')

    def test_the_placements_start_on_many_frames_and_no_two_flash_together_on_one_shape(self):
        decor = POOL.water_decor(built().surface)
        self.assertGreater(len(decor), 60)
        starts, keys = [], {}
        for cell, frames in decor.items():
            lit = [i for i, f in enumerate(frames) if f.getbbox()]
            self.assertTrue(lit, cell)
            self.assertEqual(lit, list(range(lit[0], lit[0] + len(lit))))
            self.assertGreaterEqual(lit[0], 1)                      # frame 0 is the still floor (animations off)
            starts.append(lit[0])
            key = (lit[0], frames[lit[1]].tobytes())
            keys[key] = keys.get(key, 0) + 1
        self.assertGreaterEqual(len(set(starts)), 20, 'the start frames come in a few lockstep groups')
        self.assertEqual(max(keys.values()), 1, 'two tiles flash the same picture on the same frame')


if __name__ == '__main__':
    unittest.main()
