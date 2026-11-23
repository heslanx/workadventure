"""Behaviour tests of tools/contract.py: the pixel rules, the ratchet, the reviewed list and its hash invalidation, the caster
heights, the kind suspects, the rank and the command line.
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_contract.py
Every picture is made in the test that uses it and every map is a small dist built in a temporary directory: no tool, no network
and no built map is needed. `BuiltContract` runs only with KONCLUI_DIST set (a built map: hq-office/build.py --out DIR) and
checks the committed baseline against it."""
import contextlib
import copy
import dataclasses
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
sys.path.insert(0, str(HERE))
import contract as C  # noqa: E402

INK = (16, 16, 48)
FILL = (96, 128, 160)


# ------------------------------------------------------------------------------------------------------------------ pictures

def canvas(w, h):
    return np.zeros((h, w, 4), dtype=np.uint8)


def paint(img, x0, y0, x1, y1, rgb, alpha=255):
    """Fill the inclusive rectangle x0..x1, y0..y1."""
    img[y0:y1 + 1, x0:x1 + 1] = (*rgb, alpha)
    return img


def inked_box(w, h, x0, y0, x1, y1, fill=FILL, ink=INK):
    img = canvas(w, h)
    paint(img, x0, y0, x1, y1, ink)
    paint(img, x0 + 1, y0 + 1, x1 - 1, y1 - 1, fill)
    return img


def clean():
    """20 x 20: an inked box 16 x 17, 1 empty row under it, 2 colours, symmetric, nothing at the edge: passes every rule."""
    return inked_box(20, 20, 2, 2, 17, 18)


def save(path, rgba):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.asarray(rgba, dtype=np.uint8), 'RGBA').save(path)


def make_dist(root, pieces):
    """A small built map: `pieces` is a list of dicts (key image name, name, tags, rgba, placements [(x, y)], folder, id, direction,
    collisionGrid). Writes DIST/entities/<folder>/{collection.json, sprites/<image>} and DIST/office.wam."""
    root = Path(root)
    collections, entities = {}, {}
    for number, p in enumerate(pieces):
        folder = p.get('folder', 'konclui')
        save(root / 'entities' / folder / 'sprites' / p['image'], p['rgba'])
        entry = dict(id=p.get('id', f'p{number}'), name=p['name'], tags=p.get('tags', []), imagePath=f'sprites/{p["image"]}',
                     direction=p.get('direction', 'Down'), color='#000')
        if 'collisionGrid' in p:
            entry['collisionGrid'] = p['collisionGrid']
        if 'depthOffset' in p:
            entry['depthOffset'] = p['depthOffset']
        collections.setdefault(folder, []).append(entry)
        for j, (x, y) in enumerate(p.get('placements', [(0, 0)])):
            entities[f'e{number}-{j}'] = dict(x=x, y=y, name=p['name'], prefabRef=dict(collectionName=folder, id=entry['id']))
    for folder, entries in collections.items():
        (root / 'entities' / folder / 'collection.json').write_text(json.dumps(dict(collectionName=folder, tags=[], version=1, collection=entries)))
    (root / 'office.wam').write_text(json.dumps(dict(version='1', mapUrl='office.tmj', entities=entities, areas={}, entityCollections=[], settings={})))
    return root


def piece(image, name, rgba, **extra):
    return dict(image=image, name=name, rgba=rgba, **extra)


class Tmp(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def dist(self, pieces, name='dist'):
        return make_dist(self.tmp / name, pieces)


# --------------------------------------------------------------------------------------------------------------------- rules

class PixelRules(unittest.TestCase):
    def test_a_clean_picture_passes_every_rule(self):
        self.assertEqual(C.sprite_problems(clean(), 'stand', {'symmetric'}), {})

    def test_alpha_rejects_a_partial_pixel_and_a_declaration_excuses_it(self):
        img = clean()
        img[10, 10, 3] = 128
        found = C.sprite_problems(img, 'stand')
        self.assertIn('alpha', found)
        self.assertIn('1 px with 0 < alpha < 255, first at (10, 10)', found['alpha'][0])
        self.assertNotIn('alpha', C.sprite_problems(img, 'stand', {'translucent'}))
        self.assertIn('alpha', C.sprite_problems(img, 'floor'), 'the alpha rule applies to every kind')

    def test_foot_gap_is_the_empty_rows_under_the_lowest_solid_row(self):
        img = inked_box(20, 20, 2, 2, 17, 15)                       # rows 16..19 empty: a gap of 4
        self.assertEqual(C.foot_gap(img), 4)
        self.assertIn('foot_gap', C.sprite_problems(img, 'stand'))
        self.assertNotIn('foot_gap', C.sprite_problems(inked_box(20, 20, 2, 2, 17, 18), 'stand'), 'a gap of 1 is the limit')
        self.assertNotIn('foot_gap', C.sprite_problems(img, 'hang'), 'only a stand piece is held to the foot')
        self.assertNotIn('foot_gap', C.sprite_problems(img, 'top'))

    def test_a_painted_shadow_below_the_foot_is_not_part_of_the_foot(self):
        img = inked_box(20, 24, 2, 2, 17, 18)
        paint(img, 4, 20, 15, 20, (10, 10, 61), alpha=128)           # a soft shadow row under the foot
        self.assertEqual(C.foot_gap(img), 5, 'the gap runs to the last row of the silhouette (alpha >= 200), not of the shadow')
        found = C.sprite_problems(img, 'stand')
        self.assertIn('painted_shadow', found)
        self.assertIn('alpha', found)

    def test_painted_shadow_uses_the_one_rule_of_kinds_py(self):
        import kinds as K
        shadow = inked_box(20, 24, 2, 2, 17, 18)
        paint(shadow, 4, 20, 15, 20, (10, 10, 61), alpha=128)
        pool = inked_box(20, 24, 2, 2, 17, 18)
        paint(pool, 4, 20, 15, 20, (240, 220, 150), alpha=140)        # a pool of LIGHT is not a shadow
        for img in (shadow, pool, clean()):
            self.assertEqual('painted_shadow' in C.sprite_problems(img, 'stand'), K.painted_shadow(img))
        self.assertIn('painted_shadow', C.sprite_problems(shadow, 'top'))
        self.assertNotIn('painted_shadow', C.sprite_problems(pool, 'stand'))
        self.assertNotIn('painted_shadow', C.sprite_problems(shadow, 'hang'), 'a wall piece has no floor to shadow')

    def test_edge_touch_flags_art_cut_by_the_canvas_but_not_ink_on_the_edge(self):
        cut = inked_box(20, 20, 2, 2, 17, 18)
        paint(cut, 2, 2, 17, 2, FILL)                                # the top row is fill, as if the picture went on above it
        paint(cut, 2, 0, 17, 1, FILL)                                # ... and reaches the top edge
        found = C.sprite_problems(cut, 'stand')
        self.assertIn('edge_touch', found)
        self.assertIn('top edge', found['edge_touch'][0])
        framed = inked_box(20, 20, 0, 0, 17, 18)                     # an inked frame that sits on the top and left edges
        self.assertNotIn('edge_touch', C.sprite_problems(framed, 'stand'))
        self.assertNotIn('edge_touch', C.sprite_problems(cut, 'floor'), 'a rug fills its canvas')

    def test_edge_touch_ignores_a_short_run_and_the_bottom_edge(self):
        two = inked_box(20, 20, 2, 2, 17, 18)
        paint(two, 5, 0, 6, 2, FILL)                                  # 2 px reach the top edge: under the run length
        self.assertNotIn('edge_touch', C.sprite_problems(two, 'stand'))
        three = inked_box(20, 20, 2, 2, 17, 18)
        paint(three, 5, 0, 7, 2, FILL)
        self.assertIn('edge_touch', C.sprite_problems(three, 'stand'))
        bottom = inked_box(20, 19, 2, 2, 17, 18)                       # the foot on the last row is normal
        self.assertNotIn('edge_touch', C.sprite_problems(bottom, 'stand'))

    def test_height_cap_counts_solid_rows_and_a_tall_declaration_lifts_it(self):
        ok = inked_box(20, 59, 2, 2, 17, 57)                          # 56 rows
        over = inked_box(20, 60, 2, 2, 17, 58)                        # 57 rows
        self.assertEqual((C.solid_rows(ok), C.solid_rows(over)), (56, 57))
        self.assertNotIn('height_cap', C.sprite_problems(ok, 'stand'))
        self.assertIn('height_cap', C.sprite_problems(over, 'stand'))
        self.assertNotIn('height_cap', C.sprite_problems(over, 'stand', {'tall'}))
        self.assertNotIn('height_cap', C.sprite_problems(over, 'top'), 'the cap is for stand pieces')

    def test_outline_needs_the_ink_on_90_percent_of_the_boundary(self):
        half = inked_box(20, 20, 2, 2, 17, 18)
        paint(half, 2, 18, 17, 18, FILL)                              # the bottom edge and ...
        paint(half, 17, 2, 17, 18, FILL)                              # ... the right edge are not ink
        share, ink = C.outline_share(half)
        self.assertEqual(ink, INK)
        self.assertLess(share, 0.9)
        self.assertIn('outline', C.sprite_problems(half, 'stand'))
        share, ink = C.outline_share(clean())
        self.assertEqual((share, ink), (1.0, INK))
        near = inked_box(20, 20, 2, 2, 17, 18, ink=(30, 30, 60))      # an ink within the tolerance of the darkest tone counts
        paint(near, 2, 2, 17, 2, INK)
        self.assertNotIn('outline', C.sprite_problems(near, 'stand'))

    def test_the_ink_is_the_darkest_colour_that_holds_a_share_of_the_boundary(self):
        img = inked_box(20, 20, 2, 2, 17, 18)
        img[2, 5] = (0, 0, 0, 255)                                    # one black pixel: 1 of 66 boundary pixels, not an ink
        self.assertEqual(C.ink_colour(img), INK)
        self.assertIsNone(C.ink_colour(canvas(8, 8)))

    def test_colours_are_counted_over_the_solid_pixels_only(self):
        def with_colours(n):                                          # n distinct colours in all: the ink, the fill and n - 2 more
            img = clean()
            for i in range(n - 2):
                img[4 + i // 10, 4 + i % 10] = (i + 1, 200, 10, 255)
            return img
        self.assertEqual(C.colour_count(with_colours(24)), 24)
        self.assertNotIn('colours', C.sprite_problems(with_colours(24), 'stand'))
        self.assertIn('colours', C.sprite_problems(with_colours(25), 'stand'))
        shadow = with_colours(24)
        paint(shadow, 0, 19, 19, 19, (9, 9, 9), alpha=100)             # a non-solid pixel is not a colour of the piece
        self.assertEqual(C.colour_count(shadow), 24)

    def test_symmetry_only_applies_to_a_declared_piece_and_has_a_2_percent_limit(self):
        img = clean()
        paint(img, 2, 2, 3, 2, (0, 0, 0), alpha=0)                    # 2 px of the left corner gone: 4 differing px of 270
        self.assertAlmostEqual(C.mirror_difference(img), 4 / 270, places=6)
        self.assertNotIn('symmetry', C.sprite_problems(img, 'stand', {'symmetric'}), '1.5% is inside the 2% limit')
        paint(img, 2, 3, 2, 3, (0, 0, 0), alpha=0)                    # a third px: 6 of 269 = 2.2%
        self.assertAlmostEqual(C.mirror_difference(img), 6 / 269, places=6)
        self.assertIn('symmetry', C.sprite_problems(img, 'stand', {'symmetric'}))
        self.assertNotIn('symmetry', C.sprite_problems(img, 'stand'), 'a piece that is not declared symmetric is not held to it')

    def test_symmetry_of_a_hand_made_shape_is_exact_and_ignores_the_canvas_position(self):
        shape = inked_box(32, 32, 4, 8, 27, 20)
        paint(shape, 4, 8, 9, 8, (0, 0, 0), alpha=0)                  # the left corner cut 6 px wide, the right one not cut
        shifted = np.roll(shape, 3, axis=1)
        self.assertAlmostEqual(C.mirror_difference(shape), C.mirror_difference(shifted))
        self.assertAlmostEqual(C.mirror_difference(shape), 12 / 306, places=6)   # 6 px cut on one corner: 12 differ of 306 solid
        colour = clean()
        colour[5, 4] = (200, 10, 10, 255)                             # a colour on one side only
        self.assertEqual(C.mirror_difference(colour), 0.0, 'the default measure is the silhouette')
        self.assertGreater(C.mirror_difference(colour, colours=True), 0.0)

    def test_every_rule_names_its_scope_and_a_picture_with_no_solid_pixel_fails_the_foot(self):
        self.assertEqual(set(C.RULE_FUNCTIONS), set(C.RULES))
        self.assertEqual(set(C.CATEGORY_KINDS), set(C.RULES))
        self.assertEqual(C.sprite_problems(canvas(8, 8), 'stand')['foot_gap'], ['no solid pixel'])


# ------------------------------------------------------------------------------------------------------------------- ratchet

def offender():
    return inked_box(20, 20, 2, 2, 17, 15)                            # foot gap 4


class Ratchet(Tmp):
    def three(self):
        return [piece('a.png', 'Piece A', offender(), tags=['Mesas']), piece('b.png', 'Piece B', clean()),
                piece('c.png', 'Piece C', clean())]

    def setUp(self):
        super().setUp()
        self.dist_path = self.dist(self.three())
        self.baseline = C.make_baseline(C.measure(self.dist_path))
        self.keys = {n: f'konclui/sprites/{n}.png' for n in 'abc'}

    def run_check(self, **kw):
        return C.check(self.dist_path, self.baseline, pieces={}, review={}, **kw)[0]

    def redraw(self, name, rgba):
        save(self.dist_path / 'entities' / 'konclui' / 'sprites' / f'{name}.png', rgba)

    def test_the_baseline_lists_today_s_offenders_and_the_picture_they_were_measured_on(self):
        self.assertEqual(self.baseline['rules']['foot_gap']['offenders'], [self.keys['a']])
        self.assertEqual(self.baseline['rules']['foot_gap']['count'], 1)
        self.assertEqual(self.baseline['rules']['outline']['count'], 0)
        self.assertEqual(set(self.baseline['sprites']), set(self.keys.values()))
        self.assertEqual(C.make_baseline(C.measure(self.dist_path)), self.baseline, 'the baseline is deterministic')

    def test_no_change_passes(self):
        result = self.run_check()
        self.assertEqual((result.name, result.status), ('office.contract', C.PASS), result.detail)
        self.assertNotIn('lower the baseline', result.detail)

    def test_a_regression_fails_and_names_the_sprite_and_the_rule(self):
        self.redraw('b', offender())
        result = self.run_check()
        self.assertEqual(result.status, C.FAIL)
        self.assertIn('foot_gap: konclui/sprites/b.png (not an offender in the baseline)', result.lines[0])

    def test_an_improvement_passes_and_says_to_lower_the_baseline(self):
        self.redraw('a', clean())
        result = self.run_check()
        self.assertEqual(result.status, C.PASS)
        self.assertIn('foot_gap fell by 1', result.detail)
        self.assertIn('lower the baseline', result.detail)
        self.assertEqual(result.data['rules']['foot_gap'], dict(count=0, baseline=1, regressions=0, improved=1))

    def test_swapping_an_offender_for_another_fails_although_the_count_is_the_same(self):
        self.redraw('a', clean())
        self.redraw('b', offender())
        result = self.run_check()
        self.assertEqual(result.data['rules']['foot_gap']['count'], result.data['rules']['foot_gap']['baseline'])
        self.assertEqual(result.status, C.FAIL)
        self.assertIn('konclui/sprites/b.png', result.lines[0])

    def test_a_redrawn_offender_loses_its_exemption_and_is_held_to_the_limit(self):
        redrawn = inked_box(20, 20, 2, 2, 17, 16)                     # a better picture (gap 3) that still breaks the rule
        self.redraw('a', redrawn)
        result = self.run_check()
        self.assertEqual(result.status, C.FAIL)
        self.assertIn('picture changed since the baseline', result.lines[0])

    def test_a_sprite_the_baseline_never_saw_is_held_to_the_limit(self):
        self.dist_path = self.dist(self.three() + [piece('d.png', 'Piece D', offender())], name='dist2')
        result = self.run_check()
        self.assertEqual(result.status, C.FAIL)
        self.assertIn('(new sprite)', result.lines[0])
        clean_new = self.dist(self.three() + [piece('d.png', 'Piece D', clean())], name='dist3')
        self.assertEqual(C.check(clean_new, self.baseline, pieces={}, review={})[0].status, C.PASS)

    def test_a_removed_offender_is_an_improvement(self):
        self.dist_path = self.dist(self.three()[1:], name='dist4')
        result = self.run_check()
        self.assertEqual(result.status, C.PASS)
        self.assertIn('lower the baseline', result.detail)

    def test_without_enforcement_a_regression_is_only_reported(self):
        self.redraw('b', offender())
        self.assertEqual(self.run_check(enforce=False).status, C.REPORTED)

    def test_a_missing_baseline_is_reported_not_passed(self):
        with tempfile.TemporaryDirectory() as empty:
            results = C.check(self.dist_path, data_dir=empty)
        self.assertEqual(results[0].status, C.REPORTED)
        self.assertIn('baseline.json is missing', results[0].detail)

    def test_the_declared_tall_and_symmetric_pieces_change_what_is_an_offender(self):
        tall = inked_box(20, 60, 2, 2, 17, 58)
        dist = self.dist([piece('t.png', 'Tree', tall)], name='dist5')
        plain = C.measure(dist)
        self.assertIn('height_cap', plain['konclui/sprites/t.png']['problems'])
        declared = C.measure(dist, {'casters': {'konclui/sprites/t.png': {'h': 50, 'tall': True, 'source': 'manual'}}})
        self.assertNotIn('height_cap', declared['konclui/sprites/t.png']['problems'])


class ReviewedList(Tmp):
    def verdicts(self, names):
        return [dict(key=f'konclui/sprites/{n}.png', name=f'Piece {n.upper()}', verdict=v, problems=['p'], fix=None, projection='front-elevation',
                     topFaceVisible=False, depthPxPerTile=0, lightFrom='top', outline='dark-full', scaleVsAvatar='right', bakedShadow=False,
                     castShadowWillLookWrong=False) for n, v in names]

    def setUp(self):
        super().setUp()
        self.dist_path = self.dist([piece('a.png', 'Piece A', clean()), piece('b.png', 'Piece B', offender())])
        self.review = C.seed_review(self.dist_path, self.verdicts([('a', 'keep'), ('b', 'redraw')]))

    def test_the_seed_carries_the_verdict_the_audit_fields_the_reviewer_and_the_hash_of_the_picture(self):
        entry = self.review['entries']['konclui/sprites/b.png']
        self.assertEqual((entry['verdict'], entry['reviewer'], entry['problems']), ('redraw', C.AUDIT_REVIEWER, ['p']))
        self.assertEqual(entry['sha256'], C.sha256_file(self.dist_path / 'entities/konclui/sprites/b.png'))
        self.assertEqual(entry['audit']['projection'], 'front-elevation')

    def test_a_changed_picture_makes_its_entry_stale_and_only_its_entry(self):
        measured = C.measure(self.dist_path)
        self.assertEqual(C.review_status(self.review, measured)['stale'], [])
        save(self.dist_path / 'entities/konclui/sprites/b.png', clean())
        status = C.review_status(self.review, C.measure(self.dist_path))
        self.assertEqual((status['stale'], status['current']), (['konclui/sprites/b.png'], ['konclui/sprites/a.png']))

    def test_the_review_result_is_reported_never_a_failure_and_counts_the_stale(self):
        save(self.dist_path / 'entities/konclui/sprites/b.png', clean())
        result = C.review_result(self.review, C.measure(self.dist_path))
        self.assertEqual(result.status, C.REPORTED)
        self.assertIn('1 reviewed pictures are current', result.detail)
        self.assertIn('1 stale', result.detail)
        self.assertEqual(result.lines, ['stale (the picture changed after the review): konclui/sprites/b.png'])

    def test_a_sprite_with_no_entry_is_not_reviewed_and_an_entry_with_no_sprite_is_an_orphan(self):
        dist = self.dist([piece('a.png', 'Piece A', clean()), piece('c.png', 'Piece C', clean())], name='dist2')
        status = C.review_status(self.review, C.measure(dist))
        self.assertEqual((status['missing'], status['orphan']), (['konclui/sprites/c.png'], ['konclui/sprites/b.png']))

    def test_a_garbled_audit_key_is_matched_to_the_one_sprite_with_that_name_and_the_repair_is_recorded(self):
        verdicts = self.verdicts([('a', 'keep'), ('b', 'redraw')])
        verdicts[1]['key'] = 'konclui/sprites/b-garbled.png'
        review = C.seed_review(self.dist_path, verdicts)
        self.assertEqual(review['repairs'], [dict(was='konclui/sprites/b-garbled.png', now='konclui/sprites/b.png')])
        self.assertEqual(review['entries']['konclui/sprites/b.png']['key_repaired_from'], 'konclui/sprites/b-garbled.png')

    def test_a_key_that_matches_nothing_or_a_sprite_with_no_verdict_is_an_error(self):
        verdicts = self.verdicts([('a', 'keep'), ('b', 'redraw')])
        verdicts[1].update(key='konclui/sprites/gone.png', name='Nothing like it')
        with self.assertRaisesRegex(ValueError, 'matches no placed sprite'):
            C.seed_review(self.dist_path, verdicts)
        with self.assertRaisesRegex(ValueError, 'have no verdict'):
            C.seed_review(self.dist_path, verdicts[:1])

    def test_a_second_opinion_survives_a_reseed(self):
        self.review['entries']['konclui/sprites/a.png']['second_opinion'] = dict(verdict='touch-up', reviewer='x', reason='y')
        again = C.seed_review(self.dist_path, self.verdicts([('a', 'keep'), ('b', 'redraw')]), previous=self.review)
        self.assertEqual(again['entries']['konclui/sprites/a.png']['second_opinion']['verdict'], 'touch-up')


# ------------------------------------------------------------------------------------------------------------------ casters

class Casters(unittest.TestCase):
    def test_a_tree_is_declared_tall_and_keeps_its_rows(self):
        entry = C.derive_caster('Bétula', ['Exterior e jardim'], 150, None, {'topFaceVisible': False})
        self.assertEqual((entry['h'], entry['basis'], entry['tall']), (150, 'rows', True))

    def test_a_plant_keeps_its_rows_and_is_not_tall(self):
        entry = C.derive_caster('Aglaonema', ['Plantas'], 52, None, {'topFaceVisible': True})
        self.assertEqual((entry['h'], entry['basis']), (52, 'rows'))
        self.assertNotIn('tall', entry)

    def test_a_front_elevation_inside_the_window_of_its_anchor_keeps_its_rows(self):
        entry = C.derive_caster('Cadeira de café', ['Cadeiras e bancos'], 24, None, {'topFaceVisible': False})
        self.assertEqual((entry['h'], entry['basis']), (24, 'rows'))     # the chair anchor is 19: 24 / 19 = 1.26

    def test_a_front_elevation_far_from_its_anchor_takes_the_anchor(self):
        entry = C.derive_caster('Poltrona Eames', ['Cadeiras e bancos'], 27, None, {'topFaceVisible': False})
        self.assertEqual((entry['h'], entry['basis']), (18, 'anchor'))   # 27 / 18 = 1.5: outside 0.6 to 1.4
        self.assertIn('outside', entry['source'])

    def test_a_top_face_piece_is_measured_from_its_grid_when_the_result_is_plausible(self):
        grid = [[1, 1, 1], [0, 0, 0]]
        entry = C.derive_caster('Mesa de escritório', ['Mesas'], 40, grid, {'topFaceVisible': True, 'depthPxPerTile': 30})
        self.assertEqual((entry['h'], entry['basis']), (10, 'measured'))  # 40 - 1 x 30; the anchor is 16 and 10 / 16 = 0.62
        self.assertIn('40 rows minus 1 tile(s)', entry['source'])

    def test_a_top_face_piece_with_an_implausible_measure_or_no_grid_takes_the_anchor(self):
        grid = [[1, 1, 1], [1, 1, 1]]
        a = C.derive_caster('Mesa octogonal 2x3', ['Mesas'], 65, grid, {'topFaceVisible': True, 'depthPxPerTile': 30})
        self.assertEqual((a['h'], a['basis']), (16, 'anchor'))           # 65 - 2 x 30 = 5: under 0.6 of 16
        b = C.derive_caster('Banqueta de bar', ['Cadeiras e bancos'], 30, None, {'topFaceVisible': True})
        self.assertEqual((b['h'], b['basis']), (16, 'anchor'))
        self.assertIn('no collisionGrid or scale', b['source'])

    def test_the_height_is_never_more_than_the_picture(self):
        self.assertEqual(C.derive_caster('Mesa', ['Mesas'], 5, None, {'topFaceVisible': True})['h'], 5)

    def test_a_kind_with_no_anchor_keeps_the_rows_as_today(self):
        entry = C.derive_caster('Geladeira', ['Cozinha e café'], 61, None, {'topFaceVisible': True})
        self.assertEqual((entry['h'], entry['basis']), (61, 'rows'))
        self.assertIn('no height anchor', entry['source'])

    def test_a_table_lamp_is_a_lamp_not_a_table(self):
        self.assertEqual(C.anchor_for('Luminária de mesa 1')[0], 'desk lamp')
        self.assertEqual(C.anchor_for('Mesa de centro redonda')[0], 'low table')
        self.assertEqual(C.anchor_for('Luminária de arco com cúpula')[1], 44, 'the plan\'s arc lamp apex')
        self.assertEqual(C.anchor_for('Banqueta de bar turquesa (1.4)')[1], 16, 'the plan\'s bar stool seat')
        self.assertIsNone(C.anchor_for('Geladeira'))

    def test_grid_depth_counts_the_rows_that_block(self):
        self.assertEqual(C.grid_depth([[1, 1, 1], [0, 0, 0]]), 1)
        self.assertEqual(C.grid_depth([[0, 0], [1, 1]]), 1)
        self.assertEqual(C.grid_depth([[1], [1], [0]]), 2)
        self.assertIsNone(C.grid_depth(None))
        self.assertIsNone(C.measured_front(40, None, 30))
        self.assertIsNone(C.measured_front(20, [[1], [1]], 30), 'a picture shallower than its footprint has no measurable front')


class PiecesData(Tmp):
    def setUp(self):
        super().setUp()
        tall = inked_box(20, 30, 2, 2, 17, 28)
        self.dist_path = self.dist([piece('a.png', 'Mesa A', inked_box(20, 40, 2, 2, 17, 38), tags=['Mesas'],
                                          collisionGrid=[[1, 1, 1], [0, 0, 0]]),
                                    piece('b.png', 'Planta B', tall, tags=['Plantas']),
                                    piece('c.png', 'Caneca (sobre móvel)', clean())])
        self.review = {'entries': {'konclui/sprites/a.png': {'audit': {'topFaceVisible': True, 'depthPxPerTile': 30}}}}

    def test_every_placed_stand_sprite_gets_an_entry_and_a_top_sprite_does_not(self):
        pieces = C.derive_pieces(self.dist_path, self.review)
        self.assertEqual(sorted(pieces['casters']), ['konclui/sprites/a.png', 'konclui/sprites/b.png'])
        self.assertEqual(pieces['casters']['konclui/sprites/a.png']['h'], 16)
        self.assertEqual(pieces['casters']['konclui/sprites/b.png']['rows'], 27)

    def test_a_manual_entry_and_the_decisions_survive_a_regeneration_and_a_derived_one_does_not(self):
        previous = {'declared': {'konclui/sprites/a.png': ['symmetric']}, 'kind_corrections': [{'key': 'k', 'to': 'top'}],
                    'casters': {'konclui/sprites/a.png': {'h': 12, 'source': 'manual: looked at the lit picture'},
                                'konclui/sprites/b.png': {'h': 1, 'source': 'old derivation'}}}
        pieces = C.derive_pieces(self.dist_path, self.review, previous)
        self.assertEqual(pieces['casters']['konclui/sprites/a.png']['h'], 12)
        self.assertEqual(pieces['casters']['konclui/sprites/b.png']['h'], 27)
        self.assertEqual(pieces['declared'], previous['declared'])
        self.assertEqual(pieces['kind_corrections'], previous['kind_corrections'])

    def problems(self, pieces):
        return C.pieces_problems(pieces, C.measure(self.dist_path, pieces))

    def test_derived_pieces_have_no_problem(self):
        self.assertEqual(self.problems(C.derive_pieces(self.dist_path, self.review)), [])

    def test_a_missing_entry_an_oversized_h_and_a_missing_source_are_problems(self):
        pieces = C.derive_pieces(self.dist_path, self.review)
        del pieces['casters']['konclui/sprites/b.png']
        self.assertIn('1 placed stand sprites have no caster entry', self.problems(pieces)[0])
        pieces = C.derive_pieces(self.dist_path, self.review)
        pieces['casters']['konclui/sprites/a.png']['h'] = 99
        self.assertTrue(any('more than the picture' in p for p in self.problems(pieces)))
        pieces = C.derive_pieces(self.dist_path, self.review)
        pieces['casters']['konclui/sprites/a.png'].pop('source')
        self.assertTrue(any('says nothing of how h was decided' in p for p in self.problems(pieces)))
        pieces = C.derive_pieces(self.dist_path, self.review)
        pieces['casters']['konclui/sprites/a.png']['h'] = 0
        self.assertTrue(any('not a number' in p for p in self.problems(pieces)))

    def test_an_entry_for_a_top_sprite_a_ghost_or_a_bad_correction_is_a_problem(self):
        pieces = C.derive_pieces(self.dist_path, self.review)
        pieces['casters']['konclui/sprites/c.png'] = {'h': 3, 'source': 'x'}
        pieces['casters']['konclui/sprites/zzz.png'] = {'h': 3, 'source': 'x'}
        pieces['kind_corrections'] = [{'key': 'konclui/sprites/a.png', 'to': 'wall'}]
        pieces['declared'] = {'konclui/sprites/a.png': ['symmetric', 'shiny']}
        found = ' | '.join(self.problems(pieces))
        for text in ('is a top sprite, not stand', 'zzz.png\' is not a placed sprite', "'wall' is not one of", "unknown ['shiny']"):
            self.assertIn(text, found)

    def test_a_kind_correction_is_open_while_the_sprite_is_still_the_old_kind_and_resolved_once_the_rule_moves_it(self):
        pieces = C.derive_pieces(self.dist_path, self.review)
        pieces['kind_corrections'] = [{'key': 'konclui/sprites/a.png', 'from': 'stand', 'to': 'top'},       # still stand: open
                                      {'key': 'konclui/sprites/c.png', 'from': 'stand', 'to': 'top'}]       # already top: resolved
        self.assertEqual(self.problems(pieces), [])
        pieces['kind_corrections'] = [{'key': 'konclui/sprites/c.png', 'from': 'stand', 'to': 'hang'}]
        self.assertIn('is top now, neither stand nor hang', self.problems(pieces)[0])

    def test_the_results_fail_on_a_problem_report_without_enforcement_and_report_a_missing_file(self):
        pieces = C.derive_pieces(self.dist_path, self.review)
        pieces['casters']['konclui/sprites/a.png']['h'] = 99
        measured = C.measure(self.dist_path, pieces)
        self.assertEqual(C.pieces_result(pieces, measured).status, C.FAIL)
        self.assertEqual(C.pieces_result(pieces, measured, enforce=False).status, C.REPORTED)
        self.assertEqual(C.pieces_result(None, measured).status, C.REPORTED)
        self.assertEqual(C.pieces_result(C.derive_pieces(self.dist_path, self.review), measured).status, C.PASS)


class KindSuspects(Tmp):
    def desk(self):
        return piece('desk.png', 'Mesa de escritório', inked_box(96, 64, 2, 0, 93, 40), tags=['Mesas'], placements=[(100, 100)])

    def test_a_small_piece_whose_foot_is_inside_a_desk_is_a_suspect_and_a_seat_a_tall_piece_or_a_free_one_is_not(self):
        lamp = piece('lamp.png', 'Luminária de mesa', inked_box(16, 16, 3, 2, 12, 12), tags=['Luminárias'], placements=[(140, 110), (400, 400)])
        chair = piece('chair.png', 'Cadeira', inked_box(16, 16, 3, 2, 12, 12), tags=['Cadeiras e bancos'], placements=[(140, 110)])
        tall = piece('tall.png', 'Totem', inked_box(16, 60, 3, 2, 12, 56), tags=['Peças da marca'], placements=[(140, 90)])
        found = C.kind_suspects(self.dist([self.desk(), lamp, chair, tall]))
        self.assertEqual(list(found), ['konclui/sprites/lamp.png'])
        self.assertEqual(found['konclui/sprites/lamp.png'], dict(placements=2, on_support=1, supports={'Mesa de escritório': 1}))

    def test_a_piece_as_large_as_its_support_is_not_on_it(self):
        low = piece('low.png', 'Aparador baixo', inked_box(96, 64, 2, 0, 93, 29), tags=['Armazenamento'], placements=[(100, 105)])
        self.assertEqual(C.kind_suspects(self.dist([self.desk(), low])), {}, 'under 32 rows, but as wide as the desk it is on')
        small = piece('small.png', 'Aparador pequeno', inked_box(96, 64, 40, 0, 60, 29), tags=['Armazenamento'], placements=[(100, 105)])
        self.assertEqual(list(C.kind_suspects(self.dist([self.desk(), small], name='d2'))), ['konclui/sprites/small.png'])


class Ranking(Tmp):
    def test_the_rank_is_placements_times_severity_with_unreviewed_counting_as_keep(self):
        dist = self.dist([piece('a.png', 'A', clean(), placements=[(0, 0)] * 2), piece('b.png', 'B', clean(), placements=[(0, 0)] * 5),
                          piece('c.png', 'C', clean(), placements=[(0, 0)] * 9), piece('d.png', 'D', clean(), placements=[(0, 0)] * 3),
                          piece('e.png', 'E', clean(), placements=[(0, 0)] * 40)])
        review = {'entries': {f'konclui/sprites/{n}.png': {'verdict': v} for n, v in
                              (('a', 'redraw'), ('b', 'touch-up'), ('c', 'keep'), ('d', 'redraw'))}}
        rows = C.ranking(dist, review)
        self.assertEqual([(r['name'], r['score']) for r in rows], [('D', 9), ('A', 6), ('B', 5), ('E', 0), ('C', 0)])
        self.assertEqual([r['rank'] for r in rows], [1, 2, 3, 4, 5])
        self.assertEqual(rows[3]['verdict'], 'unreviewed')

    def test_the_document_lists_the_repeated_keeps_and_the_second_looks(self):
        dist = self.dist([piece('a.png', 'A', clean(), placements=[(0, 0)] * 7), piece('b.png', 'B', clean(), placements=[(0, 0)] * 2)])
        review = {'entries': {'konclui/sprites/a.png': {'verdict': 'keep', 'name': 'A', 'second_opinion': dict(verdict='touch-up', reviewer='me', reason='r')},
                              'konclui/sprites/b.png': {'verdict': 'redraw', 'name': 'B'}}}
        doc = C.ranking_document(dist, review)
        self.assertEqual((doc['placements'], doc['placements_by_verdict']), (9, {'redraw': 2, 'touch-up': 0, 'keep': 7}))
        self.assertEqual(doc['share_of_placements_not_keep'], round(2 / 9, 4))
        self.assertEqual(doc['most_repeated_keep'][0]['name'], 'A')
        self.assertEqual([(s['name'], s['audit_verdict'], s['second_verdict'], s['changes_audit']) for s in doc['second_look']],
                         [('A', 'keep', 'touch-up', True)])


# ------------------------------------------------------------------------------------------------------------- interfaces

class Interfaces(Tmp):
    def test_the_result_has_the_fields_of_verifys_result(self):
        try:
            sys.path.insert(0, str(HERE.parent / 'hq-office'))
            import verify as V
        except Exception as error:  # noqa: BLE001 (verify.py belongs to another job and may be in flux)
            self.skipTest(f'tools/verify.py does not import here: {error}')
        self.assertEqual([f.name for f in dataclasses.fields(C.Result)], [f.name for f in dataclasses.fields(V.Result)])
        self.assertEqual((C.PASS, C.FAIL, C.REPORTED), (V.PASS, V.FAIL, V.REPORTED))
        converted = C.to_verify(V.Result, C.Result('office.contract', C.PASS, 'ok', ['l'], {'a': 1}))
        self.assertIsInstance(converted, V.Result)
        self.assertEqual(converted.as_json()['name'], 'office.contract')

    def test_the_command_line_writes_the_baseline_then_check_passes_and_a_regression_exits_1(self):
        dist = self.dist([piece('a.png', 'Mesa A', offender(), tags=['Mesas']), piece('b.png', 'B', clean())])
        data = self.tmp / 'data'

        def run(*argv):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = C.main(list(argv))
            return code, out.getvalue()
        code, out = run('baseline', str(dist), '--write', '--data-dir', str(data))
        self.assertEqual(code, 0)
        self.assertTrue((data / 'baseline.json').is_file())
        code, out = run('check', str(dist), '--data-dir', str(data))
        self.assertEqual(code, 0)
        self.assertIn('pass      office.contract', out)
        code, out = run('report', str(dist), '--data-dir', str(data))
        self.assertIn('foot_gap', out)
        self.assertRegex(out, r'foot_gap\s+stand\s+2\s+1\s+1')
        save(dist / 'entities/konclui/sprites/b.png', offender())
        code, out = run('check', str(dist), '--data-dir', str(data))
        self.assertEqual(code, 1)
        self.assertIn('fail      office.contract', out)
        self.assertIn('foot_gap: konclui/sprites/b.png', out)
        code, out = run('baseline', str(dist))                         # no --write: printed, never written to the repo
        self.assertEqual(json.loads(out)['rules']['foot_gap']['count'], 2)


# ----------------------------------------------------------------------------------------------- outline: one ink per material

def two_materials():
    """24 x 24: a navy-outlined blue cushion on a brown-outlined tan base. Every boundary pixel is some material's own ink, as
    tools/bake.py draws a multi-material piece (bake.py accepts any material's ink). The two inks hold about half of the boundary
    each, so a one-ink measure sees 50% and a per-material one sees 100%."""
    NAVY, BLUE, BROWN, TAN = (16, 16, 64), (80, 110, 200), (70, 40, 20), (200, 160, 110)
    img = canvas(24, 24)
    paint(img, 3, 3, 20, 12, NAVY)
    paint(img, 4, 4, 19, 11, BLUE)
    paint(img, 3, 13, 20, 21, BROWN)
    paint(img, 4, 14, 19, 20, TAN)
    return img, NAVY, BROWN


class OutlineInks(unittest.TestCase):
    def test_a_piece_in_two_materials_with_an_ink_each_passes(self):
        img, navy, brown = two_materials()
        share, darkest = C.outline_share(img)
        self.assertEqual(sorted(C.ink_colours(img)), sorted([navy, brown]))
        self.assertEqual(darkest, navy, 'the darkest of the inks is the one reported')
        self.assertEqual(share, 1.0)
        self.assertNotIn('outline', C.sprite_problems(img, 'stand'))
        # what the one-ink measure said: only the darkest ink counts
        boundary = C.boundary_mask(C.solid_mask(img))
        self.assertAlmostEqual(float(C.near_any(img[boundary][:, :3], [navy]).mean()), 0.51, delta=0.06)

    def test_a_piece_outlined_in_one_light_colour_has_no_ink_and_fails(self):
        light = inked_box(20, 20, 2, 2, 17, 18, fill=(30, 40, 60), ink=(235, 230, 215))     # a pale rim round a dark body
        self.assertEqual(C.ink_colours(light), [])
        self.assertIsNone(C.ink_colour(light))
        self.assertEqual(C.outline_share(light), (0.0, None))
        problems = C.sprite_problems(light, 'stand')
        self.assertIn('outline', problems)
        self.assertIn('no ink', problems['outline'][0])

    def test_a_colour_lighter_than_the_median_never_counts_even_with_a_large_share(self):
        # a dark body whose top rim (30% of the boundary) is a highlight: the highlight is not an ink, the dark rest is, 70% < 90%
        img = inked_box(20, 20, 2, 2, 17, 18, fill=(40, 60, 80), ink=(10, 10, 30))
        paint(img, 2, 2, 17, 6, (230, 230, 200))                       # the upper 5 rows are light, boundary included
        inks = C.ink_colours(img)
        self.assertNotIn((230, 230, 200), inks)
        self.assertIn((10, 10, 30), inks)
        share, _ = C.outline_share(img)
        self.assertLess(share, 0.9)
        self.assertIn('outline', C.sprite_problems(img, 'stand'))

    def test_a_colour_with_too_small_a_share_is_not_an_ink_and_its_pixels_are_not_outline(self):
        img = inked_box(30, 30, 2, 2, 27, 28)                          # boundary 2 * 26 + 2 * 25 = 102 px
        paint(img, 2, 2, 9, 2, (60, 20, 20))                           # 8 px of a second dark colour: 7.8% -> an ink (>= 5%)
        self.assertEqual(len(C.ink_colours(img)), 2)
        img2 = inked_box(30, 30, 2, 2, 27, 28)
        paint(img2, 2, 2, 5, 2, (60, 20, 20))                          # 4 px: 3.9% -> not an ink
        self.assertEqual(C.ink_colours(img2), [INK])
        # and 4 px far from the ink are not outline
        self.assertLess(C.outline_share(img2)[0], 1.0)

    def test_the_edge_rule_exempts_only_the_darkest_ink(self):
        img, navy, brown = two_materials()                              # navy is darker than brown
        img[3, :, :] = 0
        paint(img, 0, 3, 23, 3, navy)                                   # a navy run along the top edge...
        img2 = np.roll(img, -3, axis=0)                                  # ... moved to the very first row
        self.assertEqual(C.edge_runs(img2)['top'][0][2], True)
        img3, navy, brown = two_materials()
        paint(img3, 3, 13, 20, 13, brown)
        flat = np.roll(img3, -13, axis=0)                               # the brown base's top rim on row 0
        self.assertEqual([r[2] for r in C.edge_runs(flat)['top']], [False], 'a rim that is not the darkest ink is a cut')

    def test_a_baked_two_material_piece_passes_the_contract_outline_as_it_passes_the_bakers(self):
        try:
            import bake as B
            import volume as V
        except ImportError as error:                                   # the baker is another lane's file: its absence skips, never fails
            self.skipTest(f'no baker: {error}')
        recipe = V.Recipe('two-material-test', [V.box(0, 0, 0, 1, 1, 0.3, 'wood'), V.box(0.1, 0.1, 0.3, 0.9, 0.8, 0.6, 'ds-mint')], (1, 1))
        piece = B.bake(recipe, 'oblique')
        share, ink = C.outline_share(piece.rgba)
        self.assertGreaterEqual(piece.metrics['outline_fraction'], 0.9)
        self.assertGreaterEqual(share, 0.9, f'the baker says {piece.metrics["outline_fraction"]:.3f}, the contract {share:.3f}')
        self.assertNotIn('outline', C.sprite_problems(piece.rgba, 'stand'))


def pole(rim=INK, centre=FILL, width=3, h=24, x0=8, y0=2):
    """A vertical pole `width` px wide and `h` rows tall with a one pixel outline all round (width 2: all of it is outline)."""
    return inked_box(20, h + 3, x0, y0, x0 + width - 1, y0 + h - 1, fill=centre, ink=rim)


class ThinPieces(unittest.TestCase):
    """A thin piece is mostly boundary: a 3 px pole with a perfect outline has the ink on 2/3 of ALL its pixels, so the median of
    the solid pixels IS the ink and the ink can never be darker than it. A colour that holds half of the piece or more is
    compared with the pixels that are not that colour instead."""

    def test_a_three_pixel_pole_with_a_perfect_outline_passes(self):
        img = pole()
        solid = C.solid_mask(img)
        self.assertGreaterEqual(int((img[solid][:, :3] == INK).all(axis=1).sum()) / int(solid.sum()), 0.5)      # the case that failed
        self.assertEqual(C.ink_colours(img), [INK])
        self.assertEqual(C.outline_share(img), (1.0, INK))
        self.assertNotIn('outline', C.sprite_problems(img, 'stand'))

    def test_a_pole_that_is_only_rim_has_nothing_to_be_lighter_than_and_passes_in_one_colour(self):
        img = pole(width=2)
        self.assertEqual(C.ink_colours(img), [INK])
        self.assertNotIn('outline', C.sprite_problems(img, 'stand'))

    def test_a_two_pixel_pole_with_one_light_side_does_not_pass(self):
        img = pole(width=2)
        img[:, 9, :3] = (235, 230, 215)                                # right column light, left dark: half the boundary
        share, _ = C.outline_share(img)
        self.assertLess(share, 0.9)
        self.assertIn('outline', C.sprite_problems(img, 'stand'))

    def test_a_light_rimmed_thin_pole_still_fails(self):
        for width in (3, 4, 5):
            img = pole(rim=(235, 230, 215), centre=(30, 40, 60), width=width)
            self.assertEqual(C.ink_colours(img), [], width)
            self.assertIn('no ink', C.sprite_problems(img, 'stand')['outline'][0])

    def test_a_pole_whose_rim_is_not_darker_than_its_centre_fails_even_when_the_rim_is_most_of_it(self):
        img = pole(rim=(120, 120, 150), centre=(20, 20, 40), width=3)
        self.assertEqual(C.ink_colours(img), [])
        self.assertIn('outline', C.sprite_problems(img, 'stand'))

    def test_a_flat_blob_of_one_colour_has_no_ink(self):
        blob = canvas(20, 20)
        paint(blob, 2, 2, 17, 17, FILL)                                # nothing outlines it: every boundary pixel is the fill
        self.assertEqual(C.ink_colours(blob), [])
        self.assertIn('no ink', C.sprite_problems(blob, 'stand')['outline'][0])

    def test_a_thin_flat_bar_of_one_colour_has_no_ink_but_a_line_has(self):
        # thin (boundary over 40% of the piece), one colour, with an interior: nothing outlines it. A 2 px line has no interior:
        # every pixel is boundary and it is its own ink
        bar = pole(rim=FILL, centre=FILL, width=4)
        solid = C.solid_mask(bar)
        self.assertGreaterEqual(float(C.boundary_mask(solid).sum()) / float(solid.sum()), 0.4)
        self.assertTrue((solid & ~C.boundary_mask(solid)).any())
        self.assertEqual(C.ink_colours(bar), [])
        self.assertEqual(C.ink_colours(pole(rim=FILL, centre=FILL, width=2)), [FILL])

    def test_a_wide_flat_body_with_a_lighter_window_has_no_ink(self):
        # reviewer case: 16x16 grey (61% of the piece) with a 10x10 lighter window; the rim is the fill, so nothing outlines it
        # (the boundary is 23% of the piece: not thin, so the half-of-the-piece case does not apply)
        body = canvas(20, 20)
        paint(body, 2, 2, 17, 17, (120, 120, 120))
        paint(body, 5, 5, 14, 14, (240, 240, 240))
        solid = C.solid_mask(body)
        self.assertGreaterEqual(float((body[solid][:, :3] == (120, 120, 120)).all(axis=1).mean()), 0.5)
        self.assertLess(float(C.boundary_mask(solid).sum()) / float(solid.sum()), 0.4)
        self.assertEqual(C.ink_colours(body), [])
        self.assertEqual(C.outline_share(body)[0], 0.0)
        self.assertIn('no ink', C.sprite_problems(body, 'stand')['outline'][0])

    def test_a_wide_flat_body_with_a_lighter_highlight_stripe_has_no_ink(self):
        body = canvas(20, 20)
        paint(body, 2, 2, 17, 17, (120, 120, 120))
        paint(body, 4, 6, 15, 7, (235, 235, 235))                      # a highlight stripe across the face, off the rim
        self.assertEqual(C.ink_colours(body), [])
        self.assertIn('no ink', C.sprite_problems(body, 'stand')['outline'][0])
        body[2, 2:18, :3] = (235, 235, 235)                            # a lighter top edge too: still no outline
        self.assertEqual(C.ink_colours(body), [])

    def test_the_half_of_the_piece_case_needs_the_ink_on_nearly_all_of_the_boundary(self):
        # a 3 px pole, 24 rows: boundary 50 px of 72. Ten rim pixels are light: the ink holds 40 of 72 (55%, so the plain median
        # test cannot take it) but only 80% of the boundary, not 90%
        img = pole()
        img[3:8, 8, :3] = (200, 200, 200)
        img[3:8, 10, :3] = (200, 200, 200)
        solid = C.solid_mask(img)
        self.assertEqual(int((img[solid][:, :3] == INK).all(axis=1).sum()), 40)
        self.assertEqual(C.ink_colours(img), [])
        self.assertIn('outline', C.sprite_problems(img, 'stand'))

    def test_a_colour_the_plain_median_test_accepts_is_still_accepted(self):
        # the rule only adds the half-of-the-piece case: a piece with a light fill and a dark outline is judged as before
        self.assertEqual(C.ink_colours(clean()), [INK])
        img = inked_box(20, 20, 2, 2, 17, 18, fill=(200, 200, 200), ink=(120, 120, 120))
        self.assertEqual(C.ink_colours(img), [(120, 120, 120)])

    def test_the_wider_piece_results_are_unchanged(self):
        self.assertEqual(C.outline_share(clean()), (1.0, INK))
        for width in (4, 6, 12):
            self.assertEqual(C.outline_share(pole(width=width))[1], INK)

    def test_a_baked_three_pixel_pole_passes_as_it_passes_the_baker(self):
        import bake as B
        for proj in ('oblique', 'camera75'):
            with self.subTest(proj):
                recipe = B.V.Recipe('thin-pole', [B.V.box(14 / 32, 28 / 32, 0, 17 / 32, 1.0, 1.2, 'wood')], (1, 1))
                piece = B.bake(recipe, proj, overrides=False)
                self.assertEqual(piece.metrics['outline_fraction'], 1.0)
                self.assertFalse([v for v in piece.violations if v.startswith('outline')])
                solid = C.solid_mask(piece.rgba)
                ink = B.V.hex_rgb(B.V.MATERIALS['wood'].ink)
                self.assertGreaterEqual(float((piece.rgba[solid][:, :3] == ink).all(axis=1).mean()), 0.5, 'the fixture is the thin case')
                self.assertNotIn('outline', C.sprite_problems(piece.rgba, 'stand'))


class OneOutlineDefinition(unittest.TestCase):
    """The baker and the contract measure the outline with ONE function (bake.outline_share); they differ only in the limits
    they pass it."""

    def test_both_call_bake_outline_share_with_their_own_limits(self):
        import bake as B
        from unittest import mock
        with mock.patch.object(B, 'outline_share', wraps=B.outline_share) as spy:
            B.bake(B.V.Recipe('one-fn', [B.V.box(0, 0, 0, 1, 1, 0.5, 'wood')], (1, 1)), 'oblique', overrides=False)
            baker_calls = [c.kwargs for c in spy.call_args_list]
            spy.reset_mock()
            C.outline_share(clean())
            contract_calls = [c.kwargs for c in spy.call_args_list]
        self.assertEqual([c['tolerance'] for c in baker_calls], [0])
        self.assertEqual([c['tolerance'] for c in contract_calls], [C.INK_TOLERANCE])
        self.assertEqual([c['solid_alpha'] for c in contract_calls], [C.K.SOLID_ALPHA])

    def test_the_boundary_and_the_ink_derivation_are_the_bakers(self):
        import bake as B
        img = pole()
        self.assertTrue((C.boundary_mask(C.solid_mask(img)) == B.boundary_mask(img[..., 3] >= C.K.SOLID_ALPHA)).all())
        self.assertEqual(C.ink_colours(img), B.picture_inks(img, solid_alpha=C.K.SOLID_ALPHA, min_share=C.INK_MIN_SHARE))

    def test_the_baker_and_the_contract_agree_on_every_demonstration_piece_and_projection(self):
        import bake as B
        import test_bake as TB
        for recipe in (TB.unit_box(), TB.demo_crate(), TB.demo_side_table()):
            for proj in ('oblique', 'camera75'):
                piece = B.bake(recipe, proj, overrides=False)
                share, _ = C.outline_share(piece.rgba)
                self.assertGreaterEqual(piece.metrics['outline_fraction'], 0.9, (recipe.name, proj))
                self.assertGreaterEqual(share, 0.9, (recipe.name, proj))
                self.assertNotIn('outline', C.sprite_problems(piece.rgba, 'stand'), (recipe.name, proj))


# ------------------------------------------------------------------------------------------------ numbers from projection.json

PROJECTION_JSON = HERE / 'projection.json'


def projection_doc(**sz):
    return {'default': 'oblique', 'tile_m': 1.0, 'bake': {'foot_gap_max': 1, 'colour_cap': 24},
            'projections': {'oblique': {'sx_px_per_m': 32, 'sy_px_per_m': 32, 'sz_px_per_m': sz.get('oblique', 21)},
                            'camera75': {'sx_px_per_m': 32, 'sy_px_per_m': 24, 'sz_px_per_m': sz.get('camera75', 21)}}}


class ProjectionNumbers(Tmp):
    def test_the_module_numbers_are_the_ones_of_projection_json(self):
        doc = json.loads(PROJECTION_JSON.read_text())
        default = doc['projections'][doc['default']]
        self.assertEqual(C.HEIGHT_PX_PER_M, default['sz_px_per_m'])
        self.assertEqual(C.GROUND_PX_PER_TILE, default['sy_px_per_m'] * doc['tile_m'])
        self.assertEqual(C.FOOT_GAP_MAX, doc['bake']['foot_gap_max'])
        self.assertEqual(C.COLOURS_MAX, doc['bake']['colour_cap'])
        self.assertEqual(C.limits()['foot_gap_max'], doc['bake']['foot_gap_max'])
        self.assertEqual(C.limits()['colours_max'], doc['bake']['colour_cap'])
        self.assertEqual({p['sz_px_per_m'] for p in doc['projections'].values()}, {C.HEIGHT_PX_PER_M},
                         'a height is one scale: every named projection must have the same sz_px_per_m')

    def test_the_loader_follows_the_file_and_refuses_projections_that_disagree_on_the_height_of_a_metre(self):
        path = self.tmp / 'projection.json'
        doc = projection_doc()
        doc['bake'] = {'foot_gap_max': 2, 'colour_cap': 20}
        doc['projections']['oblique']['sy_px_per_m'] = 16
        doc['projections']['camera75']['sz_px_per_m'] = 30
        doc['projections']['oblique']['sz_px_per_m'] = 30
        path.write_text(json.dumps(doc))
        self.assertEqual(C.load_projection_numbers(path),
                         dict(height_px_per_m=30, ground_px_per_tile=16.0, foot_gap_max=2, colour_cap=20))
        path.write_text(json.dumps(projection_doc(camera75=24)))
        with self.assertRaisesRegex(ValueError, 'disagree on sz_px_per_m'):
            C.load_projection_numbers(path)

    def test_the_anchors_and_the_units_note_use_the_file_s_height(self):
        label, px = C.anchor_for('Mesa de escritório')
        self.assertEqual(px, round(0.74 * C.HEIGHT_PX_PER_M))
        self.assertIn(f'{C.HEIGHT_PX_PER_M} px', C.units_note())
        pieces = load_committed('pieces.json')
        if pieces:
            self.assertEqual(pieces['units'], C.units_note(), 'pieces.json is stale: rerun `contract.py pieces DIST --write`')

    def test_the_limits_shared_with_the_baker_have_not_drifted(self):
        try:
            import bake as B
        except ImportError as error:
            self.skipTest(f'no baker: {error}')
        self.assertEqual(C.HEIGHT_CAP_PX, B.HEIGHT_CAP_PX)
        self.assertEqual(C.MIRROR_MAX, B.SYMMETRY_TOLERANCE)
        self.assertEqual(C.OUTLINE_MIN_SHARE, 0.9, 'bake.py checks "at least 90%" of the boundary')
        projection = B.load_projection()
        self.assertEqual((C.HEIGHT_PX_PER_M, C.FOOT_GAP_MAX), (projection.sz, projection.foot_gap_max))
        self.assertEqual(C.COLOURS_MAX, projection.colour_cap)          # a Recipe's own colour_cap is None: it follows the file
        box = B.V.Recipe('x', [B.V.box(0, 0, 0, 1, 1, 1, 'wood')], (1, 1))
        self.assertIsNone(box.colour_cap)
        self.assertEqual(B.bake(box, overrides=False).meta['colour_cap'], C.COLOURS_MAX, 'the baker and the contract read one number')


def load_committed(name):
    path = C.DATA_DIR / name
    return json.loads(path.read_text()) if path.is_file() else None


# ------------------------------------------------------------------------------------------------ agreement of the generic rules

def casters_and_prefabs():
    casters = {'a': dict(h=16, rows=40, basis='anchor'),                 # a desk: today's rows 40, tag cap 16, grid 40 - 1 x 32 = 8
               'b': dict(h=19, rows=19, basis='rows'),                   # a chair: rows 19, tag cap 19, no grid
               'c': dict(h=18, rows=27, basis='anchor'),                 # a sofa: rows 27, tag cap 18, grid 27 - 2 x 32 = -37 (under 1)
               'd': dict(h=10, rows=10, basis='measured')}               # no capped tag: rows, tag cap 10
    prefabs = {'a': dict(tags=['Mesas'], collisionGrid=[[1, 1], [0, 0]]), 'b': dict(tags=['Cadeiras e bancos']),
               'c': dict(tags=['Sofás e poltronas'], collisionGrid=[[1], [1]]), 'd': dict(tags=['Outros'])}
    return casters, prefabs


class Agreement(Tmp):
    def test_the_figures_are_the_hand_computed_ones(self):
        casters, prefabs = casters_and_prefabs()
        out = C.pieces_agreement(casters, prefabs)
        self.assertEqual((out['curated'], out['basis']), (4, {'anchor': 2, 'measured': 1, 'rows': 1}))
        self.assertEqual(out['all']['n'], 4)
        self.assertEqual(out['all']['mean_abs_error_px'], {'today_rows': round((24 + 0 + 9 + 0) / 4, 1), 'tag_cap': 0.0})
        self.assertEqual(out['all']['off_by_more_than_8_px'], {'today_rows': 2, 'tag_cap': 0})
        self.assertEqual(out['anchor_only']['n'], 2)
        self.assertEqual(out['anchor_only']['mean_abs_error_px']['today_rows'], 16.5)
        grid = out['with_collision_grid']
        self.assertEqual(grid['n'], 2)
        # grid depth rule: a -> 40 - 32 = 8 (error 8), c -> 27 - 64 = -37 (error 55; clamped at 1: 17; falling back to rows: 9)
        self.assertEqual(grid['mean_abs_error_px'], {'today_rows': 16.5, 'tag_cap': 0.0, 'grid_depth': 31.5,
                                                     'grid_depth_clamped_at_1': 12.5, 'grid_depth_or_rows': 8.5})

    def test_the_ground_of_a_tile_is_read_from_the_projection_not_typed_here(self):
        casters, prefabs = casters_and_prefabs()
        old = C.GROUND_PX_PER_TILE
        try:
            C.GROUND_PX_PER_TILE = 20
            grid = C.pieces_agreement(casters, prefabs)['with_collision_grid']
        finally:
            C.GROUND_PX_PER_TILE = old
        self.assertEqual(grid['mean_abs_error_px']['grid_depth'], (abs(20 - 16) + abs(-13 - 18)) / 2)   # a: 40 - 20; c: 27 - 40

    def test_a_hand_entry_with_no_rows_is_left_out_rather_than_crashing(self):
        casters, prefabs = casters_and_prefabs()
        casters['a'] = dict(h=12, source='manual: looked at the picture')
        self.assertEqual(C.pieces_agreement(casters, prefabs)['curated'], 3)

    def test_the_rejection_text_is_built_from_the_figures_and_does_not_contradict_them(self):
        casters, prefabs = casters_and_prefabs()
        agreement = C.pieces_agreement(casters, prefabs)
        text = C.rejected_text(agreement)
        for figure in ('31.5', '12.5', '8.5', '16.5', '0.0', '2 of 4'):
            self.assertIn(figure, text)
        self.assertNotIn('further', text)
        agreement['with_collision_grid']['mean_abs_error_px']['grid_depth'] = 99.9
        self.assertIn('99.9', C.rejected_text(agreement), 'the numbers come from the figures, not from the text')

    def test_the_command_prints_the_same_figures_as_the_function(self):
        casters, prefabs = casters_and_prefabs()
        dist = self.dist([piece('a.png', 'Mesa A', inked_box(20, 40, 2, 2, 17, 38), tags=['Mesas'], collisionGrid=[[1, 1, 1], [0, 0, 0]])])
        data = self.tmp / 'data'
        data.mkdir()
        (data / 'pieces.json').write_text(C.dump_json({'casters': {'konclui/sprites/a.png': dict(h=16, rows=37, basis='anchor')}}))
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = C.main(['pieces-agreement', str(dist), '--data-dir', str(data)])
        out = json.loads(buffer.getvalue())
        self.assertEqual(code, 0)
        self.assertEqual(out['curated'], 1)
        self.assertEqual(out['all']['mean_abs_error_px'], {'today_rows': 21.0, 'tag_cap': 0.0})

    def test_derive_pieces_regenerates_the_generic_rule_and_its_figures(self):
        dist = self.dist([piece('a.png', 'Mesa A', inked_box(20, 40, 2, 2, 17, 38), tags=['Mesas'], collisionGrid=[[1, 1, 1], [0, 0, 0]]),
                          piece('b.png', 'Cadeira B', inked_box(20, 30, 2, 2, 17, 28), tags=['Cadeiras e bancos'])])
        stale = {'generic_rule': {'rejected': 'old text with 17.8', 'measured_agreement': {'curated': 999}}}
        rule = C.derive_pieces(dist, {'entries': {}}, stale)['generic_rule']
        self.assertEqual(rule['measured_agreement']['curated'], 2)
        self.assertEqual(rule['tag_caps'], C.TAG_CAPS)
        self.assertEqual(rule['rejected'], C.rejected_text(rule['measured_agreement']))
        self.assertNotIn('17.8', rule['rejected'])

    def test_the_committed_generic_rule_is_consistent_with_its_own_figures(self):
        pieces = load_committed('pieces.json')
        if not pieces:
            self.skipTest('no committed pieces.json')
        rule = pieces['generic_rule']
        agreement = rule['measured_agreement']
        self.assertEqual(rule['tag_caps'], C.TAG_CAPS)
        self.assertEqual(rule['rejected'], C.rejected_text(agreement), 'rerun `contract.py pieces DIST --write`')
        usable = [k for k, c in pieces['casters'].items() if 'rows' in c and 'h' in c]
        self.assertEqual((agreement['curated'], agreement['all']['n']), (len(usable), len(usable)))
        self.assertEqual(sum(agreement['basis'].values()), len(usable))
        grid = agreement['with_collision_grid']
        self.assertLessEqual(grid['n'], len(usable))
        self.assertLess(grid['mean_abs_error_px']['tag_cap'], grid['mean_abs_error_px']['today_rows'])
        self.assertIn(str(grid['mean_abs_error_px']['grid_depth']), rule['rejected'])
        self.assertNotIn('17.8', rule['rejected'])
        self.assertNotIn('106', rule['rejected'])


# ----------------------------------------------------------------------------------------------------------------- scratch paths

SCRATCH, HOME = '/' + 'tmp', '/' + 'Users'


class ScratchPaths(Tmp):
    def test_scratch_and_home_paths_are_rewritten_and_the_tag_stays(self):
        cases = {
            f'MEASURED (python3 -I {SCRATCH}/asset-audit/crops/s11/holes.py): a hole': 'MEASURED (python3 -I audit-2026-11-22/crops/s11/holes.py): a hole',
            f'MEASURED from {SCRATCH}/lighting-v2/dist/office.wam: both': 'MEASURED from dist/office.wam: both',
            f'crop of {SCRATCH}/lighting-v2/renders/preview.png, 48': 'crop of lighting-v2/renders/preview.png, 48',
            f'seen in /private{SCRATCH}/claude-501/.../images/1.webp)': 'seen in images/1.webp)',
            f'{SCRATCH}/sl-f22/lounge/on.png and {SCRATCH}/sl-f12.5/lounge/on.png': 'sl-f22/lounge/on.png and sl-f12.5/lounge/on.png',
            f'{HOME}/someone/work/.worktrees/konclui-native/.local/x.json': '.local/x.json',
            f'{HOME}/someone/notes.txt': '~/notes.txt',
            'no path here, 3/4 and a/b': 'no path here, 3/4 and a/b',
        }
        for text, want in cases.items():
            self.assertEqual(C.scrub_paths(text), want)
        self.assertEqual(C.scrub_paths(None), None)
        self.assertEqual(C.scrub_document({'a': [f'{SCRATCH}/x/y.py', 3], 'b': {'c': f'{SCRATCH}/z'}}), {'a': ['x/y.py', 3], 'b': {'c': 'z'}})

    def test_the_seed_scrubs_the_audit_text_and_a_kept_second_opinion(self):
        rgba = clean()
        dist = self.dist([piece('a.png', 'Mesa A', rgba)])
        verdicts = [dict(key='konclui/sprites/a.png', name='Mesa A', verdict='keep',
                         problems=[f'MEASURED (python3 -I {SCRATCH}/asset-audit/crops/x.py): ok', f'READ {SCRATCH}/lighting-v2/dist/office.wam'],
                         fix=f'see {SCRATCH}/asset-audit/reference.png')]
        previous = {'entries': {'konclui/sprites/a.png': {'second_opinion': {'verdict': 'keep', 'reason': f'looked at {SCRATCH}/sl-f22/lounge/on.png'}}}}
        entry = C.seed_review(dist, verdicts, previous=previous)['entries']['konclui/sprites/a.png']
        text = json.dumps(entry)
        self.assertNotIn(SCRATCH, text)
        self.assertEqual(entry['problems'][0], 'MEASURED (python3 -I audit-2026-11-22/crops/x.py): ok')
        self.assertEqual(entry['fix'], 'see audit-2026-11-22/reference.png')
        self.assertEqual(entry['second_opinion']['reason'], 'looked at sl-f22/lounge/on.png')

    def test_scrubbing_text_does_not_change_the_hash_that_decides_whether_an_entry_is_stale(self):
        dist = self.dist([piece('a.png', 'Mesa A', clean())])
        verdicts = [dict(key='konclui/sprites/a.png', name='Mesa A', verdict='redraw', problems=[f'x {SCRATCH}/asset-audit/y'])]
        review = C.seed_review(dist, verdicts)
        self.assertEqual(review['entries']['konclui/sprites/a.png']['sha256'], C.sha256_file(dist / 'entities/konclui/sprites/a.png'))
        measured = C.measure(dist)
        self.assertEqual(C.review_status(review, measured)['current'], ['konclui/sprites/a.png'])

    def test_no_committed_contract_file_points_into_a_scratch_or_home_directory(self):
        names = sorted(p.name for p in C.DATA_DIR.glob('*.json'))
        self.assertTrue({'baseline.json', 'pieces.json', 'ranking.json', 'review.json'} <= set(names) or not names, names)
        for name in names:
            text = (C.DATA_DIR / name).read_text()
            for needle in (SCRATCH + '/', HOME + '/', '/private/'):
                self.assertNotIn(needle, text, f'{name} names {needle}...: scrub it (contract.py scrub_paths)')
        for source in (HERE / 'contract.py', HERE / 'test_contract.py'):
            for needle in (SCRATCH, HOME):
                self.assertNotIn(needle, source.read_text(), f'{source.name} spells {needle}: build it in parts')


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'set KONCLUI_DIST to a built map (hq-office/build.py --out DIR)')
class BuiltContract(unittest.TestCase):
    def test_the_committed_baseline_holds_on_the_build_it_was_measured_on_or_on_an_improvement_of_it(self):
        results = C.check(os.environ['KONCLUI_DIST'])
        for r in results:
            print(f'  {r.status:<9} {r.name}  {r.detail}', file=sys.stderr)
        self.assertEqual(results[0].status, C.PASS, results[0].lines[:3])
        self.assertEqual(results[1].status, C.PASS, results[1].lines[:3])

    def test_the_committed_agreement_figures_are_what_the_build_gives(self):
        pieces = load_committed('pieces.json')
        dist = os.environ['KONCLUI_DIST']
        self.assertEqual(C.pieces_agreement(pieces['casters'], C.prefabs_of(dist)), pieces['generic_rule']['measured_agreement'])


if __name__ == '__main__':
    unittest.main()
