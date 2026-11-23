"""Behaviour tests of the arc floor lamp (hq-office/props/arc_lamp.py), baked by tools/bake.py in both projections.

Each number below is written out here on purpose (32 px per metre across, 32 or 24 px per metre of depth, 21 px per metre
of height): these tests are an independent check of the piece against the plan (section 7.2 and 11), not against its own
constants. They pin what the audit found wrong in today's lamp: a baked light pool (70% of the visible px), a 38 px dome
that shows its underside, a base ellipse that is too flat, and a mirror pair shaded from three directions.

Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_prop_arc_lamp.py"""
import hashlib
import json
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
from props import arc_lamp as A  # noqa: E402

SX = 32.0
SY = {'oblique': 32.0, 'camera75': 24.0}
SZ = 21.0
PROJECTIONS = tuple(SY)
SIDES = ('left', 'right')

_cache = {}


def baked(side, projection):
    key = (side, projection)
    if key not in _cache:
        _cache[key] = B.bake(A.build(side), projection)
    return _cache[key]


def opaque(piece):
    return piece.rgba[..., 3] > 0


def hexes(piece):
    px = piece.rgba[opaque(piece)][:, :3]
    return {'#%02X%02X%02X' % tuple(int(v) for v in p) for p in px}


def runs(mask_row):
    """Lengths of the horizontal runs of True in one row, with their start columns."""
    out, start = [], None
    for x, v in enumerate(list(mask_row) + [False]):
        if v and start is None:
            start = x
        if not v and start is not None:
            out.append((start, x - start))
            start = None
    return out


class Bakes(unittest.TestCase):
    def test_both_sides_bake_in_both_projections_without_violations_or_warnings(self):
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                self.assertEqual(p.violations, [], (side, proj))
                self.assertEqual(p.warnings, [], (side, proj))
                self.assertEqual(p.projection, proj)

    def test_the_registry_finds_both_recipes_and_the_module_imports_cleanly(self):
        import props
        props.refresh()
        self.assertIn('arc-lamp-left', props.names())
        self.assertIn('arc-lamp-right', props.names())
        self.assertNotIn('arc_lamp', props.errors())

    def test_a_bad_side_is_refused(self):
        with self.assertRaises(ValueError):
            A.build('up')


class WhatTheAuditFoundWrong(unittest.TestCase):
    def test_no_light_pool_and_no_painted_shadow_every_pixel_is_solid(self):
        # today: 1,841 of 2,647 visible px are a warm semi-transparent pool plus 67 px of dark contact shadow
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                self.assertEqual(set(np.unique(p.rgba[..., 3]).tolist()), {0, 255}, (side, proj))
                px = p.rgba[opaque(p)][:, :3].astype(int)
                warm = (px[:, 0] > px[:, 2] + 8)
                self.assertFalse(warm.any(), f'a warm (pool or glow) pixel in {side} {proj}: {px[warm][:3].tolist()}')
                self.assertLess(int(opaque(p).sum()), 600, 'a lamp is a few hundred px, not a lit disc')

    def test_the_dome_is_45_cm_across_and_shows_no_underside(self):
        for proj in PROJECTIONS:
            p = baked('right', proj)
            top = p.rgba[..., :3].astype(int)
            dome_top = np.all(top == np.array([0x6F, 0x83, 0xA0]), axis=-1) & opaque(p)     # the steel top tone, shade only
            ys, xs = np.nonzero(dome_top)
            self.assertGreater(len(xs), 40, proj)
            # the whole shade: opaque px in the columns around the dome centre, rows of the shade
            hx, hy = p.anchors['light_head']
            cols = np.nonzero(opaque(p)[:, int(hx) - 9:int(hx) + 10].any(0))[0]
            widest = max(max(n for _, n in runs(opaque(p)[y]) if start_x_near(runs(opaque(p)[y]), hx, n)) for y in range(int(hy) - 8, int(hy) + 8)
                         if start_x_near(runs(opaque(p)[y]), hx, 1))
            self.assertTrue(13 <= widest <= 15, f'{proj}: dome {widest} px across, 0.45 m is 14 (today 38)')
            self.assertGreater(len(cols), 0)

    def test_the_shade_is_wider_than_it_is_tall_in_both_projections_so_it_is_a_dome_not_a_ball(self):
        # the art director's finding: 18 rows by 15 columns in the oblique view, a bead on a stick
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                hx, hy = p.anchors['light_head']
                m = opaque(p)
                rows = [y for y in range(int(p.foot[1]) - 20) if any(s <= hx < s + n and n >= 8 for s, n in runs(m[y]))]
                width = max(n for y in rows for s, n in runs(m[y]) if s <= hx < s + n)
                height = rows[-1] - rows[0] + 1
                self.assertTrue(13 <= width <= 17, f'{side} {proj}: shade {width} px across')
                self.assertLess(height, width, f'{side} {proj}: shade {height} rows tall, {width} across')

    def test_the_shade_shows_no_underside_its_opening_faces_down_and_is_never_drawn(self):
        # the model: no surface of the shade points below the horizon, so the opening (the underside) has no samples at all
        s = A._dome(0.0).sample(0.01)
        self.assertGreater(len(s), 1000)
        self.assertGreaterEqual(float(s.N[:, 2].min()), -1e-9)
        # the picture: the lowest row of the shade is the dark outline only, there is no light interior under the rim
        for proj in PROJECTIONS:
            p = baked('right', proj)
            hx, hy = p.anchors['light_head']
            m = opaque(p)
            window = m[:, int(hx) - 7:int(hx) + 8]
            bottom = int(np.nonzero(window[:int(p.foot[1]) - 20].any(1))[0].max())      # above the base, so the shade's last row
            row = p.rgba[bottom, int(hx) - 7:int(hx) + 8][window[bottom]][:, :3]
            ink = {(0x05, 0x06, 0x1A), (0x0B, 0x14, 0x41), (0x14, 0x21, 0x60)}
            self.assertTrue(all(tuple(int(v) for v in px) in ink for px in row), f'{proj}: light px on the shade underside: {row.tolist()}')

    def test_the_base_is_a_plate_16_px_across_and_wider_than_it_is_tall(self):
        # the art director's finding on the round 0.44 m disc: 17 rows by 14 columns in the oblique view, an egg that reads
        # as a ball. The base is an oval plate now: 16 px across and fewer rows than columns in both projections.
        for proj in PROJECTIONS:
            p = baked('right', proj)
            fx, fy = p.foot
            m = opaque(p)
            window = m[int(fy) - 18:int(fy), max(0, int(fx) - 9):int(fx) + 9]
            wide = [int(max((n for _, n in runs(r)), default=0)) for r in window]
            rows = sum(1 for w in wide if w >= 8)
            self.assertTrue(15 <= max(wide) <= 17, f'{proj}: base {max(wide)} px across')
            self.assertLess(rows, max(wide) - 1, f'{proj}: base {rows} rows against {max(wide)} columns')
            self.assertGreaterEqual(rows, 9, f'{proj}: base only {rows} rows')

    def test_the_pole_is_three_pixels_thick(self):
        for proj in PROJECTIONS:
            p = baked('right', proj)
            fx, fy = p.foot
            base_top = int(fy) - 16
            thick = []
            for y in range(base_top - 14, base_top - 4):          # the near-vertical part of the pole, above the base
                thick += [n for s, n in runs(opaque(p)[y]) if abs(s - fx) < 9]
            self.assertTrue(thick and all(3 <= n <= 5 for n in thick), f'{proj}: pole runs {thick}')

    def test_the_arc_rises_44_px_above_the_base_contact_point(self):
        # plan section 11: 44 +-1 px from the base contact line to the apex (2.1 m x 21 px)
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                rows = np.nonzero(opaque(p).any(1))[0]
                apex = p.anchors['base'][1] - float(rows.min())
                self.assertTrue(43.0 <= apex <= 45.0, f'{side} {proj}: apex {apex:.2f} px above the base contact')
                self.assertTrue(43 <= int(p.height.max()) <= 45, f'{side} {proj}: height map max {int(p.height.max())}')

    def test_the_dome_hangs_1_1_m_sideways_and_1_55_m_up_and_the_light_head_is_its_opening_centre(self):
        for side, sign in (('right', 1), ('left', -1)):
            for proj in PROJECTIONS:
                p = baked(side, proj)
                bx, by = p.anchors['base']
                hx, hy = p.anchors['light_head']
                self.assertAlmostEqual(hx - bx, sign * 1.1 * SX, delta=0.5, msg=f'{side} {proj}')
                # the head is 1.55 m up (the dome's rim; the dome's middle is about 1.6 m, as briefed) at the base's depth
                self.assertAlmostEqual(by - hy, 1.55 * SZ, delta=0.5, msg=f'{side} {proj}')
                dome = np.all(p.rgba[..., :3] == np.array([0x6F, 0x83, 0xA0]), axis=-1) & opaque(p)
                mid = int((hx + bx) / 2)             # the base's own bright edge is the same tone: look at the dome's half only
                if sign > 0:
                    dome[:, :mid] = False
                else:
                    dome[:, mid:] = False
                cx = float(np.nonzero(dome)[1].mean())
                self.assertAlmostEqual(cx, hx, delta=1.5, msg=f'{side} {proj}: the shade is centred on the head anchor')

    def test_the_foot_is_the_base_front_the_canvas_ends_there_and_there_is_no_foot_gap(self):
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                w, h = p.size
                self.assertLessEqual(p.metrics['foot_gap'], 1)
                self.assertEqual(p.foot[1], h, 'the last canvas row is the footprint front edge')
                rows = np.nonzero(opaque(p).any(1))[0]
                self.assertGreaterEqual(int(rows.max()), h - 2)
                base_cols = np.nonzero(opaque(p)[-6:].any(0))[0]
                self.assertAlmostEqual((base_cols.min() + base_cols.max() + 1) / 2, p.foot[0], delta=1.0)
                self.assertEqual(p.sort_line, h)
                self.assertEqual(p.depth_offset, 0)

    def test_the_canvas_is_at_most_56_square_and_smaller_than_today_s(self):
        today = {'Konclui sprite in the build': 110 * 96, 'one Mobilia sprite': 64 * 64}
        for side in SIDES:
            for proj in PROJECTIONS:
                w, h = baked(side, proj).size
                self.assertLessEqual(max(w, h), 56, f'{side} {proj}')
                for name, px in today.items():
                    self.assertLess(w * h, px, f'{side} {proj} against {name}')


class Look(unittest.TestCase):
    def test_at_most_12_colours_all_on_the_office_palette(self):
        self.assertGreater(len(V.ON_PALETTE), 0, 'tools/palettes/office.hex is missing')
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                self.assertLessEqual(p.metrics['colours'], 12, f'{side} {proj}')
                self.assertGreaterEqual(p.metrics['colours'], 5, 'a flat lamp would not be drawn')
                self.assertEqual(sorted(hexes(p) - V.ON_PALETTE), [], f'{side} {proj}')

    def test_every_tone_is_a_real_region_not_a_sliver_of_a_few_pixels(self):
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                px = p.rgba[opaque(p)][:, :3]
                tones, counts = np.unique(px, axis=0, return_counts=True)
                self.assertGreaterEqual(int(counts.min()), 20, f'{side} {proj}: a tone of {int(counts.min())} px')

    def test_the_outline_is_the_darkest_tone_all_round(self):
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                self.assertGreaterEqual(p.metrics['outline_fraction'], 0.9)
                bnd = B._boundary(p.rgba[..., 3])
                ink = np.all(p.rgba[..., :3] == np.array([0x05, 0x06, 0x1A]), axis=-1)
                self.assertTrue((bnd & ink).sum() / bnd.sum() >= 0.9, f'{side} {proj}')

    def test_no_stray_pixels_every_opaque_pixel_touches_another(self):
        for side in SIDES:
            for proj in PROJECTIONS:
                m = opaque(baked(side, proj)).astype(np.int8)
                n4 = sum(B._shift(m, dy, dx) for dy, dx in B.N4)
                self.assertFalse(((m == 1) & (n4 == 0)).any(), f'{side} {proj}')

    def test_the_left_picture_is_the_right_model_mirrored_not_a_pixel_flip(self):
        for proj in PROJECTIONS:
            r, l = baked('right', proj), baked('left', proj)
            self.assertEqual(r.size, l.size)
            self.assertTrue(np.array_equal(r.rgba, l.rgba[:, ::-1]), proj)
            self.assertTrue(np.array_equal(r.height, l.height[:, ::-1]), proj)
            self.assertFalse(np.array_equal(r.rgba, l.rgba), 'the two sides are different pictures')
            self.assertAlmostEqual(r.anchors['light_head'][0] + l.anchors['light_head'][0] - r.foot[0] - l.foot[0], 0.0, delta=1e-6)
            # the model itself differs: the dome is built on the other side, not mirrored after the bake
            self.assertGreater(A.build('right').anchors['light_head'][0], 1.0)
            self.assertLess(A.build('left').anchors['light_head'][0], 0.0)

    def test_the_left_normal_map_is_mirrored_with_its_x_component_flipped(self):
        r, l = baked('right', 'oblique'), baked('left', 'oblique')
        m = opaque(r)
        nr = r.normal[..., :3].astype(int)
        nl = l.normal[:, ::-1, :3].astype(int)
        # n.x of the mirrored model is -n.x: encoded 255 - c (within one step of rounding); n.y and n.z are unchanged
        self.assertTrue((np.abs((255 - nl[..., 0]) - nr[..., 0])[m] <= 2).all())
        self.assertTrue((np.abs(nl[..., 1] - nr[..., 1])[m] <= 2).all())
        self.assertTrue((np.abs(nl[..., 2] - nr[..., 2])[m] <= 2).all())

    def test_the_footprint_is_one_tile_and_only_the_dome_side_overhangs(self):
        self.assertEqual(A.build('right').footprint, (1.0, 1.0))
        self.assertEqual(set(A.build('right').overhangs), {'east'})
        self.assertEqual(set(A.build('left').overhangs), {'west'})
        for side in SIDES:
            fp = baked(side, 'oblique').footprint
            self.assertEqual(fp['tiles'], (1.0, 1.0))
            self.assertEqual((fp['px']['w'], fp['px']['h']), (32, 32))

    def test_the_normal_map_is_exact_on_opaque_pixels_and_unit_length(self):
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                self.assertTrue(np.array_equal(p.normal[..., 3], p.rgba[..., 3]))
                n = p.normal[..., :3].astype(float) / 255.0 * 2 - 1
                length = np.linalg.norm(n[opaque(p)], axis=-1)
                self.assertLess(float(np.abs(length - 1).max()), 0.0136, f'{side} {proj}')


def components(mask):
    """4-connected components of a boolean mask, as a list of lists of (row, col)."""
    seen = np.zeros(mask.shape, bool)
    out = []
    for y, x in zip(*np.nonzero(mask)):
        if seen[y, x]:
            continue
        seen[y, x] = True
        stack, comp = [(y, x)], []
        while stack:
            a, b = stack.pop()
            comp.append((a, b))
            for dy, dx in B.N4:
                yy, xx = a + dy, b + dx
                if 0 <= yy < mask.shape[0] and 0 <= xx < mask.shape[1] and mask[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    stack.append((yy, xx))
        out.append(comp)
    return out


def dome_half(piece, side):
    """Columns on the dome's side of the midpoint between the base and the light head."""
    hx, bx = piece.anchors['light_head'][0], piece.anchors['base'][0]
    mid = int((hx + bx) / 2)
    keep = np.zeros(opaque(piece).shape, bool)
    if side == 'right':
        keep[:, mid:] = True
    else:
        keep[:, :mid] = True
    return keep


def rising_runs(piece, side):
    """Rows per one-column step of the pole's outer edge, from the base up to the apex (the near-vertical and sloping part)."""
    m = opaque(piece)
    hx = piece.anchors['light_head'][0]
    inner = int(hx - 8) if side == 'right' else int(hx + 8)
    edge = []
    for y in range(int(piece.foot[1]) - 17, -1, -1):
        xs = np.nonzero(m[y, :inner] if side == 'right' else m[y, inner:])[0]
        if len(xs):
            edge.append(int(xs.min()) if side == 'right' else int(xs.max()))
    runs = []
    for i, v in enumerate(edge):
        if i and v == edge[i - 1]:
            runs[-1] += 1
        else:
            runs.append(1)
    return runs


POLE_TONES = {'#05061A', '#0B1441', '#142160'}


class ArtDirectorFindings(unittest.TestCase):
    """The review of the first bake (5 of 10, not drawn): a ball for a shade, a wedge splitting its highlight, a puck for a
    base, a cobalt pole on a black lamp, a lumpy arc, no detail. Each test fails on that earlier picture."""

    def test_the_shade_is_a_lit_crown_disc_inside_a_ring_not_a_ball_with_a_crescent(self):
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                m = opaque(p)
                crown = np.all(p.rgba[..., :3] == np.array([0x6F, 0x83, 0xA0]), axis=-1) & m & dome_half(p, side)
                big = max(components(crown), key=len)
                ys, xs = zip(*big)
                self.assertGreaterEqual(len(big), 20, f'{side} {proj}: the crown disc is {len(big)} px')
                self.assertTrue(9 <= max(xs) - min(xs) + 1 <= 12, f'{side} {proj}')
                # the widest crown row: a ring of 1 to 4 px (the outline and the rim) on both sides, of the same width (no baked side light)
                row = max(set(ys), key=lambda y: ys.count(y))
                cols = sorted(x for y, x in big if y == row)
                hx = p.anchors['light_head'][0]
                sil = [x for x in np.nonzero(m[row])[0] if abs(x - hx) < 12]
                left, right = cols[0] - min(sil), max(sil) - cols[-1]
                self.assertTrue(1 <= left <= 4 and 1 <= right <= 4 and abs(left - right) <= 1, f'{side} {proj}: ring {left}|{right}')
                # the pole enters the crown through its centre: its body tone inside the crown's box is one stem of at most
                # 4 columns around the head column, not a wedge splitting the highlight
                box = p.rgba[min(ys):max(ys) + 1, min(xs):max(xs) + 1, :3].astype(int)
                dark = np.all(box == np.array([0x0B, 0x14, 0x41]), axis=-1)          # the pole's body tone, used by nothing else
                cx = np.nonzero(dark.any(0))[0] + min(xs)
                if len(cx):
                    self.assertLessEqual(int(cx.max() - cx.min() + 1), 4, f'{side} {proj}: pole columns {cx.tolist()}')
                    self.assertLessEqual(abs(float(cx.mean()) - (hx - 0.5)), 1.5, f'{side} {proj}: the stem is off the crown centre')

    def test_the_shade_has_five_tones_and_the_pole_ends_in_a_small_collar_on_the_crown_centre(self):
        for proj in PROJECTIONS:
            p = baked('right', proj)
            hx, hy = (int(v) for v in p.anchors['light_head'])
            shade = p.rgba[hy - 8:hy + 9, hx - 8:hx + 9]
            tones = {'#%02X%02X%02X' % tuple(int(v) for v in px[:3]) for px in shade.reshape(-1, 4) if px[3]}
            self.assertGreaterEqual(len(tones), 5, f'{proj}: {sorted(tones)}')
        # the model: a collar disc of about 0.06 m radius stands on the crown's centre and the arc ends over it
        r = A.build('right')
        self.assertTrue(0.04 <= A.NECK_R <= 0.08)
        self.assertLess(A.NECK_R, A.CROWN_R / 2 + 0.001)
        self.assertEqual(len(r.solids), 7)
        end = A._arc_path(1.0, 0.2, 1.7)[-1]
        self.assertAlmostEqual(end[0], r.anchors['light_head'][0], places=6, msg='the arc ends over the shade centre column')

    def test_the_pole_is_black_metal_not_cobalt(self):
        for side in SIDES:
            for proj in PROJECTIONS:
                p = baked(side, proj)
                self.assertNotIn('#1F2E78', hexes(p), 'the saturated cobalt of the first bake')
                fx, fy = p.foot
                m = opaque(p)
                for y in range(int(fy) - 34, int(fy) - 20):          # the rising part of the pole, clear of the base
                    row = [x for x in range(m.shape[1]) if m[y, x] and abs(x - fx) < 14]
                    tones = {'#%02X%02X%02X' % tuple(int(v) for v in p.rgba[y, x, :3]) for x in row}
                    self.assertTrue(tones and tones <= POLE_TONES, f'{side} {proj} row {y}: {tones}')
                self.assertEqual(sum(1 for t in POLE_TONES if t in hexes(p)), 3, 'the pole uses its whole three-tone ramp')
                self.assertNotIn('#0A0F33', hexes(p), 'the near-duplicate sliver tone the art director found on two pixels')

    def test_the_arc_steps_in_order_each_run_of_rows_is_no_longer_than_the_one_below_it(self):
        for side in SIDES:
            for proj in PROJECTIONS:
                runs = rising_runs(baked(side, proj), side)[1:]          # the first run is cut by the base
                rises = [(i, runs[i - 1], runs[i]) for i in range(1, len(runs)) if runs[i] > runs[i - 1]]
                self.assertEqual(rises, [], f'{side} {proj}: runs {runs}')
                self.assertGreaterEqual(len(runs), 12, f'{side} {proj}: {runs}')

    def test_the_base_has_a_bright_top_edge_a_front_band_and_a_collar_disc(self):
        for proj in PROJECTIONS:
            p = baked('right', proj)
            fx, fy = p.foot
            fx, fy = int(fx), int(fy)
            col = p.rgba[:, fx, :3]                      # the centre column through the base, south to north
            seq = ['#%02X%02X%02X' % tuple(int(v) for v in col[y]) for y in range(fy - 1, fy - 20, -1) if opaque(p)[y, fx]]
            self.assertIn('#2B3A78', seq, f'{proj}: no front band in the base column {seq}')
            top = seq.index('#46566E')
            self.assertGreaterEqual(seq.index('#2B3A78') - 0, 1)
            self.assertLess(seq.index('#2B3A78'), top, 'the band is south of (below) the top face')
            self.assertIn('#6F83A0', hexes(p))
            band = sum(1 for t in seq if t == '#2B3A78')
            self.assertTrue(2 <= band <= 4, f'{proj}: front band {band} px tall')

    def test_no_light_from_the_left_or_right_the_shade_and_base_are_symmetric_about_the_vertical_axis(self):
        for proj in PROJECTIONS:
            p = baked('right', proj)
            hx = p.anchors['light_head'][0]
            hy = int(p.anchors['light_head'][1])
            window = p.rgba[hy - 7:hy + 8, int(hx) - 8:int(hx) + 8]
            for tone in ('#6F83A0', '#46566E', '#2B3A78', '#142160', '#1F2E78', '#05061A'):
                rgb = np.array(tuple(int(tone[i:i + 2], 16) for i in (1, 3, 5)))
                mask = np.all(window[..., :3] == rgb, axis=-1) & (window[..., 3] > 0)
                cut = int(round(hx - (int(hx) - 8)))
                a, b = int(mask[:, :cut].sum()), int(mask[:, cut:].sum())
                self.assertLessEqual(abs(a - b), 5, f'{proj} {tone}: {a} left, {b} right')

    def test_the_anchors_are_where_the_json_says_and_the_old_bulb_rect_has_a_new_home(self):
        for proj in PROJECTIONS:
            p = baked('right', proj)
            hx, hy = p.anchors['light_head']
            fx, fy = p.anchors['foot']
            # the head is the opening's centre: 1.1 m across and 1.55 m up from the base, in canvas px
            self.assertAlmostEqual(hx - p.anchors['base'][0], 1.1 * SX, delta=0.5)
            self.assertAlmostEqual(p.anchors['base'][1] - hy, 1.55 * SZ, delta=0.5)
            # and it falls inside the shade's silhouette, in its lower half (the opening faces down)
            m = opaque(p)
            rows = np.nonzero(m[:, int(hx) - 4:int(hx) + 5][:int(fy) - 22].any(1))[0]
            top, bottom = int(rows.min()), int(rows.max())
            self.assertTrue(top < hy < bottom, f'{proj}')


class SquashHelper(unittest.TestCase):
    """The kit has no non-uniform scale, so the recipe squashes the base and the shade in y with its own wrapper."""

    def test_a_squashed_wall_keeps_unit_outward_normals_perpendicular_to_its_surface(self):
        ky, cy = 0.76, 0.6
        wall = V.lathe([(0.2, 0.0), (0.2, 0.1)], 0.5, cy, 'base')
        s = A._Squash(wall, cy, ky).sample(0.01)
        self.assertGreater(len(s), 100)
        self.assertLess(float(np.abs(np.linalg.norm(s.N, axis=1) - 1).max()), 1e-9)
        dx, dy = s.P[:, 0] - 0.5, s.P[:, 1] - cy
        self.assertLess(float(np.abs((dx / 0.2) ** 2 + (dy / (0.2 * ky)) ** 2 - 1).max()), 1e-9, 'the wall is an ellipse')
        tangent = np.stack([-dy / ky, dx * ky, np.zeros_like(dx)], axis=1)          # d/dt of (a cos t, b sin t)
        self.assertLess(float(np.abs((s.N * tangent).sum(1)).max()), 1e-9, 'normals are perpendicular to the surface')
        self.assertGreater(float((s.N[:, 0] * dx + s.N[:, 1] * dy).min()), 0.0, 'normals point outward')

    def test_the_squash_leaves_x_and_z_alone(self):
        wall = V.lathe([(0.2, 0.0), (0.2, 0.1)], 0.5, 0.6, 'base')
        a, b = wall.sample(0.02), A._Squash(wall, 0.6, 0.76).sample(0.02)
        self.assertTrue(np.array_equal(a.P[:, [0, 2]], b.P[:, [0, 2]]))


class Deterministic(unittest.TestCase):
    def test_a_rebake_gives_the_same_bytes_and_the_same_recipe_hash(self):
        for proj in PROJECTIONS:
            a = B.bake(A.build('right'), proj)
            b = B.bake(A.build('right'), proj)
            for name in ('rgba', 'normal', 'height'):
                self.assertEqual(hashlib.sha256(getattr(a, name).tobytes()).hexdigest(),
                                 hashlib.sha256(getattr(b, name).tobytes()).hexdigest(), (proj, name))
            self.assertEqual(a.provenance['recipe_hash'], b.provenance['recipe_hash'])

    def test_files_written_twice_are_identical(self):
        with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
            for d in (d1, d2):
                baked('right', 'oblique').write(d)
            for name in ('arc-lamp-right.png', 'arc-lamp-right.normal.png', 'arc-lamp-right.height.png', 'arc-lamp-right.json'):
                self.assertEqual((Path(d1) / name).read_bytes(), (Path(d2) / name).read_bytes(), name)

    def test_the_json_carries_the_light_head_and_the_foot_in_canvas_px(self):
        with tempfile.TemporaryDirectory() as d:
            baked('right', 'oblique').write(d)
            j = json.loads((Path(d) / 'arc-lamp-right.json').read_text())
        self.assertEqual(j['foot'], j['anchors']['foot'])
        self.assertIn('light_head', j['anchors'])
        self.assertIn('base', j['anchors'])
        self.assertEqual(j['projection'], 'oblique')


def start_x_near(run_list, hx, min_len):
    """True when the row has a run of at least min_len px that contains the column of the dome centre."""
    return any(s <= hx < s + n and n >= min_len for s, n in run_list)


if __name__ == '__main__':
    unittest.main()
