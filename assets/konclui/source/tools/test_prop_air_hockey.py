"""Behaviour tests of the air hockey table (hq-office/props/air_hockey.py), baked by tools/bake.py in both projections.

What these pin is what the asset audit said was wrong with today's picture (lounge.air_hockey(), verdict "redraw"): a
plan-view top on elevation legs, a 158-pixel painted shadow, a foot gap of 5, coarse flat areas, mallets drawn as plain
discs; and what the plan (section 7.4, section 11) says the new one must be.

The expected pixel counts are derived from the metres of the recipe and the numbers of tools/projection.json, written out
here on purpose (32 px per metre in x, 32 or 24 in y, 21 in z): the table is 2.0 x 1.1 x 0.8 m, its rim 0.10 m, its apron
0.30 m tall.

Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_prop_air_hockey.py

Mutation hook (used to prove each test fails without the behaviour): AIR_HOCKEY_RECIPE=/path/to/a/copy.py loads that file
instead of hq-office/props/air_hockey.py."""
import hashlib
import importlib.util
import json
import os
import subprocess
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
import volume as V  # noqa: E402

TOP = (128, 128, 255)      # world +z, encoded (n + 1) / 2 * 255
SOUTH = (128, 0, 128)      # world +y (toward the viewer) is the map's -y: (0, -1, 0)
PROJECTIONS = ('oblique', 'camera75')


def load_module():
    path = os.environ.get('AIR_HOCKEY_RECIPE')
    if not path:
        from props import air_hockey
        return air_hockey
    spec = importlib.util.spec_from_file_location('air_hockey_under_test', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


AH = load_module()
_cache = {}


def fresh_bake(projection, overrides=True):
    """One bake of the recipe under test. With the mutation hook a mutated copy makes the patches stale (or the wrong
    size), so they are applied anyway, and dropped when they cannot be."""
    mutated = bool(os.environ.get('AIR_HOCKEY_RECIPE'))
    kw = dict(old_canvas=(64, 64), old_foot=(32, 64))
    try:
        return B.bake(AH.RECIPE(), projection, overrides=overrides, allow_stale=mutated, **kw)
    except B.OverrideError:
        if not mutated:
            raise
        return B.bake(AH.RECIPE(), projection, overrides=False, **kw)


def bake(projection, overrides=True):
    key = (projection, overrides)
    if key not in _cache:
        _cache[key] = fresh_bake(projection, overrides)
    return _cache[key]


def hexes(piece):
    a = piece.rgba
    return [['#%02X%02X%02X' % tuple(a[r, c, :3]) if a[r, c, 3] else None for c in range(a.shape[1])] for r in range(a.shape[0])]


def classify(piece):
    """'T' (top), 'S' (south) or '.' for every pixel of the normal image."""
    n = piece.normal
    out = np.full(n.shape[:2], '.', dtype='U1')
    opaque = n[..., 3] == 255
    out[opaque & (np.abs(n[..., :3].astype(int) - TOP).max(-1) <= 1)] = 'T'
    out[opaque & (np.abs(n[..., :3].astype(int) - SOUTH).max(-1) <= 1)] = 'S'
    return out


def column(piece, col):
    return ''.join(classify(piece)[:, col])


def component(piece, seed, colours):
    """4-connected pixels of `colours` around `seed` (row, col): the mask of one game piece."""
    h = hexes(piece)
    todo, seen = [seed], set()
    while todo:
        r, c = todo.pop()
        if (r, c) in seen or not (0 <= r < len(h) and 0 <= c < len(h[0])) or h[r][c] not in colours:
            continue
        seen.add((r, c))
        todo += [(r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)]
    return seen


def bbox(cells):
    rs, cs = [p[0] for p in cells], [p[1] for p in cells]
    return min(rs), min(cs), max(rs), max(cs)


def mallet_tones(which):
    """The four flat tones of a mallet: underside lip, rim, body, cap. The mint body is the mint of the centre line and circle."""
    ramp = AH.MINT if which == 'mint' else AH.STEEL
    return set(ramp)


def profile(cells):
    """Row widths of a mask, top to bottom."""
    r0, _, r1, _ = bbox(cells)
    return [sum(1 for r, _ in cells if r == row) for row in range(r0, r1 + 1)]


def outer_cells(cells):
    """The cells of a mask that have a 4-neighbour outside it: its outline."""
    return {(r, c) for r, c in cells if any(n not in cells for n in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)))}


def mallet_cells(piece, which):
    """The mask of the mint (left) or the steel (right) mallet: flood-filled from the disc centre the recipe put it at."""
    proj = B.load_projection(piece.projection)
    x = A_X[which]
    y = A_Y[which]
    z = AH.Z_FIELD + AH.ZP
    col = int(1 + proj.sx * x)
    row = int(piece.footprint['px']['y'] + proj.sy * y - proj.sz * z)
    return component(piece, (row, col), mallet_tones(which))


A_X = {'mint': AH.MALLET_X, 'steel': AH.W - AH.MALLET_X}
A_Y = {'mint': AH.MALLET_Y_MINT, 'steel': AH.MALLET_Y_STEEL}


def sha(piece):
    h = hashlib.sha256()
    for im in piece.images().values():
        h.update(np.asarray(im).tobytes())
    h.update(json.dumps(piece.to_json(), sort_keys=True).encode())
    return h.hexdigest()


# --------------------------------------------------------------------------------------------------------- the bake

class Bakes(unittest.TestCase):
    def test_it_bakes_clean_in_both_projections(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                self.assertEqual(piece.violations, [])
                self.assertEqual(piece.warnings, [])
                self.assertEqual(piece.projection, p)

    def test_alpha_is_zero_or_255_and_there_is_no_painted_shadow(self):
        """Today: 158 semi-transparent navy pixels under the legs (the grey band in the lit lounge picture)."""
        for p in PROJECTIONS:
            with self.subTest(p):
                a = bake(p).rgba[..., 3]
                self.assertEqual(sorted(set(a.ravel().tolist())), [0, 255])
                self.assertEqual(int(((a > 0) & (a < 255)).sum()), 0)

    def test_the_normal_map_is_opaque_exactly_where_the_sprite_is(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                self.assertTrue(np.array_equal(piece.normal[..., 3], piece.rgba[..., 3]))
                self.assertTrue((piece.height[piece.rgba[..., 3] == 0] == 0).all())

    def test_the_registry_finds_it_and_the_cli_bakes_it(self):
        import props
        props.refresh()
        self.assertIn('air_hockey', props.names())
        self.assertNotIn('air_hockey', props.errors())
        with tempfile.TemporaryDirectory() as out:
            r = subprocess.run([sys.executable, '-I', str(HERE / 'bake.py'), 'air_hockey', '--projection', 'oblique', '--out', out],
                               capture_output=True, text=True, timeout=300)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertTrue((Path(out) / 'air_hockey.png').exists())

    def test_the_footprint_is_2_by_1_tiles_and_the_table_is_2_by_1_1_by_0_8_metres(self):
        piece = bake('oblique')
        self.assertEqual(tuple(piece.footprint['tiles']), (2.0, 1.0))
        s = V.Compound(AH.RECIPE().solids).sample(0.04)
        tol = 0.03                                                           # samples are cell centres, within one step of an edge
        self.assertAlmostEqual(float(s.P[:, 0].min()), 0.0, delta=tol)
        self.assertAlmostEqual(float(s.P[:, 0].max()), 2.0, delta=tol)
        self.assertAlmostEqual(float(s.P[:, 1].min()), -0.10, delta=tol)     # 1.1 m deep: 0.1 m beyond the footprint, on the far side
        self.assertAlmostEqual(float(s.P[:, 1].max()), 1.00, delta=tol)      # the apron stands on the footprint's front edge
        rim = s.P[s.P[:, 0] < 0.09]
        self.assertAlmostEqual(float(rim[:, 2].max()), 0.80, delta=1e-9)     # the rim top is the table's height
        self.assertEqual(AH.RECIPE().overhangs, {'north': 0.10})

    def test_the_height_map_gives_the_rim_top_at_17_px(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                self.assertEqual(int(piece.height[:, 8].max()), 17)          # 0.8 m x 21 px, the end rim
                last = int(np.nonzero((piece.rgba[..., 3] == 255).any(1))[0].max())
                self.assertLessEqual(int(piece.height[last, 4]), 2)           # a leg's foot is on the floor (the ink row is 0.1 m up)


# --------------------------------------------------------------------------------------------- what the audit flagged

class Audit(unittest.TestCase):
    def test_foot_gap_is_at_most_1_where_today_it_is_5(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                self.assertLessEqual(bake(p).metrics['foot_gap'], 1)

    def test_the_legs_are_at_least_2_px_of_fill_and_end_on_the_last_rows(self):
        """Today: two 3 px posts at the extreme ends. Now four legs; the far pair is hidden, the near pair is 4 px wide
        (1 px ink each side, 2 px of fill) and stands on the footprint's front edge."""
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                opaque = piece.rgba[..., 3] == 255
                last = int(np.nonzero(opaque.any(1))[0].max())
                self.assertGreaterEqual(piece.size[1] - 1 - last, 0)
                self.assertLessEqual(piece.size[1] - 1 - last, 1)
                cols = np.nonzero(opaque[last])[0].tolist()
                runs, start = [], cols[0]
                for a, b in zip(cols, cols[1:] + [None]):
                    if b != a + 1:
                        runs.append((start, a))
                        start = b
                self.assertEqual(len(runs), 2)
                for lo, hi in runs:
                    self.assertGreaterEqual(hi - lo + 1 - 2, 2)              # width minus the two ink columns
                self.assertLess(runs[0][1], 10)
                self.assertGreater(runs[1][0], piece.size[0] - 11)

    def test_the_two_far_legs_are_hidden_behind_the_top(self):
        """In both projections no pixel of the far legs shows: the leg columns are empty between the apron and the near
        legs' own rows except the near legs."""
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                cls = column(piece, 4)
                below_apron = cls[cls.rindex('T') + 1:].rstrip('.')
                self.assertTrue(set(below_apron) == {'S'}, below_apron)      # one unbroken south-facing run: the near leg
                self.assertEqual(len([1 for a in zip(cls, cls[1:]) if a == ('S', '.')]), 1)

    def test_the_top_reads_as_a_surface_in_perspective_not_a_40_row_plan(self):
        """The playfield is 0.9 m deep: 0.9 x 32 = 28.8 rows in oblique, 0.9 x 24 = 21.6 in camera75 (today 32; the plan
        says 26, which is the 0.75 projection's top face). The price of one true projection."""
        for p, rows in (('oblique', 28), ('camera75', 21)):
            with self.subTest(p):
                piece = bake(p)
                ice = set(AH.ICE)
                h = hexes(piece)
                seen = [r for r in range(piece.size[1]) if h[r][14] in ice]
                self.assertEqual(seen, list(range(seen[0], seen[0] + len(seen))))
                self.assertIn(len(seen), (rows, rows + 1))
                proj = B.load_projection(p)
                self.assertLessEqual(abs(len(seen) - 0.9 * proj.sy), 1.0)

    def test_the_front_apron_is_the_tables_real_height_on_screen(self):
        """0.30 m x 21 px = 6.3 rows of south face under the rim top (the 7th is the bottom ink row); the far rim shows
        its inner face as the recess, 0.05 m x 21 = 1 row."""
        for p in PROJECTIONS:
            with self.subTest(p):
                cls = column(bake(p), 30)
                field_end = cls.rindex('T')
                apron = cls[field_end + 1:].rstrip('.')
                self.assertEqual(set(apron), {'S'})
                self.assertIn(len(apron), (6, 7, 8))
                self.assertEqual(cls[:field_end].count('S'), 1)              # the far rim's inner face, above the playfield

    def test_the_outline_is_dark_and_complete(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                self.assertGreaterEqual(bake(p).metrics['outline_fraction'], 0.9)

    def test_it_is_smaller_than_today_in_canvas_pixels(self):
        today = 64 * 64
        self.assertLess(bake('oblique').size[0] * bake('oblique').size[1], today)
        self.assertLess(bake('camera75').size[0] * bake('camera75').size[1], bake('oblique').size[0] * bake('oblique').size[1])

    def test_the_canvas_size_is_the_measured_one(self):
        """DERIVED: 64 px of table + 2 margin; 1.1 m x sy + 0.8 m x 21. The plan's 64 x 48 holds in camera75 (44 rows) and
        does not in oblique (53 rows: 1.1 x 32 + 16.8)."""
        self.assertEqual(bake('oblique').size, (66, 53))
        self.assertEqual(bake('camera75').size, (66, 44))
        self.assertLessEqual(bake('camera75').size[1], 48)

    def test_it_stays_within_the_colour_cap(self):
        """The plan allows 20 for this piece; the file's cap is 24."""
        for p in PROJECTIONS:
            with self.subTest(p):
                self.assertLessEqual(bake(p).metrics['colours'], 20)

    def test_every_material_is_on_the_office_palette_the_game_pieces_too(self):
        """A build with the table on failed office.palette (+1 picture, +192 px) while its red and blue were off the palette."""
        self.assertEqual(V.off_palette(AH.RECIPE().materials), {})

    def test_every_pixel_of_the_baked_pictures_is_a_palette_stop(self):
        palette = {line.strip().upper() for line in (HERE / 'palettes' / 'office.hex').read_text().split() if line.strip()}
        for p in PROJECTIONS:
            with self.subTest(p):
                got = {V.rgb_hex(tuple(c)).lstrip('#').upper() for c in {tuple(px[:3]) for px in bake(p).rgba.reshape(-1, 4) if px[3]}}
                self.assertEqual(got - palette, set())


# --------------------------------------------------------------------------------------------------- the game pieces

class GamePieces(unittest.TestCase):
    MALLET_ROWS = {'oblique': [5, 7, 7, 7, 7, 7, 7, 5], 'camera75': [5, 7, 7, 7, 7, 5]}
    PUCK_ROWS = {'oblique': [3, 5, 5, 5, 5, 3], 'camera75': [3, 5, 5, 5, 3]}

    def test_each_mallet_is_a_symmetric_disc_whose_rows_never_taper_into_a_chin(self):
        """The audit's earlier look at the oblique bake: a base row 3 px wide under rows of 7 (a pear), and a camera75 base of 5."""
        for p in PROJECTIONS:
            for which in ('mint', 'steel'):
                with self.subTest(f'{p} {which}'):
                    cells = mallet_cells(bake(p), which)
                    w = profile(cells)
                    self.assertEqual(w, self.MALLET_ROWS[p])
                    r0, c0, r1, c1 = bbox(cells)
                    self.assertEqual(c1 - c0 + 1, 7)
                    self.assertEqual(cells, {(r, c0 + c1 - c) for r, c in cells})       # left-right symmetric: no pear, no lump
                    self.assertEqual(w, w[::-1])                                          # and the same shape top to bottom

    def test_each_mallet_is_a_four_step_ramp_lit_rim_body_cap_and_a_dark_underside(self):
        """The art director's finding on the first version: a near-black ring, one px of body and a pink cap, so the ramp jumped
        from black to pink. Now: the rim is the ramp's second tone, the body the third (a mid-step between rim and cap), the
        cap the lightest, and only the lip under the disc is the darkest tone."""
        for p in PROJECTIONS:
            for which in ('mint', 'steel'):
                with self.subTest(f'{p} {which}'):
                    piece = bake(p)
                    ramp = AH.MINT if which == 'mint' else AH.STEEL
                    cells = mallet_cells(piece, which)
                    hx = hexes(piece)
                    r0, c0, r1, c1 = bbox(cells)
                    self.assertEqual({hx[r][c] for r, c in cells}, set(ramp))                           # all four steps, nothing else
                    self.assertEqual({hx[r0][c] for r, c in cells if r == r0}, {ramp[1]})              # the top row is the lit rim, not the darkest tone
                    self.assertEqual({hx[r1][c] for r, c in cells if r == r1}, {ramp[0]})              # the underside lip is the darkest
                    dark = {(r, c) for r, c in cells if hx[r][c] == ramp[0]}
                    self.assertLessEqual(len(dark), 11)                                               # a lip, not a ring (the old ring was 24 px)
                    self.assertTrue(all(r >= r1 - 2 for r, _ in dark))                           # only on the last 3 rows
                    cap = {(r, c) for r, c in cells if hx[r][c] == ramp[3]}
                    self.assertGreaterEqual(len(cap), 6)                                             # a cap 3 px wide, at least 2 rows
                    mid = (c0 + c1) // 2
                    self.assertEqual(sorted({c for _, c in cap}), list(range(mid - 1, mid + 2)))
                    self.assertEqual(cap, {(r, c) for r in range(min(r for r, _ in cap), max(r for r, _ in cap) + 1) for c in range(mid - 1, mid + 2)})
                    self.assertTrue(cap.isdisjoint(outer_cells(cells)))
                    below = {hx[max(r for r, _ in cap) + 1][c] for c in range(mid - 1, mid + 2)}
                    self.assertEqual(below, {ramp[2]})                                               # the cap steps down to the body, then the rim

    def test_a_mallet_stands_clear_of_the_decal_red_it_shares_a_tone_with(self):
        """The mint mallet's body is the mint of the centre line and circle (the palette has no mint to spare); the two never touch."""
        piece = bake('oblique')
        r0, c0, r1, c1 = bbox(mallet_cells(piece, 'mint'))
        hx = hexes(piece)
        near = [(r, c) for r in range(r0 - 2, r1 + 3) for c in range(c0 - 2, c1 + 3)]
        mallet = mallet_cells(piece, 'mint')
        self.assertEqual([x for x in near if x not in mallet and hx[x[0]][x[1]] == AH.MINT[2]], [])
        body, rim = AH.MINT[2].lstrip('#'), AH.MINT[1].lstrip('#')
        self.assertGreaterEqual(max(abs(int(body[i:i + 2], 16) - int(rim[i:i + 2], 16)) for i in (0, 2, 4)), 20)

    def test_the_mallets_are_two_different_colours_left_and_right(self):
        piece = bake('oblique')
        mint, steel = mallet_cells(piece, 'mint'), mallet_cells(piece, 'steel')
        self.assertTrue(mint and steel)
        self.assertLess(max(c for _, c in mint), min(c for _, c in steel))
        self.assertTrue(mint.isdisjoint(steel))

    def test_the_two_sides_read_as_a_green_and_a_blue_not_as_a_grey(self):
        """The palette has no red, so the sides are its mint and its blue. A first pick gave the second mallet a 6F83A0 body (saturation
        0.18: a grey disc with a blue cast, no colour beside the mint one); the body of each side must be a colour of its own hue."""
        import colorsys
        def hls(hex_):
            r, g, b = (int(hex_.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4))
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            return h * 360, l, s
        mint, blue = hls(AH.MINT[2]), hls(AH.STEEL[2])
        self.assertTrue(140 <= mint[0] <= 175 and mint[2] >= 0.6, mint)
        self.assertTrue(215 <= blue[0] <= 245 and blue[2] >= 0.4, blue)
        self.assertGreaterEqual(blue[0] - mint[0], 60)                      # two hues, far apart, however the lightness falls

    def test_the_puck_is_a_near_black_5_px_disc_with_no_stray_pixel(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                proj = B.load_projection(p)
                col = int(1 + proj.sx * AH.PUCK_X)
                row = int(piece.footprint['px']['y'] + proj.sy * AH.PUCK_Y - proj.sz * (AH.Z_FIELD + AH.ZP))
                tones = set(AH.PUCK)
                puck = component(piece, (row, col), tones)
                hx = hexes(piece)
                self.assertEqual(profile(puck), self.PUCK_ROWS[p])
                r0, c0, r1, c1 = bbox(puck)
                self.assertEqual(c1 - c0 + 1, 5)
                self.assertEqual({(r, c0 + c1 - c) for r, c in puck}, puck)
                for r, c in puck:                                                           # near black, and not a second steel
                    self.assertLessEqual(max(int(hx[r][c][i:i + 2], 16) for i in (1, 3, 5)), 0x30, hx[r][c])
                self.assertEqual({hx[r][c] for r, c in outer_cells(puck)}, {AH.PUCK[0]})     # a clean rim in the darkest tone
                for r, c in puck:                                                           # no pixel without a same-tone neighbour
                    self.assertTrue(any(hx[r + dr][c + dc] == hx[r][c] for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))), (r, c))

    def test_the_puck_is_in_proportion_to_the_mallet(self):
        """A 5 px puck against a 7 px mallet is 0.71 (a real one is about 0.8); the first try was 4 against 7 (0.57)."""
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                proj = B.load_projection(p)
                row = int(piece.footprint['px']['y'] + proj.sy * AH.PUCK_Y - proj.sz * (AH.Z_FIELD + AH.ZP))
                puck = component(piece, (row, int(1 + proj.sx * AH.PUCK_X)), set(AH.PUCK))
                mallet = mallet_cells(piece, 'mint')
                width = lambda cells: bbox(cells)[3] - bbox(cells)[1] + 1
                self.assertGreaterEqual(width(puck) / width(mallet), 0.7)

    def test_there_is_one_puck_and_two_mallets_and_nothing_else_in_those_colours(self):
        piece = bake('oblique')
        hx = hexes(piece)
        total = sum(1 for row in hx for v in row if v in mallet_tones('steel'))
        self.assertEqual(total, len(mallet_cells(piece, 'steel')))
        own = mallet_tones('mint') - {AH.MINT[2]}                                    # the body tone is also the decal mint
        mints = {(r, c) for r, row in enumerate(hx) for c, v in enumerate(row) if v in own}
        self.assertEqual(mints, {(r, c) for r, c in mallet_cells(piece, 'mint') if hx[r][c] in own})


class Markings(unittest.TestCase):
    def test_the_centre_line_is_two_pixels_wide_and_the_circle_is_closed(self):
        piece = bake('oblique')
        hx = hexes(piece)
        field = [r for r in range(piece.size[1]) if hx[r][14] in set(AH.ICE)]
        mid = (field[0] + field[-1]) // 2
        line = [c for c in range(piece.size[0]) if hx[field[0] + 1][c] == AH.MINT[2]]
        self.assertEqual(line, [32, 33])
        ring = [(r, c) for r in field for c in range(24, 42) if hx[r][c] == AH.MINT[2] and c not in (32, 33)]
        rows = {r for r, _ in ring}
        self.assertGreaterEqual(len(rows), 9)                                # a circle about 11 rows tall
        self.assertEqual({(r, 65 - c) for r, c in ring}, set(ring))          # symmetric about the table's long axis
        self.assertTrue(abs((min(rows) + max(rows)) / 2 - mid) <= 2)

    def test_both_goal_slots_are_dark_notches_level_with_the_circle_and_the_creases(self):
        """The audit looked at the earlier bake and saw the slots about 1.5 rows below the creases and the circle, 11 rows tall
        (an odd count that no 12-row circle can be centred on)."""
        for p, tall in (('oblique', 12), ('camera75', 9)):
            with self.subTest(p):
                piece = bake(p)
                hx = hexes(piece)
                field = [r for r in range(piece.size[1]) if hx[r][14] in set(AH.ICE)]
                slot = AH.BODY.ramp[0]
                left = [r for r in field if hx[r][2] == slot]
                right = [r for r in field if hx[r][piece.size[0] - 3] == slot]
                self.assertEqual(left, right)
                self.assertEqual(left, list(range(left[0], left[0] + tall)))
                ring = sorted({r for r in field for c in range(24, 32) if hx[r][c] == AH.MINT[2]})
                arcs = sorted({r for r in field for c in range(3, 16) if hx[r][c] == '#02A8A6'})
                self.assertEqual((left[0] + left[-1]), (ring[0] + ring[-1]))               # centred on the circle's rows
                self.assertEqual((left[0] + left[-1]), (arcs[0] + arcs[-1]))                 # and on the creases'

    def test_the_circle_and_the_creases_mirror_left_to_right_and_top_to_bottom(self):
        """The audit found the camera75 arcs not mirrored top to bottom: one end 3 px short of the rim, the other running into it."""
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                hx = hexes(piece)
                W = piece.size[0]
                field = [r for r in range(piece.size[1]) if hx[r][14] in set(AH.ICE)]
                for colour, cols in ((AH.MINT[2], [c for c in range(24, 42) if c not in (32, 33)]), ('#02A8A6', list(range(3, 31)) + list(range(35, 63)))):
                    pts = {(r, c) for r in field for c in cols if hx[r][c] == colour}
                    lo, hi = min(r for r, _ in pts), max(r for r, _ in pts)
                    self.assertEqual(pts, {(r, W - 1 - c) for r, c in pts})                   # left-right
                    self.assertEqual(pts, {(lo + hi - r, c) for r, c in pts})                 # top-bottom
                arc_left = {(r, c) for r in field for c in range(3, 31) if hx[r][c] == '#02A8A6'}
                self.assertEqual(min(c for _, c in arc_left), 4)                              # both ends of an arc reach the rim
                top_end = [c for r, c in arc_left if r == min(r for r, _ in arc_left)]
                bottom_end = [c for r, c in arc_left if r == max(r for r, _ in arc_left)]
                self.assertEqual(sorted(top_end), sorted(bottom_end))

    def test_each_goal_crease_is_one_unbroken_arc_from_rim_to_rim(self):
        """The art director found the camera75 arcs dashed: a 3 px bar and the next step left a one-pixel gap, so only a corner
        touched. Each arc must be a single 8-connected run whose two ends are on the playfield's edge."""
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                hx = hexes(piece)
                W = piece.size[0]
                field = [r for r in range(piece.size[1]) if hx[r][14] in set(AH.ICE)]
                pts = {(r, c) for r in field for c in range(W) if hx[r][c] == '#02A8A6'}
                for side in (lambda c: c < 32, lambda c: c >= 34):
                    arc = {x for x in pts if side(x[1])}
                    seen, todo = set(), [min(arc)]
                    while todo:
                        r, c = todo.pop()
                        if (r, c) in seen or (r, c) not in arc:
                            continue
                        seen.add((r, c))
                        todo += [(r + a, c + b) for a in (-1, 0, 1) for b in (-1, 0, 1)]
                    self.assertEqual(seen, arc)
                    edge = 4 if arc is not None and min(c for _, c in arc) < 32 else W - 5
                    ends = sorted(r for r, c in arc if c == edge)
                    self.assertEqual(ends[0], min(r for r, _ in arc))
                    self.assertEqual(ends[-1], max(r for r, _ in arc))

    def test_the_goal_creases_are_turquoise_arcs_on_the_playfield(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                hx = hexes(bake(p))
                crease = '#02A8A6'
                left = sum(1 for row in hx for c, v in enumerate(row) if v == crease and c < 32)
                right = sum(1 for row in hx for c, v in enumerate(row) if v == crease and c >= 34)
                self.assertGreater(left, 15)
                self.assertEqual(left, right)


class Richness(unittest.TestCase):
    """The audit: the rim and the apron were two unbroken single-tone masses, and the legs the apron's tone."""

    def test_the_rim_top_has_a_lighter_edge_on_all_four_sides(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                hx = hexes(piece)
                W = piece.size[0]
                far = [r for r in range(piece.size[1]) if hx[r][30] == AH.RIM_EDGE]
                # the near edge (the row just above the apron) always; the far edge (row 2) where the far rim top is deep enough to keep a
                # row inside the baker's 1 px outline: 3.2 rows in oblique, 2.4 in camera75
                self.assertEqual(len(far), 2 if p == 'oblique' else 1)
                if p == 'oblique':
                    self.assertEqual(far[0], 2)
                field = [r for r in range(piece.size[1]) if hx[r][14] in set(AH.ICE)]
                for r in [r for r in field if hx[r][2] != AH.BODY.ramp[0]]:                  # the sides, off the goal slots: the outer column inside the 1 px ink
                    self.assertEqual((hx[r][2], hx[r][W - 3]), (AH.RIM_EDGE, AH.RIM_EDGE), r)
                    self.assertEqual((hx[r][3], hx[r][W - 4]), (AH.RIM_RAMP[2], AH.RIM_RAMP[2]), r)

    def test_the_apron_has_two_mirrored_panel_seams_one_step_darker_and_no_left_right_light(self):
        """The art director: the apron was one flat navy with a stripe, the dullest area. Two 1 px seams a quarter and three
        quarters along; every apron row is the same left and right."""
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                hx = hexes(piece)
                W = piece.size[0]
                cls = column(piece, 30)
                top = cls.rindex('T') + 1
                rows = [r for r in range(top, len(cls)) if cls[r] == 'S' and hx[r][30] == AH.BODY.ramp[2]]
                self.assertGreaterEqual(len(rows), 5)
                for r in rows:
                    self.assertEqual((hx[r][17], hx[r][W - 18]), (AH.LEG, AH.LEG), r)             # the seams
                    self.assertEqual({hx[r][c] for c in range(3, W - 3)} - {AH.LEG}, {AH.BODY.ramp[2]})
                    self.assertEqual(hx[r], hx[r][::-1], r)                                       # mirror-symmetric: no baked side light
                self.assertEqual(sum(1 for c in range(W) if hx[rows[0]][c] == AH.LEG), 2)

    def test_the_legs_are_one_tone_below_the_apron(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                hx = hexes(piece)
                last = int(np.nonzero((piece.rgba[..., 3] == 255).any(1))[0].max())
                cls = column(piece, 30)
                apron = {hx[r][30] for r in range(cls.rindex('T') + 1, len(cls)) if cls[r] == 'S'}
                self.assertIn(AH.BODY.ramp[2], apron)                                        # the panel keeps the apron tone
                self.assertEqual({hx[last - 2][4], hx[last - 2][5]}, {AH.LEG})                # the near leg's 2 px of fill
                self.assertNotIn(AH.LEG, apron)
                self.assertNotEqual(AH.LEG, AH.BODY.ramp[2])


# ------------------------------------------------------------------------------------------------ determinism, patch

class Determinism(unittest.TestCase):
    def test_a_rebake_gives_the_same_bytes(self):
        for p in PROJECTIONS:
            with self.subTest(p):
                again = fresh_bake(p)
                self.assertEqual(sha(again), sha(bake(p)))
                self.assertEqual(again.provenance['recipe_hash'], bake(p).provenance['recipe_hash'])

    def test_the_two_projections_bake_the_same_recipe(self):
        self.assertEqual(bake('oblique').provenance['recipe_hash'], bake('camera75').provenance['recipe_hash'])


class OverridePatch(unittest.TestCase):
    EXPECTED = {'oblique': ('air_hockey.oblique.txt', 17), 'camera75': ('air_hockey.camera75.txt', 44)}

    def test_each_projection_has_a_small_patch_within_the_budget(self):
        for p, (name, n) in self.EXPECTED.items():
            with self.subTest(p):
                info = bake(p).metrics['override']
                self.assertEqual(info['file'], name)
                self.assertEqual(info['changed'], n)
                self.assertLessEqual(info['changed'], info['budget'])
                plain = bake(p, overrides=False)
                self.assertEqual(int((plain.rgba != bake(p).rgba).any(-1).sum()), n)
                self.assertEqual(int((plain.normal[..., 3] != bake(p).normal[..., 3]).sum()), 0)

    def test_the_circle_and_the_creases_are_exact_mirrors_with_the_patch_and_not_without(self):
        """The baker's sampling breaks the mirror, left-right and top-bottom, on a few 50% coverage ties; the patch restores it."""
        def mirror_errors(piece):
            hx = hexes(piece)
            W = piece.size[0]
            field = [r for r in range(piece.size[1]) if hx[r][14] in set(AH.ICE)]
            bad = 0
            for colour, cols in ((AH.MINT[2], [c for c in range(24, 42) if c not in (32, 33)]), ('#02A8A6', list(range(3, 31)) + list(range(35, 63)))):
                pts = {(r, c) for r in field for c in cols if hx[r][c] == colour}
                lo, hi = min(r for r, _ in pts), max(r for r, _ in pts)
                bad += len(pts ^ {(r, W - 1 - c) for r, c in pts}) + len(pts ^ {(lo + hi - r, c) for r, c in pts})
            return bad
        for p in PROJECTIONS:
            with self.subTest(p):
                self.assertEqual(mirror_errors(bake(p)), 0)
                self.assertGreater(mirror_errors(bake(p, overrides=False)), 0)

    def test_the_patch_gives_camera75_the_mallets_and_the_puck_its_squashed_rows_cannot(self):
        """Without it a camera75 mallet is a cross-shaped cap in a ring (6 rows hold no 3 x 2 cap), and the puck has a top-tone
        pixel notching its base row; oblique needs no such repair."""
        def shapes(piece):
            hx = hexes(piece)
            out = {}
            for which in ('mint', 'steel'):
                ramp = AH.MINT if which == 'mint' else AH.STEEL
                cells = mallet_cells(piece, which)
                cap = {(r, c) for r, c in cells if hx[r][c] == ramp[3]}
                rect = {(r, c) for r in range(min(r for r, _ in cap), max(r for r, _ in cap) + 1)
                        for c in range(min(c for _, c in cap), max(c for _, c in cap) + 1)}
                out[f'{which} cap is a rectangle'] = cap == rect
            proj = B.load_projection(piece.projection)
            row = int(piece.footprint['px']['y'] + proj.sy * AH.PUCK_Y - proj.sz * (AH.Z_FIELD + AH.ZP))
            puck = component(piece, (row, int(1 + proj.sx * AH.PUCK_X)), set(AH.PUCK))
            out['puck top px'] = sum(1 for r, c in puck if hx[r][c] == AH.PUCK[1])
            return out
        clean = {'mint cap is a rectangle': True, 'steel cap is a rectangle': True, 'puck top px': 6}    # the camera75 puck top is 3 + 3 px
        self.assertEqual(shapes(bake('camera75')), clean)
        self.assertEqual(shapes(bake('oblique', overrides=False)), dict(clean, **{'puck top px': 9}))   # 3 x 3 in oblique
        raw = shapes(bake('camera75', overrides=False))
        self.assertTrue(all(raw[k] != clean[k] for k in clean), raw)

    def test_the_apron_bottom_outline_is_one_unbroken_ink_row(self):
        """The art director found four lighter notches in the apron's bottom outline where a leg's fill overwrote it."""
        for p in PROJECTIONS:
            with self.subTest(p):
                piece = bake(p)
                hx = hexes(piece)
                cls = column(piece, 30)
                row = cls.rindex('S')
                ink = AH.BODY.ramp[0]
                self.assertEqual({hx[row][c] for c in range(2, piece.size[0] - 2)}, {ink})
                self.assertEqual({hx[row + 1][c] for c in (3, 4, 5, 6, piece.size[0] - 7)} - {None}, {AH.LEG, ink})   # the leg's own tone starts below it
                plain = hexes(bake(p, overrides=False))
                self.assertIn(AH.LEG, {plain[row][c] for c in range(2, piece.size[0] - 2)})           # without the patch the legs notch it

    def test_the_patches_touch_only_the_markings_the_game_pieces_and_the_leg_joins(self):
        """Nothing of the rim, the slots or the apron panel is hand-edited; below the playfield only the 8 leg-join pixels of the
        apron's bottom outline."""
        for p in PROJECTIONS:
            with self.subTest(p):
                plain, patched = bake(p, overrides=False), bake(p)
                a, b = plain.rgba, patched.rgba
                changed = np.argwhere((a != b).any(-1))
                self.assertTrue(len(changed))
                hx = hexes(patched)
                field = [r for r in range(patched.size[1]) if hx[r][14] in set(AH.ICE)]
                above = [(r, c) for r, c in changed.tolist() if r <= field[-1]]
                joins = [(r, c) for r, c in changed.tolist() if r > field[-1]]
                self.assertGreater(min(r for r, _ in above), field[0] - 1)                    # on the playfield, not the far rim
                self.assertGreater(min(c for _, c in above), 3)
                self.assertLess(max(c for _, c in above), patched.size[0] - 4)
                self.assertEqual(len(joins), 8)
                self.assertEqual(len({r for r, _ in joins}), 1)
                self.assertEqual({hx[r][c] for r, c in joins}, {AH.BODY.ramp[0]})


if __name__ == '__main__':
    unittest.main()
