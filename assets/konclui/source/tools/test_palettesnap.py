"""Tests of tools/palettesnap.py (the locked palettes and spritefusion-palette-snapper) and of its wiring into the family checks.
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_palettesnap.py
The classes that run the real tool are skipped, with the reason, when the pinned binary is not usable; `Missing` runs without it
and proves a missing tool is an error, never a pass. `BuiltOffice` runs only with KONCLUI_DIST set (a built map)."""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
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
import palettesnap as PS  # noqa: E402
import pixelgrid as PG  # noqa: E402
import toolchain  # noqa: E402


def load_module(name, path):
    """Three wrappers are called sheetcheck.py (hq-office, pets/tools, avatars): load each under its own name."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(Path(path).resolve().parent))
    spec.loader.exec_module(module)
    return module


OFFICE_CHECK = load_module('office_sheetcheck_ps', SOURCE / 'hq-office' / 'sheetcheck.py')
PETS_CHECK = load_module('pets_sheetcheck_ps', SOURCE / 'pets' / 'tools' / 'sheetcheck.py')
AVATAR_CHECK = load_module('avatar_sheetcheck_ps', SOURCE / 'avatars' / 'sheetcheck.py')

TOOL_PROBLEM = toolchain.problem('palette-snapper')
needs_tool = unittest.skipIf(TOOL_PROBLEM, f'spritefusion-palette-snapper not usable: {TOOL_PROBLEM}')

PALETTE = [(10, 20, 30), (250, 250, 250), (200, 30, 30)]


def picture(planted=None, partial=False, size=32):
    """A 32 x 32 RGBA array that uses every colour of PALETTE; `planted` {(x, y): rgb} puts other colours on top."""
    px = np.zeros((size, size, 4), np.uint8)
    px[4:12, 4:12] = (*PALETTE[0], 255)
    px[14:20, 14:20] = (*PALETTE[1], 255)
    px[22:26, 2:10] = (*PALETTE[2], 255)
    if partial:
        px[2, 2] = (*PALETTE[0], 128)           # a pane
        px[0, 0] = (77, 88, 99, 0)              # a clear pixel carrying a colour nobody sees
    for (x, y), rgb in (planted or {}).items():
        px[y, x, :3] = rgb
        px[y, x, 3] = 255
    return px


def save(path, pixels):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, 'RGBA').save(path)
    return Path(path)


def workdir(test):
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    return Path(tmp.name)


def fake_run_tool(alter):
    """A stand-in for PS._run_tool: the staged picture is the source passed through `alter(array) -> array`."""
    def run(files, palette, mode, root):
        staged = {}
        for i, file in enumerate(files):
            out = Path(root) / f'fake-{i}.png'
            Image.fromarray(alter(PG.load_rgba(file)), 'RGBA').save(out)
            staged[Path(file)] = out
        return staged
    return run


class Palettes(unittest.TestCase):
    """The palette files are their sources' output, and the readers are strict."""

    def test_the_palette_files_equal_their_sources(self):
        self.assertEqual(PS.palette_files_problems(), [])

    def test_office_palette_reads_the_names_a_dict_maps_onto(self):
        # WALL maps catalogue colours onto INK (a name, not a literal) and onto three literal colours: all four count.
        office = {PS.hex_of(c) for c in PS.office_palette()}
        for colour in ('#0a0a3d', '#eef3f6', '#2b3a78', '#c2cfd7', '#53ffc8', '#0f262c', '#ebddc8'):
            self.assertIn(colour, office)

    def test_a_palette_file_that_drifts_from_its_source_fails(self):
        for name, edit in (('office.hex', lambda lines: lines[1:]),                  # a colour dropped
                           ('avatars.hex', lambda lines: lines + ['123456']),         # a colour added
                           ('pets.hex', lambda lines: lines[:-1])):
            with self.subTest(name):
                folder = workdir(self)
                PS.write_family_files(folder)
                self.assertEqual(PS.palette_files_problems(folder), [])
                path = folder / name
                path.write_text('\n'.join(sorted(edit(path.read_text().split()))) + '\n')
                found = PS.palette_files_problems(folder)
                self.assertEqual(len(found), 1)
                self.assertIn(name, found[0])

    def test_a_change_of_the_source_is_not_masked_by_the_file(self):
        # palette.py gains a colour: the generated list differs from the committed file, so the test above would fail.
        text = (SOURCE / 'hq-office' / 'palette.py').read_text() + "\nSPARE = '#123456'\n"
        copy = workdir(self) / 'palette.py'
        copy.write_text(text)
        self.assertIn((0x12, 0x34, 0x56), PS.office_palette(copy))
        self.assertNotEqual(PS.office_palette(copy), PS.read_palette(PS.PALETTE_DIR / 'office.hex'))

    def test_the_avatar_file_is_the_union_of_its_groups_source(self):
        groups = json.loads((SOURCE / 'avatars' / 'sheet-palette.json').read_text())
        self.assertEqual(sorted(PS.avatar_groups()), sorted(['wokas', 'companions']))
        for group, colours in PS.avatar_groups().items():
            self.assertEqual(colours, PS._colours(groups[group]))
        self.assertEqual(PS.read_palette(PS.PALETTE_DIR / 'avatars.hex'), PS.avatars_palette())

    def test_the_pets_file_is_the_union_of_the_species_keys(self):
        union = set()
        for path in (SOURCE / 'pets' / 'species').glob('*/palette.json'):
            union |= {tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) for v in json.loads(path.read_text())['key'].values()}
        self.assertEqual(set(PS.read_palette(PS.PALETTE_DIR / 'pets.hex')), union)

    def test_readers_take_the_formats_the_tool_takes_and_name_a_bad_line(self):
        folder = workdir(self)
        (folder / 'a.hex').write_text('; comment\n0A141E\n#fafafa ; white\n\nc81e1e\n0a141e\n')
        (folder / 'a.gpl').write_text('GIMP Palette\nName: x\n#\n 10  20  30 ink\n250 250 250 paper\n200  30  30 red\n')
        (folder / 'a.json').write_text(json.dumps(['#0a141e', '#fafafa', '#c81e1e']))
        (folder / 'bad.hex').write_text('0a141e\nnot-a-colour\n')
        for name in ('a.hex', 'a.gpl', 'a.json'):
            self.assertEqual(PS.read_palette(folder / name), sorted(PALETTE), name)
        with self.assertRaisesRegex(ValueError, r'bad\.hex:2'):
            PS.read_palette(folder / 'bad.hex')

    def test_oklab_distance_is_zero_for_the_same_colour_and_grows_with_the_gap(self):
        self.assertEqual(PS.distance((10, 20, 30), (10, 20, 30)), 0.0)
        self.assertAlmostEqual(PS.distance((0, 0, 0), (255, 255, 255)), 1.0, places=3)
        self.assertLess(PS.distance((100, 120, 140), (100, 121, 140)), PS.distance((100, 120, 140), (100, 130, 140)))
        self.assertLess(PS.distance((100, 120, 140), (100, 129, 140)), PS.THRESHOLD)        # MEASURED: the tool merges these
        self.assertGreater(PS.distance((100, 120, 140), (100, 131, 140)), PS.THRESHOLD)     # and keeps these apart


class FamilyLocks(unittest.TestCase):
    """The per-picture lock the command line and the gates share (no tool needed)."""

    def make(self, *relative):
        folder = workdir(self)
        for name in relative:
            save(folder / name, picture())
        return folder

    def test_an_avatar_picture_is_locked_to_its_nearest_group_folder(self):
        folder = self.make('wokas/a.png', 'companions/b.png', 'wokas/deep/companions/c.png')
        locks = PS.family_locks('avatars', [folder])
        groups = PS.avatar_groups()
        by_name = {p.name: colours for p, colours in locks.items()}
        self.assertEqual(by_name['a.png'], groups['wokas'])
        self.assertEqual(by_name['b.png'], groups['companions'])
        self.assertEqual(by_name['c.png'], groups['companions'])          # the nearest folder wins
        self.assertNotEqual(groups['wokas'], groups['companions'])

    def test_a_picture_with_no_known_group_or_species_is_an_error_not_a_guess(self):
        folder = self.make('loose/a.png')
        with self.assertRaisesRegex(PS.PaletteError, 'wokas or companions'):
            PS.family_locks('avatars', [folder])
        with self.assertRaisesRegex(PS.PaletteError, 'no palette.json'):
            PS.family_locks('pets', [folder])
        with self.assertRaises(KeyError):
            PS.family_locks('nothing', [folder])
        with self.assertRaises(PS.PaletteError):
            PS.family_locks('office', [workdir(self)])                     # no PNG at all

    def test_a_pet_picture_is_locked_to_the_palette_json_beside_it(self):
        folder = self.make('gato/base.png', 'cao/base.png')
        (folder / 'gato' / 'palette.json').write_text(json.dumps({'key': {'a': '#0a141e', 'b': '#fafafa'}}))
        (folder / 'cao' / 'palette.json').write_text(json.dumps({'key': {'a': '#c81e1e'}}))
        locks = {p.parent.name: colours for p, colours in PS.family_locks('pets', [folder]).items()}
        self.assertEqual(locks, {'gato': [(10, 20, 30), (250, 250, 250)], 'cao': [(200, 30, 30)]})

    def test_the_office_lock_is_office_hex_for_every_picture(self):
        folder = self.make('a.png', 'b/c.png')
        locks = PS.family_locks('office', [folder])
        self.assertEqual(len(locks), 2)
        self.assertTrue(all(colours == PS.office_palette() for colours in locks.values()))


@needs_tool
class RealTool(unittest.TestCase):
    """The pinned spritefusion-palette-snapper, run for real."""

    def sources(self, **named):
        folder = workdir(self)
        for name, pixels in named.items():
            save(folder / f'{name}.png', pixels)
        return folder

    def test_art_that_conforms_comes_back_the_same(self):
        folder = self.sources(a=picture(), b=picture(partial=True))
        stats = {}
        self.assertEqual(PS.check([folder], PALETTE, stats=stats), [])
        self.assertEqual(stats['pictures'], 2)
        target = workdir(self) / 'out'
        result = PS.snap(folder, target, PALETTE, out=io.StringIO())
        self.assertEqual((result.changed, result.refused, len(result.written)), ([], [], 2))
        for name in ('a', 'b'):
            before, after = PG.load_rgba(folder / f'{name}.png'), PG.load_rgba(target / f'{name}.png')
            self.assertTrue(np.array_equal(before[..., 3], after[..., 3]))
            solid = before[..., 3] > 0
            self.assertTrue(np.array_equal(before[solid], after[solid]))

    def test_a_planted_off_palette_pixel_is_caught_and_named(self):
        planted = (12, 22, 31)                                   # one step from (10, 20, 30)
        folder = self.sources(clean=picture(), dirty=picture(planted={(20, 5): planted}))
        found = PS.check([folder], PALETTE)
        self.assertEqual([c.path.name for c in found], ['dirty.png'])
        change = found[0]
        self.assertEqual((change.changed, change.off_palette, change.merged), (1, 1, 0))
        self.assertTrue(change.first.startswith('(20,5) #0c161f -> #0a141e'), change.first)
        self.assertAlmostEqual(change.max_distance, PS.distance(planted, PALETTE[0]), places=4)
        self.assertIn('dirty.png', change.line())

    def test_a_far_planted_pixel_goes_to_the_nearest_palette_colour(self):
        folder = self.sources(dirty=picture(planted={(20, 5): (190, 40, 40)}))
        target = workdir(self) / 'out'
        PS.snap(folder, target, PALETTE, out=io.StringIO())
        self.assertEqual(tuple(PG.load_rgba(target / 'dirty.png')[5, 20]), (*PALETTE[2], 255))

    def test_alpha_comes_back_unchanged_and_the_check_asserts_it(self):
        pixels = picture(partial=True, planted={(20, 5): (12, 22, 31)})
        pixels[8, 8, 3] = 200
        folder = self.sources(a=pixels)
        target = workdir(self) / 'out'
        PS.snap(folder, target, PALETTE, out=io.StringIO())
        after = PG.load_rgba(target / 'a.png')
        self.assertTrue(np.array_equal(after[..., 3], pixels[..., 3]))
        self.assertEqual(int(after[8, 8, 3]), 200)

        def lose_a_pixel(array):
            array = array.copy()
            array[8, 8, 3] = 0
            return array
        with mock.patch.object(PS, '_run_tool', fake_run_tool(lose_a_pixel)):
            with self.assertRaises(PS.AlphaChanged):
                PS.check([folder], PALETTE)
            with self.assertRaises(PS.AlphaChanged):
                PS.snap(folder, workdir(self) / 'again', PALETTE, out=io.StringIO())

    def test_snap_is_all_or_nothing_a_later_bad_picture_leaves_no_partial_target(self):
        # a.png is fine and comes first; b.png (it has the 128-alpha pane at (2, 2)) comes back with a lost pixel. The old
        # loop moved a.png into the target before it judged b.png and left it there.
        folder = self.sources(a=picture(), b=picture(partial=True))
        target = workdir(self) / 'out'                              # the SAME path for the call and the assertion

        def lose_a_pixel_of_b(array):
            array = array.copy()
            if array[2, 2, 3] == 128:
                array[8, 8, 3] = 0
            return array
        with mock.patch.object(PS, '_run_tool', fake_run_tool(lose_a_pixel_of_b)):
            with self.assertRaises(PS.AlphaChanged):
                PS.snap(folder, target, PALETTE, out=io.StringIO())
        self.assertFalse(target.exists(), sorted(p.name for p in target.glob('**/*')) if target.exists() else '')

        def foreign_in_b(array):                                    # the same for a colour the palette lacks
            array = array.copy()
            if array[2, 2, 3] == 128:
                array[5, 5, :3] = (1, 2, 3)
            return array
        with mock.patch.object(PS, '_run_tool', fake_run_tool(foreign_in_b)):
            with self.assertRaises(PS.OutputOffPalette):
                PS.snap(folder, target, PALETTE, out=io.StringIO())
        self.assertFalse(target.exists())
        PS.snap(folder, target, PALETTE, out=io.StringIO())         # and a good run still writes both
        self.assertEqual(sorted(p.name for p in target.iterdir()), ['a.png', 'b.png'])

    def test_a_move_that_fails_halfway_removes_what_it_wrote(self):
        folder = self.sources(a=picture(), b=picture(partial=True))
        target = workdir(self) / 'out'
        real, calls = shutil.move, []

        def flaky(src, dst):
            calls.append(dst)
            if len(calls) == 2:
                raise OSError('disk full')
            return real(src, dst)
        with mock.patch.object(PS.shutil, 'move', flaky):
            with self.assertRaises(OSError):
                PS.snap(folder, target, PALETTE, out=io.StringIO())
        self.assertEqual([p for p in target.glob('**/*.png')], [])

    def test_each_mode_gives_its_own_result_and_an_unknown_mode_is_an_error(self):
        # Two greys between a dark, a mid and a light palette colour: `nearest` maps both onto the mid grey, `lightness`
        # spreads the sprite's range (100..160) over the palette's (dark..light).
        palette = [(10, 20, 30), (128, 128, 128), (250, 250, 250)]
        px = np.zeros((16, 16, 4), np.uint8)
        px[:8] = (100, 100, 100, 255)
        px[8:] = (160, 160, 160, 255)
        folder = self.sources(a=px)
        seen = {}
        for mode in PS.MODES:
            target = workdir(self) / mode
            PS.snap(folder, target, palette, mode, out=io.StringIO())
            after = PG.load_rgba(target / 'a.png')
            seen[mode] = (tuple(after[0, 0, :3]), tuple(after[15, 0, :3]))
            self.assertEqual(PS.check([folder], palette, mode)[0].changed, 256)
        self.assertEqual(seen['nearest'], ((128, 128, 128), (128, 128, 128)))
        self.assertEqual(seen['lightness'], ((10, 20, 30), (250, 250, 250)))
        for call in (lambda: PS.check([folder], palette, 'sideways'),
                     lambda: PS.snap(folder, workdir(self) / 'x', palette, 'sideways')):
            with self.assertRaisesRegex(ValueError, 'sideways'):
                call()

    def test_a_tool_that_returns_a_foreign_colour_or_another_size_is_refused(self):
        folder = self.sources(a=picture())

        def foreign(array):
            array = array.copy()
            array[5, 5, :3] = (1, 2, 3)
            return array
        with mock.patch.object(PS, '_run_tool', fake_run_tool(foreign)):
            with self.assertRaises(PS.OutputOffPalette):
                PS.check([folder], PALETTE)
        with mock.patch.object(PS, '_run_tool', fake_run_tool(lambda array: array[:16])):
            with self.assertRaises(PS.AlphaChanged):
                PS.check([folder], PALETTE)

    def test_the_tool_writes_indexed_pngs_and_they_are_decoded_not_compared_by_bytes(self):
        folder = self.sources(a=picture(partial=True))
        target = workdir(self) / 'out'
        PS.snap(folder, target, PALETTE, out=io.StringIO())
        with Image.open(target / 'a.png') as written, Image.open(folder / 'a.png') as original:
            self.assertEqual(written.mode, 'P')                               # MEASURED: up to 256 colours it is indexed
            self.assertEqual(original.mode, 'RGBA')
        before, after = PG.load_rgba(folder / 'a.png'), PG.load_rgba(target / 'a.png')
        self.assertEqual(after.shape, before.shape)
        self.assertTrue(np.array_equal(after[..., 3], before[..., 3]))        # the tRNS chunk decodes to the same alpha
        self.assertTrue(np.array_equal(after[before[..., 3] > 0], before[before[..., 3] > 0]))
        self.assertNotEqual((folder / 'a.png').read_bytes(), (target / 'a.png').read_bytes())   # same pixels, other bytes

    def test_two_runs_give_the_same_pixels_and_the_same_bytes(self):
        folder = self.sources(a=picture(planted={(20, 5): (190, 40, 40), (3, 3): (11, 21, 31)}), b=picture(partial=True))
        one, two = workdir(self) / 'one', workdir(self) / 'two'
        PS.snap(folder, one, PALETTE, out=io.StringIO())
        PS.snap(folder, two, PALETTE, out=io.StringIO())
        for name in ('a.png', 'b.png'):
            self.assertEqual((one / name).read_bytes(), (two / name).read_bytes(), name)
            self.assertTrue(np.array_equal(PG.load_rgba(one / name), PG.load_rgba(two / name)))
        first, second = PS.check([folder], PALETTE), PS.check([folder], PALETTE)
        self.assertEqual([(c.path, c.changed, c.first, c.max_distance) for c in first],
                         [(c.path, c.changed, c.first, c.max_distance) for c in second])

    def test_snap_never_writes_into_its_source(self):
        folder = self.sources(a=picture(planted={(20, 5): (190, 40, 40)}))
        before = (folder / 'a.png').read_bytes()
        for target in (folder, folder / 'a.png', folder / 'inside', folder.parent):
            with self.subTest(target=str(target)):
                with self.assertRaises(PS.PaletteError):
                    PS.snap(folder, target, PALETTE, out=io.StringIO())
        with self.assertRaises(PS.PaletteError):
            PS.snap(folder / 'a.png', folder / 'a.png', PALETTE, out=io.StringIO())
        self.assertEqual((folder / 'a.png').read_bytes(), before)
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ['a.png'])

    def test_an_existing_output_is_an_error_unless_forced(self):
        folder = self.sources(a=picture())
        target = workdir(self) / 'out'
        PS.snap(folder, target, PALETTE, out=io.StringIO())
        with self.assertRaises(FileExistsError):
            PS.snap(folder, target, PALETTE, out=io.StringIO())
        PS.snap(folder, target, PALETTE, force=True, out=io.StringIO())

    def test_the_tools_merge_of_close_palette_colours_is_counted_and_snap_refuses_it(self):
        close = [(100, 120, 140), (100, 126, 140)]                     # 0.018 apart in OKLab: the tool merges them
        self.assertLess(PS.distance(*close), PS.THRESHOLD)
        px = np.zeros((32, 32, 4), np.uint8)
        px[:8, :8] = (*close[0], 255)
        px[8:12, :8] = (*close[1], 255)
        folder = self.sources(a=px)
        found = PS.check([folder], close)
        self.assertEqual(len(found), 1)
        self.assertEqual((found[0].off_palette, found[0].merged), (0, 32))
        refused = PS.snap(folder, workdir(self) / 'out', close, out=io.StringIO())
        self.assertEqual((refused.written, len(refused.refused)), ([], 1))
        out = io.StringIO()
        self.assertEqual(PS.judge('avatars', found, {'pictures': 1}, out), 0)       # not a violation of the lock
        self.assertIn('not a violation', out.getvalue())

    def test_declared_exceptions_are_left_out_and_counted(self):
        folder = self.sources(glass=picture(planted={(20, 5): (190, 40, 40)}), plain=picture())
        stats = {}
        found = PS.check([folder], PALETTE, exempt=lambda p: 'glass' if p.stem == 'glass' else None, stats=stats)
        self.assertEqual((found, stats), ([], {'pictures': 1, 'exempt': 1}))

    def test_a_palette_of_more_than_256_colours_is_refused_not_truncated(self):
        many = [(i, j, 0) for i in range(20) for j in range(14)]
        with self.assertRaises(PS.PaletteTooLarge):
            PS.check([self.sources(a=picture())], many)

    def test_the_committed_art_has_no_colour_off_its_palette(self):
        art = SOURCE / 'art' / 'out'
        if not art.is_dir():
            self.skipTest('art/out is not in this checkout')
        for group, colours in PS.avatar_groups().items():
            self.assertEqual([c for c in PS.check([art / group], colours) if c.off_palette], [], group)
        for species in sorted((SOURCE / 'pets' / 'species').glob('*/base.png')):
            colours = PS.read_palette(species.parent / 'palette.json')
            self.assertEqual([c for c in PS.check([species], colours) if c.off_palette], [], species.parent.name)

    def test_report_counts_colours_near_duplicates_and_pictures_outside(self):
        far, close_a, close_b = (30, 200, 30), (100, 120, 140), (100, 124, 140)
        px = np.zeros((32, 32, 4), np.uint8)
        px[:4] = (*far, 255)
        px[4:8] = (*close_a, 255)
        px[8:12] = (*close_b, 255)
        folder = self.sources(a=px, b=picture())
        data = PS.report([folder], [far, close_a, (250, 250, 250)], out=io.StringIO())
        self.assertEqual((data['pictures'], data['colours']), (2, 3 + 3))
        self.assertEqual((data['near_pairs'], data['colours_in_a_near_pair']), (1, 2))
        self.assertEqual(data['merge_pictures'], 1)                     # the tool, run per picture, merges close_a/close_b
        self.assertEqual(data['merge_lost'], 1)
        self.assertEqual((data['pictures_outside'], data['colours_outside']), (2, 3))   # close_b, and two colours of picture()

    def test_the_contact_sheet_shows_the_most_changed_pictures(self):
        dirty = {(x, 5): (190, 40, 40) for x in range(20, 30)}
        folder = self.sources(a=picture(planted=dirty), b=picture(planted={(20, 5): (190, 40, 40)}))
        changes = PS.check([folder], PALETTE)
        target = workdir(self) / 'sheet.png'
        shown = PS.contact_sheet(changes, PALETTE, target)
        self.assertEqual([p.name for p in shown], ['a.png', 'b.png'])
        with Image.open(target) as sheet:
            self.assertGreater(sheet.width, 64)
        with self.assertRaises(PS.PaletteError):
            PS.contact_sheet([], PALETTE, workdir(self) / 'none.png')

    def test_the_command_line_exits_non_zero_when_a_picture_would_change(self):
        palette = workdir(self) / 'p.hex'
        palette.write_text(PS.hex_text(PALETTE))
        clean, dirty = self.sources(a=picture()), self.sources(a=picture(planted={(20, 5): (190, 40, 40)}))
        run = lambda *args: subprocess.run([sys.executable, '-I', str(HERE / 'palettesnap.py'), *args],
                                           capture_output=True, text=True)
        good = run('check', '--palette', str(palette), str(clean))
        bad = run('check', '--palette', str(palette), str(dirty))
        self.assertEqual((good.returncode, bad.returncode), (0, 1), good.stderr + bad.stderr)
        self.assertIn('a.png', bad.stdout)
        out = run('snap', '--palette', str(palette), str(dirty), str(workdir(self) / 'x'))
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(run('report', '--palette', str(palette), '--no-tool', str(dirty)).returncode, 0)


@needs_tool
class FamilyCommandLine(unittest.TestCase):
    """`palettesnap.py check --family` judges as the gates do (judge, per-group and per-species locks)."""

    def run_cli(self, *args):
        return subprocess.run([sys.executable, '-I', str(HERE / 'palettesnap.py'), *args], capture_output=True, text=True)

    def avatar(self, group, **planted):
        folder = workdir(self)
        colours = PS.avatar_groups()[group]
        px = np.zeros((16, 16, 4), np.uint8)
        px[:] = (*colours[0], 255)
        for (x, y), rgb in planted.get('planted', {}).items():
            px[y, x, :3] = rgb
        save(folder / group / 'a.png', px)
        return folder / group

    def test_check_family_avatars_passes_conforming_art_and_fails_a_planted_pixel_naming_it(self):
        clean = self.avatar('companions')
        dirty = self.avatar('wokas', planted={(3, 3): (1, 2, 3)})
        good, bad = self.run_cli('check', '--family', 'avatars', str(clean)), self.run_cli('check', '--family', 'avatars', str(dirty))
        self.assertEqual((good.returncode, bad.returncode), (0, 1), good.stdout + good.stderr + bad.stderr)
        self.assertIn('a.png', bad.stdout)
        self.assertIn('FAIL', bad.stdout)

    def test_a_merge_alone_does_not_fail_the_command_line_as_it_does_not_fail_the_gate(self):
        close = [(100, 120, 140), (100, 126, 140)]
        folder = workdir(self)
        (folder / 'gato').mkdir()
        (folder / 'gato' / 'palette.json').write_text(json.dumps({'key': {'a': '#64788c', 'b': '#647e8c'}}))
        px = np.zeros((32, 32, 4), np.uint8)
        px[:8, :8] = (*close[0], 255)
        px[8:12, :8] = (*close[1], 255)
        save(folder / 'gato' / 'base.png', px)
        found = PS.check([folder / 'gato' / 'base.png'], close)
        self.assertEqual((found[0].off_palette, found[0].merged), (0, 32))       # the raw check does see it
        result = self.run_cli('check', '--family', 'pets', str(folder / 'gato' / 'base.png'))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('not a violation', result.stdout)
        self.assertIn('merge only: gato/base.png 32 px', result.stdout)             # the picture is named, not just counted
        raw = self.run_cli('check', '--palette', str(self._palette_file(close)), str(folder / 'gato' / 'base.png'))
        self.assertEqual(raw.returncode, 1)                                      # --palette keeps "any change fails"

    def _palette_file(self, colours):
        path = workdir(self) / 'p.hex'
        path.write_text(PS.hex_text(colours))
        return path

    def test_check_family_pets_uses_the_species_palette_and_the_union_file_is_not_a_lock(self):
        species = SOURCE / 'pets' / 'species' / 'gato' / 'base.png'
        if not species.is_file():
            self.skipTest('pets/species is not in this checkout')
        result = self.run_cli('check', '--family', 'pets', str(species))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)    # was exit 2: "palette has 377 colours"
        self.assertEqual(self.run_cli('check', '--family', 'pets', str(species.parent.parent)).returncode, 0)

    def test_the_committed_avatar_art_gets_the_same_verdict_from_the_command_line_and_the_gate(self):
        art = SOURCE / 'art' / 'out'
        if not art.is_dir():
            self.skipTest('art/out is not in this checkout')
        for group in PS.AVATAR_GROUPS:
            cli = self.run_cli('check', '--family', 'avatars', str(art / group))
            self.assertEqual(cli.returncode, 0, group + cli.stdout + cli.stderr)
        self.assertEqual(AVATAR_CHECK.check(art, io.StringIO()), 0)

    def test_check_family_office_is_refused_and_points_at_the_gate(self):
        result = self.run_cli('check', '--family', 'office', str(self.avatar('wokas')))
        self.assertEqual(result.returncode, 2)
        self.assertIn('hq-office/sheetcheck.py check --dist', result.stderr)

    def test_snap_family_writes_each_picture_with_its_own_group_palette(self):
        folder = workdir(self)
        groups = PS.avatar_groups()
        for group in PS.AVATAR_GROUPS:
            px = np.zeros((16, 16, 4), np.uint8)
            px[:] = (*groups[group][0], 255)
            px[3, 3, :3] = groups[group][0]
            save(folder / group / 'a.png', px)
        target = workdir(self) / 'out'
        result = self.run_cli('snap', '--family', 'avatars', str(folder), str(target))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for group in PS.AVATAR_GROUPS:
            self.assertEqual(tuple(PG.load_rgba(target / group / 'a.png')[0, 0, :3]), groups[group][0])

    def test_the_contact_sheet_of_a_family_check_uses_each_pictures_lock(self):
        dirty = self.avatar('wokas', planted={(3, 3): (1, 2, 3)})
        sheet = workdir(self) / 'sheet.png'
        result = self.run_cli('check', '--family', 'avatars', str(dirty), '--contact-sheet', str(sheet))
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertTrue(sheet.is_file())

    def test_the_contact_sheet_is_never_written_over_or_inside_a_checked_source(self):
        folder = workdir(self)
        save(folder / 'a.png', picture(planted={(20, 5): (190, 40, 40)}))
        before = (folder / 'a.png').read_bytes()
        changes = PS.check([folder], PALETTE)
        for target in (folder / 'a.png', folder / 'sheet.png', folder):
            with self.subTest(target=str(target)):
                with self.assertRaises(PS.PaletteError):
                    PS.contact_sheet(changes, PALETTE, target, sources=[folder])
        self.assertEqual((folder / 'a.png').read_bytes(), before)
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ['a.png'])
        palette = self._palette_file(PALETTE)
        result = self.run_cli('check', '--palette', str(palette), str(folder), '--contact-sheet', str(folder / 'sheet.png'))
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn('immutable', result.stderr)
        self.assertFalse((folder / 'sheet.png').exists())


class Missing(unittest.TestCase):
    """No usable tool is an error that says how to install it, never a pass. Runs without the tool."""

    def setUp(self):
        self.folder = workdir(self)
        save(self.folder / 'a.png', picture())

    def assert_missing(self, call):
        with self.assertRaises(toolchain.ToolMissing) as caught:
            call()
        self.assertIn('cargo install --locked', str(caught.exception))
        return str(caught.exception)

    def test_a_wrong_override_is_an_error_for_check_snap_and_the_command_line(self):
        env = {toolchain.TOOLS['palette-snapper']['env']: str(self.folder / 'nothing')}
        with mock.patch.dict(os.environ, env):
            self.assert_missing(lambda: PS.check([self.folder], PALETTE))
            self.assert_missing(lambda: PS.snap(self.folder, self.folder.parent / 'never', PALETTE))
            self.assertFalse((self.folder.parent / 'never').exists())
            self.assertEqual(PS.main(['check', '--palette', str(PS.PALETTE_DIR / 'office.hex'), str(self.folder)]), 2)

    def test_a_tool_that_is_on_no_path_is_missing(self):
        env = {'PATH': str(self.folder), 'HOME': str(self.folder)}          # no tool on PATH, no ~/.cargo/bin
        with mock.patch.dict(os.environ, env):
            os.environ.pop(toolchain.TOOLS['palette-snapper']['env'], None)
            self.assert_missing(lambda: PS.check([self.folder], PALETTE))

    def test_an_input_that_needs_no_run_of_the_tool_is_still_an_error_without_it(self):
        env = {toolchain.TOOLS['palette-snapper']['env']: str(self.folder / 'nothing')}
        with mock.patch.dict(os.environ, env):
            self.assert_missing(lambda: PS.check([self.folder], PALETTE, exempt=lambda path: 'every picture is exempt'))
            self.assert_missing(lambda: PS.check_family('office', [self.folder], exempt=lambda path: 'all exempt'))
            changes = [PS.Change(self.folder / 'a.png', 1, 1, 1, 0, 0.1, '(0,0) #000000 -> #010101')]
            self.assert_missing(lambda: PS.contact_sheet(changes, PALETTE, self.folder.parent / 'sheet.png'))

    def test_the_office_gate_is_an_error_without_the_tool_even_when_every_picture_is_declared(self):
        dist = self.folder / 'dist'
        (dist / 'entities').mkdir(parents=True)
        (dist / 'seats').mkdir()
        (dist / 'tilesets').mkdir()
        save(dist / 'tilesets' / 'Konclui_Walls.png', np.full((32, 32, 4), (9, 9, 9, 255), np.uint8))   # a declared tileset
        env = {toolchain.TOOLS['palette-snapper']['env']: str(self.folder / 'nothing')}
        with mock.patch.dict(os.environ, env):
            with self.assertRaises(toolchain.ToolMissing):
                OFFICE_CHECK.check_palette(dist, io.StringIO())

    def test_an_unknown_mode_is_an_error_before_any_tool_is_looked_for(self):
        with self.assertRaisesRegex(ValueError, 'sideways'):
            PS.check([self.folder], PALETTE, 'sideways')

    def test_the_family_checks_do_not_pass_without_the_tool(self):
        env = {toolchain.TOOLS['palette-snapper']['env']: str(self.folder / 'nothing')}
        art = SOURCE / 'art' / 'out'
        with mock.patch.dict(os.environ, env):
            if art.is_dir():
                with self.assertRaises(toolchain.ToolMissing):
                    AVATAR_CHECK.check(art, io.StringIO())
            with self.assertRaises(toolchain.ToolMissing):
                with contextlib.redirect_stdout(io.StringIO()):
                    PETS_CHECK.main(['check'])


class Judge(unittest.TestCase):
    """The family decision, on made-up Changes (no tool)."""

    def change(self, off=0, merged=0, name='a.png'):
        return PS.Change(Path(name), 100, off + merged, off, merged, 0.05, '(1,2) #000000 -> #010101')

    def judge(self, family, changes, pictures=10):
        out = io.StringIO()
        return PS.judge(family, changes, {'pictures': pictures}, out), out.getvalue()

    def test_a_conforming_family_fails_on_every_picture_off_the_palette(self):
        for family in ('avatars', 'pets'):
            failed, text = self.judge(family, [self.change(off=3), self.change(off=1, name='b.png')])
            self.assertEqual(failed, 2, family)
            self.assertIn('FAIL', text)
        self.assertEqual(self.judge('pets', [])[0], 0)

    def test_a_merge_alone_never_fails(self):
        failed, text = self.judge('pets', [self.change(merged=40)])
        self.assertEqual(failed, 0)
        self.assertIn('not a violation', text)

    def test_the_office_is_declared_not_conforming_with_a_written_reason(self):
        self.assertFalse(PS.FAMILY_DECLARATION['office']['conforming'])
        self.assertGreater(len(PS.FAMILY_DECLARATION['office']['reason']), 100)
        failed, text = self.judge('office', [self.change(off=50), self.change(off=70, name='b.png')], pictures=12542)
        self.assertEqual(failed, 0)
        self.assertIn('NOT FAILING', text)
        self.assertIn('2 of 12542 pictures', text)
        self.assertIn('120 px', text)

    def test_the_office_baseline_is_a_ratchet_it_fails_when_the_count_grows_and_shows_the_delta(self):
        baseline = dict(pictures=2, px=120)
        declared = dict(PS.FAMILY_DECLARATION['office'], baseline=baseline)
        with mock.patch.dict(PS.FAMILY_DECLARATION, {'office': declared}):
            failed, text = self.judge('office', [self.change(off=50), self.change(off=70, name='b.png')])
            self.assertEqual(failed, 0)
            self.assertIn('NOT FAILING', text)
            self.assertIn('baseline 2 pictures / 120 px, now 2 / 120 (+0 pictures, +0 px)', text)
            failed, text = self.judge('office', [self.change(off=50), self.change(off=70, name='b.png'), self.change(off=1, name='c.png')])
            self.assertEqual(failed, 1)                                          # one more picture
            self.assertIn('FAIL (grew past the baseline)', text)
            self.assertIn('+1 pictures, +1 px', text)
            failed, text = self.judge('office', [self.change(off=50), self.change(off=71, name='b.png')])
            self.assertEqual(failed, 1)                                          # same pictures, one more px
            failed, text = self.judge('office', [self.change(off=50)])
            self.assertEqual(failed, 0)                                          # fewer is allowed, and says to lower it
            self.assertIn('lower the baseline', text)

    def test_the_committed_office_baseline_is_recorded(self):
        baseline = PS.FAMILY_DECLARATION['office']['baseline']
        self.assertGreater(baseline['pictures'], 0)
        self.assertGreater(baseline['px'], baseline['pictures'])

    def test_a_stale_declaration_fails_once_the_office_conforms(self):
        failed, text = self.judge('office', [])
        self.assertEqual(failed, 1)
        self.assertIn('FAIL palette office', text)
        with mock.patch.dict(PS.FAMILY_DECLARATION, {'office': dict(conforming=True, reason='')}):
            self.assertEqual(self.judge('office', [self.change(off=1)])[0], 1)


class Wiring(unittest.TestCase):
    """The palette check inside each family's check, and the build's call."""

    def test_the_build_calls_the_office_palette_check(self):
        text = (SOURCE / 'hq-office' / 'build.py').read_text()
        self.assertIn('SHEETCHECK.check_palette(dist', text)
        self.assertIn('contract += SHEETCHECK.check_palette', text)

    def test_the_office_check_command_runs_both_contracts_and_either_failing_fails_it(self):
        for dist_failures, palette_failures, expected in ((0, 0, 0), (1, 0, 1), (0, 2, 1), (3, 4, 1)):
            with mock.patch.object(OFFICE_CHECK, 'check_dist', return_value=dist_failures) as dist_check, \
                    mock.patch.object(OFFICE_CHECK, 'check_palette', return_value=palette_failures) as palette_check:
                self.assertEqual(OFFICE_CHECK.main(['check', '--dist', '/some/dist']), expected)
            dist_check.assert_called_once_with('/some/dist')
            palette_check.assert_called_once_with('/some/dist')               # both ran: the palette one is not short-circuited

    @needs_tool
    def test_avatar_sheets_are_checked_by_the_tool_and_a_planted_pixel_fails(self):
        art = SOURCE / 'art' / 'out'
        if not art.is_dir():
            self.skipTest('art/out is not in this checkout')
        self.assertEqual(AVATAR_CHECK.check(art, io.StringIO()), 0)
        copy = workdir(self) / 'out'
        shutil.copytree(art, copy)
        sheet = copy / 'companions' / 'koru.png'
        pixels = PG.load_rgba(sheet).copy()
        y, x = np.argwhere(pixels[..., 3] > 0)[0]
        pixels[y, x, :3] = (1, 2, 3)
        save(sheet, pixels)
        out = io.StringIO()
        self.assertEqual(AVATAR_CHECK.check(copy, out), 1)              # one sheet, named by pixelgrid's palette check AND the tool's
        self.assertIn('would change', out.getvalue())
        self.assertIn('koru.png', out.getvalue())

    @needs_tool
    def test_pet_sheets_are_checked_by_the_tool_and_a_planted_pixel_fails(self):
        species = SOURCE / 'pets' / 'species'
        if not (species / 'gato' / 'base.png').is_file():
            self.skipTest('pets/species is not in this checkout')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(PETS_CHECK.main(['check']), 0)
        copy = workdir(self) / 'species'
        shutil.copytree(species / 'gato', copy / 'gato')
        pixels = PG.load_rgba(copy / 'gato' / 'base.png').copy()
        y, x = np.argwhere(pixels[..., 3] > 0)[0]
        pixels[y, x, :3] = (1, 2, 3)
        save(copy / 'gato' / 'base.png', pixels)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(PETS_CHECK.main(['check', str(copy)]), 1)
        self.assertIn('would change', out.getvalue())

    def mini_dist(self, glass_colour=(1, 2, 3), plain_colour=(1, 2, 3)):
        """A built-map stand-in: one declared glass prefab, one plain prefab, one declared tileset, one plain tileset."""
        dist = workdir(self)
        sprites = dist / 'entities' / 'konclui' / 'sprites'
        sprites.mkdir(parents=True)
        (dist / 'seats').mkdir()
        (dist / 'tilesets').mkdir()
        entries = [{'id': 'x1', 'name': 'Janela guilhotina', 'imagePath': 'sprites/glass.png'},
                   {'id': 'x2', 'name': 'Mesa qualquer', 'imagePath': 'sprites/plain.png'}]
        (dist / 'entities' / 'konclui' / 'collection.json').write_text(json.dumps({'collection': entries}))
        save(sprites / 'glass.png', np.full((8, 8, 4), (*glass_colour, 255), np.uint8))
        save(sprites / 'plain.png', np.full((8, 8, 4), (*plain_colour, 255), np.uint8))
        save(dist / 'tilesets' / 'Konclui_Walls.png', np.full((32, 32, 4), (9, 9, 9, 255), np.uint8))
        save(dist / 'tilesets' / 'Konclui_Floor.png', np.full((32, 32, 4), (*plain_colour, 255), np.uint8))
        return dist

    @needs_tool
    def test_office_check_counts_the_declared_layers_and_does_not_fail_a_nonconforming_office(self):
        dist = self.mini_dist()
        out = io.StringIO()
        contact = workdir(self) / 'contact.png'
        self.assertEqual(OFFICE_CHECK.check_palette(dist, out, contact=contact), 0)
        text = out.getvalue()
        self.assertIn('declared exception glass: 1 pictures left out', text)
        self.assertIn('declared exception tileset-glass-walls: 1 pictures left out', text)
        self.assertIn('2 of 2 pictures are off the palette', text)          # the plain prefab and the plain tileset
        self.assertIn('NOT FAILING', text)
        self.assertTrue(contact.is_file())

    @needs_tool
    def test_office_check_fails_the_day_the_office_conforms_and_when_it_is_enforced(self):
        on_palette = PS.office_palette()[0]
        dist = self.mini_dist(plain_colour=on_palette)
        out = io.StringIO()
        self.assertEqual(OFFICE_CHECK.check_palette(dist, out), 1)           # conforming, declaration stale
        self.assertIn('FAIL palette office', out.getvalue())
        dirty = self.mini_dist()
        with mock.patch.dict(PS.FAMILY_DECLARATION, {'office': dict(conforming=True, reason='')}):
            out = io.StringIO()
            self.assertEqual(OFFICE_CHECK.check_palette(dirty, out), 2)      # enforced: the two pictures off the palette
            self.assertIn('FAIL', out.getvalue())


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST unset (a built map: hq-office/build.py --out DIR)')
@needs_tool
class BuiltOffice(unittest.TestCase):
    def test_the_office_palette_check_runs_over_the_real_build_and_does_not_fail_it(self):
        out = io.StringIO()
        self.assertEqual(OFFICE_CHECK.check_palette(os.environ['KONCLUI_DIST'], out), 0, out.getvalue())
        self.assertIn('declared exception glass: 77 pictures left out', out.getvalue())


if __name__ == '__main__':
    if not os.environ.get('KONCLUI_DIST'):
        print('note: KONCLUI_DIST is unset, so BuiltOffice is SKIPPED; build with `python3 hq-office/build.py --out DIR '
              '--renders DIR2` and rerun with KONCLUI_DIST=DIR', file=sys.stderr)
    unittest.main()
