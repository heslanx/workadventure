"""Behaviour tests of the pixel contract, the alpha repair, the declared translucent layers and the normals pipeline.
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_pixelgrid.py
(`-m unittest tools/test_pixelgrid.py` also works without -I; with -I only the script form does: -I drops the cwd.)
The tests that need spritefusion-pixel-snapper or spritefusion-sprite-normals are skipped without the binary."""
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
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
import normals as N  # noqa: E402
import toolchain  # noqa: E402
import pixelgrid as PG  # noqa: E402
import translucent as TL  # noqa: E402


def load_module(name, path):
    """Three wrappers are called sheetcheck.py (hq-office, pets/tools, avatars): load each under its own name."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


OFFICE_CHECK = load_module('office_sheetcheck', SOURCE / 'hq-office' / 'sheetcheck.py')
PETS_CHECK = load_module('pets_sheetcheck', SOURCE / 'pets' / 'tools' / 'sheetcheck.py')
AVATAR_CHECK = load_module('avatar_sheetcheck', SOURCE / 'avatars' / 'sheetcheck.py')


def sheet(w=64, h=32, fill=None):
    px = np.zeros((h, w, 4), np.uint8)
    px[4:12, 4:12] = (10, 20, 30, 255)
    if fill:
        fill(px)
    return px


class Check(unittest.TestCase):
    def test_clean_native_sheet_passes(self):
        self.assertEqual(PG.problems(sheet(), palette={(10, 20, 30)}), [])

    def test_partial_alpha_names_its_cell_and_pixel(self):
        def bleed(px):
            px[5, 40] = (10, 20, 30, 128)
        self.assertIn('cell (1,0) pixel (40,5)', PG.problems(sheet(fill=bleed))[0])

    def test_size_off_the_grid_and_foreign_colour_fail(self):
        self.assertTrue(any('not a multiple of 32' in p for p in PG.problems(sheet(w=50))))

        def foreign(px):
            px[20, 33] = (1, 2, 3, 255)
        self.assertIn('outside the palette', PG.problems(sheet(fill=foreign), palette={(10, 20, 30)})[0])

    def test_snap_leaves_a_passing_sheet_alone_and_refuses_in_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / 'a.png'
            Image.fromarray(sheet(), 'RGBA').save(src)
            out = io.StringIO()
            self.assertEqual(PG.snap(src, Path(tmp) / 'b.png', {(10, 20, 30)}, out=out), 0)
            self.assertFalse((Path(tmp) / 'b.png').exists())
            with self.assertRaises(SystemExit):
                PG.snap(src, src)

    def test_snap_rejects_a_result_that_still_fails_the_check(self):
        # The fixed snapper keeps a picture at --pixel-size 1 (the stock one cropped a 32x32 cell to 25x25), so the re-check that
        # fails it is the partial alpha the snapper does not repair.
        toolchain.require('pixel-snapper')
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / 'a.png'
            Image.fromarray(sheet(32, 32, lambda px: px.__setitem__((6, 6), (10, 20, 30, 90))), 'RGBA').save(src)
            out = io.StringIO()
            self.assertEqual(PG.snap(src, Path(tmp) / 'b.png', {(10, 20, 30)}, pixel_size=1, out=out), 1)
            self.assertIn('partial alpha', out.getvalue())
            self.assertFalse((Path(tmp) / 'b.png').exists())


def ramp(w, h, axis):
    """An opaque w x h sprite whose luminance rises along `axis` (1 = left to right, 0 = top to bottom)."""
    px = np.zeros((h, w, 4), np.uint8)
    line = np.linspace(40, 215, w if axis else h).astype(np.uint8)
    px[..., :3] = (line[None, :, None] if axis else line[:, None, None])
    px[..., 3] = 255
    return px


def make_dist(root, sprites, entities, size, offsets=None):
    """A built-map fixture: sprites {name: RGBA}, entities [(name, x, y)] (dict order = file order), map size, and the
    prefabs' `depthOffset` {name: int} (collection.json writes none for a prefab without one)."""
    root = Path(root)
    (root / 'fx').mkdir(parents=True)
    (root / 'entities' / 'col' / 'sprites').mkdir(parents=True)
    (root / 'fx' / 'manifest.json').write_text(json.dumps({'map': list(size)}))
    items = []
    for name, px in sprites.items():
        Image.fromarray(px, 'RGBA').save(root / 'entities' / 'col' / 'sprites' / f'{name}.png')
        items.append({'id': name, 'imagePath': f'sprites/{name}.png',
                      **({'depthOffset': offsets[name]} if name in (offsets or {}) else {})})
    (root / 'entities' / 'col' / 'collection.json').write_text(json.dumps({'collectionName': 'col', 'collection': items}))
    wam = {'entities': {f'e{i}': {'x': x, 'y': y, 'prefabRef': {'collectionName': 'col', 'id': name}}
                        for i, (name, x, y) in enumerate(entities)}}
    (root / 'office.wam').write_text(json.dumps(wam))


class Partial(unittest.TestCase):
    def with_alpha(self, values):
        def put(px):
            for i, v in enumerate(values):
                px[20, i] = (10, 20, 30, v)
        return sheet(fill=put)

    def test_every_partial_alpha_fails_the_strict_rule_from_1_to_254(self):
        for value in (1, 127, 128, 254):                       # 254 and 1 are the boundaries of "partial"
            self.assertTrue(PG.problems(self.with_alpha([value])), value)
        self.assertEqual(PG.problems(self.with_alpha([0, 255])), [])

    def test_the_failure_counts_the_pixels_and_the_edge_ones(self):
        def edge(px):
            px[10, 40] = (10, 20, 30, 255)                    # opaque above, clear below: this one is an edge
            px[11, 40] = (10, 20, 30, 128)
            px[20, 50] = (10, 20, 30, 128)                    # alone in the clear: not an edge
        found = PG.problems(sheet(fill=edge))[0]
        self.assertIn('2 px with partial alpha (1 levels, 1 on a silhouette edge)', found)

    def test_a_declared_layer_may_carry_partial_alpha_but_only_its_levels(self):
        px = self.with_alpha([128, 30])
        self.assertEqual(PG.problems(px, declared=PG.Declared('glass')), [])
        self.assertEqual(PG.problems(px, declared=PG.Declared('glass', {128, 30})), [])
        found = PG.problems(self.with_alpha([128, 77]), declared=PG.Declared('glass', {128, 30}))
        self.assertIn('alpha levels [77] are not declared', found[0])

    def test_an_empty_folder_is_a_failure_not_a_green(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = io.StringIO()
            self.assertEqual(PG.check([tmp], out=out), 1)
            self.assertIn('no PNG found', out.getvalue())

    def test_a_missing_tool_says_not_on_path_and_never_prints_none(self):
        with mock.patch.dict(os.environ, {'NOPE_BIN': ''}), mock.patch.object(PG.shutil, 'which', return_value=None):
            with self.assertRaises(SystemExit) as raised:
                PG.tool_path('NOPE_BIN', 'nope')
        self.assertIn('not set and nope is not on PATH', str(raised.exception))
        self.assertNotIn('None', str(raised.exception))
        with mock.patch.dict(os.environ, {'NOPE_BIN': '/no/such/file'}):
            with self.assertRaises(SystemExit) as raised:
                PG.tool_path('NOPE_BIN', 'nope')
        self.assertIn("set to '/no/such/file', which is not a file", str(raised.exception))


class BinaryAlpha(unittest.TestCase):
    def picture(self, values, fill=(10, 20, 30)):
        px = np.zeros((8, max(len(values), 1), 4), np.uint8)
        for i, v in enumerate(values):
            px[3, i] = (*fill, v)
        return px

    def test_a_picture_without_partial_alpha_comes_back_as_the_same_object(self):
        px = self.picture([0, 255])
        self.assertIs(PG.binary_alpha(px), px)

    def test_flat_levels_drop_a_shadow_below_192_and_keep_an_edge_from_192(self):
        fixed = PG.binary_alpha(self.picture([1, 127, 128, 191, 192, 254]))
        self.assertEqual(fixed[3, :, 3].tolist(), [0, 0, 0, 0, 255, 255])

    def test_an_anti_aliased_picture_is_cut_at_the_silhouette_test_127(self):
        values = list(range(121, 121 + PG.AA_LEVELS))            # 121..128: 8 distinct levels (the aa class), 127 | 128 inside
        self.assertEqual(PG.partial_class(self.picture(values)), 'aa')
        fixed = PG.binary_alpha(self.picture(values))
        self.assertEqual(fixed[3, :, 3].tolist(), [0, 0, 0, 0, 0, 0, 0, 255])   # 127 is clear, 128 is solid
        self.assertEqual(fixed[3, :, 3].tolist(), [255 if v > 127 else 0 for v in values])

    def test_eight_distinct_partial_levels_are_an_aa_picture_and_seven_are_a_flat_one(self):
        # 130..137 (aa: > 127 becomes 255) against 130..136 (flat: below 192 is dropped): the class decides the result.
        eight, seven = list(range(130, 138)), list(range(130, 137))
        self.assertEqual((PG.AA_LEVELS, PG.partial_class(self.picture(eight)), PG.partial_class(self.picture(seven))),
                         (8, 'aa', 'flat'))
        self.assertEqual(PG.binary_alpha(self.picture(eight))[3, :, 3].tolist(), [255] * 8)
        self.assertEqual(PG.binary_alpha(self.picture(seven))[3, :, 3].tolist(), [0] * 7)
        self.assertEqual(PG.partial_class(self.picture([128, 128, 128, 128, 128, 128, 128, 128, 40])), 'flat')  # levels, not px

    def test_the_colour_under_a_dropped_pixel_is_zeroed_and_a_kept_one_is_untouched(self):
        fixed = PG.binary_alpha(self.picture([128, 200]))
        self.assertEqual(fixed[3, 0].tolist(), [0, 0, 0, 0])
        self.assertEqual(fixed[3, 1].tolist(), [10, 20, 30, 255])

    def test_it_is_idempotent_and_keeps_the_size(self):
        once = PG.binary_alpha(self.picture([60, 128, 200, 255, 0]))
        self.assertEqual(once.shape, (8, 5, 4))
        self.assertIs(PG.binary_alpha(once), once)


class DeclaredLayers(unittest.TestCase):
    """hq-office/sheetcheck.check_dist over a built-map fixture: the declared translucent layers and their counts."""
    GLASS = 'Mesa em meia-lua'                                   # a declared name (translucent.py ENTITY_LAYERS)

    def dist(self, tmp, entities, tilesets=None, seats=()):
        """entities {file: (prefab name, RGBA)}; tilesets {file: RGBA}; seats {file: RGBA}."""
        root = Path(tmp)
        (root / 'entities' / 'col').mkdir(parents=True)
        items = []
        for file, (name, px) in entities.items():
            Image.fromarray(px, 'RGBA').save(root / 'entities' / 'col' / file)
            items.append({'id': file, 'name': name, 'imagePath': file})
        (root / 'entities' / 'col' / 'collection.json').write_text(json.dumps({'collection': items}))
        (root / 'seats' / 'front').mkdir(parents=True)
        for file, px in dict(seats).items():
            Image.fromarray(px, 'RGBA').save(root / 'seats' / 'front' / file)
        if not seats:
            Image.fromarray(sheet(32, 32), 'RGBA').save(root / 'seats' / 'front' / 'a.png')
        (root / 'tilesets').mkdir()
        glass = lambda level: sheet(64, 32, lambda px: px.__setitem__((6, 6), (1, 2, 3, level)))
        for file, px in {'Konclui_Walls.png': glass(64), 'Konclui_Doors.png': glass(74), 'Konclui_Light.png': glass(9),
                         'Collision.png': sheet(32, 32), **(tilesets or {})}.items():
            Image.fromarray(px, 'RGBA').save(root / 'tilesets' / file)
        return root

    def run_check(self, entities, tilesets=None, expected=1, seats=(), shadow=0):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.dist(tmp, entities, tilesets, seats)
            out = io.StringIO()
            with mock.patch.object(TL, 'EXPECTED_ENTITY_FILES',
                                   {'glass': expected, 'lamp-light-pool': 0, 'baked-shadow': shadow}):
                return OFFICE_CHECK.check_dist(root, out), out.getvalue()

    def translucent(self, level=128):
        return sheet(64, 32, lambda px: px.__setitem__((6, 6), (1, 2, 3, level)))

    def test_a_declared_glass_sprite_and_clean_sprites_pass_with_the_count_asserted(self):
        failed, text = self.run_check({'g.png': (self.GLASS, self.translucent()), 'a.png': ('Cadeira', sheet())})
        self.assertEqual(failed, 0, text)
        self.assertIn('declared translucent layer glass: 1 files', text)

    def test_a_new_partial_alpha_sprite_fails_the_check_and_is_named(self):
        entities = {'g.png': (self.GLASS, self.translucent()), 'new.png': ('Cadeira nova', self.translucent())}
        failed, text = self.run_check(entities)
        self.assertEqual(failed, 1)
        self.assertRegex(text, r'FAIL .*new\.png: 1 px with partial alpha')

    def test_a_second_declared_glass_file_breaks_the_asserted_count(self):
        entities = {'g.png': (self.GLASS, self.translucent()), 'h.png': (self.GLASS, self.translucent(51))}
        failed, text = self.run_check(entities)
        self.assertEqual(failed, 1)
        self.assertIn('glass: 2 files carry partial alpha, 1 are declared', text)

    def test_a_declared_sprite_that_lost_its_translucency_breaks_the_count_too(self):
        failed, text = self.run_check({'g.png': (self.GLASS, sheet())})
        self.assertEqual(failed, 1)
        self.assertIn('glass: 0 files carry partial alpha, 1 are declared', text)

    def test_a_declared_entity_layer_may_not_use_a_level_it_did_not_declare(self):
        failed, text = self.run_check({'g.png': (self.GLASS, self.translucent(77))})      # 77 is not a glass level
        self.assertEqual(failed, 1)
        self.assertIn('declared layer glass: alpha levels [77] are not declared', text)

    def test_the_baked_shadow_layer_keeps_a_wall_frame_shadow_and_its_count_is_asserted(self):
        frame = 'Quadro: o salão'                                  # fx.py FLAT: the runtime draws no shadow for a frame
        failed, text = self.run_check({'g.png': (self.GLASS, self.translucent()), 'q.png': (frame, self.translucent(40))},
                                      shadow=1)
        self.assertEqual(failed, 0, text)
        self.assertIn('declared translucent layer baked-shadow: 1 files', text)
        failed, text = self.run_check({'g.png': (self.GLASS, self.translucent()), 'q.png': (frame, self.translucent(40))})
        self.assertEqual(failed, 1)                               # the same frame with the layer's count at 0
        self.assertIn('baked-shadow: 1 files carry partial alpha, 0 are declared', text)

    def test_a_seat_front_follows_the_declared_layer_of_its_prefab(self):
        failed, text = self.run_check({'g.png': (self.GLASS, self.translucent())},
                                      seats={'g.png.png': self.translucent()}, expected=2)    # seats/front/<prefab id>.png
        self.assertEqual(failed, 0, text)
        self.assertIn('declared translucent layer glass: 2 files', text)

    def test_a_tileset_may_not_use_a_level_it_did_not_declare(self):
        failed, text = self.run_check({'g.png': (self.GLASS, self.translucent())},
                                      {'Konclui_Walls.png': self.translucent(99)})
        self.assertEqual(failed, 1)
        self.assertIn('declared layer tileset-glass-walls: alpha levels [99]', text)

    def test_a_seat_front_with_partial_alpha_fails(self):
        failed, text = self.run_check({'g.png': (self.GLASS, self.translucent())}, seats={'s.png': self.translucent()})
        self.assertEqual(failed, 1)
        self.assertRegex(text, r'FAIL .*seats.*s\.png: 1 px with partial alpha')

    def test_the_build_writes_binary_alpha_for_everything_but_the_declared_names(self):
        from PIL import Image as PILImage
        shadow = PILImage.fromarray(self.translucent(128), 'RGBA')
        self.assertEqual(PG.partial_levels(np.asarray(TL.snapped('Cadeira', shadow))[..., 3]), [])
        kept = TL.snapped(self.GLASS, shadow)
        self.assertIs(kept, shadow)


class DeclaredBudget(unittest.TestCase):
    """The numbers of translucent.py, asserted with their REAL values (DeclaredLayers mocks the counts and uses fixture
    levels, so it cannot see a change of them). A change of the budget fails here until this test says so on purpose."""

    def test_the_declared_budget_is_the_documented_one(self):
        self.assertEqual(TL.EXPECTED_ENTITY_FILES, {'glass': 77, 'lamp-light-pool': 4, 'baked-shadow': 32})
        self.assertEqual(sum(TL.EXPECTED_ENTITY_FILES.values()), 113)
        self.assertEqual({layer: len(names) for layer, (_, names) in TL.ENTITY_LAYERS.items()},
                         {'glass': 6, 'lamp-light-pool': 4, 'baked-shadow': 30})
        self.assertEqual(TL.ENTITY_LEVELS, {'glass': {51, 128, 179, 192, 204, 230},
                                            'baked-shadow': {22, 26, 28, 30, 40, 44, 48, 50, 56, 70, 100, 128, 130, 166}})
        self.assertEqual(TL.EXPECTED_TILESET_FILES,
                         {'tileset-glass-walls': 1, 'tileset-glass-doors': 1, 'tileset-light-overlay': 1})
        self.assertEqual({name: levels for name, (_, levels) in TL.TILESET_LAYERS.items()},
                         {'Konclui_Walls.png': {34, 40, 52, 64, 70, 170, 200, 210, 230, 235},
                          'Konclui_Doors.png': {74, 210, 220, 235}, 'Konclui_Light.png': None})

    def test_a_layer_without_levels_here_is_a_layer_that_lists_none_on_purpose(self):
        # lamp-light-pool is a gradient: no level list. Any other entity layer must have one.
        self.assertEqual(sorted(set(TL.ENTITY_LAYERS) - set(TL.ENTITY_LEVELS)), ['lamp-light-pool'])


def setUpModule():
    if not os.environ.get('KONCLUI_DIST'):
        print('note: KONCLUI_DIST is unset, so BuiltOffice (the real budgets over a built map) is SKIPPED; '
              'build with `python3 hq-office/build.py --out DIR --renders DIR2` and rerun with KONCLUI_DIST=DIR',
              file=sys.stderr)


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST unset (a built map: hq-office/build.py --out DIR)')
class BuiltOffice(unittest.TestCase):
    """hq-office/sheetcheck.check_dist with the REAL constants (nothing mocked) over the built map in $KONCLUI_DIST:
    the entity and seat-front pictures, the declared layers' levels and file counts, and the tilesets."""

    def test_the_real_budgets_hold_over_the_built_map(self):
        """The budgets of the switch the build was made with (fx/manifest.json "volume"; none for a default build): the declared layers
        lose the pictures a baked piece stops carrying (translucent.VOLUME_DROPS), and nothing else."""
        import verify
        dist = os.environ['KONCLUI_DIST']
        switch = verify.recorded_switch(dist)
        with verify.built_with(dist):
            out = io.StringIO()
            failed = OFFICE_CHECK.check_dist(dist, out)
            self.assertEqual(failed, 0, out.getvalue()[-3000:])
            want = TL.expected_entity_files(TL.painted_shadows(), switch)
            self.assertEqual(TL.EXPECTED_ENTITY_FILES, want)
            for layer, files in want.items():
                self.assertIn(f'declared translucent layer {layer}: {files} files', out.getvalue())
        today = TL.expected_entity_files(TL.painted_shadows())
        if not switch:
            self.assertEqual(want, today)
        elif TL.painted_shadows():                    # each name takes exactly the files VOLUME_DROPS says out of its layer
            for layer in today:
                dropped = sum(files for n in switch for lay, (_, files) in TL.VOLUME_DROPS.get(n, {}).items() if lay == layer)
                self.assertEqual(today[layer] - want[layer], dropped, layer)


class LostShadow(unittest.TestCase):
    """translucent.lost_only_shadow: a placed piece the runtime draws no shadow for must not lose its own to the repair."""

    def dist(self, tmp, name, footprint):
        root = Path(tmp)
        (root / 'fx').mkdir()
        (root / 'entities' / 'col').mkdir(parents=True)
        (root / 'entities' / 'col' / 'collection.json').write_text(json.dumps(
            {'collectionName': 'col', 'collection': [{'id': 'p0', 'name': name, 'imagePath': 'p0.png'}]}))
        (root / 'office.wam').write_text(json.dumps(
            {'entities': {'e0': {'x': 0, 'y': 0, 'prefabRef': {'collectionName': 'col', 'id': 'p0'}}}}))
        (root / 'fx' / 'manifest.json').write_text(json.dumps({'shadows': {'col/p0.png': footprint}}))
        return root

    def lost(self, name, footprint, picture):
        from PIL import Image as PILImage
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(TL.DROPPED, clear=True):
            TL.snapped(name, PILImage.fromarray(picture, 'RGBA'))
            return TL.lost_only_shadow(self.dist(tmp, name, footprint))

    def shadowed(self):
        return sheet(32, 32, lambda px: px.__setitem__((20, 6), (0, 0, 0, 40)))      # a 40-alpha shadow px: dropped

    def test_an_undeclared_piece_with_no_runtime_shadow_that_loses_its_shadow_is_reported(self):
        self.assertEqual(self.lost('Quadro novo', None, self.shadowed()), [('Quadro novo', 1)])

    def test_a_piece_the_runtime_shadows_does_not_need_its_baked_one(self):
        self.assertEqual(self.lost('Cadeira nova', [2, 20, 30, 28], self.shadowed()), [])

    def test_a_declared_piece_keeps_its_shadow_so_nothing_is_lost(self):
        self.assertEqual(self.lost('Quadro: o salão', None, self.shadowed()), [])

    def test_a_piece_with_no_partial_alpha_loses_nothing(self):
        self.assertEqual(self.lost('Quadro novo', None, sheet(32, 32)), [])


class RepoSheets(unittest.TestCase):
    """The contract over the committed sheets: pets, avatars and companions."""

    def test_the_avatar_and_companion_sheets_pass(self):
        out = io.StringIO()
        self.assertEqual(AVATAR_CHECK.check(out=out), 0, out.getvalue())
        self.assertIn('5 of 5 sheets pass', out.getvalue())
        self.assertIn('1 of 1 sheets pass', out.getvalue())

    def avatar_copy(self, tmp, change):
        root = Path(tmp) / 'out'
        shutil.copytree(AVATAR_CHECK.ART_OUT, root)
        sheet_path = next((root / 'wokas').glob('*.png'))
        px = PG.load_rgba(sheet_path).copy()
        change(px)
        Image.fromarray(px, 'RGBA').save(sheet_path)
        return root

    def test_a_colour_outside_the_locked_avatar_palette_fails(self):
        def foreign(px):
            y, x = np.argwhere(px[..., 3] == 255)[0]
            px[y, x, :3] = (1, 2, 3)
        with tempfile.TemporaryDirectory() as tmp:
            out = io.StringIO()
            self.assertEqual(AVATAR_CHECK.check(self.avatar_copy(tmp, foreign), out), 1)
            self.assertIn('outside the palette, first #010203', out.getvalue())

    def test_a_partial_alpha_pixel_in_an_avatar_sheet_fails(self):
        def soft(px):
            y, x = np.argwhere(px[..., 3] == 255)[0]
            px[y, x, 3] = 128
        with tempfile.TemporaryDirectory() as tmp:
            out = io.StringIO()
            self.assertEqual(AVATAR_CHECK.check(self.avatar_copy(tmp, soft), out), 1)
            self.assertIn('partial alpha', out.getvalue())

    def test_an_avatar_sheet_that_is_not_96_by_128_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.avatar_copy(tmp, lambda px: None)
            sheet_path = next((root / 'wokas').glob('*.png'))
            Image.fromarray(np.zeros((128, 128, 4), np.uint8), 'RGBA').save(sheet_path)   # a 32 px multiple, wrong size
            out = io.StringIO()
            self.assertEqual(AVATAR_CHECK.check(root, out), 1)
            self.assertIn('size 128x128 is not 96x128', out.getvalue())

    def test_the_pets_sheets_pass_and_a_wide_sheet_is_counted_before_the_summary(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(PETS_CHECK.main(['check']), 0)
        self.assertIn('24 of 24 sheets pass', out.getvalue())
        wide = np.zeros((32, 480, 4), np.uint8)
        self.assertEqual(PETS_CHECK.wide_rule(wide), ['width 480 is not 512 (16 cells)'])
        with tempfile.TemporaryDirectory() as tmp:
            species = Path(tmp) / 'cat'
            species.mkdir()
            Image.fromarray(wide, 'RGBA').save(species / 'base.png')
            shutil.copy(next(PETS_CHECK.SPECIES.glob('*/palette.json')), species / 'palette.json')
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(PETS_CHECK.main(['check', tmp]), 1)
            self.assertIn('0 of 1 sheets pass, 1 fail', out.getvalue())


WOKA_BASE = SOURCE.parents[2] / 'play' / 'src' / 'pusher' / 'data' / 'woka.json'


def native_export():
    """avatars/native_export.py by path (it puts pets/tools on sys.path, where another sheetcheck.py lives)."""
    return load_module('native_export_under_test', SOURCE / 'avatars' / 'native_export.py')


@unittest.skipUnless(WOKA_BASE.is_file(), 'play/src/pusher/data/woka.json not in this checkout')
class PipelineGates(unittest.TestCase):
    """The pipeline steps that WRITE sheets run the pixel contract on what they write (not only the committed art)."""

    def export(self, tmp, module):
        return module.build(WOKA_BASE, Path(tmp) / 'out', Path(tmp) / 'cat')

    def test_the_avatar_export_writes_layers_that_pass_the_contract(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(io.StringIO()) as err:
            self.export(tmp, native_export())
            self.assertIn('sheets pass, 0 fail', err.getvalue())

    def test_exported_layers_must_be_exactly_96_by_128(self):
        with tempfile.TemporaryDirectory() as tmp:
            Image.fromarray(sheet(96, 128), 'RGBA').save(Path(tmp) / 'ok.png')
            Image.fromarray(sheet(128, 128), 'RGBA').save(Path(tmp) / 'wide.png')     # a 32 px multiple, wrong size
            out = io.StringIO()
            self.assertEqual(AVATAR_CHECK.check_exported(tmp, out), 1)
            self.assertRegex(out.getvalue(), r'FAIL .*wide\.png: size 128x128 is not 96x128')

    def test_the_avatar_export_fails_when_a_layer_has_partial_alpha(self):
        module = native_export()
        real = module.layer

        def soft(*args):
            px = real(*args).copy()
            y, x = np.argwhere(px[..., 3] == 255)[0]
            px[y, x, 3] = 128
            return px
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(io.StringIO()) as err, \
                mock.patch.object(module, 'layer', soft):
            with self.assertRaises(ValueError) as raised:
                self.export(tmp, module)
        self.assertIn('pixel contract', str(raised.exception))
        self.assertIn('partial alpha', err.getvalue())

    def test_the_pet_build_fails_when_the_recoloured_atlas_has_partial_alpha(self):
        petkit = load_module('petkit_under_test', SOURCE / 'pets' / 'tools' / 'petkit.py')
        real = petkit.recolour

        def soft(*args):
            px = real(*args).copy()
            y, x = np.argwhere(px[..., 3] == 255)[0]
            px[y, x, 3] = 128
            return px
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(petkit, 'recolour', soft):
            with self.assertRaises(SystemExit) as raised:
                petkit.build(SOURCE / 'pets' / 'species' / 'gato', tmp)
            self.assertIn('partial alpha', str(raised.exception))


class SnapperPath(unittest.TestCase):
    def test_a_stock_snapper_through_the_override_is_refused(self):
        # A build whose --help lacks --expect-cell is the stock one: it returns wrong sizes with exit 0, so `snap` must not run it.
        with tempfile.TemporaryDirectory() as tmp:
            stock = Path(tmp) / 'spritefusion-pixel-snapper'
            stock.write_text('#!/bin/sh\nif [ "$1" = "--version" ]; then echo "spritefusion-pixel-snapper 1.0.0"; exit 0; fi\n'
                             'echo "usage: tool INPUT OUTPUT [COLORS] [--pixel-size N]"\n')
            stock.chmod(0o755)
            with mock.patch.dict(os.environ, {PG.SNAPPER_ENV: str(stock)}):
                with self.assertRaises(SystemExit) as raised:
                    PG.snapper_path()
            self.assertIn('STOCK', str(raised.exception))

    def test_the_pinned_fixed_build_is_what_snap_runs(self):
        self.assertEqual(PG.snapper_path(), toolchain.require('pixel-snapper'))


class SnapSucceeds(unittest.TestCase):
    def test_an_upscaled_picture_that_resizes_onto_the_grid_is_written_with_binary_alpha(self):
        # 32 x 32 art upscaled 4x (128 px) with one stray half-transparent pixel: `--pixel-size 4` returns 32 x 32 (the stock
        # snapper returned 33 x 33 for it, and 32 x 32 for 31 x 31 art; the fixed one does not).
        toolchain.require('pixel-snapper')
        colours = np.array([(200, 30, 30, 255), (30, 200, 30, 255), (30, 30, 200, 255), (240, 240, 60, 255)], np.uint8)
        art = np.zeros((32, 32, 4), np.uint8)
        art[3:29, 3:29] = colours[np.random.default_rng(1).integers(0, 4, (26, 26))]
        up = art.repeat(4, 0).repeat(4, 1)
        up[41, 41, 3] = 128
        palette = {tuple(int(v) for v in c[:3]) for c in colours}
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'up.png', Path(tmp) / 'snapped.png'
            Image.fromarray(up, 'RGBA').save(src)
            self.assertTrue(PG.problems(up, palette=palette))
            self.assertEqual(PG.snap(src, dst, palette, pixel_size=4, out=io.StringIO()), 0)
            snapped = PG.load_rgba(dst)
            self.assertEqual(snapped.shape[:2], (32, 32))
            self.assertEqual(PG.problems(snapped, palette=palette), [])


class Binarize(unittest.TestCase):
    def test_keeps_the_size_and_turns_alpha_binary(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'a.png', Path(tmp) / 'b.png'
            px = sheet(96, 64, lambda p: (p.__setitem__((6, 6), (10, 20, 30, 200)), p.__setitem__((7, 7), (10, 20, 30, 127))))
            Image.fromarray(px, 'RGBA').save(src)
            self.assertEqual(PG.binarize(src, dst, out=io.StringIO()), 0)
            fixed = PG.load_rgba(dst)
            self.assertEqual(fixed.shape, px.shape)
            self.assertEqual((fixed[6, 6, 3], fixed[7, 7, 3]), (255, 0))
            self.assertEqual(PG.problems(fixed, palette={(10, 20, 30)}), [])

    def test_a_clean_picture_is_not_written_and_in_place_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / 'a.png'
            Image.fromarray(sheet(), 'RGBA').save(src)
            PG.binarize(src, Path(tmp) / 'b.png', out=io.StringIO())
            self.assertFalse((Path(tmp) / 'b.png').exists())
            with self.assertRaises(SystemExit):
                PG.binarize(src, src)


class Compose(unittest.TestCase):
    """normals.compose over a built-map fixture with the legacy method (no binary needed)."""

    def compose(self, sprites, entities, size=(32, 32), offsets=None):
        with tempfile.TemporaryDirectory() as tmp:
            make_dist(tmp, sprites, entities, size, offsets)
            image, method = N.compose(tmp, 'legacy')
        self.assertEqual(method, 'legacy')
        return np.asarray(image)

    def test_a_sprite_lands_at_its_placement_offset_and_the_rest_stays_flat(self):
        a = ramp(6, 5, 1)
        canvas = self.compose({'a': a}, [('a', 10, 7)])
        self.assertEqual(canvas.shape, (32, 32, 4))
        self.assertEqual(canvas[7:12, 10:16].tolist(), N.legacy_normal(a).tolist())
        covered = np.zeros((32, 32), bool)
        covered[7:12, 10:16] = True
        self.assertTrue((canvas[~covered] == N.FLAT).all())

    def test_the_picture_is_clipped_at_the_map_edge(self):
        canvas = self.compose({'a': ramp(8, 8, 1)}, [('a', 28, 28)])
        self.assertEqual(canvas[28:, 28:].tolist(), N.legacy_normal(ramp(8, 8, 1))[:4, :4].tolist())

    def test_a_picture_above_and_left_of_the_map_is_clipped_at_the_origin(self):
        # x < 0 and y < 0: the visible part starts at the sprite's pixel (3, 2), not at its first pixel.
        a = ramp(8, 8, 1)
        canvas = self.compose({'a': a}, [('a', -3, -2)])
        want = N.legacy_normal(a)[2:, 3:]
        self.assertEqual(canvas[:6, :5].tolist(), want.tolist())
        self.assertTrue((canvas[6:] == N.FLAT).all() and (canvas[:, 5:] == N.FLAT).all())

    def test_a_translucent_pixel_is_not_geometry_so_it_keeps_the_flat_normal(self):
        # A declared translucent sprite (glass, a light pool): pixels under alpha 255 are no normal (alpha 0, flat).
        a = ramp(6, 6, 1)
        a[2, 3, 3], a[3, 3, 3], a[4, 3, 3] = 128, 60, 254
        canvas = self.compose({'a': a}, [('a', 4, 4)])
        for row in (2, 3, 4):
            self.assertEqual(tuple(canvas[4 + row, 7]), N.FLAT, row)
        self.assertEqual(canvas[4 + 1, 7, 3], 255)

    def test_a_transparent_pixel_keeps_the_flat_normal(self):
        a = ramp(6, 6, 1)
        a[2, 3, 3] = 0
        canvas = self.compose({'a': a}, [('a', 4, 4)])
        self.assertEqual(tuple(canvas[6, 7]), N.FLAT)

    def test_the_sprite_with_the_lower_bottom_edge_is_drawn_on_top_whatever_the_file_order(self):
        tall, short = ramp(8, 16, 1), ramp(8, 4, 0)
        # tall spans y 0..16, short y 4..8: the short one's TOP is lower than the tall one's, its BOTTOM is higher.
        for order in ([('tall', 4, 0), ('short', 4, 4)], [('short', 4, 4), ('tall', 4, 0)]):
            canvas = self.compose({'tall': tall, 'short': short}, order)
            self.assertEqual(tuple(canvas[5, 6]), tuple(N.legacy_normal(tall)[5, 2]))

    def test_a_depth_offset_can_put_the_sprite_with_the_lower_bottom_edge_behind(self):
        # The runtime draws at y + height + depthOffset (EntitiesManager.ts). tall's bottom edge is 16 against short's 8,
        # so with no offsets tall is on top; with tall's offset at -20 its depth is -4 and short is drawn over it.
        tall, short = ramp(8, 16, 1), ramp(8, 4, 0)
        under, over = tuple(N.legacy_normal(tall)[5, 2]), tuple(N.legacy_normal(short)[1, 2])
        self.assertNotEqual(under, over)                          # the pixel (6, 5) tells the two sprites apart
        for order in ([('tall', 4, 0), ('short', 4, 4)], [('short', 4, 4), ('tall', 4, 0)]):
            sprites = {'tall': tall, 'short': short}
            self.assertEqual(tuple(self.compose(sprites, order)[5, 6]), under)
            self.assertEqual(tuple(self.compose(sprites, order, offsets={'tall': -20})[5, 6]), over)
            self.assertEqual(tuple(self.compose(sprites, order, offsets={'short': 50})[5, 6]), over)   # 8 + 50 > 16

    def test_two_sprites_at_the_same_depth_go_by_x_whatever_the_file_order(self):
        # Equal depth (bottom edge 8 for both): the runtime's tie is the texture load order, which no file records,
        # so the pipeline takes a fixed rule: the larger x is on top. Overlap pixel (5, 3): b's local (1, 3).
        a, b = ramp(8, 8, 1), ramp(8, 8, 0)
        self.assertNotEqual(tuple(N.legacy_normal(a)[3, 5]), tuple(N.legacy_normal(b)[3, 1]))
        for order in ([('a', 0, 0), ('b', 4, 0)], [('b', 4, 0), ('a', 0, 0)]):
            canvas = self.compose({'a': a, 'b': b}, order)
            self.assertEqual(tuple(canvas[3, 5]), tuple(N.legacy_normal(b)[3, 1]))

    def test_placed_reads_the_depth_offset_of_the_prefab_and_defaults_it_to_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            make_dist(tmp, {'a': ramp(4, 4, 1), 'b': ramp(4, 4, 1)}, [('a', 1, 2), ('b', 3, 4)], (16, 16), {'b': -57})
            self.assertEqual([(x, y, Path(p).name, d) for x, y, p, d in N.placed(tmp)],
                             [(1, 2, 'a.png', 0), (3, 4, 'b.png', -57)])


@unittest.skipUnless(shutil.which('spritefusion-sprite-normals'), 'spritefusion-sprite-normals not installed')
class ToolNormals(unittest.TestCase):
    def square(self):
        px = np.zeros((20, 20, 4), np.uint8)
        px[..., :3] = 120                       # the same grey under the transparent border: only alpha marks the edge
        px[4:16, 4:16, 3] = 255
        return px

    def tool(self, px):
        with tempfile.TemporaryDirectory() as tmp:
            Image.fromarray(px, 'RGBA').save(Path(tmp) / 'a.png')
            return N.tool_normals([str(Path(tmp) / 'a.png')]).popitem()[1]

    def test_the_silhouette_of_a_flat_square_pushes_every_edge_outward(self):
        n = self.tool(self.square()).astype(int)
        # +X right, +Y up: the left edge leans left (R low), the right edge right, the top edge up (G high).
        self.assertLess(n[10, 4, 0], 100)
        self.assertGreater(n[10, 15, 0], 156)
        self.assertGreater(n[4, 10, 1], 156)
        self.assertLess(n[15, 10, 1], 100)
        self.assertTrue((n[..., 3][4:16, 4:16] == 255).all() and n[0, 0, 3] == 0)

    def test_the_alpha_comes_from_the_sprite_not_from_the_tool(self):
        # The tool may keep partial alpha as it is. The composed alpha must be 255 on an opaque pixel and 0 on a
        # translucent one (128, 60 and 254 alike), whatever the tool wrote.
        px = self.square()
        px[8, 8, 3], px[8, 9, 3], px[8, 10, 3] = 128, 60, 254
        n = self.tool(px)
        self.assertEqual(n[8, 8:11, 3].tolist(), [0, 0, 0])
        self.assertEqual(n[8, 7, 3], 255)

    def test_the_old_method_is_blind_to_the_silhouette_of_the_same_square(self):
        n = N.legacy_normal(self.square()).astype(int)
        self.assertEqual(tuple(n[10, 4, :3]), (128, 128, 255))     # one colour everywhere: alpha alone draws no edge

    def test_a_lit_slope_leans_the_same_way_as_the_old_method(self):
        px = np.zeros((24, 24, 4), np.uint8)
        px[4:20, 4:20] = ramp(16, 16, 1)
        tool, old = self.tool(px).astype(int), N.legacy_normal(px).astype(int)
        inner = (slice(8, 16), slice(8, 16))
        self.assertEqual(np.sign(tool[inner][..., 0].mean() - 128), np.sign(old[inner][..., 0].mean() - 128))


    def test_atlas_cells_are_lit_one_by_one_and_the_size_is_kept(self):
        # two opaque blocks that touch across the cell border (x 31 | 32): with --frame-size 32x32 the right edge of
        # cell 0 is still an edge, so it leans right; read as one sprite it would be interior and flat.
        px = np.zeros((32, 64, 4), np.uint8)
        px[..., :3] = 120
        px[8:24, 16:48, 3] = 255
        with tempfile.TemporaryDirectory() as tmp:
            sheet_path = Path(tmp) / 'a.png'
            Image.fromarray(px, 'RGBA').save(sheet_path)
            made = N.atlas_normals({'a': sheet_path}, Path(tmp) / 'out')
            n = np.asarray(Image.open(made['a']).convert('RGBA')).astype(int)
        self.assertEqual(n.shape, (32, 64, 4))
        self.assertGreater(n[16, 31, 0], 156)       # cell 0's right edge leans right
        self.assertLess(n[16, 32, 0], 100)          # cell 1's left edge leans left


class FakeTool(unittest.TestCase):
    """The composed alpha is the sprite's, whatever a tool writes: a stand-in binary that returns alpha 128 everywhere
    (a real tool could keep partial alpha, MEASURED on a 128 px in wave A) must still give 255 on opaque, 0 elsewhere."""

    def fake_binary(self, tmp):
        path = Path(tmp) / 'fake-normals'
        path.write_text(f"#!{sys.executable}\n"
                        "import sys\nfrom pathlib import Path\nimport numpy as np\nfrom PIL import Image\n"
                        "a = sys.argv[1:]\nout = Path(a[a.index('--output-dir') + 1]); out.mkdir(parents=True, exist_ok=True)\n"
                        "for f in a[:a.index('--output-dir')]:\n"
                        "    h, w = np.asarray(Image.open(f)).shape[:2]\n"
                        "    px = np.zeros((h, w, 4), np.uint8); px[...] = (200, 100, 255, 128)\n"
                        "    Image.fromarray(px, 'RGBA').save(out / (Path(f).stem + '_n.png'))\n")
        path.chmod(0o755)
        return str(path)

    def test_the_alpha_of_the_result_is_the_sprites_not_the_tools(self):
        px = ramp(6, 6, 1)
        px[1, 1, 3] = 128                                             # a translucent pixel
        px[2, 2, 3] = 0                                               # a clear one
        with tempfile.TemporaryDirectory() as tmp:
            Image.fromarray(px, 'RGBA').save(Path(tmp) / 'a.png')
            with mock.patch.dict(os.environ, {N.NORMALS_ENV: self.fake_binary(tmp)}):
                n = N.tool_normals([str(Path(tmp) / 'a.png')]).popitem()[1]
        self.assertEqual(sorted(np.unique(n[..., 3]).tolist()), [0, 255])
        self.assertEqual((n[..., 3] == 255).tolist(), (px[..., 3] == 255).tolist())


class Fallback(unittest.TestCase):
    """The owner's fallback: tool missing -> the luminance method, said loudly; a wrong tool setting is an error."""

    def dist(self, tmp):
        make_dist(tmp, {'a': ramp(6, 5, 1)}, [('a', 4, 4)], (16, 16))

    def test_with_no_tool_auto_uses_the_luminance_method_and_says_so_on_stderr(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {'PATH': '', N.NORMALS_ENV: ''}):
            self.dist(tmp)
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                image, method = N.compose(tmp, 'auto')
            self.assertEqual(method, 'legacy')
            self.assertIn('LUMINANCE FALLBACK', err.getvalue())
            self.assertEqual(np.asarray(image)[4:9, 4:10].tolist(), N.legacy_normal(ramp(6, 5, 1)).tolist())
            self.assertIn('NOT silhouette-aware', N.describe(method))

    def test_asking_for_the_tool_when_it_is_missing_is_an_error_naming_the_variable(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {'PATH': '', N.NORMALS_ENV: ''}):
            self.dist(tmp)
            with self.assertRaises(SystemExit) as raised:
                N.compose(tmp, 'tool')
        self.assertIn(f'{N.NORMALS_ENV} is not set and {N.NORMALS_DEFAULT} is not on PATH', str(raised.exception))

    def test_a_set_but_wrong_tool_variable_is_an_error_never_a_fallback(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {N.NORMALS_ENV: '/no/such/binary'}):
            self.dist(tmp)
            self.assertEqual(N.resolve_method('auto'), 'tool')
            err = io.StringIO()
            with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as raised:
                N.compose(tmp, 'auto')
        self.assertIn('which is not a file', str(raised.exception))
        self.assertEqual(err.getvalue(), '')


class RuntimeContract(unittest.TestCase):
    """fx/normal.png as play/src/front/Konclui/Ambience reads it (read-only here: the ambience lane owns those files)."""

    def written(self, method):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'dist'
            a = ramp(10, 8, 1)
            a[2, 3, 3] = 128                                            # a translucent pixel inside the sprite
            make_dist(root, {'a': a, 'b': ramp(6, 6, 0)}, [('a', 4, 4), ('b', 12, 10)], (24, 20))
            first, second = Path(tmp) / 'one.png', Path(tmp) / 'two.png'
            N.write(root, first, method)
            N.write(root, second, method)
            return first.read_bytes(), second.read_bytes()

    def decoded(self, data):
        return np.asarray(Image.open(io.BytesIO(data)).convert('RGBA')).astype(int)

    def test_two_runs_give_the_same_bytes(self):
        one, two = self.written('legacy')
        self.assertEqual(one, two)

    @unittest.skipUnless(shutil.which('spritefusion-sprite-normals'), 'spritefusion-sprite-normals not installed')
    def test_two_runs_of_the_tool_give_the_same_bytes(self):
        one, two = self.written('tool')
        self.assertEqual(one, two)

    def test_the_size_the_channels_and_the_flat_pixel_are_what_the_shader_samples(self):
        data, _ = self.written('legacy')
        n = self.decoded(data)
        self.assertEqual(n.shape, (20, 24, 4))                             # the manifest's map size, rows from the top
        self.assertTrue(np.isin(n[..., 3], (0, 255)).all())                # binary alpha: `nm.a > 0.5` and premultiply-safe
        self.assertEqual(tuple(N.FLAT), (128, 128, 255, 0))                # vec4(0.5, 0.5, 1.0, 0.0): "no normal"
        clear = n[..., 3] == 0
        self.assertTrue((n[clear][:, :3] == (128, 128, 255)).all())        # a pixel with no normal is the flat one
        self.assertEqual(n[4 + 2, 4 + 3, 3], 0)                                    # the translucent pixel (alpha 128): no normal
        self.assertTrue((n[4:12, 4:14, 3].sum() > 0))

    def test_the_png_carries_no_colour_chunk_so_the_browser_does_not_colour_manage_a_data_texture(self):
        data, _ = self.written('legacy')
        chunks, i = [], 8
        while i < len(data):
            length = int.from_bytes(data[i:i + 4], 'big')
            chunks.append(data[i + 4:i + 8].decode('ascii'))
            i += 12 + length
        self.assertFalse({'iCCP', 'gAMA', 'sRGB', 'cHRM'} & set(chunks), chunks)

    def test_the_runtime_loader_reads_the_file_name_this_pipeline_writes(self):
        loader = SOURCE.parents[2] / 'play' / 'src' / 'front' / 'Konclui' / 'Ambience' / 'phaser' / 'effectsLoader.ts'
        if not loader.exists():
            self.skipTest('effectsLoader.ts not in this checkout')
        self.assertRegex(loader.read_text(), r'loadNormal\(`\$\{base\}normal\.png`, manifest\.map\)')
        self.assertIn("'normal.png'", (HERE.parent / 'hq-office' / 'fx.py').read_text().replace('"', "'"))


class Stamped(unittest.TestCase):
    """fx.add_normals: the default writes fx/normal.png and advertises it; KONCLUI_FX_NORMALS=0 leaves it out."""

    def run_add(self, environ):
        import fx
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {'PATH': '', N.NORMALS_ENV: ''}):
            root = Path(tmp) / 'dist'
            make_dist(root, {'a': ramp(6, 5, 1)}, [('a', 4, 4)], (16, 16))
            manifest = json.loads((root / 'fx' / 'manifest.json').read_text())
            with contextlib.redirect_stdout(io.StringIO()) as said, contextlib.redirect_stderr(io.StringIO()):
                wrote = fx.add_normals(root, root / 'fx', manifest, environ)
            on_disk = json.loads((root / 'fx' / 'manifest.json').read_text())
            png = root / 'fx' / 'normal.png'
            text = Image.open(png).text if png.exists() else None
            return wrote, png.exists(), on_disk.get('normal'), text, said.getvalue()

    def test_by_default_the_build_writes_the_texture_advertises_it_and_says_the_method(self):
        wrote, exists, advertised, text, said = self.run_add({})
        self.assertEqual((wrote, exists, advertised), (True, True, True))
        self.assertEqual(text[N.METHOD_KEY], 'legacy')                 # no tool on PATH here: the fallback, stamped
        self.assertIn('NOT silhouette-aware', said)

    def test_the_off_switch_writes_nothing_and_advertises_nothing(self):
        self.assertEqual(self.run_add({'KONCLUI_FX_NORMALS': '0'})[:4], (False, False, None, None))

    @unittest.skipUnless(shutil.which('spritefusion-sprite-normals'), 'spritefusion-sprite-normals not installed')
    def test_the_tool_run_is_stamped_tool(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'dist'
            make_dist(root, {'a': ramp(6, 5, 1)}, [('a', 4, 4)], (16, 16))
            N.write(root, Path(tmp) / 'n.png', 'tool')
            self.assertEqual(Image.open(Path(tmp) / 'n.png').text[N.METHOD_KEY], 'tool')


class Atlases(unittest.TestCase):
    def test_the_default_atlases_are_every_pet_sheet_and_every_avatar_and_companion_sheet(self):
        found = N.default_atlases()
        names = [Path(p).parent.name for p in found]
        self.assertEqual(sum(n not in ('wokas', 'companions') for n in names), 24)
        self.assertEqual(names.count('wokas'), 5)
        self.assertEqual(names.count('companions'), 1)
        for path in found:
            h, w = PG.load_rgba(path).shape[:2]
            self.assertEqual((w % 32, h % 32), (0, 0), path)


class LegacyNormals(unittest.TestCase):
    def test_legacy_normal_golden_values(self):
        # Golden values of the luminance method (ported from the removed runtime function normalFromLuminance): the only
        # pin the fallback has, there is no runtime fixture left to compare against.
        src = np.array([[(0, 0, 0, 255), (255, 255, 255, 255), (0, 0, 0, 255)],
                        [(128, 128, 128, 255), (64, 64, 64, 255), (200, 200, 200, 255)],
                        [(255, 0, 0, 255), (0, 255, 0, 128), (0, 0, 255, 0)]], np.uint8)
        expected = [[72, 155, 239, 255], [128, 83, 247, 255], [181, 170, 235, 255],
                    [143, 146, 253, 255], [110, 102, 251, 255], [95, 135, 251, 255],
                    [109, 115, 253, 255], [139, 149, 253, 255], [155, 88, 245, 0]]
        self.assertEqual(N.legacy_normal(src).reshape(-1, 4).tolist(), expected)


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST unset (a built map: hq-office/build.py --out DIR)')
class BuiltFacadeDecor(unittest.TestCase):
    """The lawn decor of the built map around the two glass facades: the lawn behind the NORTH glass keeps its tufts and flower clumps
    (HEAD has 12 of them on the facade's lower row; the first try of N10 left none), and nothing grows on the room's floor behind the
    SOUTH glass (HEAD drew 28 on it, over the glass)."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(SOURCE / 'hq-office'))
        import plan as P
        cls.P = P
        cls.map = json.loads((Path(os.environ['KONCLUI_DIST']) / 'office.tmj').read_text())
        layer = next(l for l in cls.map['layers'] if l['name'] == 'decor')
        cls.W = cls.map['width']
        cls.decor = {(i % cls.W, i // cls.W) for i, v in enumerate(layer['data']) if v}

    def columns(self, row):
        return {x for r, a, b, _, m in self.P.H_WALLS if r == row and m == 'glass' for x in range(self.P.vb(a), self.P.vb(b))}

    def test_the_lawn_behind_the_north_glass_keeps_its_tufts_on_the_lower_row(self):
        cells = [(x, self.P.BY0 + 1) for x in sorted(self.columns(self.P.BY0)) if (x, self.P.BY0 + 1) in self.decor]
        self.assertGreaterEqual(len(cells), 6, cells)

    def test_nothing_grows_on_the_room_floor_behind_the_south_glass(self):
        cols = self.columns(self.P.BY1)
        over = [(x, y) for x, y in self.decor if y in (self.P.BY1, self.P.BY1 + 1) and x in cols]
        self.assertEqual(over, [])


class FacadeFloors(unittest.TestCase):
    """The ground under the two facades of glass (hq-office/build.py draw_floors; audit items I01 and N10). The south facade is seen from
    outside: behind it stands the room, so the floor under its glass is the floor of what stands behind it, down to the face's last row
    (build.facade_base), and the lawn starts there. The north facade is seen from inside: behind it is the lawn, which stops at the face's
    last row, and the room's floor runs under the rest of the cell when the face ends before the cell does (it used to run 2 px past the
    rail: a green sliver under it)."""

    @classmethod
    def setUpClass(cls):
        cls.B = load_module('office_build_facade', SOURCE / 'hq-office' / 'build.py')
        cls.floors = cls.B.draw_floors()
        cls.px = np.asarray(cls.floors)
        grass = np.asarray(cls.B.floor_tile('lawn'))
        cls.lawn = lambda self, x, y: tuple(grass[y % grass.shape[0], x % grass.shape[1]])

    def glass_spans(self, row):
        return [(self.B.P.vb(a) * 32, self.B.P.vb(b) * 32) for r, a, b, _, m in self.B.P.H_WALLS if r == row and m == 'glass']

    def test_facade_base_is_the_last_opaque_row_of_the_face_and_a_soft_shadow_under_it_does_not_count(self):
        face = np.zeros((64, 96, 4), np.uint8)
        face[4:8, :, 3] = 255                      # a rail
        face[8:60, :, 3] = 64                      # the panes
        face[60:62, :, 3] = 255                    # the base rail
        face[62:64, :, 3] = 34                     # the soft shadow under it
        with mock.patch.object(self.B.GL, 'face', lambda *a, **k: Image.fromarray(face, 'RGBA')):
            self.assertEqual(self.B.facade_base(south=False), 62)

    def test_facade_base_follows_the_real_glass(self):
        for south in (False, True):
            face = np.asarray(self.B.GL.face(96, facade=True, south=south))
            base = self.B.facade_base(south)
            self.assertTrue((face[base - 1, :, 3] >= self.B.FACE_OPAQUE).any(), south)
            self.assertFalse((face[base:, :, 3] >= self.B.FACE_OPAQUE).any(), south)

    def test_behind_reads_the_floor_that_lies_at_a_row_and_looks_through_a_rug(self):
        laid = [('hall', 0, 0, 256, 100), ('room', 64, 0, 160, 100), ('rug-tile', 96, 0, 128, 100), ('cafe', 160, 0, 192, 40)]
        runs = self.B.behind(laid, 32, 224, 50)
        self.assertEqual(runs, [('hall', 32, 64), ('room', 64, 160), ('hall', 160, 224)])
        self.assertEqual(self.B.behind(laid, 32, 224, 20), [('hall', 32, 64), ('room', 64, 160), ('cafe', 160, 192), ('hall', 192, 224)])
        self.assertEqual(self.B.behind(laid, 40, 70, 50)[0][1], 40)           # the first run starts where the glass does

    def test_the_south_facade_shows_no_lawn_down_to_the_face_base_and_the_lawn_starts_there(self):
        T = 32
        row = self.B.P.BY1
        base = row * T + self.B.facade_base(south=True)
        for x0, x1 in self.glass_spans(row):
            region = self.px[row * T:base, x0:x1]
            on_lawn = np.array([[tuple(region[y, x]) == self.lawn(x0 + x, row * T + y) for x in range(0, x1 - x0, 7)]
                                for y in range(0, base - row * T, 5)])
            self.assertFalse(on_lawn.any(), (x0, x1))
            for y in range(base, (row + 2) * T + 2):                 # the rail's own soft shadow falls on lawn, not on a beige strip
                self.assertEqual(tuple(self.px[y, x0 + 3]), self.lawn(x0 + 3, y), (x0, y))

    def test_the_south_facade_continues_the_floor_of_the_row_above_it(self):
        """A floor pattern repeats every 64 px or less, so a pixel of the facade's cell equals the pixel 64 px above it when the same floor
        lies there; a rug (its pattern ends where the rug does) is looked through and left out of the comparison."""
        T = 32
        P = self.B.P
        row = P.BY1
        rugs = [(l * T, (r + 1) * T) for kind, l, t, r, b in P.ZONES if kind == 'rug-tile']
        checked = 0
        for x0, x1 in self.glass_spans(row):
            for x in range(x0 + 5, x1, 13):
                if any(a <= x < b for a, b in rugs) or abs(x - (P.AXIS + 0.5) * T) < 3 * T:    # a rug; the entrance (the hall's)
                    continue
                for y in (row * T + 1, row * T + 20, row * T + self.B.facade_base(south=True) - 1):
                    self.assertEqual(tuple(self.px[y, x]), tuple(self.px[y - 64, x]), (x, y))
                    checked += 1
        self.assertGreater(checked, 100)

    def test_a_north_facade_cell_that_is_lawn_down_to_the_face_base_is_a_lawn_cell_and_keeps_its_tufts(self):
        """The first try of N10 made the lower cells of the north facade half lawn, half floor, and lawn decor is placed on cells that equal
        the lawn tile: 12 tufts and flower clumps behind the north glass vanished, and with them 19 of the lawn's 179 swaying tufts."""
        T = 32
        row, B = self.B.P.BY0, self.B
        tail = B.north_facade_tail()
        base = B.facade_base(south=False)
        cells = {(x // T + k, row + 1) for x0, x1 in self.glass_spans(row) for x in (x0,) for k in range((x1 - x0) // T)}
        grass = B.floor_tile('lawn')
        n = grass.width // T
        if base == 2 * T:                # the glass face runs to the end of its cell (glass.py today): whole lawn cells, no tail to keep
            self.assertEqual(tail, {})
            for tx, ty in cells:
                self.assertEqual(B.lawn_rows(self.floors, grass, n, tx, ty, tail), T, (tx, ty))
        else:                            # a shorter face: the lawn is the cell's leading rows and the room's floor the rest
            self.assertEqual(set(tail), cells)
            self.assertEqual(set(tail.values()), {base - T})
            for tx, ty in cells:
                self.assertEqual(B.lawn_rows(self.floors, grass, n, tx, ty, tail), base - T, (tx, ty))     # a lawn cell, as before the change
                self.assertNotEqual(B.lawn_rows(self.floors, grass, n, tx, ty, {}), T, (tx, ty))           # and a mixed cell to the old rule
        tx = next(iter(cells))[0]
        self.assertEqual(B.lawn_rows(self.floors, grass, n, tx, row + 3, tail), 0)                     # the room's floor under the facade never is

    def test_the_north_facade_shows_the_lawn_behind_it_and_the_room_floor_from_its_base(self):
        T = 32
        row = self.B.P.BY0
        base = row * T + self.B.facade_base(south=False)
        for x0, x1 in self.glass_spans(row):
            for x in range(x0 + 3, x1, 11):
                self.assertEqual(tuple(self.px[base - 1, x]), self.lawn(x, base - 1), (x, base - 1))
                for y in range(base, (row + 2) * T):
                    self.assertNotEqual(tuple(self.px[y, x]), self.lawn(x, y), (x, y))


if __name__ == '__main__':
    unittest.main()
