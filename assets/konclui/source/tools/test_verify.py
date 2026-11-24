"""Behaviour tests of tools/verify.py, the one command that answers "is this build fit to publish".
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_verify.py
Every test builds its own small map (entities, tilesets, fx/normal.png) or sheet folders in a temporary directory and runs
the real check code. The tests that run spritefusion-palette-snapper are skipped, with the install commands, on a host that
lacks a pinned tool; the normals, pixel, toolchain and determinism tests need no external tool. `BuiltMap` runs only with
KONCLUI_DIST set (a built map: hq-office/build.py --out DIR)."""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image, PngImagePlugin

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SOURCE / 'hq-office'))
import normals as N  # noqa: E402
import palettesnap as PS  # noqa: E402
import pixelgrid as PG  # noqa: E402
import toolchain as TC  # noqa: E402
import translucent as TL  # noqa: E402
import verify as V  # noqa: E402
import publish  # noqa: E402

TOOLS_OK = all(TC.problem(name) is None for name in TC.NAMES)
NEEDS_TOOLS = unittest.skipUnless(TOOLS_OK, 'a pinned SpriteFusion tool is missing; python3 -I tools/toolchain.py status '
                                           'prints the install commands')
SPRITE = (10, 20, 30)            # a colour that is not on any locked palette (so the office reports it, as it does)
MAP = (64, 48)
ON_PALETTE = PS.read_palette(PS.PALETTE_DIR / 'office.hex')[0]      # a colour of the office palette
ORIGIN = (10, 6)                 # where the entity sprite stands on the map


def png(path, pixels):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, 'RGBA').save(path)


def block(w, h, colour, box=None):
    px = np.zeros((h, w, 4), np.uint8)
    x0, y0, x1, y1 = box or (0, 0, w, h)
    px[y0:y1, x0:x1] = (*colour, 255)
    return px


def make_normal(dist, covered, stamp='tool', size=MAP, normal=(204, 128, 230)):
    """fx/normal.png the way normals.write lays it out: flat (128, 128, 255, 0) everywhere, `normal` at alpha 255 where
    `covered` is true. The stamp is a text chunk; `stamp` None leaves it out."""
    width, height = size
    canvas = np.zeros((height, width, 4), np.uint8)
    canvas[...] = N.FLAT
    h, w = covered.shape
    canvas[:h, :w][covered] = (*normal, 255)
    info = PngImagePlugin.PngInfo()
    if stamp:
        info.add_text(N.METHOD_KEY, stamp)
    Image.fromarray(canvas, 'RGBA').save(Path(dist) / 'fx' / 'normal.png', pnginfo=info)


def covered_mask():
    """The map-sized mask of the one placed sprite's opaque pixels (a 12 x 12 sprite with an 8 x 8 block at (2, 2))."""
    mask = np.zeros((MAP[1], MAP[0]), bool)
    mask[ORIGIN[1] + 2:ORIGIN[1] + 10, ORIGIN[0] + 2:ORIGIN[0] + 10] = True
    return mask


def pinned_record():
    """The manifest's "tools" record of a build made by exactly the pinned tools (fx.tool_record's shape), from the pins alone."""
    return dict(tools={name: dict(version=pin['version'], pinnedVersion=pin['version'], pinnedCommit=pin['commit'],
                                  sha256='0' * 64, matches=True) for name, pin in TC.TOOLS.items()}, missing=[])


def set_tools(dist, record):
    """Replace the manifest's "tools" entry; None removes the key."""
    path = Path(dist) / 'fx' / 'manifest.json'
    manifest = json.loads(path.read_text())
    manifest.pop('tools', None)
    if record is not None:
        manifest['tools'] = record
    path.write_text(json.dumps(manifest))


def make_dist(root, normal=True, stamp='tool', tools=True):
    """A small conforming map: one entity sprite placed once, one tileset, the manifest (with the record of the pinned tools
    unless `tools` is false) and (by default) a normal map."""
    dist = Path(root) / 'dist'
    png(dist / 'entities' / 'col' / 'a.png', block(12, 12, SPRITE, (2, 2, 10, 10)))
    (dist / 'entities' / 'col' / 'collection.json').write_text(json.dumps(
        {'collectionName': 'col', 'collection': [{'id': 'a', 'name': 'chair', 'imagePath': 'a.png'}]}))
    (dist / 'seats').mkdir()
    png(dist / 'tilesets' / 't.png', block(64, 32, ON_PALETTE))
    (dist / 'office.tmj').write_text('{}')
    (dist / 'office.wam').write_text(json.dumps(
        {'entities': {'e1': {'x': ORIGIN[0], 'y': ORIGIN[1], 'prefabRef': {'collectionName': 'col', 'id': 'a'}}}}))
    (dist / 'fx').mkdir()
    (dist / 'fx' / 'manifest.json').write_text(json.dumps({'map': list(MAP), 'normal': normal, 'shadows': {},
                                                              **({'tools': pinned_record()} if tools else {})}))
    if normal:
        make_normal(dist, covered_mask(), stamp)
    return dist


def make_avatars(root, sheet_size=(96, 128)):
    """art/out with one wokas and one companions sheet, each in one colour of its group's real locked palette."""
    groups = PS.avatar_groups()
    out = Path(root) / 'out'
    for group, name in (('wokas', 'a.png'), ('companions', 'b.png')):
        png(out / group / name, block(*sheet_size, groups[group][0]))
    return out


def make_pets(root, width=512):
    """species/foo with a one-colour base.png and the palette.json holding that colour."""
    species = Path(root) / 'species'
    png(species / 'foo' / 'base.png', block(width, 32, (10, 20, 30)))
    (species / 'foo' / 'palette.json').write_text(json.dumps({'key': {'body': '#0a141e'}}))
    return species


def by_name(results):
    return {r.name: r for r in results}


@contextlib.contextmanager
def no_declared_counts():
    """The real office declares 77 glass, 4 lamp and 32 baked-shadow pictures and asserts those counts; a small fixture has none."""
    with mock.patch.object(V.OFFICE.TL, 'EXPECTED_ENTITY_FILES', {}), mock.patch.object(V.OFFICE.TL, 'EXPECTED_TILESET_FILES', {}):
        yield


class Case(unittest.TestCase):
    def setUp(self):
        before = TL.configured()                       # the fixtures are default builds: judge them whatever KONCLUI_VOLUME_PIECES says
        TL.configure(frozenset())
        self.addCleanup(TL.configure, before)
        tmp = tempfile.TemporaryDirectory(prefix='test-verify-')
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        patch = mock.patch.dict(os.environ, {TC.ALLOW_MISMATCH_ENV: '', TC.SHA256_ENV: ''})
        patch.start()
        self.addCleanup(patch.stop)

    def office(self, dist, **kw):
        with no_declared_counts():
            return by_name(V.run(dist, ['office'], **kw))

    def assertStatus(self, results, **expected):
        got = {name: results[name].status for name in expected}
        self.assertEqual(got, expected, {n: (r.status, r.detail) for n, r in results.items()})


@NEEDS_TOOLS
class Conforming(Case):
    def test_a_conforming_map_passes_every_check_and_the_office_palette_is_reported(self):
        results = self.office(make_dist(self.tmp))
        self.assertStatus(results, **{'toolchain': 'pass', 'office.dist': 'pass', 'office.tools': 'pass', 'office.grid': 'pass',
                                      'office.alpha': 'pass', 'office.translucent': 'pass', 'office.palette': 'reported', 'office.normals': 'pass'})
        self.assertEqual(results['office.palette'].data['off_pictures'], 1)
        self.assertIn('declared not conforming', results['office.palette'].detail)
        self.assertIn('method tool', results['office.normals'].detail)

    def test_conforming_avatar_and_pet_sheets_pass(self):
        results = by_name(V.run(self.tmp, ['avatars', 'pets'], avatars_root=make_avatars(self.tmp), pets_root=make_pets(self.tmp)))
        self.assertStatus(results, **{'avatars.grid': 'pass', 'avatars.alpha': 'pass', 'avatars.palette': 'pass',
                                      'pets.grid': 'pass', 'pets.alpha': 'pass', 'pets.palette': 'pass'})
        self.assertEqual(results['avatars.palette'].data['pictures'], 2)

    def test_an_off_palette_pixel_in_a_conforming_family_fails_the_palette_check_by_name(self):
        out = make_avatars(self.tmp)
        sheet = PG.load_rgba(out / 'wokas' / 'a.png').copy()
        sheet[5, 5] = (255, 0, 255, 255)
        png(out / 'wokas' / 'a.png', sheet)
        results = by_name(V.run(self.tmp, ['avatars'], avatars_root=out))
        self.assertStatus(results, **{'avatars.palette': 'fail', 'avatars.grid': 'pass', 'avatars.alpha': 'pass'})
        self.assertIn('a.png', results['avatars.palette'].lines[0])
        self.assertEqual(results['avatars.palette'].data['off_px'], 1)

    def test_an_off_palette_pet_sheet_fails_and_a_wrong_width_fails_the_grid_check(self):
        species = make_pets(self.tmp)
        sheet = PG.load_rgba(species / 'foo' / 'base.png').copy()
        sheet[3, 3] = (255, 0, 255, 255)
        png(species / 'foo' / 'base.png', sheet)
        self.assertStatus(by_name(V.run(self.tmp, ['pets'], pets_root=species)),
                          **{'pets.palette': 'fail', 'pets.grid': 'pass', 'pets.alpha': 'pass'})
        narrow = make_pets(self.tmp / 'narrow', width=480)
        self.assertStatus(by_name(V.run(self.tmp, ['pets'], pets_root=narrow)), **{'pets.grid': 'fail', 'pets.alpha': 'pass'})

    def test_an_office_that_would_conform_fails_until_its_declaration_is_flipped(self):
        dist = make_dist(self.tmp)
        png(dist / 'entities' / 'col' / 'a.png', block(12, 12, ON_PALETTE, (2, 2, 10, 10)))
        self.assertStatus(self.office(dist), **{'office.palette': 'fail'})

    def test_the_office_palette_fails_when_the_off_palette_art_grows_past_the_baseline(self):
        dist = make_dist(self.tmp)
        declared = dict(PS.FAMILY_DECLARATION['office'], baseline=dict(pictures=0, px=0))
        with mock.patch.dict(PS.FAMILY_DECLARATION, {'office': declared}):
            results = self.office(dist)
        self.assertStatus(results, **{'office.palette': 'fail'})
        self.assertIn('baseline', '\n'.join(results['office.palette'].lines))

    def test_only_the_asked_family_runs(self):
        self.assertEqual({r.name for r in V.run(self.tmp, ['avatars'], avatars_root=make_avatars(self.tmp))},
                         {'toolchain', 'avatars.grid', 'avatars.alpha', 'avatars.palette'})


class PixelChecks(Case):
    def test_a_planted_partial_alpha_sprite_fails_the_alpha_check_and_only_it(self):
        dist = make_dist(self.tmp)
        sprite = PG.load_rgba(dist / 'entities' / 'col' / 'a.png').copy()
        sprite[0, 0] = (SPRITE[0], SPRITE[1], SPRITE[2], 128)             # in the clear corner: coverage is unchanged
        png(dist / 'entities' / 'col' / 'a.png', sprite)
        with no_declared_counts():
            results = by_name(V.office_pixels(dist))
        self.assertStatus(results, **{'office.alpha': 'fail', 'office.grid': 'pass', 'office.translucent': 'pass'})
        self.assertIn('a.png', results['office.alpha'].lines[0])
        self.assertIn('partial alpha', results['office.alpha'].lines[0])
        self.assertEqual(V.normals_result(dist).status, V.PASS)          # the translucent pixel is not geometry: no normal

    def test_a_tileset_off_the_cell_grid_fails_the_grid_check(self):
        dist = make_dist(self.tmp)
        png(dist / 'tilesets' / 't.png', block(50, 32, ON_PALETTE))
        with no_declared_counts():
            self.assertStatus(by_name(V.office_pixels(dist)), **{'office.grid': 'fail', 'office.alpha': 'pass'})

    def test_the_free_sized_entities_are_not_grid_checked_and_the_detail_says_so(self):
        with no_declared_counts():
            results = by_name(V.office_pixels(make_dist(self.tmp)))
        self.assertIn('1 pictures have cell-multiple sizes (the other 1 are free-sized)', results['office.grid'].detail)

    def test_a_declared_layer_that_loses_its_count_fails_the_translucent_check(self):
        dist = make_dist(self.tmp)
        with mock.patch.object(V.OFFICE.TL, 'EXPECTED_ENTITY_FILES', {'glass': 1}), \
                mock.patch.object(V.OFFICE.TL, 'EXPECTED_TILESET_FILES', {}):
            results = by_name(V.office_pixels(dist))
        self.assertStatus(results, **{'office.translucent': 'fail', 'office.alpha': 'pass'})
        self.assertIn('glass', results['office.translucent'].lines[0])

    def test_a_wrong_sized_avatar_sheet_fails_the_grid_check(self):
        out = make_avatars(self.tmp, sheet_size=(96, 96))
        self.assertStatus(by_name(V.avatar_pixels(out)), **{'avatars.grid': 'fail', 'avatars.alpha': 'pass'})

    def test_a_partial_alpha_avatar_sheet_fails_the_alpha_check(self):
        out = make_avatars(self.tmp)
        sheet = PG.load_rgba(out / 'companions' / 'b.png').copy()
        sheet[0, 0, 3] = 100
        png(out / 'companions' / 'b.png', sheet)
        self.assertStatus(by_name(V.avatar_pixels(out)), **{'avatars.alpha': 'fail', 'avatars.grid': 'pass'})

    def test_an_empty_dist_fails_the_dist_check_and_every_check_that_needs_it(self):
        empty = self.tmp / 'empty'
        empty.mkdir()
        with no_declared_counts():
            results = by_name(V.run(empty, ['office']))
        self.assertEqual(results['office.dist'].status, V.FAIL)
        self.assertIn('entities', results['office.dist'].detail)
        for name in ('office.tools', 'office.pixels', 'office.palette', 'office.normals'):
            self.assertEqual(results[name].status, V.FAIL, name)

    def test_each_expected_path_of_a_dist_is_required_by_name(self):
        # without this the list could lose an entry (office.tmj, say) and a map without it would still pass office.dist
        import shutil
        every = ('entities', 'seats', 'tilesets', 'fx/manifest.json', 'office.tmj', 'office.wam')     # written out, not V's own list
        self.assertEqual(V.EXPECTED_DIST, every)
        for entry in every:
            dist = make_dist(self.tmp / entry.replace('/', '_'))
            target = dist / entry
            shutil.rmtree(target) if target.is_dir() else target.unlink()
            result = V.office_dist_result(dist)
            self.assertEqual(result.status, V.FAIL, entry)
            self.assertEqual(result.data['missing'], [entry])
            self.assertIn(entry, result.detail)
        self.assertEqual(V.office_dist_result(make_dist(self.tmp / 'whole')).status, V.PASS)

    def test_each_message_of_the_real_checks_lands_in_its_own_check(self):
        tall = np.zeros((32, 50, 4), np.uint8)
        self.assertEqual(V.classify('FAIL x.png: ' + PG.problems(tall)[0]), 'grid')
        partial = block(32, 32, SPRITE)
        partial[0, 0, 3] = 90
        self.assertEqual(V.classify('FAIL x.png: ' + PG.problems(partial)[0]), 'alpha')
        self.assertEqual(V.classify('FAIL x.png: ' + PG.problems(partial, declared=PG.Declared('glass', {51}))[0]), 'translucent')
        buffer = io.StringIO()
        PG.check_counts({'glass': {'files': 1}}, {'glass': 2}, buffer)
        self.assertEqual(V.classify(buffer.getvalue().splitlines()[0]), 'translucent')
        self.assertEqual(V.classify('FAIL x.png: ' + V.AVATARS.size_rule(tall)[0]), 'grid')
        self.assertEqual(V.classify('FAIL x.png: ' + V.PETS.wide_rule(tall)[0]), 'grid')
        empty = self.tmp / 'nothing'
        empty.mkdir()
        buffer = io.StringIO()
        PG.check([empty], out=buffer)
        self.assertEqual(V.classify(buffer.getvalue().splitlines()[0]), 'grid')
        self.assertEqual(V.classify('FAIL x.png: something nobody wrote yet'), 'alpha')      # unknown: still a failure


class Normals(Case):
    def fails(self, dist, **kw):
        result = V.normals_result(dist, **kw)
        self.assertEqual(result.status, V.FAIL, result.detail)
        return result

    def test_a_conforming_normal_map_passes_and_the_detail_has_the_numbers(self):
        result = V.normals_result(make_dist(self.tmp))
        self.assertEqual(result.status, V.PASS, result.detail)
        self.assertEqual(result.data['opaque_px'], 64)
        self.assertEqual(result.data['expected_px'], 64)
        self.assertLess(result.data['max_length_deviation'], V.NORMAL_TOLERANCE)

    def test_a_manifest_that_does_not_advertise_normals_is_reported_not_failed(self):
        dist = make_dist(self.tmp, normal=False)
        self.assertEqual(V.normals_result(dist).status, V.REPORTED)

    def test_an_advertised_normal_map_that_is_missing_fails(self):
        dist = make_dist(self.tmp)
        (dist / 'fx' / 'normal.png').unlink()
        self.assertIn('missing', self.fails(dist).detail)

    def test_a_normal_map_of_the_wrong_size_fails_by_its_size(self):
        dist = make_dist(self.tmp)
        make_normal(dist, covered_mask(), size=(MAP[0], MAP[1] + 8))
        result = self.fails(dist)
        self.assertIn('size 64x56 is not the map\'s 64x48', result.detail)

    def test_a_legacy_stamped_normal_map_fails_unless_it_is_allowed_and_then_it_is_reported(self):
        dist = make_dist(self.tmp, stamp='legacy')
        result = self.fails(dist)
        self.assertIn('legacy', result.detail)
        self.assertIn('--allow-legacy-normals', result.detail)
        allowed = V.normals_result(dist, allow_legacy=True)
        self.assertEqual(allowed.status, V.REPORTED)
        self.assertIn('allowed by --allow-legacy-normals', allowed.detail)

    def test_a_normal_map_with_no_method_stamp_or_a_foreign_one_fails(self):
        for stamp in (None, 'guess'):
            dist = make_dist(self.tmp / str(stamp), stamp=stamp)
            self.assertIn('no method stamp', self.fails(dist).detail)

    def test_a_normal_that_is_not_unit_length_fails(self):
        for normal in ((255, 255, 255), (128, 128, 128), (255, 128, 128)):         # lengths 1.73, 0.5, 1.0 with z 0: only the first two
            dist = make_dist(self.tmp / str(normal))
            make_normal(dist, covered_mask(), normal=normal)
            if normal == (255, 128, 128):
                self.assertEqual(V.normals_result(dist).status, V.PASS)           # (1, 0.004, 0.004) is unit length
            else:
                self.assertIn('unit length', self.fails(dist).detail)

    def test_the_tolerance_is_the_rounding_of_eight_bit_channels(self):
        flat = np.array([[128, 128, 255]], np.float64) / 255 * 2 - 1
        self.assertLess(abs(np.linalg.norm(flat) - 1), V.NORMAL_TOLERANCE)
        # the bound is the rounding of 8-bit channels (sqrt(3)/255 = 0.0068) plus a hair, not twice that
        self.assertGreater(V.NORMAL_TOLERANCE, np.sqrt(3) / 255)
        self.assertLess(V.NORMAL_TOLERANCE, 0.0075)

    def test_a_normal_of_length_1_01_fails(self):
        dist = make_dist(self.tmp)
        make_normal(dist, covered_mask(), normal=(255, 145, 128))        # (1.0, 0.137, 0.004): length 1.0094
        vector = np.array([255, 145, 128]) / 255 * 2 - 1
        self.assertAlmostEqual(float(np.linalg.norm(vector)), 1.0094, places=3)
        self.assertIn('unit length', self.fails(dist).detail)

    def test_an_alpha_other_than_zero_or_255_fails(self):
        dist = make_dist(self.tmp)
        picture = PG.load_rgba(dist / 'fx' / 'normal.png').copy()
        picture[ORIGIN[1] + 3, ORIGIN[0] + 3, 3] = 128
        info = PngImagePlugin.PngInfo()
        info.add_text(N.METHOD_KEY, 'tool')
        Image.fromarray(picture, 'RGBA').save(dist / 'fx' / 'normal.png', pnginfo=info)
        self.assertIn('alpha other than 0 or 255', '\n'.join(self.fails(dist).lines))

    def test_an_opaque_entity_pixel_without_a_normal_fails(self):
        dist = make_dist(self.tmp)
        short = covered_mask()
        short[ORIGIN[1] + 4, ORIGIN[0] + 4] = False
        make_normal(dist, short)
        self.assertIn('1 opaque entity px have no normal', '\n'.join(self.fails(dist).lines))

    def test_a_normal_on_a_pixel_that_is_no_entity_fails(self):
        dist = make_dist(self.tmp)
        wide = covered_mask()
        wide[0, 0] = True
        make_normal(dist, wide)
        self.assertIn('1 px have a normal but are not an opaque entity px, first at (0,0)', '\n'.join(self.fails(dist).lines))

    def test_the_coverage_is_derived_from_the_sprites_not_from_the_normal_map(self):
        # the sprite moves; a normal map made for the old place covers pixels that are no longer geometry
        dist = make_dist(self.tmp)
        wam = json.loads((dist / 'office.wam').read_text())
        wam['entities']['e1']['x'] += 20
        (dist / 'office.wam').write_text(json.dumps(wam))
        result = self.fails(dist)
        self.assertIn('have no normal', '\n'.join(result.lines))
        self.assertIn('not an opaque entity px', '\n'.join(result.lines))

    def test_a_sprite_that_crosses_the_map_edge_is_clipped_not_an_error(self):
        dist = make_dist(self.tmp)
        wam = json.loads((dist / 'office.wam').read_text())
        wam['entities']['e1'].update(x=MAP[0] - 6, y=-4)
        (dist / 'office.wam').write_text(json.dumps(wam))
        covered = np.zeros((MAP[1], MAP[0]), bool)
        covered[0:6, MAP[0] - 4:MAP[0]] = True
        make_normal(dist, covered)
        self.assertEqual(V.normals_result(dist).status, V.PASS)


class ManifestTools(Case):
    """office.tools: the record of the tools that made the build, not the tools on this machine."""

    def result(self, record):
        self.n = getattr(self, 'n', 0) + 1
        dist = make_dist(self.tmp / str(self.n), tools=False)
        set_tools(dist, record)
        return V.manifest_tools_result(dist)

    def test_a_record_of_the_pinned_tools_passes(self):
        result = self.result(pinned_record())
        self.assertEqual(result.status, V.PASS, result.detail)
        self.assertEqual(sorted(result.data['tools']), sorted(TC.NAMES))

    def test_a_record_with_another_version_fails_naming_the_tool(self):
        record = pinned_record()
        record['tools']['pixel-snapper'].update(version='9.9.9', matches=False)
        result = self.result(record)
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('pixel-snapper', result.detail)
        self.assertIn('9.9.9', result.detail)

    def test_a_record_that_says_matches_false_fails_even_with_the_pinned_version(self):
        record = pinned_record()
        record['tools']['sprite-normals']['matches'] = False
        result = self.result(record)
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('sprite-normals', result.detail)

    def test_a_manifest_with_no_record_fails_with_its_reason(self):
        result = self.result(None)
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('no "tools" record', result.detail)

    def test_a_record_that_lists_a_missing_tool_fails_naming_it(self):
        record = pinned_record()
        del record['tools']['sprite-normals']
        record['missing'] = ['sprite-normals']
        result = self.result(record)
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('sprite-normals', '\n'.join(result.lines))
        self.assertEqual(result.data['missing'], ['sprite-normals'])

    def test_a_tool_neither_recorded_nor_listed_missing_fails(self):
        record = pinned_record()
        del record['tools']['palette-snapper']
        self.assertIn('palette-snapper: not recorded', self.result(record).lines)

    def test_a_malformed_record_fails_instead_of_raising(self):
        for record in ({}, [], 'x', {'tools': [], 'missing': []}, {'tools': {}, 'missing': 'none'}):
            self.assertEqual(self.result(record).status, V.FAIL, record)

    def test_a_hash_the_pins_do_not_list_fails_only_under_enforce(self):
        record = pinned_record()
        self.assertEqual(self.result(record).status, V.PASS)
        with mock.patch.dict(os.environ, {TC.SHA256_ENV: 'enforce'}):
            result = self.result(record)
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('not listed', result.lines[0])

    def test_the_record_a_build_writes_is_what_the_check_reads(self):
        import fx
        dist = make_dist(self.tmp, tools=False)
        set_tools(dist, json.loads(json.dumps(fx.tool_record())))
        result = V.manifest_tools_result(dist)
        # on a host with the pinned tools the real record passes; on any other it fails by name, never raises
        self.assertEqual(result.status, V.PASS if TOOLS_OK else V.FAIL, result.detail)

    def test_the_run_includes_the_check_and_a_mismatching_record_makes_it_fail(self):
        dist = make_dist(self.tmp)
        record = pinned_record()
        record['tools']['pixel-snapper'].update(version='9.9.9', matches=False)
        set_tools(dist, record)
        with mock.patch.object(V, 'check_toolchain', return_value=V.Result('toolchain', V.PASS, 'host tools ok')):
            self.assertStatus(self.office(dist), **{'toolchain': 'pass', 'office.tools': 'fail'})


class Toolchain(Case):
    def test_a_missing_tool_fails_the_toolchain_check_naming_it_and_its_install_command(self):
        for name, spec in TC.TOOLS.items():
            with mock.patch.dict(os.environ, {spec['env']: str(self.tmp / 'nowhere')}):
                result = V.check_toolchain()
            self.assertEqual(result.status, V.FAIL, name)
            self.assertIn(name, result.detail)
            self.assertIn(spec['install'], '\n'.join(result.lines))

    def test_a_missing_palette_tool_fails_the_palette_check_and_leaves_the_pixel_checks_alone(self):
        out = make_avatars(self.tmp)
        with mock.patch.dict(os.environ, {TC.TOOLS['palette-snapper']['env']: str(self.tmp / 'nowhere')}):
            results = by_name(V.run(self.tmp, ['avatars'], avatars_root=out))
        self.assertStatus(results, **{'toolchain': 'fail', 'avatars.palette': 'fail', 'avatars.grid': 'pass', 'avatars.alpha': 'pass'})
        self.assertIn('ToolMissing', results['avatars.palette'].detail)
        self.assertIn(TC.TOOLS['palette-snapper']['install'], '\n'.join(results['avatars.palette'].lines))

    def test_a_tool_of_another_version_fails_even_with_the_allow_flag(self):
        fake = self.tmp / 'spritefusion-pixel-snapper'
        fake.write_text('#!/bin/sh\necho "spritefusion-pixel-snapper 9.9.9"\n')
        fake.chmod(0o755)
        with mock.patch.dict(os.environ, {TC.TOOLS['pixel-snapper']['env']: str(fake), TC.ALLOW_MISMATCH_ENV: '1'}):
            result = V.check_toolchain()
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('9.9.9', '\n'.join(result.lines))
        self.assertIn('pixel-snapper', result.detail)

    @NEEDS_TOOLS
    def test_the_real_tools_pass_and_their_identities_are_in_the_data(self):
        result = V.check_toolchain()
        self.assertEqual(result.status, V.PASS, result.lines)
        self.assertEqual(sorted(result.data['tools']), sorted(TC.NAMES))
        self.assertEqual(result.data['missing'], [])


class Determinism(Case):
    def script(self, body):
        path = self.tmp / 'fake-build.py'
        path.write_text('import os, sys\nfrom pathlib import Path\n'
                        'args = dict(zip(sys.argv[1::2], sys.argv[2::2]))\n'
                        "out = Path(args['--out']); out.mkdir(parents=True); Path(args['--renders']).mkdir(parents=True)\n"
                        "(out / 'a.txt').write_text('same')\n" + body)
        return path

    def test_two_identical_builds_pass(self):
        result = V.determinism_result(build_script=self.script("(out / 'b.txt').write_text('same')\n"))
        self.assertEqual(result.status, V.PASS, result.lines)
        self.assertEqual(result.data, {'files': 2, 'differing': 0})

    def test_a_build_that_differs_between_runs_fails_and_names_the_file(self):
        result = V.determinism_result(build_script=self.script("(out / 'b.txt').write_text(os.urandom(8).hex())\n"))
        self.assertEqual(result.status, V.FAIL)
        self.assertEqual(result.lines, ['b.txt: bytes differ'])
        self.assertEqual(result.data['differing'], 1)

    def test_a_file_only_one_build_wrote_fails(self):
        result = V.determinism_result(build_script=self.script("(out / ('x' + os.urandom(3).hex() + '.txt')).write_text('x')\n"))
        self.assertEqual(result.status, V.FAIL)
        self.assertTrue(all('only in one build' in line for line in result.lines), result.lines)

    def test_a_failing_build_fails_with_its_exit_code_and_output(self):
        result = V.determinism_result(build_script=self.script("print('boom'); sys.exit(3)\n"))
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('exited 3', result.detail)
        self.assertIn('boom', result.lines[-1])

    def test_the_given_dist_is_compared_with_the_rebuild_for_information_only(self):
        script = self.script("(out / 'b.txt').write_text('same')\n")
        same = self.tmp / 'same'
        same.mkdir()
        (same / 'a.txt').write_text('same')
        (same / 'b.txt').write_text('same')
        self.assertIn('DIST itself is identical', V.determinism_result(same, script).detail)
        (same / 'b.txt').write_text('other')
        other = V.determinism_result(same, script)
        self.assertEqual(other.status, V.PASS)
        self.assertEqual(other.data['given_dist_differs_in'], 1)

    def test_rebuild_is_only_run_when_asked(self):
        dist = make_dist(self.tmp)
        with no_declared_counts(), mock.patch.object(V, 'determinism_result') as called:
            V.run(dist, ['office'])
            called.assert_not_called()
            called.return_value = V.Result('determinism', V.PASS, 'x')
            names = [r.name for r in V.run(dist, ['office'], rebuild=True)]
        self.assertEqual(names[-1], 'determinism')


class CommandLine(Case):
    def run_main(self, argv, results=None, families=None):
        out, err = io.StringIO(), io.StringIO()
        fake = mock.patch.object(V, 'run', return_value=results) if results is not None else contextlib.nullcontext()
        with fake as called, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = V.main(argv)
        return code, out.getvalue(), err.getvalue(), called

    def test_one_line_per_check_with_its_status_and_the_verdict(self):
        dist = self.tmp / 'dist'
        dist.mkdir()
        results = [V.Result('toolchain', V.PASS, 'ok'), V.Result('office.palette', V.REPORTED, 'counted'),
                   V.Result('office.alpha', V.FAIL, '2 failures', ['a.png: partial', 'b.png: partial'])]
        code, out, _, _ = self.run_main([str(dist)], results)
        lines = out.splitlines()
        self.assertEqual(code, 1)
        self.assertTrue(lines[0].startswith('pass') and 'toolchain' in lines[0])
        self.assertTrue(lines[1].startswith('reported') and 'office.palette' in lines[1])
        self.assertTrue(lines[2].startswith('fail') and 'office.alpha' in lines[2])
        self.assertEqual([l.strip() for l in lines[3:5]], ['a.png: partial', 'b.png: partial'])
        self.assertIn('NOT fit to publish', lines[-1])

    def test_exit_0_only_without_a_failure_and_reported_is_not_a_failure(self):
        dist = self.tmp / 'dist'
        dist.mkdir()
        code, out, _, _ = self.run_main([str(dist)], [V.Result('a', V.PASS, ''), V.Result('b', V.REPORTED, '')])
        self.assertEqual(code, 0)
        self.assertIn('1 pass, 0 fail, 1 reported: fit to publish', out)

    def test_a_dist_in_the_source_tree_leaves_the_source_tree_untouched(self):
        source = self.tmp / 'source'
        dist = source / 'hq-office' / 'dist'
        dist.mkdir(parents=True)
        scratch = self.tmp / 'scratch'
        scratch.mkdir()
        before = sorted(p.relative_to(source).as_posix() for p in source.rglob('*'))
        with mock.patch.object(V, 'SOURCE', source), mock.patch.object(V.tempfile, 'gettempdir', return_value=str(scratch)):
            code, out, _, _ = self.run_main([str(dist)], [V.Result('a', V.PASS, '')])
        self.assertEqual(code, 0)
        self.assertEqual(sorted(p.relative_to(source).as_posix() for p in source.rglob('*')), before)
        reports = list(scratch.rglob('verify.json'))
        self.assertEqual(len(reports), 1, out)
        self.assertIn(str(reports[0]), out)
        self.assertTrue(json.loads(reports[0].read_text())['ok'])

    def test_an_explicit_out_inside_the_source_tree_is_refused_and_nothing_is_written(self):
        source = self.tmp / 'source'
        (source / 'hq-office').mkdir(parents=True)
        dist = self.tmp / 'dist'
        dist.mkdir()
        with mock.patch.object(V, 'SOURCE', source):
            code, _, err, called = self.run_main([str(dist), '--out', str(source / 'hq-office' / 'verify.json')], [V.Result('a', V.PASS, '')])
        self.assertEqual(code, 2)
        self.assertIn('never written into the source tree', err)
        self.assertFalse((source / 'hq-office' / 'verify.json').exists())
        called.assert_not_called()

    def test_an_earlier_report_is_removed_so_a_run_that_dies_leaves_no_stale_ok(self):
        dist = self.tmp / 'dist'
        dist.mkdir()
        stale = self.tmp / 'verify.json'
        stale.write_text(json.dumps({'ok': True}))
        with mock.patch.object(V, 'run', side_effect=KeyError('boom')), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(KeyError):
                V.main([str(dist)])
        self.assertFalse(stale.exists())

    def test_a_check_that_exits_is_a_failure_not_a_crash_and_not_a_pass(self):
        # the tool helpers answer a missing tool or a bad input with SystemExit
        dist = self.tmp / 'dist'
        dist.mkdir()
        with mock.patch.object(V, 'office_dist_result', side_effect=SystemExit('no tool')), \
                mock.patch.object(V, 'check_toolchain', return_value=V.Result('toolchain', V.PASS, 'ok')):
            results = by_name(V.run(dist, ['office']))
        self.assertEqual(results['office.dist'].status, V.FAIL)
        self.assertIn('no tool', results['office.dist'].detail)

    def test_a_run_without_the_office_family_does_not_claim_the_dist_is_fit(self):
        dist = self.tmp / 'dist'
        dist.mkdir()
        code, out, _, _ = self.run_main([str(dist), '--family', 'avatars'], [V.Result('avatars.grid', V.PASS, 'ok')])
        self.assertEqual(code, 0)
        self.assertNotIn('fit to publish', out.replace('not a verdict', ''))
        self.assertIn('avatars only; DIST not examined', out)
        document = json.loads((self.tmp / 'verify.json').read_text())
        self.assertFalse(document['dist_examined'])
        self.assertIsNone(document['dist'])
        code, out, _, _ = self.run_main([str(dist), '--family', 'all'], [V.Result('office.dist', V.PASS, 'ok')])
        self.assertIn(': fit to publish', out)
        self.assertTrue(json.loads((self.tmp / 'verify.json').read_text())['dist_examined'])

    def test_verify_json_is_written_beside_the_dist_not_inside_it(self):
        dist = self.tmp / 'dist'
        dist.mkdir()
        self.run_main([str(dist)], [V.Result('toolchain', V.PASS, 'ok', data={'n': 1}), V.Result('x', V.FAIL, 'bad', ['l'])])
        self.assertFalse((dist / 'verify.json').exists())
        document = json.loads((self.tmp / 'verify.json').read_text())
        self.assertEqual(document['schema'], 1)
        self.assertFalse(document['ok'])
        self.assertEqual(document['summary'], {'pass': 1, 'fail': 1, 'reported': 0})
        self.assertEqual([c['name'] for c in document['checks']], ['toolchain', 'x'])
        self.assertEqual(document['checks'][0]['data'], {'n': 1})
        self.assertEqual(document['checks'][1]['lines'], ['l'])
        self.assertEqual(sorted(document['toolchain']), ['missing', 'tools'])

    def test_out_overrides_the_place_of_the_report(self):
        dist = self.tmp / 'dist'
        dist.mkdir()
        target = self.tmp / 'elsewhere' / 'r.json'
        target.parent.mkdir()
        self.run_main([str(dist), '--out', str(target)], [V.Result('a', V.PASS, '')])
        self.assertTrue(target.is_file())
        self.assertFalse((self.tmp / 'verify.json').exists())

    def test_a_dist_that_is_not_a_directory_is_a_usage_error(self):
        code, _, err, _ = self.run_main([str(self.tmp / 'nope')])
        self.assertEqual(code, 2)
        self.assertIn('not a directory', err)
        self.assertFalse((self.tmp / 'verify.json').exists())

    def test_the_options_reach_the_run(self):
        dist = self.tmp / 'dist'
        dist.mkdir()
        _, _, _, called = self.run_main([str(dist), '--family', 'pets', '--allow-legacy-normals', '--rebuild'], [V.Result('a', V.PASS, '')])
        called.assert_called_once_with(dist, ('pets',), True, True)
        _, _, _, called = self.run_main([str(dist)], [V.Result('a', V.PASS, '')])
        called.assert_called_once_with(dist, V.FAMILIES, False, False)

    def test_a_check_that_raises_is_a_failure_not_a_crash(self):
        dist = self.tmp / 'dist'
        dist.mkdir()
        with mock.patch.object(V, 'office_dist_result', side_effect=RuntimeError('disk on fire')), \
                mock.patch.object(V, 'check_toolchain', return_value=V.Result('toolchain', V.PASS, 'ok')):
            results = by_name(V.run(dist, ['office']))
        self.assertEqual(results['office.dist'].status, V.FAIL)
        self.assertIn('RuntimeError: disk on fire', results['office.dist'].detail)

    @NEEDS_TOOLS
    def test_the_real_command_over_the_repository_avatars_passes_end_to_end(self):
        dist = self.tmp / 'dist'
        dist.mkdir()
        code, out, _, _ = self.run_main([str(dist), '--family', 'avatars'])
        self.assertEqual(code, 0, out)
        self.assertEqual([l.split()[1] for l in out.splitlines()[:4]], ['toolchain', 'avatars.grid', 'avatars.alpha', 'avatars.palette'])
        self.assertTrue((self.tmp / 'verify.json').is_file())

    def test_the_command_line_runs_as_a_script_in_isolated_mode(self):
        import subprocess
        done = subprocess.run([sys.executable, '-I', str(HERE / 'verify.py'), str(self.tmp / 'missing')], capture_output=True, text=True)
        self.assertEqual(done.returncode, 2)
        self.assertIn('not a directory', done.stderr)


class BuildManifest(Case):
    def test_the_build_manifest_records_the_tool_identities_without_host_paths(self):
        import fx
        record = fx.tool_record()
        self.assertEqual(sorted(record), ['missing', 'tools'])
        self.assertEqual(sorted(set(record['tools']) | set(record['missing'])), sorted(TC.NAMES))
        for ident in record['tools'].values():
            self.assertEqual(sorted(ident), ['matches', 'pinnedCommit', 'pinnedVersion', 'sha256', 'version'])
        self.assertNotIn(str(Path.home()), json.dumps(record))
        self.assertNotIn('/bin/', json.dumps(record))

    def test_a_missing_tool_is_recorded_by_name_and_publish_reads_the_record(self):
        import fx
        with mock.patch.dict(os.environ, {TC.TOOLS['palette-snapper']['env']: str(self.tmp / 'nowhere')}):
            record = fx.tool_record()
        self.assertEqual(record['missing'], ['palette-snapper'])
        dist = self.tmp / 'dist' / 'fx'
        dist.mkdir(parents=True)
        (dist / 'manifest.json').write_text(json.dumps({'map': [1, 1], 'tools': record}))
        self.assertEqual(publish.read_tools(self.tmp / 'dist'), record)


def set_manifest(dist, **keys):
    """Add keys to the manifest of a small map (a value None removes the key)."""
    path = Path(dist) / 'fx' / 'manifest.json'
    manifest = json.loads(path.read_text())
    for key, value in keys.items():
        manifest.pop(key, None)
        if value is not None:
            manifest[key] = value
    path.write_text(json.dumps(manifest))


class Volume(Case):
    """The checks of a build made with KONCLUI_VOLUME_PIECES: the recorded switch, office.contract and the casters."""

    def contract(self, dist, baseline=None):
        with mock.patch.object(V.C, 'load_json', side_effect=lambda name, data_dir=None: baseline if name == 'baseline.json' else None):
            return by_name(V.contract_results(dist))

    def baseline_of(self, dist):
        return V.C.make_baseline(V.C.measure(dist))

    def test_the_recorded_switch_is_read_from_the_manifest(self):
        dist = make_dist(self.tmp)
        self.assertEqual(V.recorded_switch(dist), frozenset())
        set_manifest(dist, volume='air-hockey,plant-proxy')
        self.assertEqual(V.recorded_switch(dist), {'air-hockey', 'plant-proxy'})
        self.assertEqual(V.recorded_switch(self.tmp / 'nowhere'), frozenset())

    def test_a_build_is_judged_by_its_own_switch_and_the_process_is_put_back(self):
        dist = make_dist(self.tmp)
        set_manifest(dist, volume='air-hockey')
        TL.configure(frozenset({'plant-proxy'}))
        with V.built_with(dist):
            self.assertEqual(TL.configured(), {'air-hockey'})
            self.assertEqual(TL.EXPECTED_ENTITY_FILES['baked-shadow'], 31)
        self.assertEqual(TL.configured(), {'plant-proxy'})
        set_manifest(dist, volume=None)
        with V.built_with(dist):                     # a default build in a process that has the switch on: the default
            self.assertEqual(TL.configured(), frozenset())
            self.assertEqual(TL.EXPECTED_ENTITY_FILES['baked-shadow'], 32)
        self.assertEqual(TL.configured(), {'plant-proxy'})

    def test_the_process_is_put_back_when_a_check_raises(self):
        dist = make_dist(self.tmp)
        set_manifest(dist, volume='air-hockey')
        with self.assertRaises(RuntimeError):
            with V.built_with(dist):
                raise RuntimeError('x')
        self.assertEqual(TL.configured(), frozenset())

    @NEEDS_TOOLS
    def test_a_manifest_value_that_is_not_a_switch_fails_the_pixel_checks_by_name(self):
        dist = make_dist(self.tmp)
        set_manifest(dist, volume='airhockey')
        results = self.office(dist)
        self.assertEqual(results['office.pixels'].status, V.FAIL)
        self.assertIn("'airhockey'", results['office.pixels'].detail)

    @NEEDS_TOOLS
    def test_the_office_run_registers_the_contract_and_the_casters(self):
        names = list(self.office(make_dist(self.tmp)))
        for name in ('office.contract', 'office.contract.pieces', 'office.contract.review', 'office.contract.casters'):
            self.assertIn(name, names)
        self.assertLess(names.index('office.kinds'), names.index('office.contract'))

    # ---- office.contract
    def test_legacy_offenders_behind_the_baseline_are_reported_and_never_fail(self):
        dist = make_dist(self.tmp)
        result = self.contract(dist, self.baseline_of(dist))['office.contract']
        self.assertEqual(result.status, V.REPORTED, result.detail)
        self.assertIn('legacy offenders behind the baseline', result.detail)

    def test_a_clean_map_is_a_pass(self):
        dist = make_dist(self.tmp)
        sprite = block(12, 12, (200, 120, 60), (2, 2, 10, 11))                                  # a foot gap of 1
        sprite[2:11, 2:10][np.pad(np.zeros((7, 6), bool), 1, constant_values=True)] = (20, 10, 5, 255)    # a 1 px ink outline
        png(dist / 'entities' / 'col' / 'a.png', sprite)
        baseline = self.baseline_of(dist)
        self.assertEqual({rule: e['offenders'] for rule, e in baseline['rules'].items() if e['offenders']}, {})
        self.assertEqual(self.contract(dist, baseline)['office.contract'].status, V.PASS)

    def test_a_volume_piece_that_breaks_a_gate_rule_fails_even_when_the_baseline_lists_the_sprite(self):
        dist = make_dist(self.tmp)
        baseline = self.baseline_of(dist)                            # the sprite offends foot_gap (2 empty rows): legacy
        png(dist / 'entities' / 'col' / 'a.png', block(12, 12, SPRITE, (2, 2, 10, 10)) + 0)
        px = np.asarray(Image.open(dist / 'entities' / 'col' / 'a.png')).copy()
        px[3, 3, 0] += 1                                             # the picture changed since the baseline
        png(dist / 'entities' / 'col' / 'a.png', px)
        set_manifest(dist, volumePieces={'col/a.png': 'volume'}, volume='air-hockey')
        result = self.contract(dist, baseline)['office.contract']
        self.assertEqual(result.status, V.FAIL, result.detail)
        self.assertIn('picture changed since the baseline', result.lines[0])
        self.assertIn('foot_gap', result.lines[0])

    def test_a_touched_up_legacy_piece_keeps_its_standing_for_the_rules_it_already_offended(self):
        dist = make_dist(self.tmp)
        baseline = self.baseline_of(dist)
        px = np.asarray(Image.open(dist / 'entities' / 'col' / 'a.png')).copy()
        px[3, 3, 0] += 1
        png(dist / 'entities' / 'col' / 'a.png', px)
        set_manifest(dist, volumePieces={'col/a.png': 'proxy'}, volume='arc-lamp-proxy')
        result = self.contract(dist, baseline)['office.contract']
        self.assertEqual(result.status, V.REPORTED, result.detail)
        self.assertEqual(result.data['volume_pieces'], {'col/a.png': 'proxy'})

    def test_a_touched_up_piece_that_breaks_a_rule_it_did_not_offend_before_fails(self):
        dist = make_dist(self.tmp)
        baseline = self.baseline_of(dist)
        baseline['rules']['foot_gap']['offenders'] = []              # it was clean for this rule when the baseline was written
        set_manifest(dist, volumePieces={'col/a.png': 'proxy'}, volume='arc-lamp-proxy')
        result = self.contract(dist, baseline)['office.contract']
        self.assertEqual(result.status, V.FAIL, result.detail)
        self.assertIn('not an offender in the baseline', result.lines[0])

    def test_without_the_proxy_standing_the_same_touched_up_piece_is_a_regression(self):
        dist = make_dist(self.tmp)
        baseline = self.baseline_of(dist)
        px = np.asarray(Image.open(dist / 'entities' / 'col' / 'a.png')).copy()
        px[3, 3, 0] += 1
        png(dist / 'entities' / 'col' / 'a.png', px)
        self.assertEqual(self.contract(dist, baseline)['office.contract'].status, V.FAIL)

    def test_a_missing_baseline_is_reported_not_failed(self):
        self.assertEqual(self.contract(make_dist(self.tmp), None)['office.contract'].status, V.REPORTED)

    # ---- office.contract.casters
    def casters(self, **manifest):
        dist = make_dist(Path(tempfile.mkdtemp(dir=self.tmp)))
        set_manifest(dist, kinds={'col/a.png': 'stand'}, **manifest)
        return V.casters_result(dist)

    def test_a_manifest_without_casters_is_reported(self):
        result = self.casters()
        self.assertEqual(result.status, V.REPORTED)
        self.assertFalse(result.data['present'])

    ONE = {'col/a.png': {'h': 8, 'foot': 9, 'span': [2, 10]}}

    def test_casters_that_are_exactly_the_stand_sprites_pass_with_casters_all(self):
        result = self.casters(casters=self.ONE, volume='casters-all')
        self.assertEqual(result.status, V.PASS, result.detail)
        self.assertEqual(result.data['scope'], 'all')

    def test_with_casters_all_a_stand_sprite_with_no_caster_and_a_caster_for_a_sprite_that_does_not_stand_fail(self):
        result = self.casters(casters={}, volume='casters-all')
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('no caster', result.lines[0])
        result = self.casters(casters={**self.ONE, 'col/b.png': self.ONE['col/a.png']}, volume='casters-all')
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('not placed stand sprites', result.lines[0])

    def test_without_casters_all_the_casters_are_exactly_the_volume_pieces(self):
        """One piece on changes the shadow of that piece only: a stand sprite the switch did not touch has no caster."""
        result = self.casters(casters=self.ONE, volume='air-hockey', volumePieces={'col/a.png': 'volume'})
        self.assertEqual((result.status, result.data['scope']), (V.PASS, 'volume pieces'), result.detail)
        self.assertEqual(self.casters(casters={}, volume='air-hockey', volumePieces={}).status, V.PASS)   # a piece the build did not place

    def test_without_casters_all_a_caster_for_another_stand_sprite_fails_and_so_does_a_missing_one(self):
        result = self.casters(casters=self.ONE, volume='air-hockey', volumePieces={})
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('are not volume pieces', result.lines[0])
        result = self.casters(casters={}, volume='arc-lamp-proxy', volumePieces={'col/a.png': 'proxy'})
        self.assertEqual(result.status, V.FAIL)
        self.assertIn('have no caster', result.lines[0])

    def test_casters_all_beside_a_piece_is_every_stand_sprite_and_the_scope_is_read_from_the_recorded_value(self):
        self.assertEqual(self.casters(casters=self.ONE, volume='air-hockey,casters-all', volumePieces={'col/a.png': 'volume'}).status, V.PASS)
        self.assertEqual(self.casters(casters={}, volume='air-hockey,casters-all', volumePieces={}).status, V.FAIL)
        # the process's own environment says nothing: only the manifest's record does
        with mock.patch.dict(os.environ, {'KONCLUI_VOLUME_PIECES': 'casters-all'}):
            self.assertEqual(self.casters(casters={}, volume='air-hockey', volumePieces={}).status, V.PASS)

    def test_a_manifest_value_that_is_not_a_switch_fails_the_casters(self):
        self.assertEqual(self.casters(casters=self.ONE, volume='caster-all').status, V.FAIL)

    def test_a_caster_outside_its_picture_or_not_made_of_integers_fails(self):
        for entry, why in (({'h': 8, 'foot': 12, 'span': [2, 10]}, 'foot row 12'), ({'h': 8, 'foot': 9, 'span': [2, 13]}, 'span'), ({'h': 8, 'foot': 9, 'span': [4, 4]}, 'span'),
                           ({'h': 0, 'foot': 9, 'span': [2, 10]}, 'h 0'), ({'h': 13, 'foot': 9, 'span': [2, 10]}, 'h 13'),
                           ({'h': 8.5, 'foot': 9, 'span': [2, 10]}, 'integers'), ({'h': 8, 'foot': 9, 'span': [9, 2]}, 'span'),
                           ({'h': 8, 'foot': 9}, '{h, foot, span}'), ({'h': 8, 'foot': True, 'span': [2, 10]}, 'integers')):
            result = self.casters(casters={'col/a.png': entry}, volume='casters-all')
            self.assertEqual(result.status, V.FAIL, entry)
            self.assertIn(why, ' '.join(result.lines), entry)

    def test_a_volume_piece_of_an_unknown_kind_or_on_a_sprite_that_is_not_placed_fails(self):
        entry = {'col/a.png': {'h': 8, 'foot': 9, 'span': [2, 10]}}
        self.assertEqual(self.casters(casters=entry, volume='air-hockey', volumePieces={'col/a.png': 'baked'}).status, V.FAIL)
        self.assertEqual(self.casters(casters=entry, volume='casters-all', volumePieces={'col/zzz.png': 'volume'}).status, V.FAIL)
        self.assertEqual(self.casters(casters=entry, volume='air-hockey', volumePieces={'col/a.png': 'volume'}).status, V.PASS)


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST unset (a built map: hq-office/build.py --out DIR)')
class BuiltMap(Case):
    def test_the_real_build_records_its_tools_and_verifies_clean(self):
        dist = Path(os.environ['KONCLUI_DIST'])
        manifest = json.loads((dist / 'fx' / 'manifest.json').read_text())
        self.assertEqual(sorted(manifest['tools']['tools']), sorted(TC.NAMES))
        results = V.run(dist, ['office'])
        # A build made with any KONCLUI_VOLUME_PIECES value verifies clean too: the baked pieces are drawn in palette tones, the casters
        # are the ones the recorded value asks for, and the declared layers follow the switch.
        self.assertEqual({r.name for r in results if r.status == V.FAIL}, set(), [(r.name, r.detail) for r in results])


if __name__ == '__main__':
    if not os.environ.get('KONCLUI_DIST'):
        print('note: KONCLUI_DIST is unset, so BuiltMap is SKIPPED; build with `python3 hq-office/build.py --out DIR --renders '
              'DIR2` and rerun with KONCLUI_DIST=DIR', file=sys.stderr)
    unittest.main()
