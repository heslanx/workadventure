"""Behaviour tests of tools/kinds.py (the stand / top / hang / floor rule and the painted-shadow rule), of the floor-piece
exclusion in tools/normals.py (a rug gets no relief), of the normals profiles, and of the office.kinds check of tools/verify.py.
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_kinds.py
Every test builds its own small map in a temporary directory; the tests that run spritefusion-sprite-normals are skipped, with
the reason, on a host that lacks the pinned tool, and the rest need no external tool (the `legacy` method).
`BuiltKinds` runs only with KONCLUI_DIST set (a built map: hq-office/build.py --out DIR)."""
import json
import os
import re
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
import kinds as K  # noqa: E402
import normals as N  # noqa: E402
import toolchain as TC  # noqa: E402
import verify as V  # noqa: E402

TOOL_OK = TC.problem('sprite-normals') is None
NEEDS_TOOL = unittest.skipUnless(TOOL_OK, 'spritefusion-sprite-normals is missing; python3 -I tools/toolchain.py status prints '
                                          'the install command')

# The cases of the lighting plan's contract (section 1c): the runtime lane's casterKind tests run the same rows verbatim.
PLAN_CASES = [
    ('Costela-de-adão grande', 'stand'), ('Tapete de lã 10×5', 'floor'), ('Carpete navy da sala de jogos', 'floor'),
    ('Grama em vaso (sobre móvel)', 'top'), ('Quadro: a equipe', 'hang'), ('Luminária pendente', 'hang'),
    ('TV de parede', 'hang'), ('iMac (sobre móvel)', 'top'), ('Luminária de arco com cúpula', 'stand'),
    ('Sofá de três lugares', 'stand'), ('Vaso de parede pequeno', 'hang'), ('Relógio de parede minimalista', 'hang'),
    ('Painéis acústicos hexagonais', 'hang'), ('Prateleira flutuante com livros', 'hang'),
    # added after the review of 2026-11-23: a computer is on its desk by its name, a picture of one is still a picture
    ('Computador iMac', 'top'), ('Quadro: Koru no notebook', 'hang'),
]


class Classifier(unittest.TestCase):
    def test_the_fourteen_cases_of_the_plan(self):
        for name, kind in PLAN_CASES:
            self.assertEqual(K.classify(name), kind, name)

    def test_costela_is_not_a_hanging_piece_and_the_old_unanchored_tela_is_what_matched_it(self):
        old = re.compile(r'tela', re.I)                        # fx.py FLAT's unanchored word
        self.assertTrue(old.search('Costela-de-adão (monstera)'), 'the bug this rule fixes')
        self.assertEqual(K.classify('Costela-de-adão (monstera)'), 'stand')
        self.assertFalse(K.HANG_RE.search('Costela-de-adão (monstera)'))

    def test_words_are_whole_words_never_substrings(self):
        self.assertEqual(K.classify('Estande tvz'), 'stand')                 # "tv" inside a word
        self.assertEqual(K.classify('Pisoteador'), 'stand')                  # "piso" inside a word
        self.assertEqual(K.classify('Mesa de TV'), 'hang')                   # the same word alone
        self.assertEqual(K.classify('Capacho (grande)'), 'floor')            # punctuation is a boundary

    def test_the_order_of_the_rules_decides_the_overlaps(self):
        self.assertEqual(K.classify('Grama em vaso (sobre móvel)'), 'top')   # top before the floor word "grama"
        self.assertEqual(K.classify('Quadro: tapete', tags=['Decoração de parede']), 'hang')
        self.assertEqual(K.classify('Quadro decorativo', depth_offset=-100), 'floor')    # floor by depth before hang
        self.assertEqual(K.classify('Relógio (sobre móvel)'), 'top')          # top before hang
        self.assertEqual(K.classify('Tapete (sobre móvel)'), 'top')           # a mat on a table is a top piece

    def test_the_floor_by_tag_depth_and_folder(self):
        self.assertEqual(K.classify('Peça', tags=['Tapetes e pisos']), 'floor')
        self.assertEqual(K.classify('Peça', depth_offset=-100), 'floor')
        self.assertEqual(K.classify('Peça', depth_offset=-99), 'stand')
        self.assertEqual(K.classify('Peça', path='mobilia/sprites/floors/x.png'), 'floor')
        self.assertEqual(K.classify('Tapete de entrada com o K', depth_offset=-160), 'floor')

    def test_the_hang_by_tag_and_folder(self):
        for folder in ('walldecor', 'walls', 'doors'):
            self.assertEqual(K.classify('Peça', path=f'mobilia/sprites/{folder}/x.png'), 'hang', folder)
        self.assertEqual(K.classify('Peça', tags=['Decoração de parede']), 'hang')
        self.assertEqual(K.classify('Peça', path='mobilia/sprites/walldecoration/x.png'), 'stand')   # a whole folder name

    def test_the_tag_of_screens_does_not_make_a_monitor_hang(self):
        self.assertEqual(K.classify('Monitor ultrawide', tags=['Tecnologia e telas']), 'stand')

    def test_an_unknown_prefab_with_a_floor_depth_becomes_floor(self):
        self.assertEqual(K.classify('Peça nova do editor', depth_offset=-200), 'floor')

    def test_a_missing_name_or_tags_does_not_raise(self):
        self.assertEqual(K.classify(None, None, None, None), 'stand')


def picture(h=20, w=10, foot_shadow=0, alpha=40, colour=(10, 10, 61), solid_rows=(0, 16), shadow_rows=None):
    """An RGBA picture: an opaque block over `solid_rows`, then `foot_shadow` partial-alpha pixels (on row `shadow_rows[0]`
    onward, left to right) of `colour` at `alpha`."""
    px = np.zeros((h, w, 4), np.uint8)
    px[solid_rows[0]:solid_rows[1], 1:9] = (200, 120, 60, 255)
    rows = shadow_rows or (solid_rows[1],)
    left = foot_shadow
    for y in rows:
        for x in range(w):
            if left:
                px[y, x] = (*colour, alpha)
                left -= 1
    return px


class Painted(unittest.TestCase):
    def test_six_dark_partial_pixels_under_the_foot_are_a_painted_shadow_and_five_are_not(self):
        self.assertTrue(K.painted_shadow(picture(foot_shadow=6)))
        self.assertFalse(K.painted_shadow(picture(foot_shadow=5)))

    def test_a_pool_of_light_is_not_a_shadow(self):
        self.assertFalse(K.painted_shadow(picture(foot_shadow=8, colour=(255, 240, 160), alpha=90)))

    def test_a_dark_pixel_under_the_solid_alpha_is_a_shadow_and_from_it_is_the_piece(self):
        self.assertTrue(K.painted_shadow(picture(foot_shadow=8, alpha=128)))        # the lounge's painted rows are 128 to 166
        self.assertTrue(K.painted_shadow(picture(foot_shadow=8, alpha=K.SOLID_ALPHA - 1)))
        self.assertFalse(K.painted_shadow(picture(foot_shadow=8, alpha=K.SOLID_ALPHA)))

    def test_partial_pixels_in_the_bottom_quarter_of_the_silhouette_count(self):
        # silhouette rows 0..15 (16 rows): the bottom quarter is rows 12..15
        inside = picture(foot_shadow=6, shadow_rows=(13,))
        inside[16:] = 0
        self.assertTrue(K.painted_shadow(inside))
        above = picture(foot_shadow=6, shadow_rows=(11,))
        self.assertFalse(K.painted_shadow(above))

    def test_a_picture_without_a_solid_pixel_is_not_painted(self):
        px = np.zeros((10, 10, 4), np.uint8)
        px[8, :] = (10, 10, 61, 40)
        self.assertFalse(K.painted_shadow(px))

    def test_the_numbers_of_the_rule(self):
        self.assertEqual((K.PAINTED_MIN_PX, K.PAINTED_ALPHA_BELOW, K.PAINTED_DARK_BELOW, K.PAINTED_BOTTOM),
                         (6, 200, 128, 0.25))


SHAPE_CASES = json.loads((SOURCE.parents[2] / 'play/src/front/Konclui/Ambience/domain/__fixtures__/shade-shapes-cases.json').read_text())


def fixture_picture(rows):
    tokens = SHAPE_CASES['tokens']
    return np.array([[tokens[ch] for ch in row] for row in rows], np.uint8)


class SharedPictureCases(unittest.TestCase):
    """The runtime's shadeShapes.test.ts runs the same rows: the same top, foot and painted answer on the same pixels."""

    def test_every_case_gives_the_runtimes_answer(self):
        for case in SHAPE_CASES['cases']:
            px = fixture_picture(case['rows'])
            self.assertEqual(K.silhouette_rows(px[..., 3]), (case['top'], case['foot']), case['name'])
            self.assertEqual(K.painted_shadow(px), case['painted'], case['name'])


class ManifestContract(unittest.TestCase):
    def test_a_manifest_with_neither_key_is_an_older_build_and_conforms(self):
        self.assertEqual(K.manifest_problems({}), [])

    def test_a_conforming_pair_has_no_problem(self):
        self.assertEqual(K.manifest_problems({'kinds': {'a': 'stand', 'b': 'top', 'c': 'floor'}, 'painted': ['a', 'b']}), [])

    def test_an_unknown_kind_is_named(self):
        problems = K.manifest_problems({'kinds': {'a': 'wall'}})
        self.assertEqual(len(problems), 1)
        self.assertIn("'a'", problems[0])

    def test_painted_may_list_only_stand_or_top_pieces(self):
        problems = K.manifest_problems({'kinds': {'a': 'hang', 'b': 'floor', 'c': 'stand'}, 'painted': ['a', 'b', 'c', 'zzz']})
        self.assertIn('3 painted keys are not stand or top', problems[0])

    def test_painted_without_kinds_fails_and_a_duplicate_key_fails(self):
        self.assertTrue(K.manifest_problems({'painted': ['a']}))
        self.assertTrue(any('twice' in p for p in K.manifest_problems({'kinds': {'a': 'stand'}, 'painted': ['a', 'a']})))


# ------------------------------------------------------------------------------------------------------ a small map

MAP = (96, 64)


def png(path, pixels):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, 'RGBA').save(path)


def block(w, h, colour):
    px = np.zeros((h, w, 4), np.uint8)
    px[...] = (*colour, 255)
    return px


PREFABS = {  # id: (name, tags, depthOffset, picture, (x, y))
    'rug': ('Tapete de lã 5×3', ['Tapetes e pisos'], -192, block(48, 32, (150, 90, 90)), (10, 10)),
    'chair': ('Cadeira simples', ['Cadeiras e bancos'], 0, block(12, 16, (60, 90, 160)), (20, 14)),      # on the rug
    'frame': ('Quadro: a equipe', ['Peças da marca'], -1, block(16, 12, (200, 200, 60)), (70, 4)),
    'mug': ('Caneca (sobre móvel)', ['Comidas e bebidas'], -20, block(6, 6, (230, 230, 230)), (74, 40)),
}


def make_dist(root, with_kinds=True, painted=()):
    """A map with a rug, a chair standing on the rug, a frame, a mug on a table: the collection, the wam, the manifest."""
    dist = Path(root) / 'dist'
    entries = []
    for pid, (name, tags, depth, pixels, _) in PREFABS.items():
        png(dist / 'entities' / 'col' / f'{pid}.png', pixels)
        entries.append({'id': pid, 'name': name, 'tags': tags, 'imagePath': f'{pid}.png', 'depthOffset': depth})
    (dist / 'entities' / 'col' / 'collection.json').write_text(json.dumps({'collectionName': 'col', 'collection': entries}))
    (dist / 'seats').mkdir()
    (dist / 'tilesets').mkdir()
    (dist / 'office.tmj').write_text('{}')
    (dist / 'office.wam').write_text(json.dumps({'entities': {
        f'e-{pid}': {'x': x, 'y': y, 'prefabRef': {'collectionName': 'col', 'id': pid}}
        for pid, (*_, (x, y)) in PREFABS.items()}}))
    (dist / 'fx').mkdir()
    manifest = {'map': list(MAP), 'normal': True, 'shadows': {}}
    if with_kinds:
        manifest['kinds'] = K.kinds_of(dist)
        manifest['painted'] = list(painted)
    (dist / 'fx' / 'manifest.json').write_text(json.dumps(manifest))
    return dist


class Entries(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='test-kinds-')
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def test_the_kinds_of_the_small_map(self):
        dist = make_dist(self.tmp)
        self.assertEqual(K.kinds_of(dist), {'col/chair.png': 'stand', 'col/frame.png': 'hang', 'col/mug.png': 'top',
                                            'col/rug.png': 'floor'})

    def test_a_picture_shared_by_prefabs_that_disagree_is_an_error(self):
        dist = make_dist(self.tmp)
        path = dist / 'entities' / 'col' / 'collection.json'
        doc = json.loads(path.read_text())
        doc['collection'].append({'id': 'rug2', 'name': 'Tapete de lã 5×3', 'tags': [], 'imagePath': 'chair.png',
                                  'depthOffset': -200})                    # the chair's picture, as a floor piece
        path.write_text(json.dumps(doc))
        wam = json.loads((dist / 'office.wam').read_text())
        wam['entities']['e-rug2'] = {'x': 0, 'y': 0, 'prefabRef': {'collectionName': 'col', 'id': 'rug2'}}
        (dist / 'office.wam').write_text(json.dumps(wam))
        with self.assertRaises(ValueError) as caught:
            K.kinds_of(dist)
        self.assertIn('one picture, one kind', str(caught.exception))

    def test_a_picture_shared_by_prefabs_of_one_kind_is_one_key(self):
        dist = make_dist(self.tmp)
        path = dist / 'entities' / 'col' / 'collection.json'
        doc = json.loads(path.read_text())
        doc['collection'].append({'id': 'chair2', 'name': 'Cadeira simples', 'tags': ['Cadeiras e bancos'],
                                  'imagePath': 'chair.png', 'depthOffset': -3})
        path.write_text(json.dumps(doc))
        wam = json.loads((dist / 'office.wam').read_text())
        wam['entities']['e-chair2'] = {'x': 0, 'y': 0, 'prefabRef': {'collectionName': 'col', 'id': 'chair2'}}
        (dist / 'office.wam').write_text(json.dumps(wam))
        self.assertEqual(len(K.placed_entries(dist)['col/chair.png']), 2)
        self.assertEqual(K.kinds_of(dist)['col/chair.png'], 'stand')


class FloorNormals(unittest.TestCase):
    """tools/normals.py: a floor piece is not stamped, so a rug gets no relief."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='test-kinds-')
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def texture(self, dist, method='legacy', **kw):
        image, used = N.compose(dist, method, **kw)
        return np.asarray(image), used

    def test_the_rug_pixels_stay_flat_nothing_and_the_others_get_a_normal(self):
        n, _ = self.texture(make_dist(self.tmp))
        rug = n[10:42, 10:58]
        flat = np.array(N.FLAT, np.uint8)
        chair = (slice(14, 30), slice(20, 32))
        outside_chair = np.ones(rug.shape[:2], bool)
        outside_chair[4:20, 10:22] = False                  # the chair stands on the rug: its pixels are the chair's
        self.assertTrue((rug[outside_chair] == flat).all(), 'a floor piece leaves its rect flat')
        self.assertTrue((n[chair][..., 3] == 255).all(), 'the chair keeps its normal on top of the rug')
        self.assertTrue((n[4:16, 70:86][..., 3] == 255).all(), 'a hanging piece is still stamped')

    def test_without_kinds_in_the_manifest_the_rug_is_stamped_as_before(self):
        dist = make_dist(self.tmp, with_kinds=False)
        n, _ = self.texture(dist)
        self.assertTrue((n[10:14, 10:58][..., 3] == 255).all())
        self.assertEqual(N.floor_sprites(dist), set())

    def test_floor_sprites_are_spelled_as_placed_spells_them(self):
        dist = make_dist(self.tmp)
        floor = N.floor_sprites(dist)
        self.assertEqual(len(floor), 1)
        self.assertEqual({p for _, _, p, _ in N.placed(dist)} & floor, floor)

    def test_the_tool_is_not_run_on_a_floor_piece(self):
        dist = make_dist(self.tmp)
        seen = []
        real = N.tool_normals

        def spy(sprites, profile=N.DOMED, pieces=None, standing=None):
            seen.extend(sorted(Path(p).name for p in sprites))
            return {p: N.legacy_normal(N.geometry(N.PG.load_rgba(p))) for p in sprites}

        with mock.patch.object(N, 'resolve_method', lambda m: 'tool'), mock.patch.object(N, 'tool_normals', spy):
            N.compose(dist)
        self.assertEqual(seen, ['chair.png', 'frame.png', 'mug.png'])
        self.assertIs(N.tool_normals, real)

    @NEEDS_TOOL
    def test_two_runs_write_the_same_bytes_and_the_tool_leaves_the_rug_flat(self):
        dist = make_dist(self.tmp)
        a, b = self.tmp / 'a.png', self.tmp / 'b.png'
        N.write(dist, a, 'tool')
        N.write(dist, b, 'tool')
        self.assertEqual(a.read_bytes(), b.read_bytes())
        n = np.asarray(Image.open(a).convert('RGBA'))
        self.assertTrue((n[10:14, 10:58] == np.array(N.FLAT, np.uint8)).all())     # the rug's top rows, clear of the chair
        with Image.open(a) as written:
            self.assertEqual(written.info[N.PROFILE_KEY], N.DOMED)


class Profiles(unittest.TestCase):
    def test_the_size_classes(self):
        self.assertEqual([N.shape_radius(s) for s in (1, 47, 48, 95, 96, 400)], [4.0, 4.0, 10.0, 10.0, 20.0, 20.0])

    def test_the_longest_side_of_the_opaque_box(self):
        mask = np.zeros((40, 40), bool)
        mask[5:15, 3:30] = True
        self.assertEqual(N.longest_side(mask), 27)
        self.assertEqual(N.longest_side(np.zeros((4, 4), bool)), 0)

    def test_the_flags_of_a_domed_sprite_and_none_for_plain(self):
        self.assertEqual(N.tool_flags(N.DOMED, 60), ['--shape-radius', '10', '--shape-strength', '1.4',
                                                     '--normal-strength', '2'])
        self.assertEqual(N.tool_flags(N.PLAIN, 60), [])

    def test_the_tool_is_run_once_per_size_class_with_that_class_flags_and_stable_file_names(self):
        tmp = tempfile.TemporaryDirectory(prefix='test-kinds-')
        self.addCleanup(tmp.cleanup)
        paths = {}
        for name, size in (('small', 20), ('mid', 60), ('big', 120), ('small2', 30)):
            paths[name] = Path(tmp.name) / f'{name}.png'
            png(paths[name], block(size, size, (90, 90, 90)))
        commands = []

        def run(command, **kwargs):
            commands.append(command)
            out = Path(command[command.index('--output-dir') + 1])
            out.mkdir(parents=True, exist_ok=True)
            for f in command[1:command.index('--output-dir')]:
                Image.open(f).save(out / (Path(f).stem + '_n.png'))
            return mock.Mock(returncode=0, stderr='')

        with mock.patch.object(N.subprocess, 'run', run), mock.patch.object(N.PG, 'tool_path', lambda *a: 'tool'):
            made = N.tool_normals({str(p) for p in paths.values()})
        self.assertEqual(len(commands), 3)
        radius = {c[c.index('--shape-radius') + 1]: sorted(Path(f).name for f in c[1:c.index('--output-dir')]) for c in commands}
        # the files are numbered by the sorted order of the sprites: big 0, mid 1, small 2, small2 3
        self.assertEqual(radius, {'4': ['00002.png', '00003.png'], '10': ['00001.png'], '20': ['00000.png']})
        self.assertEqual(len(made), 4)
        with mock.patch.object(N.subprocess, 'run', run), mock.patch.object(N.PG, 'tool_path', lambda *a: 'tool'):
            commands.clear()
            N.tool_normals({str(p) for p in paths.values()}, N.PLAIN)
        self.assertEqual(len(commands), 1)
        self.assertNotIn('--shape-radius', commands[0])

    def test_an_unknown_profile_is_refused(self):
        with self.assertRaises(SystemExit):
            N.tool_normals(set(), 'round')

    def test_the_relief_of_a_piece_by_its_kind_tags_and_light(self):
        P = K.relief_profile
        self.assertEqual(P('floor', ['Plantas']), 'none')
        self.assertEqual(P('stand', ['Luminárias'], 'arc'), 'flat')           # a lamp is the light: it takes none
        self.assertEqual(P('top', [], 'desk'), 'flat')
        self.assertEqual(P('stand', ['Sofás e poltronas']), 'domed')
        self.assertEqual(P('stand', ['Plantas']), 'domed')
        self.assertEqual(P('stand', ['Mesas']), 'bevel')                      # a desk top folded into four triangles when domed
        self.assertEqual(P('stand', ['Jogos e lazer']), 'bevel')
        self.assertEqual(P('hang', ['Decoração de parede']), 'bevel')         # a picture got an X
        self.assertEqual(P('top', ['Plantas']), 'bevel')                      # a piece on furniture is small: an edge is all it has
        self.assertEqual(P('stand', []), 'bevel')
        self.assertEqual(P('stand', ['Tecnologia e telas'], 'screen'), 'bevel')   # a screen is not a lamp

    def test_a_bevel_piece_has_the_radius_of_an_edge_at_any_size_and_a_flat_piece_never_runs_the_tool(self):
        self.assertEqual(N.tool_flags(N.DOMED, 120, 'bevel')[:2], ['--shape-radius', '4'])
        self.assertEqual(N.tool_flags(N.DOMED, 120, 'domed')[:2], ['--shape-radius', '20'])
        tmp = tempfile.TemporaryDirectory(prefix='test-kinds-')
        self.addCleanup(tmp.cleanup)
        paths = {}
        for name in ('sofa', 'desk', 'lamp'):
            paths[name] = str(Path(tmp.name) / f'{name}.png')
            png(Path(paths[name]), block(120, 120, (90, 90, 90)))
        commands = []

        def run(command, **kwargs):
            commands.append(command)
            out = Path(command[command.index('--output-dir') + 1])
            out.mkdir(parents=True, exist_ok=True)
            for f in command[1:command.index('--output-dir')]:
                Image.open(f).save(out / (Path(f).stem + '_n.png'))
            return mock.Mock(returncode=0, stderr='')

        pieces = {paths['sofa']: 'domed', paths['desk']: 'bevel', paths['lamp']: 'flat'}
        with mock.patch.object(N.subprocess, 'run', run), mock.patch.object(N.PG, 'tool_path', lambda *a: 'tool'):
            made = N.tool_normals(set(paths.values()), N.DOMED, pieces)
        radius = sorted(c[c.index('--shape-radius') + 1] for c in commands)
        self.assertEqual(radius, ['20', '4'])                                  # the lamp is in no run
        self.assertEqual(sum(len(c[1:c.index('--output-dir')]) for c in commands), 2)
        lamp = made[paths['lamp']]
        self.assertTrue((lamp[..., :3] == np.array(N.FLAT[:3], np.uint8)).all())
        self.assertTrue((lamp[..., 3] == 255).all())                           # a prop, with the flat normal: it is lit, it shades none

    # Seen failing (review of 2026-11-23): the tool's relief on a tree's canopy, a bean bag and a planter came out as facets, and the
    # lighting's bands cut them into hard-edged triangles with straight creases ('low-poly'). A domed piece is averaged over its solid
    # pixels so that the step between two neighbouring normals, which is what a crease is, is smaller.
    def _facets(self, size=40):
        n = np.zeros((size, size, 4), np.uint8)
        n[...] = N.FLAT
        solid = np.ones((size, size), bool)
        half = size // 2
        for (ys, xs, rgb) in ((slice(0, half), slice(0, half), (30, 128, 200)), (slice(0, half), slice(half, size), (226, 128, 200)),
                              (slice(half, size), slice(0, half), (128, 30, 200)), (slice(half, size), slice(half, size), (128, 226, 200))):
            n[ys, xs, :3] = rgb
        n[..., 3] = 255
        return n, solid

    @staticmethod
    def _largest_step(n, solid):
        v = n[..., :3].astype(float) / 255 * 2 - 1
        steps = []
        for axis in (0, 1):
            a = v[:-1] if axis == 0 else v[:, :-1]
            b = v[1:] if axis == 0 else v[:, 1:]
            both = (solid[:-1] & solid[1:]) if axis == 0 else (solid[:, :-1] & solid[:, 1:])
            steps.append(np.linalg.norm(a - b, axis=-1)[both].max())
        return max(steps)

    def test_smoothing_a_domed_pieces_normals_shrinks_the_step_across_a_crease_and_keeps_its_shape(self):
        n, solid = self._facets()
        before = self._largest_step(n, solid)
        out = N.smooth(n, solid, 3)
        self.assertLess(self._largest_step(out, solid), before * 0.45)
        self.assertTrue((out[..., 3] == n[..., 3]).all())                       # the alpha is the piece's, untouched
        norms = np.linalg.norm(out[..., :3].astype(float) / 255 * 2 - 1, axis=-1)
        self.assertTrue(np.allclose(norms, 1, atol=0.03))                       # still unit normals (to a byte)
        self.assertTrue((N.smooth(n, solid, 3) == out).all())                   # deterministic
        self.assertTrue((N.smooth(n, solid, 0) == n).all())                     # no passes, no change

    def test_smoothing_never_reads_or_writes_a_pixel_outside_the_piece(self):
        n, solid = self._facets(20)
        solid[:, 10:] = False
        n[:, 10:, 3] = 0
        n[:, 10:, :3] = (7, 9, 11)                                               # something that would show if it leaked in
        out = N.smooth(n, solid, 3)
        self.assertTrue((out[:, 10:] == n[:, 10:]).all())

    def test_the_passes_grow_with_the_size_class(self):
        self.assertEqual([N.smooth_passes(s) for s in (1, 47, 48, 95, 96, 400)], [1, 1, 2, 2, 3, 3])

    def test_only_a_domed_piece_is_smoothed_by_tool_normals(self):
        tmp = tempfile.TemporaryDirectory(prefix='test-kinds-')
        self.addCleanup(tmp.cleanup)
        paths = {}
        for name in ('canopy', 'desk'):
            paths[name] = str(Path(tmp.name) / f'{name}.png')
            png(Path(paths[name]), block(100, 100, (90, 90, 90)))
        facets, _ = self._facets(100)

        def run(command, **kwargs):
            out = Path(command[command.index('--output-dir') + 1])
            out.mkdir(parents=True, exist_ok=True)
            for f in command[1:command.index('--output-dir')]:
                Image.fromarray(facets, 'RGBA').save(out / (Path(f).stem + '_n.png'))
            return mock.Mock(returncode=0, stderr='')

        pieces = {paths['canopy']: 'domed', paths['desk']: 'bevel'}
        with mock.patch.object(N.subprocess, 'run', run), mock.patch.object(N.PG, 'tool_path', lambda *a: 'tool'):
            made = N.tool_normals(set(paths.values()), N.DOMED, pieces)
            plain = N.tool_normals({paths['canopy']}, N.PLAIN, {paths['canopy']: 'domed'})
        solid = np.ones((100, 100), bool)
        self.assertLess(self._largest_step(made[paths['canopy']], solid), self._largest_step(facets, solid) * 0.45)
        # the slab keeps the tool's direction at its edge (only the inside is made flat, and the lean is capped at N.EDGE_LEAN) and the
        # plain profile does not smooth at all
        edge = made[paths['desk']][:4]
        want = facets[:4, :, :3].astype(float) / 255 * 2 - 1
        got = edge[..., :3].astype(float) / 255 * 2 - 1
        lean_want, lean_got = np.hypot(want[..., 0], want[..., 1]), np.hypot(got[..., 0], got[..., 1])
        self.assertTrue((lean_got <= N.EDGE_LEAN + 0.01).all())
        leaning = lean_want > 0.05
        self.assertTrue((np.sign(got[..., 0][leaning]) == np.sign(want[..., 0][leaning])).all())
        self.assertTrue((plain[paths['canopy']][..., :3] == facets[..., :3]).all())

    def test_a_slab_is_flat_inside_its_edge_and_the_tool_does_not_read_its_painted_wash(self):
        # Seen failing: the tool's --shape-radius is a long fall-off, not a bevel (a 4 px radius left 0 of 2240 px of a plain
        # rectangle flat), and its --detail-strength reads a painted light-to-dark wash as relief: the air hockey's playfield
        # came out as a four-faced roof and the lab showed folded sheets. A bevel piece keeps the tool's normal for its
        # N.BEVEL_PX edge only, and the tool is told not to read the picture's shading.
        flags = N.tool_flags(N.DOMED, 120, 'bevel')
        self.assertEqual(flags[flags.index('--detail-strength') + 1], '0')
        self.assertNotIn('--detail-strength', N.tool_flags(N.DOMED, 120, 'domed'))
        mask = np.zeros((20, 30), bool)
        mask[2:18, 3:27] = True
        kept = N.inside(mask, 4)
        self.assertEqual(int(kept.sum()), (16 - 8) * (24 - 8))                 # 4 px off every side
        self.assertFalse(kept[2:6].any() or kept[14:18].any() or kept[:, 3:7].any() or kept[:, 23:27].any())
        self.assertFalse(N.inside(np.ones((6, 6), bool), 4).any())             # a piece under 8 px has no inside
        tmp = tempfile.TemporaryDirectory(prefix='test-kinds-')
        self.addCleanup(tmp.cleanup)
        paths = {name: str(Path(tmp.name) / f'{name}.png') for name in ('desk', 'sofa')}
        for path in paths.values():
            png(Path(path), block(40, 30, (90, 60, 30)))

        def run(command, **kwargs):
            out = Path(command[command.index('--output-dir') + 1])
            out.mkdir(parents=True, exist_ok=True)
            for f in command[1:command.index('--output-dir')]:
                Image.open(f).save(out / (Path(f).stem + '_n.png'))      # a picture that is nowhere flat
            return mock.Mock(returncode=0, stderr='')

        with mock.patch.object(N.subprocess, 'run', run), mock.patch.object(N.PG, 'tool_path', lambda *a: 'tool'):
            made = N.tool_normals(set(paths.values()), N.DOMED, {paths['desk']: 'bevel', paths['sofa']: 'domed'})
        desk, sofa = made[paths['desk']], made[paths['sofa']]
        flat = np.array(N.FLAT[:3], np.uint8)
        self.assertTrue((desk[10:20, 10:30, :3] == flat).all())                # the inside of the slab: flat, a prop (alpha 255)
        self.assertTrue((desk[10:20, 10:30, 3] == 255).all())
        self.assertFalse((desk[0:3, :, :3] == flat).all(axis=-1).any())        # its edge keeps what the tool made
        self.assertFalse((sofa[..., :3] == flat).all(axis=-1).any())           # a soft furnishing is not touched

    def test_piece_profiles_read_the_manifest_the_prefab_tags_and_the_lights(self):
        tmp = tempfile.TemporaryDirectory(prefix='test-kinds-')
        self.addCleanup(tmp.cleanup)
        dist = make_dist(Path(tmp.name))
        manifest = json.loads((dist / 'fx' / 'manifest.json').read_text())
        profiles = N.piece_profiles(dist, manifest)
        self.assertEqual(len(profiles), len([k for k, v in manifest['kinds'].items() if v != 'floor']))
        self.assertTrue(set(profiles.values()) <= {'flat', 'bevel', 'box', 'domed'})
        self.assertEqual(N.piece_profiles(dist, {'kinds': None}), {})          # an older build: every piece is domed, as before


class KindsCheck(unittest.TestCase):
    """tools/verify.py office.kinds, and the floor exclusion in office.normals."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='test-kinds-')
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def manifest(self, dist, **change):
        path = dist / 'fx' / 'manifest.json'
        m = json.loads(path.read_text())
        for k, v in change.items():
            if v is None:
                m.pop(k, None)
            else:
                m[k] = v
        path.write_text(json.dumps(m))
        return m

    def test_a_conforming_manifest_passes_with_the_counts(self):
        result = V.kinds_result(make_dist(self.tmp))
        self.assertEqual(result.status, V.PASS, result.detail)
        self.assertEqual((result.data['stand'], result.data['top'], result.data['hang'], result.data['floor']), (1, 1, 1, 1))

    def test_a_manifest_with_neither_key_is_reported_not_failed(self):
        self.assertEqual(V.kinds_result(make_dist(self.tmp, with_kinds=False)).status, V.REPORTED)

    def test_a_kind_that_differs_from_the_rule_fails_naming_the_sprite(self):
        dist = make_dist(self.tmp)
        m = json.loads((dist / 'fx' / 'manifest.json').read_text())
        m['kinds']['col/rug.png'] = 'stand'                    # the rug stamped as a standing piece: it would get relief
        self.manifest(dist, kinds=m['kinds'])
        result = V.kinds_result(dist)
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('col/rug.png', result.detail)

    def test_a_placed_sprite_without_a_kind_and_a_kind_without_a_sprite_fail(self):
        dist = make_dist(self.tmp)
        kinds = json.loads((dist / 'fx' / 'manifest.json').read_text())['kinds']
        del kinds['col/mug.png']
        kinds['col/ghost.png'] = 'stand'
        self.manifest(dist, kinds=kinds)
        lines = '\n'.join(V.kinds_result(dist).lines)
        self.assertIn('have no kind', lines)
        self.assertIn('are not placed sprites', lines)

    def test_a_standing_picture_with_its_own_shadow_must_be_listed_as_painted(self):
        dist = make_dist(self.tmp)
        shadowed = block(12, 16, (60, 90, 160))
        shadowed = np.concatenate([shadowed, np.zeros((4, 12, 4), np.uint8)])
        shadowed[16:18, :6] = (10, 10, 61, 40)
        shadowed[17, 6:12] = (10, 10, 61, 40)
        png(dist / 'entities' / 'col' / 'chair.png', shadowed)
        result = V.kinds_result(dist)
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('painted', result.detail)
        self.manifest(dist, painted=['col/chair.png'])
        self.assertEqual(V.kinds_result(dist).status, V.PASS)

    def test_painted_may_not_list_a_floor_piece(self):
        dist = make_dist(self.tmp, painted=['col/rug.png'])
        self.assertEqual(V.kinds_result(dist).status, V.FAIL)

    def test_the_run_includes_the_check(self):
        dist = make_dist(self.tmp)
        names = [r.name for r in V.run(dist, ['office'])]
        self.assertIn('office.kinds', names)

    def test_a_normal_under_a_floor_piece_fails_office_normals_and_flat_passes(self):
        dist = make_dist(self.tmp)
        image, _ = N.compose(dist, 'legacy')
        from PIL import PngImagePlugin
        info = PngImagePlugin.PngInfo()
        info.add_text(N.METHOD_KEY, 'tool')
        image.save(dist / 'fx' / 'normal.png', pnginfo=info)
        self.assertEqual(V.normals_result(dist, allow_legacy=True).status, V.PASS, V.normals_result(dist).detail)
        stamped = np.asarray(image).copy()
        stamped[12, 12] = (204, 128, 230, 255)                 # a relief pixel on the rug, clear of the chair
        Image.fromarray(stamped, 'RGBA').save(dist / 'fx' / 'normal.png', pnginfo=info)
        result = V.normals_result(dist)
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('not an opaque entity px', result.detail)


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST is unset')
class BuiltKinds(unittest.TestCase):
    """The real build: the plan's fourteen cases on its own names, and the manifest against the rule."""

    def test_the_real_manifest_passes_the_kinds_check_and_leaves_every_floor_piece_flat(self):
        dist = Path(os.environ['KONCLUI_DIST'])
        result = V.kinds_result(dist)
        self.assertEqual(result.status, V.PASS, result.detail)
        self.assertGreater(result.data['floor'], 0)
        self.assertTrue(V.normals_result(dist).status in (V.PASS, V.REPORTED))


if __name__ == '__main__':
    if not os.environ.get('KONCLUI_DIST'):
        print('note: KONCLUI_DIST is unset, so BuiltKinds is SKIPPED; build with `python3 hq-office/build.py --out DIR --renders '
              'DIR2` and rerun with KONCLUI_DIST=DIR')
    unittest.main()
