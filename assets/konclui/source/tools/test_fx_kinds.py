"""Behaviour tests of what hq-office/fx.py writes for the new lighting ("kinds", "painted", the classifier fixture) and of the
switch that builds the lounge pieces without their painted shadow rows (KONCLUI_PAINTED_SHADOWS, lounge.py + translucent.py).
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_fx_kinds.py
No external tool and no build: a small map in a temporary directory, and the lounge's own pictures (built in a fraction of a
second). `BuiltManifest` runs only with KONCLUI_DIST set (a built map: hq-office/build.py --out DIR)."""
import hashlib
import json
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
import fx as FX  # noqa: E402
import kinds as K  # noqa: E402
import lounge as LOUNGE  # noqa: E402
import test_kinds as TK  # noqa: E402  (the small map)
import translucent as TL  # noqa: E402

# sha256 over every picture of lounge.pieces() with the painted rows on (the default), measured on HEAD before this change:
# the switch must not move a byte while it is on.
LOUNGE_DEFAULT_SHA256 = '4fe216401f2c704fbaac21ab738fe8da170d3938a1a063ae303f82432c2b67ec'


def lounge_pictures(painted):
    """{(group, variant): RGBA array} of lounge.pieces() built with the painted rows on or off (the cache is bypassed)."""
    with mock.patch.dict(os.environ, {'KONCLUI_PAINTED_SHADOWS': '1' if painted else '0'}):
        pieces = LOUNGE.pieces.__wrapped__()
    return {(g, v): np.asarray(pieces[g][v]['image']) for g in sorted(pieces) for v in sorted(pieces[g])}


class Written(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='test-fx-kinds-')
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def test_kinds_are_the_rule_over_the_placed_sprites(self):
        self.assertEqual(FX.kinds(TK.make_dist(self.tmp)),
                         {'col/chair.png': 'stand', 'col/frame.png': 'hang', 'col/mug.png': 'top', 'col/rug.png': 'floor'})

    def test_a_picture_whose_prefabs_disagree_stops_the_build(self):
        dist = TK.make_dist(self.tmp)
        with mock.patch.object(FX.KINDS, 'kinds_of', side_effect=ValueError('x: one picture, one kind')):
            with self.assertRaises(SystemExit) as caught:
                FX.kinds(dist)
        self.assertIn('one picture, one kind', str(caught.exception))

    def test_painted_lists_a_stand_piece_that_draws_its_shadow_and_never_a_hang_or_floor_piece(self):
        dist = TK.make_dist(self.tmp)
        shadowed = np.concatenate([TK.block(12, 16, (60, 90, 160)), np.zeros((4, 12, 4), np.uint8)])
        shadowed[16, :] = (10, 10, 61, 40)
        TK.png(dist / 'entities' / 'col' / 'chair.png', shadowed)
        TK.png(dist / 'entities' / 'col' / 'frame.png', np.concatenate([TK.block(16, 12, (200, 200, 60)),
                                                                        np.full((4, 16, 4), (10, 10, 61, 40), np.uint8)]))
        self.assertEqual(FX.painted(dist, FX.kinds(dist)), ['col/chair.png'])

    def test_painted_lists_a_declared_baked_shadow_piece_even_when_its_alpha_is_128(self):
        dist = TK.make_dist(self.tmp)
        path = dist / 'entities' / 'col' / 'collection.json'
        doc = json.loads(path.read_text())
        doc['collection'][1]['name'] = 'Pebolim do salão de jogos'      # a declared name: the catalogue's own shadow at alpha 128
        path.write_text(json.dumps(doc))
        self.assertIn('col/chair.png', FX.painted(dist, FX.kinds(dist)))

    def test_painted_is_empty_for_clean_pictures(self):
        dist = TK.make_dist(self.tmp)
        self.assertEqual(FX.painted(dist, FX.kinds(dist)), [])

    def test_dump_kinds_writes_the_shared_fixture_rows(self):
        dist = TK.make_dist(self.tmp)
        target = self.tmp / 'placed-kinds.json'
        rows = FX.dump_kinds(dist, target)
        self.assertEqual(json.loads(target.read_text()), rows)
        self.assertEqual([r['key'] for r in rows], sorted(r['key'] for r in rows))
        rug = next(r for r in rows if r['key'] == 'col/rug.png')
        self.assertEqual(rug, {'key': 'col/rug.png', 'name': 'Tapete de lã 5×3', 'tags': ['Tapetes e pisos'],
                               'depthOffset': -192, 'kind': 'floor'})
        for r in rows:
            self.assertEqual(K.classify(r['name'], r['tags'], r['depthOffset'], r['key']), r['kind'])

    def test_the_old_flat_pattern_wrongly_matched_costela_and_the_kinds_rule_does_not(self):
        self.assertTrue(FX.FLAT.search('Costela-de-adão (monstera)'))
        self.assertEqual(K.classify('Costela-de-adão (monstera)'), 'stand')


class PaintedShadowsSwitch(unittest.TestCase):
    def test_the_default_keeps_every_lounge_picture_byte_identical_to_before(self):
        pictures = lounge_pictures(painted=True)
        digest = hashlib.sha256()
        for (g, v), px in pictures.items():
            digest.update(g.encode() + v.encode() + Image.fromarray(px, 'RGBA').tobytes())
        self.assertEqual(digest.hexdigest(), LOUNGE_DEFAULT_SHA256)

    def test_the_switch_is_read_from_the_environment_and_defaults_on(self):
        self.assertTrue(LOUNGE.painted_shadows({}))
        self.assertTrue(LOUNGE.painted_shadows({'KONCLUI_PAINTED_SHADOWS': '1'}))
        self.assertFalse(LOUNGE.painted_shadows({'KONCLUI_PAINTED_SHADOWS': '0'}))
        self.assertEqual(TL.painted_shadows({}), True)
        self.assertEqual(TL.painted_shadows({'KONCLUI_PAINTED_SHADOWS': '0'}), False)

    def test_shade_row_paints_only_while_the_switch_is_on(self):
        a = np.zeros((3, 8, 4), np.uint8)
        LOUNGE.shade_row(a, 1, 2, 5, 48)
        self.assertEqual(a[1, 2:6, 3].tolist(), [48, 48, 48, 48])
        b = np.zeros((3, 8, 4), np.uint8)
        with mock.patch.dict(os.environ, {'KONCLUI_PAINTED_SHADOWS': '0'}):
            LOUNGE.shade_row(b, 1, 2, 5, 48)
        self.assertEqual(int(b.sum()), 0)

    def test_the_pieces_that_change_without_the_rows_are_exactly_the_declared_lounge_list_plus_two_lamps_and_a_plant(self):
        on, off = lounge_pictures(True), lounge_pictures(False)
        changed = {k for k in on if on[k].shape != off[k].shape or (on[k] != off[k]).any()}
        names = {LOUNGE.NAMES[g] for g, _ in changed}
        declared = {n for n in names if TL.layer_of(n) == 'baked-shadow'}
        self.assertEqual(declared, set(TL.LOUNGE_ROW_SHADOWS))
        # the rest: the arc lamp and the nightstands (declared lamp-light-pool: they keep their glow) and Aglaonema (not declared:
        # the default build's alpha repair already drops its rows)
        self.assertEqual(names - declared, {'Luminária de arco com cúpula', 'Criado-mudo de nogueira', 'Aglaonema'})

    def test_without_the_rows_a_lounge_row_shadow_piece_has_no_partial_alpha_left(self):
        off = lounge_pictures(False)
        for (g, v), px in off.items():
            if LOUNGE.NAMES[g] in TL.LOUNGE_ROW_SHADOWS:
                partial = (px[..., 3] > 0) & (px[..., 3] < 255)
                self.assertFalse(partial.any(), LOUNGE.NAMES[g])

    def test_the_declared_pictures_of_those_pieces_are_thirteen_files(self):
        on = lounge_pictures(True)
        files = sum(1 for (g, _), px in on.items() if LOUNGE.NAMES[g] in TL.LOUNGE_ROW_SHADOWS
                    and ((px[..., 3] > 0) & (px[..., 3] < 255)).any())
        self.assertEqual(files, TL.LOUNGE_ROW_SHADOW_FILES)

    def test_the_declared_layers_follow_the_switch_and_the_default_is_what_it_was(self):
        self.assertEqual(TL.expected_entity_files(True), {'glass': 77, 'lamp-light-pool': 4, 'baked-shadow': 32})
        self.assertEqual(TL.expected_entity_files(False), {'glass': 77, 'lamp-light-pool': 4, 'baked-shadow': 19})
        on, off = TL.entity_layers(True), TL.entity_layers(False)
        self.assertEqual(len(on['baked-shadow'][1]), 30)
        self.assertEqual(len(off['baked-shadow'][1]), 19)
        self.assertEqual(on['glass'], off['glass'])
        self.assertEqual(on['lamp-light-pool'], off['lamp-light-pool'])
        self.assertEqual(TL.ENTITY_LAYERS, on)                   # this process runs with the default
        self.assertEqual(TL.EXPECTED_ENTITY_FILES, TL.expected_entity_files(True))


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST is unset')
class BuiltManifest(unittest.TestCase):
    """The real build's manifest: every placed sprite has a kind and the list of painted pieces conforms."""

    def test_the_manifest_covers_every_placed_sprite_and_conforms(self):
        dist = Path(os.environ['KONCLUI_DIST'])
        manifest = json.loads((dist / 'fx' / 'manifest.json').read_text())
        self.assertEqual(K.manifest_problems(manifest), [])
        self.assertEqual(set(manifest['kinds']), set(manifest['shadows']))
        self.assertEqual(manifest['kinds'], FX.kinds(dist))


if __name__ == '__main__':
    if not os.environ.get('KONCLUI_DIST'):
        print('note: KONCLUI_DIST is unset, so BuiltManifest is SKIPPED; build with `python3 hq-office/build.py --out DIR '
              '--renders DIR2` and rerun with KONCLUI_DIST=DIR')
    unittest.main()
