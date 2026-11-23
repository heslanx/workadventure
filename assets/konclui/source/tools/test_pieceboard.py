"""Behaviour tests of tools/pieceboard.py (the acceptance board) on fixture recipes, a fixture build and a fixture floor
picture, plus a smoke test on a real build when KONCLUI_DIST names one and KONCLUI_FLOOR_VIEW names the shader lab's
unlit lounge picture of that build (lounge/off.png).

Run (from assets/konclui/source): python3 -I tools/test_pieceboard.py
PIECEBOARD_FILE=/path/to/pieceboard.py python3 -I tools/test_pieceboard.py   tests a mutant copy instead (how each test was
checked to fail without its behaviour)."""
import contextlib
import hashlib
import importlib.util
import io
import json
import math
import os
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


def load_module():
    target = os.environ.get('PIECEBOARD_FILE')
    if not target:
        import pieceboard
        return pieceboard
    spec = importlib.util.spec_from_file_location('pieceboard_under_test', target)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


P = load_module()

VIEW = (80, 30, 64, 64)
WOOD_A, WOOD_B = (240, 214, 178), (217, 186, 149)
OLD_BODY = (200, 40, 40)
BIG = ('import volume as V\nRECIPE = V.Recipe("fx-big", [V.box(0, 0, 0, 1, 1, 0.5, "wood")], (1, 1))\n')
SMALL = ('import volume as V\nRECIPE = V.Recipe("fx-small", [V.box(0.25, 0.5, 0, 0.75, 1.0, 0.25, "wood")], (1, 1))\n')
LEGS = ('import volume as V\nRECIPE = V.Recipe("fx-legs", [V.box(0.1, 0.05, 0, 0.2, 0.15, 0.4, "wood"), '
        'V.box(0.1, 0.85, 0, 0.2, 0.95, 0.4, "wood")], (1, 1))\n')


def old_sprite():
    """20 x 40: a solid red body on rows 5..29 and a translucent painted shadow under it on rows 30..33."""
    a = np.zeros((40, 20, 4), np.uint8)
    a[5:30, 4:16] = OLD_BODY + (255,)
    a[30:34, 2:18] = (0, 0, 0, 40)
    return a


def floor_colour(wx, wy):
    return WOOD_A if ((wx // 4) + (wy // 4)) % 2 == 0 else WOOD_B


def make_picture(path, placements, sprite, view=VIEW, k=2):
    x0, y0, w, h = view
    pic = np.zeros((h, w, 3), np.uint8)
    for j in range(h):
        for i in range(w):
            pic[j, i] = floor_colour(x0 + i, y0 + j)
    for (px, py) in placements:
        sh, sw = sprite.shape[:2]
        for j in range(sh):
            for i in range(sw):
                X, Y = px - x0 + i, py - y0 + j
                if sprite[j, i, 3] >= 128 and 0 <= X < w and 0 <= Y < h:
                    pic[Y, X] = sprite[j, i, :3]
    Image.fromarray(np.repeat(np.repeat(pic, k, 0), k, 1), 'RGB').save(path)
    return pic


def make_dist(root, placements=((90, 40), (120, 45))):
    root = Path(root)
    (root / 'entities' / 'fx' / 'sprites').mkdir(parents=True)
    Image.fromarray(old_sprite(), 'RGBA').save(root / 'entities' / 'fx' / 'sprites' / 'fx-old.png')
    (root / 'entities' / 'fx' / 'collection.json').write_text(json.dumps(
        {'collectionName': 'Fixture', 'collection': [{'id': 'fx-old', 'name': 'old', 'imagePath': 'sprites/fx-old.png'}]}))
    (root / 'office.wam').write_text(json.dumps({
        'entities': {f'e{i}': {'x': x, 'y': y, 'name': 'old', 'prefabRef': {'collectionName': 'Fixture', 'id': 'fx-old'}}
                     for i, (x, y) in enumerate(placements)},
        'entityCollections': [{'url': 'entities/fx/collection.json', 'type': 'file'}]}))
    return root


class Fixture(unittest.TestCase):
    """A temp dir with a fixture build, floor picture, recipe files and a --map file."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        t = Path(self.tmp.name)
        self.dist = make_dist(t / 'dist')
        self.floor = t / 'floor.png'
        self.pic1x = make_picture(self.floor, [(90, 40), (120, 45)], old_sprite())
        self.recipes = t / 'recipes'
        self.recipes.mkdir()
        for name, src in (('fx_big.py', BIG), ('fx_small.py', SMALL), ('fx_legs.py', LEGS)):
            (self.recipes / name).write_text(src)
        self.mapfile = t / 'map.json'
        self.write_map({})
        self.out = t / 'out'

    def write_map(self, plans):
        m = {'fx-big': {'recipe': str(self.recipes / 'fx_big.py'), 'prefabs': ['fx-old'], 'plan': plans.get('fx-big', {})},
             'fx-small': {'recipe': str(self.recipes / 'fx_small.py'), 'prefabs': ['fx-old'], 'plan': plans.get('fx-small', {})}}
        self.mapfile.write_text(json.dumps(m))
        self.catalogue = P.load_map(self.mapfile)

    def entries(self, names=('fx-big', 'fx-small'), projections=('oblique', 'camera75'), **kw):
        return P.make_entries(list(names), P.Dist(self.dist), list(projections), {**P.CATALOGUE, **self.catalogue}, **kw)

    def run_all(self, names=('fx-big', 'fx-small'), **kw):
        return P.run(list(names), self.dist, self.floor, self.out, VIEW, ('oblique', 'camera75'), catalogue=self.catalogue, **kw)


# ------------------------------------------------------------------------------------------------ today's sprite and placement

class TodaysSprite(Fixture):
    def test_foot_is_the_bottom_of_the_solid_pixels_not_of_the_painted_shadow(self):
        # rows 5..29 are solid (y 30 is the first row below them), rows 30..33 a translucent painted shadow
        self.assertEqual(P.measure_foot(old_sprite()), (10, 30))

    def test_old_metrics_match_the_audit_definitions(self):
        old = P.Old('fx-old', 'x.png', old_sprite())
        m = P.old_metrics(old)
        self.assertEqual((m['canvas_px'], m['solid_px'], m['semi_px'], m['foot_gap'], m['height_px']), (800, 300, 64, 10, 25))
        self.assertEqual(m['colours_solid'], 1)

    def test_new_picture_stands_on_todays_foot_and_matches_the_bakers_shift(self):
        e = self.entries(('fx-big',))[0]
        for proj in ('oblique', 'camera75'):
            piece = e.pieces[proj]
            dx, dy = e.shift_for(e.old, proj)
            self.assertEqual((dx, dy), (piece.shift['dx'], piece.shift['dy']))
            nx, ny = 90 + dx, 40 + dy
            self.assertEqual((nx + rnd(piece.foot[0]), ny + rnd(piece.foot[1])), (90 + e.old.foot[0], 40 + e.old.foot[1]))

    def test_placements_come_from_the_wam(self):
        e = self.entries(('fx-big',))[0]
        self.assertEqual(e.placements['fx-old'], [(90, 40), (120, 45)])


def rnd(v):
    return int(math.floor(v + 0.5))


# --------------------------------------------------------------------------------------------------------------- cast shadow

class Shadow(unittest.TestCase):
    def test_one_pixel_of_height_ten_sweeps_to_the_lower_right_by_point_six(self):
        solid = np.zeros((20, 20), bool)
        solid[5, 5] = True
        height = np.zeros((20, 20))
        height[5, 5] = 10
        ground = np.full((20, 20), 15.0)
        mask, (ox, oy) = P.sweep_shadow(solid, ground, height)
        ys, xs = np.nonzero(mask)
        tip = 0.6 * 10 * math.sqrt(0.5)                     # 4.24 px along each axis
        self.assertEqual((xs.min() - ox, ys.min() - oy), (5, 15))                 # the ground point
        self.assertEqual((xs.max() - ox, ys.max() - oy), (int(5.5 + tip), int(15.5 + tip)))
        self.assertTrue(mask[int(15.5 + tip / 2) + oy, int(5.5 + tip / 2) + ox])  # the segment is filled in between

    def test_the_old_way_roots_every_pixel_at_the_foot_row(self):
        a = np.zeros((20, 12, 4), np.uint8)
        a[0:10, 5] = (9, 9, 9, 255)                         # a post, 10 rows above the foot
        old = P.Old('x', 'x.png', a, foot=(5, 10))
        mask, (ox, oy) = P.shadow_of_old(old)
        ys, xs = np.nonzero(mask)
        self.assertGreaterEqual(ys.min() - oy, 10)          # nothing above the foot row: a shear, not a surface sweep
        self.assertEqual(xs.max() - ox, int(5.5 + 0.6 * 10 * math.sqrt(0.5)))

    def test_a_baked_pieces_shadow_is_rooted_at_row_plus_height(self):
        piece = B.bake(V.Recipe('fx-box', [V.box(0, 0, 0, 1, 1, 0.5, 'wood')], (1, 1)), 'oblique')
        mask, (ox, oy) = P.shadow_of_piece(piece)
        top_of_footprint = piece.sort_line - piece.footprint['px']['h']
        self.assertGreaterEqual(np.nonzero(mask)[0].min() - oy, top_of_footprint - 1)   # not above the footprint's far edge
        st = P.shadow_stats(mask, (ox, oy), piece.foot)
        self.assertLessEqual(st['contact_px'], 2)
        self.assertEqual(st['components'], 1)

    def test_components_counts_separate_blobs(self):
        m = np.zeros((10, 10), bool)
        m[1, 1] = m[2, 2] = True                            # one, joined on the diagonal
        m[7, 7] = True
        self.assertEqual(P.components(m), 2)


# ----------------------------------------------------------------------------------------------------------------- the floor

class FloorPicture(Fixture):
    def test_periodic_floor_is_rebuilt_under_an_entity(self):
        pic = np.array(Image.open(self.floor).convert('RGB'))[::2, ::2]
        occ = P.entity_mask(P.Dist(self.dist), VIEW)
        self.assertGreater(int(occ.sum()), 300)
        floor = P.Floor(pic, VIEW, occ)
        self.assertEqual(floor.period, (8, 8))
        got = floor.fill(0, 0, VIEW[2], VIEW[3])
        want = np.array([[floor_colour(VIEW[0] + i, VIEW[1] + j) for i in range(VIEW[2])] for j in range(VIEW[3])], np.uint8)
        self.assertTrue((got == want).all())                # also where the entity hides the real floor

    def test_the_strip_continues_the_floor_below_the_picture(self):
        pic = np.array(Image.open(self.floor).convert('RGB'))[::2, ::2]
        floor = P.Floor(pic, VIEW, P.entity_mask(P.Dist(self.dist), VIEW))
        strip = floor.fill(0, VIEW[3], 8, 8)
        want = np.array([[floor_colour(VIEW[0] + i, VIEW[1] + VIEW[3] + j) for i in range(8)] for j in range(8)], np.uint8)
        self.assertTrue((strip == want).all())

    def test_view_is_reduced_by_the_enlargement_factor(self):
        warnings = []
        pic = P.load_view(self.floor, VIEW, warnings)
        self.assertEqual(pic.shape, (VIEW[3], VIEW[2], 3))
        self.assertTrue((pic == self.pic1x).all())
        self.assertEqual(warnings, [])
        with self.assertRaises(ValueError):
            P.load_view(self.floor, (0, 0, 50, 64), [])


# ---------------------------------------------------------------------------------------------------------------- the scene

class Scene(Fixture):
    def scene(self, name, projection='oblique'):
        e = self.entries((name,))
        pic = P.load_view(self.floor, VIEW, [])
        floor = P.Floor(pic, VIEW, P.entity_mask(P.Dist(self.dist), VIEW))
        scene, comp, rep = P.make_scene(e, projection, pic, VIEW, floor, P.Dist(self.dist))
        return e[0], pic, scene, comp, rep

    def test_todays_piece_is_not_painted_out_when_it_stays_visible(self):
        e, pic, scene, comp, rep = self.scene('fx-small')
        pl = rep['pieces']['fx-small']['placements'][0]
        self.assertGreater(pl['old_still_visible_px'], 0)
        self.assertEqual(pl['drawn'], 'outline only')
        crop = scene[:VIEW[3]]
        changed = (crop != pic).any(-1)
        self.assertTrue(changed.any())
        self.assertTrue((crop[changed] == np.array(P.MAGENTA)).all())            # only the magenta outline differs
        outline = P.silhouette_outline(e.pieces['oblique'].rgba)
        n_in_view = sum(1 for p in rep['pieces']['fx-small']['placements'] if p['in_view'])
        self.assertEqual(n_in_view, 2)
        self.assertLessEqual(int(changed.sum()), n_in_view * int(outline.sum()))   # no more than the 1 px outlines moved

    def test_new_piece_is_drawn_in_place_only_when_it_covers_todays_completely(self):
        e, pic, scene, comp, rep = self.scene('fx-big')
        pl = rep['pieces']['fx-big']['placements'][0]
        self.assertEqual(pl['old_still_visible_px'], 0)
        self.assertEqual(pl['drawn'], 'in place')
        nx, ny = pl['new_top_left'][0] - VIEW[0], pl['new_top_left'][1] - VIEW[1]
        piece = e.pieces['oblique']
        ys, xs = np.nonzero(piece.rgba[..., 3] > 0)
        j, i = ys[len(ys) // 2], xs[len(xs) // 2]
        self.assertEqual(tuple(scene[ny + j, nx + i]), tuple(piece.rgba[j, i, :3]))

    def test_strip_has_todays_piece_and_the_new_one_on_one_foot_line_and_a_woka(self):
        e, pic, scene, comp, rep = self.scene('fx-small')
        sp = {s['kind']: s for s in rep['strip']['sprites']}
        self.assertEqual(set(sp), {'old', 'new', 'woka'})
        for kind, rgba in (('old', e.old.rgba), ('new', e.pieces['oblique'].rgba), ('woka', P.woka_standin())):
            s = sp[kind]
            h, w = rgba.shape[:2]
            got = scene[s['y']:s['y'] + h, s['x']:s['x'] + w]
            solid = rgba[..., 3] == 255
            self.assertTrue((got[solid] == rgba[..., :3][solid]).all(), kind)
        new = e.pieces['oblique']
        base = {'old': sp['old']['y'] + rnd(e.old.foot[1]), 'new': sp['new']['y'] + rnd(new.foot[1]), 'woka': sp['woka']['y'] + 32}
        self.assertEqual(base['old'], base['new'])
        self.assertGreater(base['woka'], base['old'])           # a 64 px strip has no room beside the pair: the Woka's own row

    def test_woka_stands_on_the_pairs_foot_line_when_there_is_room(self):
        old, new = old_sprite(), np.zeros((30, 18, 4), np.uint8)
        new[:, :, 3] = 255
        items = [{'name': 'x', 'old': (old, (10, 30)), 'new': (new, (9, 30))}]
        for width, same_row in ((200, True), (64, False)):
            _, height, sprites = P.plan_strip(items, width, P.woka_standin())
            base = {s['kind']: s['foot'][1] for s in sprites}
            self.assertEqual(base['old'], base['new'])
            self.assertEqual(base['woka'] == base['old'], same_row, width)
            self.assertGreaterEqual(height, base['woka'])

    def test_woka_standin_is_a_26_by_32_frame_standing_on_its_last_row(self):
        w = P.woka_standin()
        self.assertEqual(w.shape, (32, 26, 4))
        self.assertEqual(set(np.unique(w[..., 3]).tolist()), {0, 255})
        self.assertTrue((w[31, :, 3] > 0).any())
        self.assertTrue(not (w[0, :, 3] > 0).any())


# ----------------------------------------------------------------------------------------------------------------- the board

class Board(Fixture):
    def test_cells_are_labelled_in_order_and_drawn_at_4x_nearest_neighbour(self):
        entries = self.entries(('fx-small',))
        img, rows = P.make_board(entries, ['oblique', 'camera75'])
        row = rows[0]
        self.assertEqual([c['label'].split(' ')[0] + ' ' + (c['label'].split(' ')[1] if c['label'].startswith('new') else '')
                          for c in row['cells']], ['today ', 'new oblique', 'new camera75', 'normal ', 'height '])
        cell = [c for c in row['cells'] if c['label'].startswith('new oblique')][0]
        cw, ch, fcell = row['geometry']
        rgba = cell['rgba']
        ys, xs = np.nonzero(rgba[..., 3] > 0)
        r, c = int(ys.min()) + 2, int(xs[ys == ys.min() + 2].mean())
        fx, fy = rnd(cell['foot'][0]), rnd(cell['foot'][1])
        X = cell['x'] + (fcell[0] - fx + c) * P.BOARD_SCALE + 2
        Y = cell['y'] + (fcell[1] - fy + r) * P.BOARD_SCALE + 2
        self.assertEqual(P.BOARD_SCALE, 4)
        self.assertEqual(tuple(np.array(img)[Y, X]), tuple(rgba[r, c, :3]))

    def test_every_picture_of_a_row_is_aligned_on_its_foot(self):
        entries = self.entries(('fx-small',))
        cells, _ = P.board_cells(entries[0], ['oblique', 'camera75'])
        cw, ch, fcell = P.row_geometry(cells)
        for label, rgba, foot, tile in cells:
            left, top = fcell[0] - rnd(foot[0]), fcell[1] - rnd(foot[1])
            self.assertGreaterEqual(left, 0)
            self.assertGreaterEqual(top, 0)
            self.assertLessEqual(left + rgba.shape[1], cw)
            self.assertLessEqual(top + rgba.shape[0], ch)

    def test_height_picture_is_white_at_the_highest_point(self):
        piece = self.entries(('fx-big',))[0].pieces['oblique']
        pic, top = P.height_picture(piece)
        self.assertEqual(top, int(piece.height.max()))
        self.assertEqual(int(pic[..., 0][piece.height == piece.height.max()].min()), 255)


# -------------------------------------------------------------------------------------------------------------- measurements

class Measurements(Fixture):
    def by(self, meas, piece, proj, cid):
        return [c for c in meas['checks'] if c['piece'] == piece and c['projection'] == proj and c['id'] == cid][0]

    def test_universal_checks_pass_on_a_clean_fixture_and_plan_limits_fail_when_broken(self):
        self.write_map({'fx-big': {'colour_cap': 1, 'canvas_max': [10, 10], 'height_px': [100, 1], 'rim_ratio': 0.03,
                                   'margin_min': 5, 'footprint_tiles': [2, 1]},
                        'fx-small': {'colour_cap': 24, 'canvas_max': [64, 64], 'height_px': [5, 1], 'rim_ratio': 0.03}})
        meas = self.run_all()
        for proj in ('oblique', 'camera75'):
            for cid in ('alpha_binary', 'foot_gap', 'depth_offset', 'normals', 'rebake_sha256', 'no_pool', 'outline_share'):
                self.assertEqual(self.by(meas, 'fx-big', proj, cid)['status'], 'pass', (proj, cid))
            for cid in ('colour_cap', 'canvas_max', 'height_px', 'margin', 'footprint'):
                self.assertEqual(self.by(meas, 'fx-big', proj, cid)['status'], 'fail', (proj, cid))
            self.assertEqual(self.by(meas, 'fx-small', proj, 'colour_cap')['status'], 'pass')
            # today's canvas is 800 px: the 1 m box is bigger (fail), the small one smaller (pass)
            self.assertEqual(self.by(meas, 'fx-big', proj, 'canvas_px')['status'], 'fail')
            self.assertEqual(self.by(meas, 'fx-small', proj, 'canvas_px')['status'], 'pass')
            self.assertEqual(self.by(meas, 'fx-small', proj, 'canvas_max')['status'], 'pass')
        # the rim ratio is the projection's sy / sx, judged against THAT projection's expectation: 1.0 in oblique, 0.75 in camera75
        for proj, want in (('oblique', 1.0), ('camera75', 0.75)):
            c = self.by(meas, 'fx-small', proj, 'rim_ratio')
            self.assertEqual((c['value'], c['limit'], c['status']), (want, [want - 0.03, want + 0.03], 'pass'), proj)
        self.assertEqual(meas['summary']['pass'] + meas['summary']['fail'], len(meas['checks']))

    def test_canvas_totals_compare_new_against_old(self):
        meas = self.run_all()
        for proj in ('oblique', 'camera75'):
            t = meas['totals'][proj]
            self.assertEqual(t['old_canvas_px'], 2 * 20 * 40)
            self.assertEqual(t['new_canvas_px'], sum(meas['pieces'][n]['projections'][proj]['canvas_px'] for n in ('fx-big', 'fx-small')))
            self.assertEqual(self.by(meas, '(all)', proj, 'canvas_px_sum')['status'], 'pass' if t['new_canvas_px'] < t['old_canvas_px'] else 'fail')

    def test_rebake_check_fails_when_the_second_bake_differs(self):
        real = P.rebake_piece

        def drifting(entry, projection):
            piece = real(entry, projection)
            piece.rgba = piece.rgba.copy()
            piece.rgba[piece.rgba[..., 3] > 0] ^= 1          # one bit of colour moves
            return piece

        with mock.patch.object(P, 'rebake_piece', drifting):
            meas = self.run_all(('fx-small',))
        self.assertEqual(self.by(meas, 'fx-small', 'oblique', 'rebake_sha256')['status'], 'fail')

    def test_feet_rows_are_measured_on_the_model_in_the_projections_rows_per_metre(self):
        r = B.resolve(str(self.recipes / 'fx_legs.py'))
        self.assertAlmostEqual(P.ground_contact_span(r, 'oblique'), 0.8 * 32, delta=0.1)
        self.assertAlmostEqual(P.ground_contact_span(r, 'camera75'), 0.8 * 24, delta=0.1)

    def test_a_translucent_pixel_is_a_pool(self):
        entry = self.entries(('fx-small',), projections=('oblique',))[0]
        piece = entry.pieces['oblique']
        a = piece.rgba.copy()
        ys, xs = np.nonzero(a[..., 3] > 0)
        a[ys[0], xs[0], 3] = 90
        piece.rgba = a
        checks = P.Checks()
        P.measure_piece(entry, 'oblique', checks, rebake=False)
        status = {c['id']: c['status'] for c in checks.items}
        self.assertEqual(status['no_pool'], 'fail')
        self.assertEqual(status['alpha_binary'], 'fail')

    def test_the_rim_ratio_is_judged_against_each_projections_own_expectation(self):
        """A ground circle is a circle in oblique (1.0) and a 0.75 ellipse in camera75: neither may be judged by the other's figure
        (the plan said 0.75 for both, so oblique failed for being right)."""
        self.write_map({'fx-small': {'rim_ratio': 0.03}})
        meas = self.run_all(('fx-small',))
        got = {proj: self.by(meas, 'fx-small', proj, 'rim_ratio') for proj in ('oblique', 'camera75')}
        self.assertEqual({k: (c['value'], c['status']) for k, c in got.items()}, {'oblique': (1.0, 'pass'), 'camera75': (0.75, 'pass')})
        self.assertIn('expect.rim_ratio', got['oblique']['method'])

    def test_a_projection_file_whose_expectation_disagrees_with_its_scales_fails_the_check(self):
        data = json.loads(B.PROJECTION_FILE.read_text())
        data['projections']['oblique']['expect']['rim_ratio'] = 0.75          # the figure of another projection
        d = Path(self.tmp.name) / 'proj'
        d.mkdir()
        (d / 'projection.json').write_text(json.dumps(data))
        self.write_map({'fx-small': {'rim_ratio': 0.03}})
        with mock.patch.object(B, 'PROJECTION_FILE', d / 'projection.json'):
            meas = self.run_all(('fx-small',))
        self.assertEqual(self.by(meas, 'fx-small', 'oblique', 'rim_ratio')['status'], 'fail')
        self.assertEqual(self.by(meas, 'fx-small', 'camera75', 'rim_ratio')['status'], 'pass')

    def test_a_plan_that_writes_the_expected_ratio_is_refused(self):
        bad = Path(self.tmp.name) / 'bad.json'
        bad.write_text(json.dumps({'x': {'recipe': 'stool', 'plan': {'rim_ratio': [0.75, 0.03]}}}))
        with self.assertRaisesRegex(ValueError, 'tolerance'):
            P.load_map(bad)
        with self.assertRaisesRegex(ValueError, 'projection.json'):
            P.plan_tolerance([0.75, 0.03])

    def test_projection_json_expectations_are_consistent_with_its_own_scales(self):
        data = json.loads(B.PROJECTION_FILE.read_text())
        ref = data['projections'][data['plan_reference']]
        self.assertEqual(data['plan_reference'], 'camera75')
        for name, p in data['projections'].items():
            self.assertAlmostEqual(p['expect']['rim_ratio'], p['sy_px_per_m'] / p['sx_px_per_m'], places=9, msg=name)
            self.assertEqual(p['expect']['canvas_extra_rows_per_tile'], (p['sy_px_per_m'] - ref['sy_px_per_m']) * data['tile_m'], name)
        self.assertEqual((data['projections']['oblique']['status'], data['projections']['camera75']['status']), ('default', 'comparison-only'))
        self.assertEqual(data['default'], 'oblique')
        self.assertIn('comparison only', data['projections']['camera75']['note'].lower())

    def wide(self, z_px):
        """A 2 x 1 tile box z_px high: the oblique canvas is 64 + 2 wide, 32 + z_px + 1 tall; the camera75 one 24 + z_px + 1."""
        src = ('import volume as V\nRECIPE = V.Recipe("fx-wide", [V.box(0, 0, 0, 2, 1, %r, "wood")], (2, 1))\n' % (z_px / 21))
        path = Path(self.tmp.name) / f'fx_wide_{z_px}.py'
        path.write_text(src)
        return {'fx-wide': {'recipe': str(path), 'prefabs': ['fx-old'], 'plan': {'canvas_max': [64, 48]}}}

    def test_the_canvas_limit_is_the_plans_figure_made_for_each_projection(self):
        """The plan's 64 x 48 is the camera75 picture of the air hockey table. The same table is 66 wide in both (a 64 px table
        and 1 px of margin each side) and 8 rows taller in oblique (32 rows of ground per tile, not 24)."""
        cat = self.wide(17)
        meas = P.run(['fx-wide'], self.dist, self.floor, self.out, VIEW, ('oblique', 'camera75'), catalogue=cat)
        sizes = {proj: tuple(self.by(meas, 'fx-wide', proj, 'canvas_max')['value']) for proj in ('oblique', 'camera75')}
        self.assertEqual(sizes, {'oblique': (66, 50), 'camera75': (66, 42)})
        for proj in ('oblique', 'camera75'):
            self.assertEqual(self.by(meas, 'fx-wide', proj, 'canvas_max')['status'], 'pass', proj)
        self.assertEqual(self.by(meas, 'fx-wide', 'oblique', 'canvas_max')['limit'], [66, 57])
        self.assertEqual(self.by(meas, 'fx-wide', 'camera75', 'canvas_max')['limit'], [66, 49])

    def test_the_canvas_limit_is_exact_at_the_edge_in_each_projection(self):
        for z, status in ((24, 'pass'), (25, 'fail')):                 # 57 / 49 rows allowed; 25 px of height needs 58 / 50
            meas = P.run(['fx-wide'], self.dist, self.floor, self.out, VIEW, ('oblique', 'camera75'), catalogue=self.wide(z))
            for proj in ('oblique', 'camera75'):
                c = self.by(meas, 'fx-wide', proj, 'canvas_max')
                self.assertEqual(c['status'], status, (z, proj, c['value'], c['limit']))

    def test_plan_keys_are_validated(self):
        bad = Path(self.tmp.name) / 'bad.json'
        bad.write_text(json.dumps({'x': {'recipe': 'stool', 'plan': {'colour_capp': 3}}}))
        with self.assertRaises(ValueError):
            P.load_map(bad)


# ------------------------------------------------------------------------------------------------------------------- the CLI

class Cli(Fixture):
    def run_cli(self, out, *extra):
        argv = ['fx-big', 'fx-small', '--dist', str(self.dist), '--floor', str(self.floor), '--out', str(out),
                '--view', ','.join(map(str, VIEW)), '--map', str(self.mapfile), *extra]
        with contextlib.redirect_stdout(io.StringIO()):
            return P.main(argv)

    @staticmethod
    def tree(root):
        return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path(root).rglob('*')) if p.is_file()}

    def test_writes_the_five_files_deterministically_and_only_into_out(self):
        before = self.tree(self.dist), hashlib.sha256(self.floor.read_bytes()).hexdigest()
        self.assertEqual(self.run_cli(self.out), 0)
        self.assertEqual(sorted(p.name for p in self.out.iterdir()),
                         ['board.png', 'measurements.json', 'scene-camera75.png', 'scene-oblique.png', 'shadows.png'])
        second = Path(self.tmp.name) / 'out2'
        self.run_cli(second)
        self.assertEqual(self.tree(self.out), self.tree(second))
        self.assertEqual((self.tree(self.dist), hashlib.sha256(self.floor.read_bytes()).hexdigest()), before)
        data = json.loads((self.out / 'measurements.json').read_text())
        self.assertEqual(data['projections'], ['oblique', 'camera75'])
        self.assertEqual(set(data['pieces']), {'fx-big', 'fx-small'})
        self.assertTrue(data['not_taken'])

    def test_strict_exits_1_on_a_failed_measurement(self):
        self.write_map({'fx-big': {'colour_cap': 1}})
        self.assertEqual(self.run_cli(self.out), 0)
        self.assertEqual(self.run_cli(Path(self.tmp.name) / 'o2', '--strict'), 1)

    def test_names_ignore_case_and_dash_and_unknown_names_list_the_catalogue(self):
        self.assertEqual(P.canon('ARC_lamp'), 'arc-lamp')
        self.assertIn(P.canon('Potted_Plant'), P.CATALOGUE)
        with self.assertRaises(SystemExit) as cm:
            P.make_entries(['no-such-piece'], None, ['oblique'], P.CATALOGUE)
        self.assertIn('no piece named', str(cm.exception))
        self.assertIn('air-hockey', str(cm.exception))

    def test_catalogue_names_the_four_pieces_the_plan_measures(self):
        self.assertEqual(sorted(P.CATALOGUE), ['air-hockey', 'arc-lamp', 'potted-plant', 'stool'])
        for spec in P.CATALOGUE.values():
            self.assertTrue(set(spec['plan']) <= set(P.PLAN_KEYS))


# ------------------------------------------------------------------------------------------------------ the real lighting build

REAL = Path(os.environ.get('KONCLUI_DIST') or 'no-build-given')
FLOOR_VIEW = Path(os.environ.get('KONCLUI_FLOOR_VIEW') or 'no-view-given')


@unittest.skipUnless((REAL / 'office.wam').is_file() and FLOOR_VIEW.is_file(),
                     'KONCLUI_DIST and KONCLUI_FLOOR_VIEW are not both set to a build and its unlit lounge picture')
class RealBuild(unittest.TestCase):
    def test_todays_feet_and_placements_match_the_audit(self):
        dist = P.Dist(REAL)
        want = {'konclui-konclui-banqueta-turquesa': ((16, 43), 21, 3), 'konclui-konclui-lumin-ria-de-arco-preto': ((69, 71), 25, 1),
                'konclui-konclui-air-hockey-navy': ((32, 59), 5, 1)}
        for pid, (foot, gap, n) in want.items():
            old = P.Old(pid, dist.prefabs[pid], dist.sprite(pid))
            self.assertEqual(old.foot, foot, pid)
            self.assertEqual(P.old_metrics(old)['foot_gap'], gap, pid)
            self.assertEqual(len(dist.placements(pid)), n, pid)

    def test_the_lounge_floor_is_a_periodic_wood_pattern(self):
        view = P.DEFAULT_VIEW
        pic = P.load_view(str(FLOOR_VIEW), view, [])
        floor = P.Floor(pic, view, P.entity_mask(P.Dist(REAL), view))
        self.assertIsNotNone(floor.period)
        self.assertEqual(tuple(floor.mode), (240, 214, 178))


if __name__ == '__main__':
    unittest.main()
