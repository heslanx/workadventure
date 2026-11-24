"""Behaviour tests of the wiring of the volume pieces into the build (KONCLUI_VOLUME_PIECES): the switch (hq-office/translucent.py),
the pieces it replaces or touches up (hq-office/lounge.py), the manifest facts and light anchors (hq-office/fx.py) and the normals
(tools/normals.py). The checks of verify.py for them are in test_verify.py.
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_volume_pieces.py
No external tool and no build: the lounge's own pictures, baked in a few seconds, and small maps in temporary directories.
`BuiltVolume` runs only with KONCLUI_DIST set to a build made with the switch (hq-office/build.py --out DIR); its default-build half
runs on a build made without it."""
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
import lounge as LOUNGE  # noqa: E402
import normals as N  # noqa: E402
import pieceboard as PB  # noqa: E402
import test_kinds as TK  # noqa: E402  (the small map)
import translucent as TL  # noqa: E402

ENV = 'KONCLUI_VOLUME_PIECES'
AIR, STOOL, LAMP, PLANT = 'Koncluí: air hockey', 'Koncluí: banqueta', 'Koncluí: luminária de arco', 'Koncluí: planta ave-do-paraíso'
_CACHE = {}


def lounge_pieces(value=''):
    """lounge.pieces() with KONCLUI_VOLUME_PIECES set to `value` (the cache of pieces() is bypassed; each value is built once)."""
    if value not in _CACHE:
        env = {k: v for k, v in os.environ.items() if k != ENV}
        if value:
            env[ENV] = value
        with mock.patch.dict(os.environ, env, clear=True):
            _CACHE[value] = LOUNGE.pieces.__wrapped__()
    return _CACHE[value]


def solid_bottom(rgba):
    """The first row under the solid pixels (alpha 128 or more, the way the baker measures a foot)."""
    return int(np.nonzero((np.asarray(rgba)[..., 3] >= 128).any(1))[0].max()) + 1


class Switch(unittest.TestCase):
    def test_the_default_is_empty(self):
        self.assertEqual(TL.volume_pieces({}), frozenset())
        self.assertEqual(TL.volume_pieces({ENV: ''}), frozenset())
        self.assertEqual(TL.volume_pieces({ENV: ' , '}), frozenset())
        self.assertEqual(LOUNGE.volume_pieces({}), frozenset())

    def test_a_comma_list_of_names_ignores_case_and_spaces(self):
        self.assertEqual(TL.volume_pieces({ENV: 'Air-Hockey, plant-proxy'}), {'air-hockey', 'plant-proxy'})

    def test_all_is_every_name_that_reads_better_lit_and_the_stool_and_the_plants_only_by_name(self):
        self.assertEqual(TL.volume_pieces({ENV: 'all'}), {'air-hockey', 'arc-lamp-proxy'})
        self.assertNotIn('stool', TL.volume_pieces({ENV: 'all'}))
        self.assertNotIn('plant-proxy', TL.volume_pieces({ENV: 'all'}), 'lit, the tall bird of paradise\'s white pot is worse than today\'s')
        self.assertEqual(TL.volume_pieces({ENV: 'all,plant-proxy'}), {'air-hockey', 'arc-lamp-proxy', 'plant-proxy'})
        pieces = set(TL.VOLUME_NAMES) - {TL.VOLUME_CASTERS_ALL}
        self.assertEqual(TL.volume_pieces({ENV: 'all,stool,plant-proxy'}), pieces)

    def test_casters_all_is_a_name_of_its_own_that_no_other_value_implies(self):
        self.assertIn(TL.VOLUME_CASTERS_ALL, TL.VOLUME_NAMES)
        self.assertEqual(TL.volume_pieces({ENV: 'casters-all'}), {'casters-all'})
        self.assertNotIn('casters-all', TL.volume_pieces({ENV: 'all,stool,plant-proxy'}))
        self.assertEqual(TL.volume_pieces({ENV: 'air-hockey, Casters-All'}), {'air-hockey', 'casters-all'})
        # it changes no picture and no declaration: only the manifest's casters
        self.assertEqual(TL.entity_layers(True, frozenset({'casters-all'})), TL.entity_layers(True))
        self.assertEqual(TL.expected_entity_files(True, frozenset({'casters-all'})), TL.expected_entity_files(True))
        self.assertEqual(TL.unpainted_names(frozenset({'casters-all'})), set())

    def test_an_unknown_name_is_an_error_and_never_the_default_build(self):
        with self.assertRaises(ValueError) as caught:
            TL.volume_pieces({ENV: 'air-hockey,airhockey'})
        self.assertIn("'airhockey'", str(caught.exception))

    def test_the_recorded_value_is_in_a_fixed_order(self):
        self.assertEqual(TL.volume_value(frozenset({'plant-proxy', 'air-hockey'})), 'air-hockey,plant-proxy')
        self.assertEqual(TL.volume_value(frozenset()), '')
        everything = TL.volume_pieces({ENV: 'all,stool,plant-proxy,casters-all'})
        self.assertEqual(everything, set(TL.VOLUME_NAMES))
        self.assertEqual(TL.volume_value(everything), 'air-hockey,stool,arc-lamp-proxy,plant-proxy,casters-all')
        self.assertEqual(TL.volume_pieces({ENV: TL.volume_value(everything)}), everything)


class DeclaredLayers(unittest.TestCase):
    """What a volume piece stops carrying: the declared translucent layers, their file counts and the painted list follow the switch."""

    def setUp(self):
        before = TL.configured()                       # these tests set the declarations themselves, whatever the environment says
        TL.configure(frozenset())
        self.addCleanup(TL.configure, before)

    def test_the_default_declarations_are_what_they_were(self):
        self.assertEqual(TL.expected_entity_files(True), {'glass': 77, 'lamp-light-pool': 4, 'baked-shadow': 32})
        self.assertEqual(TL.expected_entity_files(True, frozenset()), TL.expected_entity_files(True))
        self.assertEqual(TL.entity_layers(True, frozenset()), TL.entity_layers(True))

    def test_each_name_takes_its_own_pictures_out_of_the_count(self):
        base = TL.expected_entity_files(True)
        for name, drops in TL.VOLUME_DROPS.items():
            got = TL.expected_entity_files(True, frozenset({name}))
            for layer, files in base.items():
                self.assertEqual(files - got[layer], drops.get(layer, ((), 0))[1], (name, layer))

    def test_all_and_the_names_declared_for_each_layer(self):
        volume = TL.volume_pieces({ENV: 'all'})
        self.assertEqual(TL.expected_entity_files(True, volume), {'glass': 77, 'lamp-light-pool': 3, 'baked-shadow': 31})
        layers = TL.entity_layers(True, volume)
        self.assertNotIn('Mesa de air hockey', layers['baked-shadow'][1])               # baked: new art, no longer declared
        self.assertIn('Ave-do-paraíso grande', layers['baked-shadow'][1])              # not in "all": still today's picture
        kept = TL.volume_pieces({ENV: 'all,plant-proxy'})
        self.assertEqual(TL.expected_entity_files(True, kept)['baked-shadow'], 29)
        self.assertIn('Ave-do-paraíso grande', TL.entity_layers(True, kept)['baked-shadow'][1])   # kept art: keeps its standing (palette)
        self.assertIn('Luminária de arco com cúpula', layers['lamp-light-pool'][1])
        self.assertIn('Banqueta de bar turquesa', layers['baked-shadow'][1])        # the stool is not in "all"

    def test_with_the_painted_rows_off_a_dropped_picture_is_not_subtracted_twice(self):
        volume = TL.volume_pieces({ENV: 'all,stool,plant-proxy'})
        self.assertEqual(TL.expected_entity_files(False, volume)['baked-shadow'], 19)
        self.assertEqual(TL.expected_entity_files(False)['baked-shadow'], 19)

    def test_configure_points_the_declarations_at_a_build_and_puts_the_process_back(self):
        default = (TL.ENTITY_LAYERS, TL.EXPECTED_ENTITY_FILES, TL.configured())
        TL.configure(frozenset({'air-hockey'}))
        self.assertEqual(TL.EXPECTED_ENTITY_FILES['baked-shadow'], 31)
        self.assertIsNone(TL.layer_of('Mesa de air hockey'))
        self.assertEqual(TL.layer_of('Mesinha redonda de nogueira com caneca'), 'baked-shadow')
        TL.configure(default[2])
        self.assertEqual((TL.ENTITY_LAYERS, TL.EXPECTED_ENTITY_FILES, TL.configured()), default)
        self.assertEqual(TL.layer_of('Mesa de air hockey'), 'baked-shadow')

    def test_a_name_whose_picture_paints_no_shadow_any_more_is_not_listed_painted_baked_or_kept(self):
        for name, prefab in (('air-hockey', 'Mesa de air hockey'), ('plant-proxy', 'Ave-do-paraíso grande'), ('stool', 'Banqueta de bar turquesa')):
            tmp = tempfile.TemporaryDirectory()
            self.addCleanup(tmp.cleanup)
            dist = make_named_dist(Path(tmp.name), [('piece', prefab, [], TK.block(20, 12, (30, 60, 90)), (10, 10))])
            kinds = FX.kinds(dist)
            self.assertEqual(FX.painted(dist, kinds), ['col/piece.png'], name)
            TL.configure(frozenset({name}))
            self.assertEqual(FX.painted(dist, kinds), [], name)
            TL.configure(frozenset())

    def test_a_dropped_name_is_no_longer_listed_painted(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        dist = make_named_dist(Path(tmp.name), [('hockey', 'Mesa de air hockey', [], TK.block(20, 12, (30, 60, 90)), (10, 10))])
        kinds = FX.kinds(dist)
        self.assertEqual(FX.painted(dist, kinds), ['col/hockey.png'])                    # declared: its shadow is painted in
        TL.configure(frozenset({'air-hockey'}))
        self.assertEqual(FX.painted(dist, kinds), [])


def make_named_dist(root, prefabs, map_size=(256, 128)):
    """A map with `prefabs` [(id, name, tags, picture, (x, y))] in one collection 'col', its wam and a manifest with kinds."""
    dist = Path(root) / 'dist'
    entries = []
    for pid, name, tags, pixels, _ in prefabs:
        TK.png(dist / 'entities' / 'col' / f'{pid}.png', pixels)
        entries.append({'id': pid, 'name': name, 'tags': tags, 'imagePath': f'{pid}.png', 'depthOffset': 0})
    (dist / 'entities' / 'col' / 'collection.json').write_text(json.dumps({'collectionName': 'col', 'collection': entries}))
    (dist / 'seats').mkdir()
    (dist / 'tilesets').mkdir()
    (dist / 'office.tmj').write_text('{}')
    (dist / 'office.wam').write_text(json.dumps({'entities': {
        f'e-{pid}': {'x': x, 'y': y, 'prefabRef': {'collectionName': 'col', 'id': pid}} for pid, _, _, _, (x, y) in prefabs}}))
    (dist / 'fx').mkdir()
    (dist / 'fx' / 'manifest.json').write_text(json.dumps({'map': list(map_size), 'normal': True, 'shadows': {}}))
    manifest = json.loads((dist / 'fx' / 'manifest.json').read_text())
    manifest['kinds'] = FX.KINDS.kinds_of(dist)
    manifest['painted'] = []
    (dist / 'fx' / 'manifest.json').write_text(json.dumps(manifest))
    return dist


class DefaultIsToday(unittest.TestCase):
    def test_with_the_switch_empty_no_piece_carries_a_volume_record_or_a_shift(self):
        for group, variants in lounge_pieces('').items():
            for variant, entry in variants.items():
                self.assertNotIn('volume', entry, (group, variant))
                self.assertNotIn('shift', entry, (group, variant))

    def test_the_four_pieces_are_the_drawn_ones(self):
        pieces = lounge_pieces('')
        self.assertEqual(pieces[AIR]['navy']['image'].size, (64, 64))
        self.assertEqual(pieces[STOOL]['turquesa']['image'].size, (32, 64))
        self.assertEqual(pieces[LAMP]['preto']['image'].size, (110, 96))
        self.assertEqual(pieces[PLANT]['alta']['image'].size, (64, 96))


class AirHockey(unittest.TestCase):
    def setUp(self):
        self.old = lounge_pieces('')[AIR]['navy']
        self.new = lounge_pieces('air-hockey')[AIR]['navy']

    def test_the_picture_is_baked_and_binary_and_the_neighbours_are_untouched(self):
        px = np.asarray(self.new['image'])
        self.assertTrue(np.isin(px[..., 3], (0, 255)).all(), 'the baked picture has no partial alpha: no painted shadow')
        self.assertNotEqual(np.asarray(self.old['image']).tobytes(), px.tobytes())
        for variant in ('Koncluí: mesa com lig 4', 'Koncluí: pebolim'):
            only = lounge_pieces('air-hockey')[variant]
            for v, entry in only.items():
                self.assertEqual(np.asarray(entry['image']).tobytes(), np.asarray(lounge_pieces('')[variant][v]['image']).tobytes())

    def test_it_moves_by_whole_tiles_and_ends_on_its_foot(self):
        self.assertEqual((self.new['shift'][0] % 32, self.new['shift'][1] % 32), (0, 0),
                         'a colliding piece must sit on the 32 px grid (build.collision_of asserts it)')
        px = np.asarray(self.new['image'])
        self.assertFalse((px[-2:, :, 3] == 0).all(), 'the last row is the foot: no empty rows under the legs (the contract\'s foot gap)')
        self.assertTrue((px[..., 3] > 0).any(0)[-1] or (px[..., 3] > 0).any(0)[-2], 'the canvas ends at the picture on the right')

    def test_the_foot_stays_on_the_row_it_was(self):
        left, top = self.new['shift']
        old_foot = solid_bottom(self.old['image'])
        # the ground contact's front edge is on today's foot row; the legs end at most one row above it (the baker's foot gap)
        self.assertEqual(top + self.new['volume']['caster']['foot'] + 1, old_foot)
        self.assertIn(old_foot - (top + solid_bottom(self.new['image'])), (0, 1))

    def test_the_sort_line_stays_where_it_was(self):
        left, top = self.new['shift']
        sort = lambda entry, dy: dy + entry['image'].height + entry['depthOffset']
        self.assertEqual(sort(self.new, top), sort(self.old, 0))

    def test_the_collision_stays_on_the_same_map_tiles(self):
        left, top = self.new['shift']
        cells = lambda grid, dx, dy: {(dx + c, dy + r) for r, row in enumerate(grid) for c, v in enumerate(row) if v}
        self.assertEqual(cells(self.new['collisionGrid'], left // 32, top // 32), cells(self.old['collisionGrid'], 0, 0))
        w, h = self.new['image'].size
        self.assertEqual((len(self.new['collisionGrid'][0]), len(self.new['collisionGrid'])), (-(-w // 32), -(-h // 32)))

    def test_the_record_has_a_normal_image_of_the_picture_s_size_and_a_caster(self):
        record = self.new['volume']
        self.assertEqual(record['kind'], 'volume')
        self.assertEqual(record['normal'].shape, np.asarray(self.new['image']).shape)
        opaque = np.asarray(self.new['image'])[..., 3] == 255
        self.assertTrue((record['normal'][..., 3][opaque] == 255).all())
        caster = record['caster']
        self.assertGreaterEqual(caster['h'], 16)                      # a 0.8 m table at 21 px per metre
        self.assertLessEqual(caster['h'], 20)
        x0, y0, x1, y1 = record['footprint']
        self.assertEqual((caster['foot'], caster['span']), (y1 - 1, [x0, x1 - 1]))
        self.assertLess(caster['foot'], self.new['image'].height)


class Stool(unittest.TestCase):
    def setUp(self):
        self.old = lounge_pieces('')[STOOL]['turquesa']
        self.new = lounge_pieces('stool')[STOOL]['turquesa']

    def test_all_leaves_the_stool_on_the_drawing(self):
        self.assertEqual(np.asarray(lounge_pieces('all')[STOOL]['turquesa']['image']).tobytes(), np.asarray(self.old['image']).tobytes())
        self.assertNotIn('volume', lounge_pieces('all')[STOOL]['turquesa'])

    def test_it_is_a_seat_with_the_numbers_the_recipe_gives(self):
        seat = self.new['seat']
        self.assertEqual(seat['direction'], 'up')
        self.assertEqual(seat['anchorOffset'], dict(x=10, y=16))
        self.assertNotIn('shift', self.new, 'a seat is placed by its anchor, not by the plan px')

    def test_the_seating_rule_gives_the_depth_offset_the_recipe_records(self):
        # build.py: depthOffset = anchorOffset.y - 1 - image height, for every seat
        self.assertEqual(self.new['seat']['anchorOffset']['y'] - 1 - self.new['image'].height, -15)

    def test_the_feet_land_where_todays_feet_land_relative_to_the_sitter(self):
        rel = lambda entry: solid_bottom(entry['image']) - entry['seat']['anchorOffset']['y']
        self.assertEqual(rel(self.new), rel(self.old))

    def test_the_picture_paints_no_shadow_of_its_own(self):
        self.assertTrue(np.isin(np.asarray(self.new['image'])[..., 3], (0, 255)).all())


class TouchUps(unittest.TestCase):
    def setUp(self):
        self.base = lounge_pieces('')
        self.lamp = lounge_pieces('arc-lamp-proxy')[LAMP]['preto']
        self.plants = lounge_pieces('plant-proxy')[PLANT]

    def test_the_lamp_loses_its_pool_and_its_shadow_and_keeps_every_solid_pixel(self):
        old, new = np.asarray(self.base[LAMP]['preto']['image']), np.asarray(self.lamp['image'])
        self.assertTrue(((old[..., 3] > 0) & (old[..., 3] < 255)).any(), 'today\'s lamp paints a pool and a shadow')
        self.assertFalse(((new[..., 3] > 0) & (new[..., 3] < 255)).any())
        self.assertEqual(new[old[..., 3] == 255].tobytes(), old[old[..., 3] == 255].tobytes())
        self.assertEqual((new[..., 3] == 255).sum(), (old[..., 3] == 255).sum())

    def test_the_lamp_moves_nowhere(self):
        self.assertNotIn('shift', self.lamp)
        self.assertEqual(self.lamp['image'].size, (110, 96))
        self.assertEqual(self.lamp['depthOffset'], self.base[LAMP]['preto']['depthOffset'])

    def test_the_proxy_anchors_are_within_two_px_of_the_pixel_heuristic_on_todays_lamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'lamp.png'
            self.base[LAMP]['preto']['image'].save(path)
            heuristic = FX.sprite_light(path, 'pendant')
        anchors = self.lamp['volume']['anchors']
        self.assertEqual(heuristic['kind'], 'arc')
        for got, want in ((anchors['light_head'], heuristic['head']), (anchors['foot'], heuristic['foot'])):
            self.assertLessEqual(abs(got[0] - want[0]), 2.0, (got, want))
            self.assertLessEqual(abs(got[1] - want[1]), 2.0, (got, want))

    def test_the_heuristic_finds_the_same_light_on_the_touched_up_lamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            old, new = Path(tmp) / 'old.png', Path(tmp) / 'new.png'
            self.base[LAMP]['preto']['image'].save(old)
            self.lamp['image'].save(new)
            self.assertEqual(FX.sprite_light(old, 'pendant'), FX.sprite_light(new, 'pendant'))

    def test_the_bulb_rect_the_runtime_paints_at_the_proxy_head_lies_on_the_drawn_glow(self):
        from props import touchup
        a = np.asarray(self.lamp['image'])
        glow = touchup.glow_mask(a)
        hx, hy = self.lamp['volume']['anchors']['light_head']
        x0, y0 = int(hx - 4), int(hy + 3)                  # lights.ts: the bulb is [hx - 4, hy + 3, 8, 2]
        self.assertEqual(int(glow[y0:y0 + 2, x0:x0 + 8].sum()), 16)

    def test_each_bird_of_paradise_loses_its_shadow_and_is_not_clipped_by_its_canvas(self):
        for colour, entry in self.plants.items():
            px = np.asarray(entry['image'])
            self.assertFalse(((px[..., 3] > 0) & (px[..., 3] < 255)).any(), colour)
            solid = px[..., 3] == 255
            rows, cols = np.nonzero(solid.any(1))[0], np.nonzero(solid.any(0))[0]
            self.assertGreaterEqual(rows[0], 2, colour)
            self.assertGreaterEqual(cols[0], 2, colour)
            self.assertGreaterEqual(px.shape[1] - 1 - cols[-1], 2, colour)

    def test_a_canvas_that_grew_keeps_the_sort_line_and_the_foot(self):
        old = self.base[PLANT]['alta']
        new = self.plants['alta']
        dx, dy = new['shift']
        self.assertEqual((new['image'].width - old['image'].width, new['image'].height - old['image'].height), (9, 8))
        sort = lambda entry, y: y + entry['image'].height + entry['depthOffset']
        self.assertEqual(sort(new, dy), sort(old, 0))
        self.assertEqual(dy + solid_bottom(new['image']), solid_bottom(old['image']))

    def test_the_plant_that_needed_no_room_does_not_move(self):
        self.assertNotIn('shift', self.plants['branco'])
        self.assertEqual(self.plants['branco']['depthOffset'], self.base[PLANT]['branco']['depthOffset'])

    def test_the_normals_and_casters_come_from_the_proxy_over_the_picture_that_is_written(self):
        for entry in (self.lamp, *self.plants.values()):
            record = entry['volume']
            self.assertEqual(record['kind'], 'proxy')
            self.assertEqual(record['normal'].shape, np.asarray(entry['image']).shape)
            self.assertGreater(record['caster']['h'], 40)
            self.assertLess(record['caster']['foot'], entry['image'].height)

    def test_a_switch_name_touches_only_its_own_pieces(self):
        only_lamp = lounge_pieces('arc-lamp-proxy')
        self.assertNotIn('volume', only_lamp[PLANT]['alta'])
        self.assertEqual(np.asarray(only_lamp[PLANT]['alta']['image']).tobytes(), np.asarray(self.base[PLANT]['alta']['image']).tobytes())
        only_plant = lounge_pieces('plant-proxy')
        self.assertNotIn('volume', only_plant[LAMP]['preto'])


class Casters(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='test-volume-')
        self.addCleanup(tmp.cleanup)
        self.dist = TK.make_dist(Path(tmp.name))
        self.kinds = FX.kinds(self.dist)

    def test_by_default_only_the_pieces_with_a_record_have_a_caster(self):
        """One switch name changes the shadow of its own piece and of no other: a stand sprite with no record has no caster."""
        self.assertEqual(FX.casters(self.dist, self.kinds), {})
        record = {'col/chair.png': {'caster': dict(h=9, foot=14, span=[2, 5])}}
        self.assertEqual(set(FX.casters(self.dist, self.kinds, record)), {'col/chair.png'})
        self.assertEqual(set(self.kinds.values()), {'stand', 'hang', 'top', 'floor'})

    def test_a_record_for_a_piece_that_is_not_a_stand_sprite_gives_no_caster(self):
        other = next(k for k, v in self.kinds.items() if v != 'stand')
        record = {other: {'caster': dict(h=9, foot=14, span=[2, 5])}}
        self.assertEqual(FX.casters(self.dist, self.kinds, record), {})

    def test_with_the_legacy_flag_every_stand_sprite_has_one_and_nothing_else_does(self):
        self.assertEqual(set(FX.casters(self.dist, self.kinds, legacy=True)), {k for k, v in self.kinds.items() if v == 'stand'})

    def test_the_legacy_flag_keeps_a_record_over_the_generic_rule_and_adds_the_others(self):
        record = {'col/chair.png': {'caster': dict(h=9, foot=14, span=[2, 5])}}
        got = FX.casters(self.dist, self.kinds, record, legacy=True)
        self.assertEqual(got['col/chair.png'], dict(h=9, foot=14, span=[2, 6]))
        self.assertEqual(set(got), {k for k, v in self.kinds.items() if v == 'stand'})

    def test_a_piece_with_no_record_takes_the_generic_rule_and_its_own_feet_with_the_legacy_flag(self):
        got = FX.casters(self.dist, self.kinds, legacy=True)['col/chair.png']      # a 12 x 16 block with a 1 px margin: the picture is the chair
        self.assertEqual(got, dict(h=16, foot=15, span=[0, 12]))

    def test_a_record_wins_over_the_picture(self):
        record = {'col/chair.png': {'caster': dict(h=9, foot=14, span=[2, 5])}}
        self.assertEqual(FX.casters(self.dist, self.kinds, record)['col/chair.png'], dict(h=9, foot=14, span=[2, 6]),
                         'a record\'s span is inclusive (proxy foot_span), the manifest\'s is [x0, x1)')

    def test_the_curated_height_of_contract_pieces_json_wins_over_the_rows(self):
        from unittest import mock as m
        with m.patch.object(__import__('contract'), 'load_json', return_value={'casters': {'col/chair.png': {'h': 11}}}):
            self.assertEqual(FX.casters(self.dist, self.kinds, legacy=True)['col/chair.png']['h'], 11)
            self.assertNotIn('col/chair.png', FX.casters(self.dist, self.kinds))     # and without the flag it has none at all

    def test_feet_are_the_last_solid_rows_and_their_columns(self):
        px = np.zeros((12, 10, 4), np.uint8)
        px[2:10, 1:9] = (9, 9, 9, 255)
        px[8:10, 3:5] = 0                                              # a gap between the legs in the last two rows
        px[10:12, :, :] = (0, 0, 0, 80)                                # a painted shadow under it: not solid
        px[9, 1:3] = (9, 9, 9, 255)
        px[9, 6:9] = (9, 9, 9, 255)
        self.assertEqual(FX.feet_of(px), (9, [1, 8]))
        self.assertIsNone(FX.feet_of(np.zeros((4, 4, 4), np.uint8)))


class Anchors(unittest.TestCase):
    def test_a_lamp_with_named_anchors_takes_them_and_one_without_keeps_the_heuristic(self):
        lamp = lounge_pieces('')[LAMP]['preto']['image']
        with tempfile.TemporaryDirectory() as tmp:
            dist = make_named_dist(Path(tmp), [('lamp', 'Luminária de arco com cúpula', [], np.asarray(lamp), (0, 0))])
            plain = FX.lights(dist)['col/lamp.png']
            self.assertEqual(FX.lights(dist, None), FX.lights(dist, {}))
            named = FX.lights(dist, {'col/lamp.png': {'light_head': [42.0, 27.0], 'foot': [69.5, 71.0]}})['col/lamp.png']
            self.assertEqual((named['head'], named['foot']), ([42.0, 27.0], [69.5, 71.0]))
            self.assertEqual({k: v for k, v in named.items() if k not in ('head', 'foot')},
                             {k: v for k, v in plain.items() if k not in ('head', 'foot')})
            half = FX.lights(dist, {'col/lamp.png': {'light_head': [1.0, 1.0]}})['col/lamp.png']
            self.assertEqual(half, plain, 'a half-named lamp keeps the heuristic')

    def test_anchors_more_than_two_px_from_the_heuristic_are_ignored_on_either_axis_and_for_head_or_foot(self):
        lamp = lounge_pieces('')[LAMP]['preto']['image']
        with tempfile.TemporaryDirectory() as tmp:
            dist = make_named_dist(Path(tmp), [('lamp', 'Luminária de arco com cúpula', [], np.asarray(lamp), (0, 0))])
            plain = FX.lights(dist)['col/lamp.png']
            (hx, hy), (fx_, fy) = plain['head'], plain['foot']
            self.assertEqual(FX.ANCHOR_TOLERANCE, 2.0)
            near = {'light_head': [hx + 2.0, hy - 2.0], 'foot': [fx_ - 2.0, fy + 2.0]}
            self.assertEqual(FX.lights(dist, {'col/lamp.png': near})['col/lamp.png']['head'], near['light_head'], 'exactly 2 px is within')
            for name, named in (('head x', dict(near, light_head=[hx + 2.01, hy])), ('head y', dict(near, light_head=[hx, hy + 6.0])),
                                ('foot x', dict(near, foot=[fx_ + 3.0, fy])), ('foot y', dict(near, foot=[fx_, fy - 2.5]))):
                self.assertEqual(FX.lights(dist, {'col/lamp.png': named})['col/lamp.png'], plain, name)


MOBILIA = ('arc_lamp.mobilia_right', 'arc_lamp.mobilia_left')
KONCLUI_LAMP_KEY = 'konclui/sprites/konclui-konclui-lumin-ria-de-arco-preto.png'


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST is unset')
class LampLights(unittest.TestCase):
    """The three placed arc lamps (the Koncluí one and the two Mobilia ones) lit from the real build's pictures: the light a lamp gets
    with its proxy volume's anchors is where the pixels put it (within 2 px), and the bulb the runtime paints there lies on the lamp."""

    @classmethod
    def setUpClass(cls):
        cls.dist = Path(os.environ['KONCLUI_DIST'])
        proxies = LOUNGE._kit()[2]
        cls.keys = {'arc_lamp.konclui': KONCLUI_LAMP_KEY, **{name: proxies.get(name).keys[0] for name in MOBILIA}}
        cls.records, cls.pictures = {}, {}
        for name, key in cls.keys.items():
            if not (cls.dist / 'entities' / key).exists():
                raise unittest.SkipTest(f'KONCLUI_DIST lacks {key}')
            picture, shift, record = LOUNGE.touch_up(name, Image.open(cls.dist / 'entities' / key).convert('RGBA'))
            cls.records[key], cls.pictures[name] = record, np.asarray(picture)
        cls.heuristic = FX.lights(cls.dist)
        cls.merged = FX.lights(cls.dist, {k: r['anchors'] for k, r in cls.records.items()})

    def test_old_and_new_head_and_foot_are_within_two_px_for_all_three_lamps(self):
        for name, key in self.keys.items():
            old, new = self.heuristic[key], self.merged[key]
            for part in ('head', 'foot'):
                for axis in (0, 1):
                    self.assertLessEqual(abs(new[part][axis] - old[part][axis]), 2.0, (name, part, old[part], new[part]))

    def test_the_proxy_head_of_the_mobilia_lamps_is_six_px_off_so_the_heuristic_is_kept(self):
        for name in MOBILIA:
            key = self.keys[name]
            named = self.records[key]['anchors']['light_head']
            self.assertGreater(abs(named[1] - self.heuristic[key]['head'][1]), 5.0, 'the recipe still disagrees: the guard is what protects the lamp')
            self.assertEqual(self.merged[key]['head'], self.heuristic[key]['head'], name)

    def test_the_koncluí_lamp_takes_the_proxy_anchors(self):
        self.assertEqual(self.merged[KONCLUI_LAMP_KEY]['head'], self.records[KONCLUI_LAMP_KEY]['anchors']['light_head'])

    def test_the_bulb_rect_lies_on_the_lamp_for_all_three(self):
        for name, key in self.keys.items():
            hx, hy = self.merged[key]['head']
            x0, y0 = int(hx - 4), int(hy + 3)                  # lights.ts: the bulb is [hx - 4, hy + 3, 8, 2]
            alpha = self.pictures[name][y0:y0 + 2, x0:x0 + 8, 3]
            self.assertEqual(alpha.shape, (2, 8), name)
            self.assertEqual(int((alpha == 255).sum()), 16, f'{name}: the glow lands in the air at {(x0, y0)}')


class Shadows(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='test-volume-')
        self.addCleanup(tmp.cleanup)
        self.dist = make_named_dist(Path(tmp.name), [
            ('hockey', 'Mesa de air hockey', [], TK.block(40, 30, (30, 60, 90)), (10, 10)),
            ('plant', 'Ave-do-paraíso grande', [], TK.block(20, 40, (30, 90, 60)), (80, 10)),
            ('stool', 'Banqueta de bar turquesa', [], TK.block(10, 30, (30, 90, 90)), (120, 10))])

    def test_a_piece_that_paints_its_own_shadow_has_no_runtime_footprint(self):
        self.assertEqual(FX.shadows(self.dist), {'col/hockey.png': None, 'col/plant.png': None, 'col/stool.png': None})

    def test_with_its_switch_name_the_picture_paints_none_and_the_runtime_draws_one(self):
        for name, key in (('air-hockey', 'hockey'), ('plant-proxy', 'plant'), ('stool', 'stool')):
            got = FX.shadows(self.dist, {'switch': frozenset({name})})
            self.assertIsNotNone(got[f'col/{key}.png'], name)
            self.assertEqual(sum(v is not None for v in got.values()), 1, 'only the named piece leaves FLAT')

    def test_a_record_s_footprint_is_the_one_written(self):
        volume = {'switch': frozenset({'air-hockey'}), 'records': {'col/hockey.png': {'footprint': [2, 14, 38, 30]}}}
        self.assertEqual(FX.shadows(self.dist, volume)['col/hockey.png'], [2, 14, 38, 30])


class NormalsFromAVolume(unittest.TestCase):
    def test_volume_map_is_masked_to_the_fully_opaque_pixels_and_keeps_unit_length(self):
        rgba = np.zeros((6, 6, 4), np.uint8)
        rgba[1:5, 1:5] = (10, 20, 30, 255)
        rgba[5, 1:5] = (0, 0, 0, 90)                                   # a painted shadow row: no normal
        normal = np.zeros((6, 6, 4), np.uint8)
        normal[..., :3] = (128, 128, 255)
        normal[1:6, 1:5] = (40, 128, 220, 255)
        normal[2, 2] = (128, 128, 255, 0)                              # a solid pixel the volume left without a normal
        normal[3, 3] = (90, 128, 230, 200)                             # a solid pixel whose normal has a partial alpha
        got = N.volume_map(rgba, normal)
        self.assertEqual(got[..., 3][1:5, 1:5].tolist(), np.full((4, 4), 255).tolist())
        self.assertEqual(got[5, 1:5].tolist(), [list(N.FLAT)] * 4)
        self.assertEqual(got[2, 2].tolist(), [128, 128, 255, 255])
        self.assertEqual(got[3, 3].tolist(), [90, 128, 230, 255], 'alpha is the picture\'s: 255 on a fully opaque pixel')
        self.assertEqual(got[1, 1].tolist(), [40, 128, 220, 255])
        self.assertEqual(got[0, 0].tolist(), list(N.FLAT))

    def test_a_volume_of_another_size_is_an_error(self):
        with self.assertRaises(ValueError):
            N.volume_map(np.zeros((6, 6, 4), np.uint8), np.zeros((6, 7, 4), np.uint8))

    def test_compose_stamps_the_volume_normals_and_never_runs_the_tool_on_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = TK.make_dist(Path(tmp))
            chair = dist / 'entities' / 'col' / 'chair.png'
            h, w = np.asarray(Image.open(chair)).shape[:2]
            volume = np.zeros((h, w, 4), np.uint8)
            volume[..., :3] = (60, 128, 240)
            volume[..., 3] = 255
            with mock.patch.object(N, 'tool_normals', side_effect=lambda sprites, *a, **k: {p: N.legacy_normal(N.geometry(N.PG.load_rgba(p)))
                                                                                          for p in sprites}) as tool:
                image, method = N.compose(dist, 'tool', N.DOMED, {chair: volume})
            self.assertNotIn(str(chair), set().union(*[set(c.args[0]) for c in tool.call_args_list]))
            canvas = np.asarray(image)
            x, y = 20, 14                                              # the chair's placement in the small map
            self.assertEqual(canvas[y + 5, x + 5].tolist(), [60, 128, 240, 255])
            self.assertEqual(method, 'tool')

    def test_without_a_volume_compose_is_what_it_was(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = TK.make_dist(Path(tmp))
            a, _ = N.compose(dist, 'legacy')
            b, _ = N.compose(dist, 'legacy', N.DOMED, None)
            c, _ = N.compose(dist, 'legacy', N.DOMED, {})
            self.assertEqual(a.tobytes(), b.tobytes())
            self.assertEqual(a.tobytes(), c.tobytes())


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST is unset')
class BuiltVolume(unittest.TestCase):
    """The real build's manifest and pictures: a default build has none of the new keys; a build made with the switch has them all."""

    def setUp(self):
        self.dist = Path(os.environ['KONCLUI_DIST'])
        self.manifest = json.loads((self.dist / 'fx' / 'manifest.json').read_text())

    def test_the_manifest_keys_exist_exactly_when_the_switch_was_set(self):
        keys = {'volume', 'volumePieces', 'casters'}
        if 'volume' not in self.manifest:
            self.assertFalse(keys & set(self.manifest), 'a default build adds no key to the manifest')
            return
        self.assertTrue(keys <= set(self.manifest))
        self.assertEqual(self.manifest['version'], 1)
        stand = {k for k, v in self.manifest['kinds'].items() if v == 'stand'}
        if TL.VOLUME_CASTERS_ALL in self.manifest['volume'].split(','):
            self.assertEqual(set(self.manifest['casters']), stand)                          # "casters-all": every placed stand sprite
        else:
            self.assertEqual(set(self.manifest['casters']), stand & set(self.manifest['volumePieces']))   # else the pieces the switch names only
        self.assertTrue(set(self.manifest['volumePieces']) <= set(self.manifest['kinds']))
        self.assertTrue(set(self.manifest['volumePieces'].values()) <= {'volume', 'proxy'})
        self.assertEqual(TL.volume_value(TL.volume_pieces({ENV: self.manifest['volume']})), self.manifest['volume'])

    def test_a_volume_piece_is_where_the_plan_put_it(self):
        if 'air-hockey' not in self.manifest.get('volume', ''):
            self.skipTest('the build was not made with air-hockey')
        key = 'konclui/sprites/konclui-konclui-air-hockey-navy.png'
        self.assertEqual(self.manifest['volumePieces'][key], 'volume')
        wam = json.loads((self.dist / 'office.wam').read_text())
        entity = next(e for e in wam['entities'].values() if e['prefabRef']['id'] == 'konclui-konclui-air-hockey-navy')
        self.assertEqual((entity['x'] % 32, entity['y'] % 32), (0, 0))
        picture = Image.open(self.dist / 'entities' / key)
        foot = self.manifest['casters'][key]['foot']
        self.assertEqual(entity['y'] + foot + 1, 37 * 32 + 59, 'the ground contact ends on the foot row of the drawn table')
        self.assertIn(37 * 32 + 59 - (entity['y'] + solid_bottom(picture)), (0, 1), 'the legs end at most one row above it')

    def test_the_lamp_light_comes_from_the_proxy_when_the_switch_names_it(self):
        if 'arc-lamp-proxy' not in self.manifest.get('volume', ''):
            self.skipTest('the build was not made with arc-lamp-proxy')
        key = 'konclui/sprites/konclui-konclui-lumin-ria-de-arco-preto.png'
        self.assertEqual(self.manifest['lights'][key]['head'], [42.0, 27.0])

    def test_no_lamp_light_of_the_build_is_more_than_two_px_from_the_pixel_heuristic(self):
        if 'arc-lamp-proxy' not in self.manifest.get('volume', ''):
            self.skipTest('the build was not made with arc-lamp-proxy')
        heuristic = FX.lights(self.dist)
        self.assertEqual(set(heuristic), set(self.manifest['lights']))
        for key, spec in self.manifest['lights'].items():
            if 'head' in spec:
                self.assertTrue(FX.anchors_agree(heuristic[key], dict(light_head=spec['head'], foot=spec['foot'])), key)


if __name__ == '__main__':
    if not os.environ.get('KONCLUI_DIST'):
        print('note: KONCLUI_DIST is unset, so BuiltVolume is SKIPPED')
    unittest.main()
