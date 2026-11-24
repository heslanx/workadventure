"""Measures of the floor patterns drawn by hq-office/signature.py tile_pattern(): the pod carpet, the auditorium carpet with its
edges and the stage riser, the reception's terrazzo, the café's threshold, and the two patterns that must not move (porcelain,
boardwalk, the 64 px terrazzo). Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_floor_patterns.py
No build and no external tool: every picture is drawn in a fraction of a second.

The measures come from the audit's rule R7 (/tmp/asset-audit-2/round2.md) as the critic corrected it:
  seam      the mean luminance of a tile's edge column or row against its body: at most SEAM_LEVELS, except on the declared
            joints of a pattern set (a 64 px grid)
  pinstripe the share of adjacent row pairs that differ by more than 10 levels: at most 0.6
  period    the share of cells whose tile equals the tile p cells to the east, for p in 2..12: below 0.9 unless the material
            is a single tile that repeats by design
BRICK_AND_HERRINGBONE are those single tiles (the rooms' oak slats and the café's herringbone, the audit's reference floors:
every p gives 1.0 and the wrap step is no bigger than the steps inside the tile). They are exempt explicitly, and a test pins why.
Each measure is also run on the picture it replaced (the catalogue's Carpet_Texture and Carpet_Stripe_Gray, the old 64 px
terrazzo, kept below as OLD_TERRAZZO), and must fail there: that is how these tests were seen to fail without the change."""
import hashlib
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SOURCE / 'hq-office'))
import palette as PL  # noqa: E402
import plan as P  # noqa: E402
import signature as SIG  # noqa: E402

T = 32
SEAM_LEVELS = 6                  # R7(b); the critic found brick at 6.2 and exempted it by declaration
PINSTRIPE_SHARE = 0.6            # R7(c)
BRICK_AND_HERRINGBONE = {'brick': ('Wood_Slats_LightWood', 'oak'), 'herringbone': ('Wood_Herringbone_LightWood', 'oak')}

# sha256 of tile_pattern(kind).tobytes() on HEAD before this change: these two must not move a byte.
UNCHANGED = {'porcelain': '48151136e188a126af996cb09d434497eeedfd71e510ace1ab51e266fe441eb1',
             'boardwalk': 'd15fb755e18ebcd2ba799d5c188ed65d438e5b1c9d4d326051f10c0a4bc48220',
             'terrazzo': '2ca930a469b4356624ca0839c6af26a885432d50b0ae31ff40e08fff9735f68d'}


def old_terrazzo():
    """The 64 x 64 terrazzo of HEAD (seed 23, the same code), the picture that repeated every 64 px."""
    rng = np.random.default_rng(23)
    a = np.empty((64, 64, 3))
    a[:] = SIG.rgb('#EEF2F3')
    a += rng.normal(0, 1.0, (64, 64, 1))
    for colour, n in (('#C9D3D8', 70), ('#A9B6BD', 26), ('#7FD9C9', 7), ('#D8C2A3', 10)):
        for _ in range(n):
            x, y = int(rng.uniform(0, 63)), int(rng.uniform(0, 63))
            a[y, x] = SIG.rgb(colour)
            if rng.uniform() < 0.35:
                a[y, (x + 1) % 64] = SIG.rgb(colour)
    return Image.fromarray(np.dstack([np.clip(a, 0, 255), np.full((64, 64), 255)]).astype(np.uint8), 'RGBA')


OLD_TERRAZZO = old_terrazzo


def lum(img):
    return np.asarray(img.convert('RGB')).astype(float).mean(axis=2)


def tiles_of(img):
    """{(tx, ty): bytes} of the 32 px tiles of a picture."""
    a = np.asarray(img)
    return {(x // T, y // T): a[y:y + T, x:x + T].tobytes() for y in range(0, a.shape[0], T) for x in range(0, a.shape[1], T)}


def edge_levels(tile):
    """Largest difference, over the four edges of one 32 px tile, between the mean luminance of the edge column or row and of
    the body (the 24 x 24 middle): R7(b)."""
    g = lum(tile)
    body = g[4:-4, 4:-4].mean()
    return max(abs(g[:, 0].mean() - body), abs(g[:, -1].mean() - body), abs(g[0, :].mean() - body), abs(g[-1, :].mean() - body))


def pinstripe_share(tile):
    """R7(c): the share of adjacent row pairs whose mean luminance differs by more than 10 levels."""
    rows = lum(tile).mean(axis=1)
    return float((np.abs(np.diff(rows)) > 10).mean())


def period_match(grid, p):
    """R7(a): the share of cells of a grid of tile ids that equal the cell p to the east."""
    return float((grid[:, :-p] == grid[:, p:]).mean())


def laid(img, cols, rows):
    """Tile ids of the picture repeated over cols x rows cells from the origin (what build.paint does)."""
    ids, out = {}, np.zeros((rows, cols), int)
    t = tiles_of(img)
    w, h = img.width // T, img.height // T
    for y in range(rows):
        for x in range(cols):
            out[y, x] = ids.setdefault(t[(x % w, y % h)], len(ids))
    return out


class Patterns(unittest.TestCase):
    def test_every_pattern_is_opaque_a_whole_number_of_tiles_and_deterministic(self):
        for kind in SIG.FLOOR_PATTERNS:
            with self.subTest(kind=kind):
                img = SIG.tile_pattern(kind)
                self.assertEqual(img.mode, 'RGBA')
                self.assertEqual((img.width % T, img.height % T), (0, 0))
                self.assertEqual(int(np.asarray(img)[..., 3].min()), 255, 'a floor tile has no transparent pixel')
                self.assertEqual(img.tobytes(), SIG.tile_pattern(kind).tobytes())

    def test_an_unknown_pattern_is_an_error_not_a_terrazzo(self):
        with self.assertRaises(ValueError):
            SIG.tile_pattern('nope')

    def test_the_porcelain_the_boardwalk_and_the_64_px_terrazzo_did_not_move(self):
        for kind, sha in UNCHANGED.items():
            self.assertEqual(hashlib.sha256(SIG.tile_pattern(kind).tobytes()).hexdigest(), sha, kind)

    def test_every_pattern_the_plan_names_exists(self):
        """plan.FLOORS flips a floor to '@name'; a name this file does not draw would stop the build."""
        for key, v in P.FLOORS.items():
            if isinstance(v, str) and v.startswith('@') and v != '@lawn':
                with self.subTest(key=key):
                    SIG.tile_pattern(v[1:])


class BrickAndHerringbone(unittest.TestCase):
    """The audit's reference floors are single tiles that repeat by design: the periodicity measure does not apply to them,
    and the reason is a wrap step no bigger than the steps inside the tile."""

    def test_they_are_self_tiling_which_is_why_the_period_rule_exempts_them(self):
        for name, (tile, ramp) in BRICK_AND_HERRINGBONE.items():
            with self.subTest(name=name):
                g = lum(PL.floor_tile(tile, ramp))
                # the step across the wrap is no bigger than the step between two neighbours inside the tile
                self.assertLessEqual(np.abs(g[:, -1] - g[:, 0]).mean(), np.abs(np.diff(g, axis=1)).mean())
                self.assertLessEqual(np.abs(g[-1, :] - g[0, :]).mean(), np.abs(np.diff(g, axis=0)).mean())
                ids = laid(PL.floor_tile(tile, ramp), 24, 8)
                self.assertTrue(all(period_match(ids, p) == 1.0 for p in range(2, 13)),
                                'one tile: the naive period rule would flag it at every p')


class Pod(unittest.TestCase):
    def setUp(self):
        self.img = SIG.tile_pattern('pod')

    def test_it_is_a_2x2_set_of_64_px(self):
        self.assertEqual(self.img.size, (64, 64))

    def test_no_seam_on_a_32_px_tile_boundary_and_no_pinstripe(self):
        g = lum(self.img)
        for tx in range(2):
            for ty in range(2):
                tile = self.img.crop((tx * T, ty * T, tx * T + T, ty * T + T))
                grid_edges = {'left': tx == 0, 'top': ty == 0}          # the declared joints of the 64 px set
                t = lum(tile)
                body = t[4:-4, 4:-4].mean()
                if not grid_edges['left']:
                    self.assertLessEqual(abs(t[:, 0].mean() - body), SEAM_LEVELS)
                if not grid_edges['top']:
                    self.assertLessEqual(abs(t[0, :].mean() - body), SEAM_LEVELS)
                self.assertLessEqual(abs(t[:, -1].mean() - body), SEAM_LEVELS)       # the east and south edges are the body
                self.assertLessEqual(abs(t[-1, :].mean() - body), SEAM_LEVELS)
                self.assertLessEqual(pinstripe_share(tile), PINSTRIPE_SHARE)
        # the boundary at 32: the two columns beside it differ by grain only
        self.assertLessEqual(abs(g[:, 31].mean() - g[:, 32].mean()), 2)
        self.assertLessEqual(abs(g[31, :].mean() - g[32, :].mean()), 2)

    def test_the_joint_is_on_the_64_px_grid_and_a_single_pixel(self):
        g = lum(self.img)
        body = g[1:, 1:].mean()
        self.assertGreater(body - g[:, 0].mean(), 3, 'the carpet-tile joint is there')
        self.assertLessEqual(body - g[:, 0].mean(), 12, 'and quiet')
        self.assertLessEqual(np.abs(g[1:, 1:] - np.median(g[1:, 1:])).max(), 0.03 * 255 + 1, 'grain under 3 % contrast')

    def test_the_catalogue_tile_it_replaces_fails_both_measures(self):
        old = PL.floor_tile('Carpet_Texture', 'mist')
        self.assertGreater(edge_levels(old), SEAM_LEVELS)                 # 12 levels: a 2 px dark band every 32 px
        self.assertGreater(pinstripe_share(old), PINSTRIPE_SHARE)         # 1.00: the period-2 pinstripe


class Audience(unittest.TestCase):
    SEAT = range(8, 24)           # a seat is 25 px wide at the middle of its 32 px tile; its middle 16 px are never carpet

    def luminance_by_column(self, img):
        g = lum(img)
        return np.array([g[:, x::32].mean() for x in range(32)])

    def test_no_dark_stripe_under_a_seat_column(self):
        cols = self.luminance_by_column(SIG.tile_pattern('audience'))
        base = np.median(cols)
        self.assertTrue(all(abs(cols[x] - base) <= 2 for x in self.SEAT), 'the middle of the tile is plain carpet')
        dark = [x for x in range(32) if cols[x] < base - 8]
        self.assertTrue(dark and all(min(x, 32 - x) <= 4 for x in dark), f'the stripe is on the tile boundary: {dark}')

    def test_the_catalogue_carpet_it_replaces_had_the_stripe_under_every_seat(self):
        cols = self.luminance_by_column(PL.floor_tile('Carpet_Stripe_Gray', 'petrol'))
        base = np.median(cols)
        self.assertTrue(any(cols[x] < base - 8 for x in self.SEAT), 'the old stripe is at the middle of the tile')

    def test_the_stripe_is_continuous_across_a_tile_boundary(self):
        g = lum(SIG.tile_pattern('audience'))
        self.assertEqual(g.shape, (32, 32))
        self.assertLessEqual(abs(g[:, 31].mean() - g[:, 0].mean()), 3, 'one stripe split across the wrap, not two')

    def test_edges_bind_the_wall_side_and_the_east_runner_mirrors_the_west(self):
        w, e, s = (np.asarray(SIG.tile_pattern(k)) for k in ('audience-w', 'audience-e', 'audience-s'))
        edge = np.array(SIG.AUD['edge'])
        self.assertTrue((w[:, 0:4, :3] == edge).all())
        self.assertTrue((e[:, 28:32, :3] == edge).all())
        self.assertTrue((s[28:32, :, :3] == edge).all())
        self.assertTrue((w[:, 6, :3] == np.array(SIG.AUD['line'])).all())
        self.assertTrue((e[:, 25, :3] == np.array(SIG.AUD['line'])).all())
        for corner, (a, b) in {'audience-sw': ('audience-w', 'audience-s'), 'audience-se': ('audience-e', 'audience-s')}.items():
            c, ca, cb = (np.asarray(SIG.tile_pattern(k)) for k in (corner, a, b))
            if corner.endswith('sw'):
                self.assertTrue((c[:, 0:4, :3] == ca[:, 0:4, :3]).all())
            else:
                self.assertTrue((c[:, 28:32, :3] == ca[:, 28:32, :3]).all())
            self.assertTrue((c[28:32, :, :3] == cb[28:32, :, :3]).all())

    def test_the_riser_is_8_px_with_a_lit_lip_and_a_dark_foot_then_the_carpet_in_phase(self):
        r = np.asarray(SIG.tile_pattern('riser'))[..., :3].astype(float)
        face = r[0:8].mean(axis=(1, 2))
        self.assertGreater(face[0], face[1:7].max() + 10, 'the lip catches the light')
        self.assertLess(face[7], face[1:7].min() - 10, 'the foot is the darkest row')
        field = np.asarray(SIG.tile_pattern('audience'))[..., :3].astype(float)
        self.assertLessEqual(np.abs(r[8:].mean(axis=0) - field[8:].mean(axis=0)).max(), 2, 'the stripes below the riser keep their phase')


class Terrazzo(unittest.TestCase):
    def setUp(self):
        self.img = SIG.tile_pattern('terrazzo-pool')
        self.cols, self.rows = self.img.width // T, self.img.height // T

    def test_no_tile_has_a_twin_in_the_eight_cells_around_it_even_across_the_repeat(self):
        t = tiles_of(self.img)
        for (x, y), data in t.items():
            for dx in range(-1, 2):
                for dy in range(-1, 2):
                    if (dx, dy) != (0, 0):
                        self.assertNotEqual(data, t[((x + dx) % self.cols, (y + dy) % self.rows)], (x, y, dx, dy))

    def test_and_the_same_tile_is_at_least_three_cells_apart_along_a_row_most_of_the_time(self):
        ids = laid(self.img, self.cols, self.rows)
        self.assertLess(period_match(ids, 2), 0.05)

    def test_a_reception_wide_floor_passes_the_period_rule_at_every_shift_to_12(self):
        ids = laid(self.img, 22, 8)                       # the reception: 22 x 8 tiles
        for p in range(2, 13):
            self.assertLess(period_match(ids, p), 0.2, p)
        self.assertEqual(len(set(tiles_of(self.img).values())), SIG.POOL, 'a pool, not a stamp')

    def test_the_picture_repeats_on_a_period_past_the_rule(self):
        self.assertGreater(self.cols, 12)

    def test_the_64_px_terrazzo_it_replaces_fails_the_period_rule(self):
        self.assertEqual(OLD_TERRAZZO().tobytes(), SIG.tile_pattern('terrazzo').tobytes())
        ids = laid(OLD_TERRAZZO(), 22, 8)
        self.assertEqual(period_match(ids, 2), 1.0)

    def test_the_joints_do_not_show_and_the_chips_are_as_dense_as_before(self):
        g = lum(self.img)
        across = np.abs(np.diff(g, axis=1))[:, T - 1::T].mean()
        inside = np.abs(np.diff(g, axis=1))[:, [x for x in range(self.img.width - 1) if x % T != T - 1]].mean()
        self.assertLess(abs(across - inside), 0.3 * inside)
        old = lum(OLD_TERRAZZO())
        chips = lambda a: float((np.abs(a - np.median(a)) > 12).mean())        # noqa: E731
        for ty in range(self.rows):
            for tx in range(self.cols):
                share = chips(g[ty * T:ty * T + T, tx * T:tx * T + T])
                self.assertTrue(0.6 * chips(old) <= share <= 1.5 * chips(old), (tx, ty, share, chips(old)))


class Path(unittest.TestCase):
    def test_the_path_joints_continue_the_halls_grid_and_use_its_joint_colours(self):
        path, hall = np.asarray(SIG.tile_pattern('path'))[..., :3], np.asarray(SIG.tile_pattern('porcelain'))[..., :3]
        self.assertEqual(path.shape[:2], (32, 32))
        for name, mine, theirs in (('row 0', path[0], hall[0, :32]), ('row 1', path[1], hall[1, :32]),
                                   ('column 0', path[:, 0], hall[:32, 0]), ('column 1', path[:, 1], hall[:32, 1])):
            self.assertTrue((mine == theirs).all(), f'{name}: the hall\'s joint line, pixel for pixel')

    def test_one_tile_with_no_pinstripe_and_a_joint_only_on_its_own_grid(self):
        tile = SIG.tile_pattern('path')
        self.assertLessEqual(pinstripe_share(tile), PINSTRIPE_SHARE)
        self.assertEqual(len(set(tiles_of(tile).values())), 1)

    def test_the_catalogue_slab_it_replaces_is_a_16_px_grid(self):
        old = lum(PL.floor_tile('Stone_Tile', 'porcelain'))
        rows = old.mean(axis=1)
        joints = [y for y in range(1, 31) if rows[y] < rows.mean() - 3]
        self.assertTrue(any(0 < y < 31 and abs(y - 16) <= 2 for y in joints), joints)


class CafeSill(unittest.TestCase):
    def test_the_sill_is_four_oak_rows_on_the_cafes_own_herringbone(self):
        sill = np.asarray(SIG.tile_pattern('cafe-sill'))[..., :3]
        herringbone = np.asarray(PL.floor_tile('Wood_Herringbone_LightWood', 'oak'))[..., :3]
        self.assertTrue((sill[:28] == herringbone[:28]).all(), 'the catalogue pixels above the sill are untouched')
        for row, key in zip(range(28, 32), ('lit', 'mid', 'line', 'edge')):
            self.assertTrue((sill[row] == np.array(SIG.OAK[key])).all(), row)

    def test_the_sill_closes_the_tile_for_the_planks_below(self):
        sill = lum(SIG.tile_pattern('cafe-sill'))
        self.assertGreater(sill[28:30].mean() - sill[31].mean(), 8, 'a lit top over a dark foot')


class Budget(unittest.TestCase):
    def test_the_new_patterns_cost_few_tiles(self):
        """The floor sheet had 29 free tiles of 576 (the critic), and the sheet grows by rows if needed; the patterns'
        distinct 32 px tiles, counted as the build's TileBank counts them."""
        distinct = set()
        for kind in SIG.FLOOR_PATTERNS:
            if kind not in UNCHANGED:
                distinct |= set(tiles_of(SIG.tile_pattern(kind)).values())
        self.assertLessEqual(len(distinct), 32, len(distinct))   # 16 terrazzo + 4 pod + 7 audience + 1 sill + 1 path = 29


if __name__ == '__main__':
    unittest.main()
