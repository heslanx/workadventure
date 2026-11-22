"""Behaviour tests of the ingest lane (tools/ingest.py): refusals, the recovered grid, the family contract, the optional
second opinion, determinism, and that the input is never touched.
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_ingest.py

The tests that run the pixel snapper are skipped, with the reason, when spritefusion-pixel-snapper is missing or is not
the pinned one. Their fixtures are drawn here (a sprite on a 32 px grid, scaled by 8 with a blur and noise, as a model's
output is) and are tied to the pinned snapper, 1.0.0: MEASURED, the snapper returns the grid size or one more row and
column depending on the noise (50% of 16 fixtures of 32x32 came back 33x33), so the fixtures use fixed seeds that were
run against it, and a snapper upgrade that changes them is a deliberate re-measure.
No test needs perfect_pixel (a fake one is put on sys.path where the second opinion is exercised) and none writes under
the repository: every output is a temporary folder."""
import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ingest as I  # noqa: E402
import pixelgrid as PG  # noqa: E402
import toolchain  # noqa: E402

SNAPPER_PROBLEM = None
try:
    SNAPPER_PROBLEM = toolchain.problem('pixel-snapper')
except toolchain.ToolError as error:
    SNAPPER_PROBLEM = str(error)
needs_snapper = unittest.skipIf(SNAPPER_PROBLEM is not None, f'pixel snapper unavailable: {SNAPPER_PROBLEM}')
needs_lane = unittest.skipUnless(I.PALETTE_MODULE.is_file(), 'tools/palettesnap.py (the palette lane) is not there')
REAL_PALETTES = I.PALETTES                           # the repository's own palettes/<family>.hex, before any test patches it
DEFAULT = object()                                   # run_ingest(palette=DEFAULT): the palette file made in setUp

COLOURS = [(200, 60, 40), (40, 120, 200), (240, 200, 60), (30, 30, 40), (90, 200, 120)]
# 27 near-white colours far from the five: with the five alone the pinned snapper is told "5 colours" and, MEASURED on every
# fixture, finds a 33 px wide grid for a 32 px sprite; told 32 (palette of 32) it finds 32 on 14 of 16 fixtures. The
# palette of the fixtures is therefore 32 colours, five of them the ones the sprites use.
FILLER = [(225 + i % 30, 225 + (i * 7) % 30, 225 + (i * 11) % 30) for i in range(27)]


def sprite(width, height, seed=3):
    """A sprite natively on the grid: an ellipse of random pixels from five colours, clear outside."""
    r = np.random.default_rng(seed)
    px = np.zeros((height, width, 4), np.uint8)
    px[..., :3] = np.array(COLOURS, np.uint8)[r.integers(0, len(COLOURS), (height, width))]
    px[..., 3] = 255
    yy, xx = np.mgrid[0:height, 0:width]
    inside = ((xx - width / 2 + .5) ** 2 / (width * .5) ** 2 + (yy - height / 2 + .5) ** 2 / (height * .5) ** 2) < 1
    px[~inside] = 0
    return px


def model_like(px, scale=8, blur=0.8, noise=4, seed=0):
    """What an image model hands back: the grid art scaled, blurred a little, with a little colour noise."""
    img = Image.fromarray(px, 'RGBA').resize((px.shape[1] * scale, px.shape[0] * scale), Image.NEAREST)
    img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img).astype(np.int16)
    a[..., :3] += np.random.default_rng(seed).integers(-noise, noise + 1, a[..., :3].shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    with Image.open(path) as image:
        return np.asarray(image.convert('RGBA'))


def case_insensitive(folder):
    """True when `folder` is on a disk that treats `A` and `a` as one name (APFS and NTFS by default)."""
    probe = Path(folder) / 'CaseProbe.tmp'
    probe.write_text('x')
    try:
        return (Path(folder) / 'caseprobe.tmp').exists()
    finally:
        probe.unlink()


def tree_bytes(folder):
    """{relative path: bytes} of every file under `folder`."""
    folder = Path(folder)
    return {str(p.relative_to(folder)): p.read_bytes() for p in sorted(folder.rglob('*')) if p.is_file()}


FAKE_PERFECT_PIXEL = '''
CALLS = []
ANSWER = (32, 32)
def get_perfect_pixel(image, **kw):
    CALLS.append((image.shape, str(image.dtype)))
    image[:] = 0                       # a module that scribbles on what it is given must not change the staged picture
    return ANSWER[0], ANSWER[1], image
'''


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix='test-ingest-')
        self.tmp = Path(self._tmp.name).resolve()
        self.addCleanup(self._tmp.cleanup)
        # No convention palette: the palettes of the repository must not decide these tests. A run gets the palette
        # made here (the five colours of the fixtures) unless a test says palette=None: without a locked palette the
        # snapper changes colours unannounced and the verdict is "needs review", which is a result of its own.
        self.no_palettes = self.tmp / 'no-palettes'
        self.no_palettes.mkdir()
        self.default_palette = self.tmp / 'fixture-colours.hex'
        self.default_palette.write_text(''.join('%02x%02x%02x\n' % c for c in COLOURS + FILLER))
        for patch in (mock.patch.object(I, 'PALETTES', self.no_palettes),
                      mock.patch.dict(sys.modules, {'perfect_pixel': None})):   # None: "not importable", even if installed
            patch.start()
            self.addCleanup(patch.stop)
        for var in ('KONCLUI_DIST', toolchain.ALLOW_MISMATCH_ENV, toolchain.SHA256_ENV):
            patch = mock.patch.dict(os.environ)
            patch.start()
            self.addCleanup(patch.stop)
            os.environ.pop(var, None)

    def folder(self, name='in'):
        path = self.tmp / name
        path.mkdir(parents=True, exist_ok=True)
        return path

    def model(self, folder, name='piece.png', width=32, height=32, seed=0, **kw):
        path = Path(folder) / name
        model_like(sprite(width, height), seed=seed, **kw).save(path)
        return path

    def run_ingest(self, source, family='office', out=None, palette=DEFAULT, **kw):
        if palette is DEFAULT:
            palette = self.default_palette if I.PALETTE_MODULE.is_file() else None
        return I.run_ingest(source, family, out or self.tmp / 'out', palette=palette, **kw)


class Contract(Base):
    """The family rules and the verdict, on arrays: no tool involved."""

    def test_family_sizes(self):
        ok = {'office': [(32, 32), (64, 96)], 'avatars': [(96, 128)], 'pets': [(512, 32), (512, 128)]}
        bad = {'office': [(33, 32), (32, 31)], 'avatars': [(96, 129), (128, 96), (32, 32)],
               'pets': [(256, 32), (512, 33), (511, 32)]}
        for family in ok:
            for w, h in ok[family]:
                self.assertEqual(I.family_size_problems(family, w, h), [], (family, w, h))
            for w, h in bad[family]:
                self.assertTrue(I.family_size_problems(family, w, h), (family, w, h))
        self.assertIn('96x128', I.family_size_problems('avatars', 32, 32)[0])
        self.assertEqual(I.family_size_problems('avatars', 48, 64, cell=16), [])      # the cell option scales the rule
        with self.assertRaises(ValueError):
            I.family_size_problems('hats', 32, 32)

    def checks(self, pixels, family='office'):
        return {c['name']: c for c in I.contract_checks(pixels, family, 32)}

    def test_alpha_and_transparency_checks(self):
        px = sprite(32, 32)
        self.assertEqual({c['result'] for c in self.checks(px).values()}, {'pass'})
        px[10, 10, 3] = 128
        self.assertEqual(self.checks(px)['alpha']['result'], 'fail')
        opaque = px.copy()
        opaque[..., 3] = 255
        found = self.checks(opaque)
        self.assertEqual(found['transparency']['result'], 'fail')
        self.assertIn('background', found['transparency']['reason'])
        self.assertEqual(I.verdict_of(list(found.values())), 'needs review')

    def test_size_is_the_cell_grid_check_and_says_so_once(self):
        found = self.checks(sprite(33, 32))
        self.assertEqual(sorted(found), ['alpha', 'size', 'transparency'])        # no second "grid" check that repeats it
        self.assertEqual(found['size']['result'], 'fail')
        self.assertIn('is not a multiple of 32', found['size']['reason'])
        self.assertIn('on the 32 px cell grid', self.checks(sprite(64, 32))['size']['reason'])
        for family, width, height in (('avatars', 96, 129), ('pets', 512, 33)):
            self.assertEqual(self.checks(sprite(width, height), family)['size']['result'], 'fail')

    def test_colour_count_is_exact_and_counts_visible_pixels_only(self):
        px = np.zeros((2, 4, 4), np.uint8)
        px[0, 0] = (10, 20, 30, 255)
        px[0, 1] = (10, 20, 30, 255)             # the same colour twice
        px[0, 2] = (200, 0, 0, 255)
        px[0, 3] = (0, 0, 1, 7)                  # barely visible, still visible
        px[1, :, :3] = (1, 2, 3)                 # clear pixels with a colour of their own: not art
        px[1, 1, :3] = (9, 9, 9)
        self.assertEqual(I.colour_count(px), 3)
        self.assertEqual(I.colour_count(np.zeros((3, 3, 4), np.uint8)), 0)

    def test_colours_check_says_when_colours_were_changed_without_a_palette(self):
        locked = I.colours_check({(1, 2, 3), (4, 5, 6)}, 2, 2, 900, 2)
        self.assertEqual(locked['result'], 'pass')
        none = I.colours_check(None, None, 16, 900, 12)
        self.assertEqual(none['result'], 'fail')
        self.assertEqual(none['severity'], I.REVIEW)
        self.assertIn('reduced 900 colours to 12 (asked for at most 16)', none['reason'])
        self.assertIn('no palette for this run', none['reason'])
        big = I.colours_check(None, 377, 16, 900, 12)
        self.assertIn('377 colours and the snapper reads at most 256', big['reason'])
        self.assertEqual(I.verdict_of([I.check('size', True, '', I.REJECT), none]), 'needs review')

    def test_the_snapper_palette_limit_is_the_palette_lanes(self):
        if not I.PALETTE_MODULE.is_file():
            self.skipTest('tools/palettesnap.py is not there')
        self.assertEqual(I.MAX_SNAPPER_PALETTE, I.palette_lane().MAX_PALETTE)

    def test_verdict_of(self):
        passing = [I.check('size', True, '', I.REJECT)]
        self.assertEqual(I.verdict_of(passing), 'ready')
        self.assertEqual(I.verdict_of(passing + [I.not_checked('palette', 'x', I.REVIEW)]), 'ready')
        self.assertEqual(I.verdict_of(passing + [I.check('palette', False, 'x', I.REVIEW)]), 'needs review')
        both = passing + [I.check('palette', False, 'x', I.REVIEW), I.check('size', False, 'y', I.REJECT)]
        self.assertEqual(I.verdict_of(both), 'rejected')
        self.assertEqual(I.verdict_of(passing, refusal='not a picture'), 'rejected')

    def test_palette_check_names_the_off_colour(self):
        px = sprite(32, 32)
        self.assertEqual(I.palette_check(px, 32, (set(COLOURS), None))['result'], 'pass')
        off = I.palette_check(px, 32, (set(COLOURS[:3]), None))
        self.assertEqual(off['result'], 'fail')
        self.assertIn('outside the palette', off['reason'])
        record = I.not_checked('palette', 'why', I.REVIEW)
        self.assertIs(I.palette_check(px, 32, (None, record)), record)

    def test_preview_is_nearest_neighbour_and_deterministic(self):
        after = sprite(4, 4)
        before = model_like(after, scale=8)                       # 32x32
        a, b = I.preview(before, after), I.preview(before, after)
        self.assertEqual(a.tobytes(), b.tobytes())
        k = 8                                                     # the staged half is the staged picture times a whole k
        self.assertEqual(a.size, (32 + 8 + 4 * k, 4 * k))
        right = np.asarray(a)[:, 32 + 8:]
        for y, x in ((0, 0), (1, 2), (3, 3)):
            block = right[y * k:(y + 1) * k, x * k:(x + 1) * k]
            if after[y, x, 3] == 255:                              # an opaque pixel is one flat k x k block
                self.assertTrue((block == after[y, x, :3]).all(), (y, x))
        self.assertFalse((np.asarray(a)[:, 32:32 + 8] != 40).any())   # the gutter


class Refusals(Base):
    """What a run must not touch or write. None of these needs the snapper: a path refusal comes before the tool."""

    def assertRefused(self, source, out, fragment):
        with self.assertRaises(I.IngestRefused) as caught:
            I.run_ingest(source, 'office', out)
        self.assertIn(fragment, str(caught.exception))
        return caught.exception

    def test_output_inside_every_source_art_directory_is_refused(self):
        source = self.folder()
        self.model(source)
        for name in ('art', 'avatars', 'brand', 'design', 'hq-office', 'map', 'media', 'office', 'pets', 'theme',
                     'tools', 'tools/palettes', 'hq-office/dist'):
            out = I.SOURCE / name / 'ingest-test-must-not-exist'
            self.assertRefused(source, out, 'source art tree')
            self.assertFalse(out.exists(), name)
        self.assertRefused(source, I.SOURCE, 'source art tree')
        self.assertRefused(source, I.ART_ROOT / 'ingest-test-must-not-exist', 'source art tree')

    def test_output_around_the_source_art_is_refused(self):
        source = self.folder()
        self.assertRefused(source, I.ART_ROOT, 'contains the source art')
        self.assertRefused(source, I.ART_ROOT.parent, 'contains the source art')

    def test_inside_compares_by_identity_and_by_folded_name_for_a_folder_that_is_not_there(self):
        real = self.folder('a')
        self.assertTrue(I._inside(real / 'b' / 'c', real))
        self.assertTrue(I._inside(real, real))
        self.assertFalse(I._inside(self.tmp / 'ab', real))                    # a sibling that shares a prefix
        self.assertFalse(I._inside(real, real / 'b'))
        self.assertTrue(I._inside(self.tmp / 'Later' / 'x', self.tmp / 'later'))    # parent not there yet: name, case folded
        self.assertFalse(I._inside(self.tmp / 'Later2', self.tmp / 'later'))

    def test_a_different_case_of_a_path_component_does_not_get_past_the_refusals(self):
        """MEASURED before the fix, on this Mac: Path.resolve() keeps the case it is given, so ASSETS/... passed as
        'not inside the art tree' although os.path.samefile says it is the same folder."""
        if not case_insensitive(self.tmp):
            self.skipTest('this disk is case-sensitive: a different case is a different folder')
        source = self.folder('in_av')
        picture = self.model(source)
        shouting = I.ART_ROOT.parent.parent / 'ASSETS' / 'konclui' / 'source' / 'pets' / 'ingest-test-must-not-exist'
        self.assertRefused(source, shouting, 'source art tree')
        self.assertRefused(source, I.ART_ROOT.parent.parent / 'Assets' / 'KONCLUI' / 'Source' / 'Tools' / 'x', 'source art tree')
        self.assertRefused(source, str(I.ART_ROOT).replace('/assets/', '/ASSETS/'), 'contains the source art')
        self.assertRefused(source, I.ART_ROOT.parent.parent / 'ASSETS', 'contains the source art')
        self.assertFalse(shouting.exists())
        self.assertRefused(source, self.tmp / 'IN_AV', 'is the input')
        self.assertRefused(source, self.tmp / 'IN_AV' / 'staged', 'inside the input folder')
        self.assertRefused(picture, self.tmp / 'IN_AV', 'folder of the input file')
        self.assertRefused(picture, self.tmp / 'IN_AV' / 'PIECE.PNG', 'is the input')
        dist = self.folder('dist')
        os.environ['KONCLUI_DIST'] = str(dist)
        self.assertRefused(source, self.tmp / 'DIST' / 'staging', 'KONCLUI_DIST')
        self.assertRefused(source, self.tmp / 'Dist', 'KONCLUI_DIST')
        protected = self.folder('served-map')
        with self.assertRaises(I.IngestRefused) as caught:
            I.refuse_paths(source, self.tmp / 'SERVED-MAP' / 'x', protect=[protected])
        self.assertIn('--protect', str(caught.exception))
        # and the one allowed place stays allowed whatever its case
        I.refuse_paths(source, I.ART_ROOT / 'source' / 'TOOLS' / 'STAGING' / 'run-1')

    def test_protect_folders_and_published_maps_are_never_staging_folders(self):
        source = self.folder()
        self.model(source)
        served = self.folder('served')
        with self.assertRaises(I.IngestRefused) as caught:
            I.refuse_paths(source, served / 'staging', protect=[served])
        self.assertIn('--protect', str(caught.exception))
        with self.assertRaises(I.IngestRefused):
            I.refuse_paths(source, self.tmp, protect=[served])                    # around a protected folder
        I.refuse_paths(source, self.tmp / 'elsewhere', protect=[served])
        for name in (I.PUBLISH_LEDGER, 'campus.tmj'):
            held = self.folder('held-' + name.strip('.'))
            (held / name).write_text('{}')
            with self.assertRaises(I.IngestRefused) as caught:
                I.refuse_paths(source, held)
            self.assertIn('published map', str(caught.exception))
        command = [sys.executable, '-I', str(HERE / 'ingest.py'), 'run', str(source), '--family', 'office', '--out']
        done = subprocess.run(command + [str(served / 'x'), '--protect', str(served)], capture_output=True, text=True)
        self.assertEqual(done.returncode, 2)
        self.assertIn('--protect', done.stderr)
        self.assertFalse((served / 'x').exists())

    def test_output_in_the_staging_folder_is_the_one_allowed_place(self):
        I.refuse_paths(self.folder(), I.STAGING_ROOT / 'run-1')            # does not raise, creates nothing
        I.refuse_paths(self.folder(), I.STAGING_ROOT)
        self.assertFalse((I.STAGING_ROOT / 'run-1').exists())

    def test_output_inside_a_served_build_is_refused(self):
        source = self.folder()
        dist = self.folder('dist')
        os.environ['KONCLUI_DIST'] = str(dist)
        self.assertRefused(source, dist / 'staging', 'KONCLUI_DIST')
        self.assertRefused(source, dist, 'KONCLUI_DIST')

    def test_output_equal_to_or_around_the_input_is_refused(self):
        source = self.folder()
        picture = self.model(source)
        before = tree_bytes(source)
        self.assertRefused(picture, picture, 'is the input')
        self.assertRefused(source, source, 'is the input')
        self.assertRefused(source, source / 'staged', 'inside the input folder')
        self.assertRefused(picture, source, 'folder of the input file')
        self.assertEqual(tree_bytes(source), before)

    def test_output_that_is_a_file_or_a_missing_input_is_refused(self):
        source = self.folder()
        self.model(source)
        occupied = self.tmp / 'occupied'
        occupied.write_text('x')
        self.assertRefused(source, occupied, 'is not a folder')
        self.assertRefused(self.tmp / 'nothing-here', self.tmp / 'out', 'does not exist')

    def test_a_symlink_into_the_source_art_does_not_hide_it(self):
        source = self.folder()
        link = self.tmp / 'link'
        link.symlink_to(I.SOURCE / 'pets', target_is_directory=True)
        self.assertRefused(source, link / 'ingest-test-must-not-exist', 'source art tree')
        self.assertFalse((I.SOURCE / 'pets' / 'ingest-test-must-not-exist').exists())

    def test_bad_options_and_names_are_refused(self):
        source = self.folder()
        self.model(source)
        with self.assertRaises(I.IngestRefused):
            I.run_ingest(source, 'hats', self.tmp / 'out')
        with self.assertRaises(I.IngestRefused):
            I.run_ingest(source, 'office', self.tmp / 'out', palette=self.tmp / 'no-such.hex')
        with self.assertRaises(I.IngestRefused):
            I.run_ingest(source, 'office', self.tmp / 'out', cell=0)
        files = [source / 'a.png', source / 'a.jpg']
        with self.assertRaises(I.IngestRefused) as caught:
            I.staged_names(files)
        self.assertIn('both stage to a.png', str(caught.exception))
        with self.assertRaises(I.IngestRefused):
            I.staged_names([source / 'Report.png', source / 'report.png'])
        self.assertEqual(I.staged_names([source / 'my sprite!.png'])[source / 'my sprite!.png'], 'my_sprite_')


class MissingTool(Base):
    """principle 1: a missing tool stops the run, with the install command, and writes nothing."""

    def test_missing_tool_stops_the_run_with_toolmissing(self):
        source = self.folder()
        self.model(source)
        out = self.tmp / 'out'
        os.environ[toolchain.TOOLS['pixel-snapper']['env']] = str(self.tmp / 'no-such-snapper')
        with self.assertRaises(toolchain.ToolMissing) as caught:
            self.run_ingest(source, out=out)
        self.assertIn(toolchain.TOOLS['pixel-snapper']['install'], str(caught.exception))
        self.assertFalse(out.exists(), 'nothing is written when the tool is missing')

    def test_command_line_exits_2_with_the_install_command(self):
        source = self.folder()
        self.model(source)
        env = {**os.environ, toolchain.TOOLS['pixel-snapper']['env']: str(self.tmp / 'no-such-snapper')}
        done = subprocess.run([sys.executable, '-I', str(HERE / 'ingest.py'), 'run', str(source), '--family', 'office',
                               '--out', str(self.tmp / 'out')], capture_output=True, text=True, env=env)
        self.assertEqual(done.returncode, 2)
        self.assertIn('brew install', done.stderr)
        self.assertFalse((self.tmp / 'out').exists())

    def test_a_wrong_version_stops_the_run_too(self):
        source = self.folder()
        self.model(source)
        fake = self.tmp / 'snapper-9'
        fake.write_text('#!/bin/sh\necho "spritefusion-pixel-snapper 9.9.9"\n')
        fake.chmod(0o755)
        os.environ[toolchain.TOOLS['pixel-snapper']['env']] = str(fake)
        with self.assertRaises(toolchain.ToolMismatch):
            self.run_ingest(source)

    def test_a_tool_that_fails_on_one_picture_rejects_it_and_goes_on(self):
        source = self.folder()
        self.model(source, 'a.png')
        self.model(source, 'b.png')
        fake = self.tmp / 'snapper-bad'
        fake.write_text('#!/bin/sh\n[ "$1" = "--version" ] && { echo "spritefusion-pixel-snapper 1.0.0"; exit 0; }\n'
                        'echo "boom: cannot decode" >&2\nexit 3\n')
        fake.chmod(0o755)
        os.environ[toolchain.TOOLS['pixel-snapper']['env']] = str(fake)
        report = self.run_ingest(source)
        self.assertEqual([p['verdict'] for p in report['pictures']], ['rejected', 'rejected'])
        self.assertIn('boom: cannot decode', report['pictures'][0]['reasons'][0])
        self.assertEqual(I.exit_code(report), 1)


@needs_snapper
@needs_lane
class Run(Base):
    def test_the_grid_comes_back(self):
        source = self.folder()
        picture = self.model(source)
        native = sprite(32, 32)
        report = self.run_ingest(source)
        entry = report['pictures'][0]
        self.assertEqual(entry['verdict'], 'ready', entry['reasons'])
        self.assertEqual((entry['output']['width'], entry['output']['height']), (32, 32))
        self.assertEqual(entry['pixelSize']['detected'], 8.0)
        self.assertEqual(entry['pixelSize']['source'], 'auto-detected')
        self.assertEqual(entry['pixelSize']['impliedByWidth'], 8.0)
        staged = load(self.tmp / 'out' / 'piece.png')
        self.assertEqual(staged.shape, (32, 32, 4))
        # the silhouette is the drawn one, and the colour is the drawn one within the blur's reach
        self.assertGreater(((staged[..., 3] == 255) == (native[..., 3] == 255)).mean(), 0.9)
        both = (staged[..., 3] == 255) & (native[..., 3] == 255)
        near = np.abs(staged[..., :3].astype(int) - native[..., :3].astype(int)).sum(-1)[both] < 60
        self.assertGreater(near.mean(), 0.6)
        self.assertEqual(PG.problems(staged, 32), [])                      # the existing contract, over the output
        self.assertEqual(I.exit_code(report), 0)
        self.assertTrue(picture.exists())

    def test_partial_alpha_from_the_snapper_is_repaired_and_recorded(self):
        source = self.folder()
        self.model(source)
        entry = self.run_ingest(source)['pictures'][0]
        self.assertGreater(entry['alpha']['partialPx'], 0)                 # the snapper's own output had partial alpha
        self.assertIn(entry['alpha']['snapperOutput'], ('flat', 'aa'))
        self.assertEqual(entry['alpha']['afterRepair'], 'binary')
        alpha = load(self.tmp / 'out' / 'piece.png')[..., 3]
        self.assertEqual(set(np.unique(alpha)), {0, 255})
        self.assertEqual(entry['alpha']['transparentPx'] + entry['alpha']['opaquePx'], 32 * 32)

    def test_the_report_has_what_the_lane_promises(self):
        source = self.folder()
        picture = self.model(source)
        report = self.run_ingest(source)
        on_disk = json.loads((self.tmp / 'out' / 'report.json').read_text())
        self.assertEqual(on_disk, report)
        entry = report['pictures'][0]
        self.assertEqual(entry['input']['sha256'], file_hash(picture))
        self.assertEqual(entry['output']['sha256'], file_hash(self.tmp / 'out' / 'piece.png'))
        # exact counts, worked out here from the pixels and not from the tool: the visible colours of the picture that
        # was read and of the file that was staged (clear pixels carry noisy colours of their own, which are not art)
        with Image.open(picture) as image:
            read = np.asarray(image.convert('RGBA'))
        visible = lambda px: {tuple(int(v) for v in p[:3]) for p in px.reshape(-1, 4) if p[3] > 0}
        self.assertGreater(len(visible(read)), 1000)
        self.assertGreater(len(np.unique(read[read[..., 3] == 0][:, :3], axis=0)), 1)    # so the test can tell
        self.assertEqual(entry['input']['colours'], len(visible(read)))
        staged_colours = visible(load(self.tmp / 'out' / 'piece.png'))
        self.assertEqual(entry['output']['colours'], len(staged_colours))
        self.assertTrue(staged_colours <= set(COLOURS))
        self.assertEqual(entry['quantisation'], {'colourCount': 32, 'palette': 'handed to the snapper'})
        self.assertEqual([c['name'] for c in entry['checks']],
                         ['size', 'alpha', 'transparency', 'palette', 'colours', 'second-opinion'])
        self.assertTrue(all(c['reason'] for c in entry['checks']))
        self.assertEqual(report['toolchain']['tools']['pixel-snapper']['version'], '1.0.0')
        self.assertTrue(list(report)[-1] == 'promotion' and 'copies' in report['promotion'])
        self.assertEqual(report['summary'], {'ready': 1, 'needs review': 0, 'rejected': 0})
        self.assertFalse(report['incomplete'])
        self.assertEqual(load(self.tmp / 'out' / 'piece.preview.png').shape[0], 32 * 8)                          # 32 px staged, shown 8x (the input is 256)
        self.assertNotIn(str(self.tmp), (self.tmp / 'out' / 'report.json').read_text())   # no machine path inside
        self.assertEqual(sorted(p.name for p in (self.tmp / 'out').iterdir()),
                         ['piece.png', 'piece.preview.png', 'report.json'])

    def test_a_picture_that_cannot_meet_the_family_size_is_rejected_with_the_reason(self):
        source = self.folder()
        self.model(source)                                                  # 32x32 out of the snapper
        avatar = self.run_ingest(source, 'avatars')
        entry = avatar['pictures'][0]
        self.assertEqual(entry['verdict'], 'rejected')
        self.assertIn('size 32x32 is not 96x128', entry['reasons'][0])
        self.assertEqual(I.exit_code(avatar), 1)
        self.assertEqual(sorted(p.name for p in (self.tmp / 'out').iterdir()), ['rejected', 'report.json'])
        pet = self.run_ingest(source, 'pets', out=self.tmp / 'out-pets')['pictures'][0]
        self.assertEqual(pet['verdict'], 'rejected')
        self.assertIn('width 32 is not 512', pet['reasons'][0])
        self.assertEqual(self.run_ingest(source, 'office', out=self.tmp / 'out-office')['pictures'][0]['verdict'], 'ready')

    def test_a_rejected_picture_is_never_staged_beside_the_ready_ones(self):
        """MEASURED before the fix: a rejected picture was written as NAME.png next to the ready ones."""
        source = self.folder()
        self.model(source, 'tiny.png')                                     # 32x32 out: fine for office, not for avatars
        self.model(source, 'woka.png', width=96, height=128, seed=3)       # fine for avatars
        report = self.run_ingest(source, 'avatars')
        by_name = {p['name']: p for p in report['pictures']}
        self.assertEqual({n: p['verdict'] for n, p in by_name.items()}, {'tiny.png': 'rejected', 'woka.png': 'ready'})
        out = self.tmp / 'out'
        self.assertEqual(sorted(p.name for p in out.iterdir()), ['rejected', 'report.json', 'woka.png', 'woka.preview.png'])
        self.assertEqual(sorted(p.name for p in (out / 'rejected').iterdir()), ['tiny.png', 'tiny.preview.png'])
        rejected = by_name['tiny.png']
        self.assertIsNone(rejected['staged'])
        self.assertEqual((rejected['inspection'], rejected['preview']), ('rejected/tiny.png', 'rejected/tiny.preview.png'))
        self.assertEqual(rejected['output']['sha256'], file_hash(out / 'rejected' / 'tiny.png'))
        self.assertEqual(by_name['woka.png']['staged'], 'woka.png')
        # a rerun with the picture fixed removes the inspection copies of the last run
        self.run_ingest(source, 'office', out=out)
        self.assertEqual(sorted(p.name for p in out.iterdir()),
                         ['report.json', 'tiny.png', 'tiny.preview.png', 'woka.png', 'woka.preview.png'])

    def test_a_crash_in_the_middle_leaves_no_staged_file_and_a_reusable_folder(self):
        """MEASURED before the fix: an exception after the first picture left staged files and no report.json, and the
        next run into that folder was refused as 'not a previous run'."""
        source = self.folder()
        self.model(source, 'a.png')
        self.model(source, 'b.png', seed=1)
        out = self.tmp / 'out'
        real, calls = I.preview, []

        def failing(before, after, **kw):
            calls.append(1)
            if len(calls) == 2:
                raise RuntimeError('disk full, say')
            return real(before, after, **kw)
        with mock.patch.object(I, 'preview', failing), self.assertRaises(RuntimeError):
            self.run_ingest(source, out=out)
        self.assertEqual([p.name for p in out.iterdir()], ['report.json'])
        report = json.loads((out / 'report.json').read_text())
        self.assertTrue(report['incomplete'])
        self.assertIn('disk full, say', report['error'])
        self.assertEqual((report['pictures'], report['discarded']), ([], ['a.png']))
        again = self.run_ingest(source, out=out)                           # the folder can be reused
        self.assertFalse(again['incomplete'])
        self.assertEqual(sorted(p.name for p in out.iterdir()),
                         ['a.png', 'a.preview.png', 'b.png', 'b.preview.png', 'report.json'])

    def test_without_a_palette_the_colours_are_changed_and_the_picture_needs_review(self):
        """MEASURED before the fix: no palette meant a hard-coded 16 colours and a "ready" verdict, silently."""
        source = self.folder()
        self.model(source)
        report = self.run_ingest(source, palette=None)
        entry = report['pictures'][0]
        self.assertEqual(entry['verdict'], 'needs review')
        self.assertEqual(entry['quantisation'], {'colourCount': 16, 'palette': 'none'})
        colours = [c for c in entry['checks'] if c['name'] == 'colours'][0]
        self.assertEqual(colours['result'], 'fail')
        self.assertIn('no locked palette handed to it', colours['reason'])
        self.assertEqual(report['palette']['appliedBy'], 'not applied')
        self.assertEqual(I.exit_code(report), 1)

    def test_a_palette_over_256_colours_is_checked_after_the_snap_and_never_handed_to_the_tool(self):
        """MEASURED before the fix: pets.hex (377 colours) was handed over and every pets picture came back
        'the pixel snapper failed: Palette must contain at most 256 distinct colors'."""
        source = self.folder()
        self.model(source)
        big = self.tmp / 'big.hex'
        extra = [(i % 256, 100 + (i // 256) * 40, (i * 5) % 256) for i in range(300)]
        big.write_text(''.join('%02x%02x%02x\n' % c for c in COLOURS + extra))
        report = self.run_ingest(source, palette=big)
        entry = report['pictures'][0]
        self.assertEqual(report['palette']['colours'], 305)
        self.assertIn('checked after the snap only: 305 colours', report['palette']['appliedBy'])
        self.assertEqual(entry['quantisation'], {'colourCount': 16, 'palette': 'checked after the snap only'})
        self.assertNotIn('snapper failed', ' '.join(entry['reasons']))
        self.assertNotEqual(entry['verdict'], 'rejected')
        colours = [c for c in entry['checks'] if c['name'] == 'colours'][0]
        self.assertEqual(colours['result'], 'fail')
        self.assertIn('305 colours and the snapper reads at most 256', colours['reason'])
        palette = [c for c in entry['checks'] if c['name'] == 'palette'][0]
        self.assertIn(palette['result'], ('pass', 'fail'))                 # the whole palette was checked either way
        self.assertIn('305' if palette['result'] == 'pass' else 'outside the palette', palette['reason'])

    def test_each_family_runs_with_its_own_palette_file_of_the_repository(self):
        """MEASURED before the fix: office and avatars were fine, pets was rejected by the tool. One run per family,
        with palettes/<family>.hex as it is on disk."""
        shapes = {'office': (32, 32, 8), 'avatars': (96, 128, 8), 'pets': (512, 64, 4)}
        for family, (width, height, scale) in shapes.items():
            source = self.folder(f'in-{family}')
            model_like(sprite(width, height), scale=scale, seed=0).save(source / 'piece.png')
            with mock.patch.object(I, 'PALETTES', REAL_PALETTES):
                report = self.run_ingest(source, family, out=self.tmp / f'out-{family}', palette=None)
            entry = report['pictures'][0]
            self.assertEqual(report['palette']['file'], f'{family}.hex')
            self.assertEqual(report['palette']['source'], 'convention')
            self.assertNotIn('snapper failed', ' '.join(entry['reasons']), family)
            self.assertIn('output', entry, family)
            handed = len(I.palette_lane().read_palette(REAL_PALETTES / f'{family}.hex')) <= I.MAX_SNAPPER_PALETTE
            self.assertEqual(entry['quantisation']['palette'], 'handed to the snapper' if handed else 'checked after the snap only',
                             family)
            if handed:
                palette = [c for c in entry['checks'] if c['name'] == 'palette'][0]
                self.assertEqual(palette['result'], 'pass', (family, palette['reason']))
        self.assertFalse(handed)                                           # pets: more than the tool reads

    def test_an_avatar_sized_picture_is_ready_for_avatars_and_not_for_pets(self):
        source = self.folder()
        self.model(source, 'woka.png', width=96, height=128, seed=3)
        self.assertEqual(self.run_ingest(source, 'avatars')['pictures'][0]['verdict'], 'ready')
        self.assertEqual(self.run_ingest(source, 'pets', out=self.tmp / 'out-pets')['pictures'][0]['verdict'], 'rejected')

    def test_a_given_pixel_size_is_passed_to_the_snapper(self):
        source = self.folder()
        self.model(source)
        entry = self.run_ingest(source, pixel_size=8)['pictures'][0]
        self.assertEqual(entry['pixelSize']['detected'], 8.0)
        self.assertEqual(entry['pixelSize']['source'], 'override')
        crude = self.run_ingest(source, pixel_size=3, out=self.tmp / 'out-3')['pictures'][0]
        self.assertEqual(crude['pixelSize']['source'], 'override')
        self.assertGreater(crude['output']['width'], 64)                    # a wrong size gives a wrong grid, and says so
        self.assertEqual(crude['verdict'], 'rejected')

    def test_inputs_that_are_not_pictures_are_rejected_not_staged(self):
        source = self.folder()
        self.model(source, 'good.png')
        (source / 'notes.txt').write_text('hello')
        (source / 'fake.png').write_text('not a png')
        Image.new('P', (8, 8)).save(source / 'gif-as-png.png', format='GIF')
        Image.fromarray(sprite(4, 4), 'RGBA').convert('RGB').save(source / 'jpeg-as-png.png', format='JPEG')
        (source / '.hidden.png').write_text('skipped: hidden files are not pictures to ingest')
        report = self.run_ingest(source, max_pixels=100)
        by_name = {p['name']: p for p in report['pictures']}
        self.assertEqual(sorted(by_name), ['fake.png', 'gif-as-png.png', 'good.png', 'jpeg-as-png.png', 'notes.txt'])
        self.assertIn('extension .txt', by_name['notes.txt']['reasons'][0])
        self.assertIn('not a readable picture', by_name['fake.png']['reasons'][0])
        self.assertIn('is a GIF picture, not PNG, JPEG or WEBP', by_name['gif-as-png.png']['reasons'][0])
        self.assertIn('named like a PNG but holds a JPEG', by_name['jpeg-as-png.png']['reasons'][0])
        self.assertIn('is larger than the limit of 100 px', by_name['good.png']['reasons'][0])   # 256x256 > 100
        self.assertEqual({p['verdict'] for p in report['pictures']}, {'rejected'})
        self.assertEqual([p.name for p in (self.tmp / 'out').iterdir()], ['report.json'])

    def test_a_picture_over_the_byte_limit_is_rejected_unread(self):
        source = self.folder()
        self.model(source)
        entry = self.run_ingest(source, max_bytes=1000)['pictures'][0]
        self.assertEqual(entry['verdict'], 'rejected')
        self.assertIn('larger than the limit of 1000', entry['reasons'][0])
        self.assertNotIn('sha256', entry['input'])

    def test_animated_pictures_are_rejected(self):
        source = self.folder()
        frames = [Image.fromarray(sprite(8, 8, seed=s), 'RGBA') for s in (1, 2)]
        frames[0].save(source / 'moving.webp', save_all=True, append_images=frames[1:], duration=100, lossless=True)
        entry = self.run_ingest(source)['pictures'][0]
        self.assertEqual(entry['verdict'], 'rejected')
        self.assertIn('animated', entry['reasons'][0])

    def test_jpeg_and_webp_are_taken(self):
        source = self.folder()
        base = model_like(sprite(32, 32), seed=0)
        base.convert('RGB').save(source / 'photo.jpg', quality=98)
        base.save(source / 'lossless.webp', lossless=True)
        report = self.run_ingest(source)
        by_name = {p['name']: p for p in report['pictures']}
        self.assertEqual(by_name['lossless.webp']['input']['convertedForSnapper'], 'webp to png')
        self.assertEqual(by_name['lossless.webp']['pixelSize']['detected'], 8.0)
        self.assertEqual(by_name['photo.jpg']['pixelSize']['detected'], 8.0)
        self.assertEqual(by_name['photo.jpg']['alpha']['snapperOutput'], 'none')
        self.assertEqual({c['name']: c['result'] for c in by_name['photo.jpg']['checks']}['transparency'], 'fail')           # a JPEG has no transparency
        self.assertEqual(by_name['photo.jpg']['verdict'] in ('needs review', 'rejected'), True)
        self.assertTrue((self.tmp / 'out' / 'lossless.png').exists())

    def test_the_input_is_never_modified(self):
        source = self.folder()
        single = self.model(source, 'a.png')
        self.model(source, 'b.png', seed=1)
        (source / 'junk.txt').write_text('x')
        before_tree, before_stat = tree_bytes(source), {p.name: p.stat().st_mtime_ns for p in source.iterdir()}
        before = file_hash(single)
        self.run_ingest(source)
        self.run_ingest(single, out=self.tmp / 'out-single')
        self.assertEqual(file_hash(single), before)
        self.assertEqual(tree_bytes(source), before_tree)
        self.assertEqual({p.name: p.stat().st_mtime_ns for p in source.iterdir()}, before_stat)

    def test_the_run_is_deterministic(self):
        source = self.folder()
        self.model(source, 'a.png')
        self.model(source, 'b.png', width=96, height=128, seed=3)
        self.run_ingest(source, 'avatars', out=self.tmp / 'one')
        self.run_ingest(source, 'avatars', out=self.tmp / 'two')
        one, two = tree_bytes(self.tmp / 'one'), tree_bytes(self.tmp / 'two')
        self.assertEqual(sorted(one), ['b.png', 'b.preview.png', 'rejected/a.png', 'rejected/a.preview.png', 'report.json'])
        self.assertEqual(one, two)

    def test_a_second_run_into_the_same_folder_replaces_the_first_and_leaves_no_stale_file(self):
        source = self.folder()
        self.model(source, 'a.png')
        self.model(source, 'b.png')
        self.run_ingest(source)
        self.assertTrue((self.tmp / 'out' / 'b.png').exists())
        (source / 'b.png').write_text('now broken')
        report = self.run_ingest(source)
        self.assertEqual(sorted(p.name for p in (self.tmp / 'out').iterdir()), ['a.png', 'a.preview.png', 'report.json'])
        self.assertEqual({p['name']: p['verdict'] for p in report['pictures']}, {'a.png': 'ready', 'b.png': 'rejected'})

    def test_a_folder_that_is_not_a_previous_run_is_not_cleaned(self):
        source = self.folder()
        self.model(source)
        out = self.folder('out')
        (out / 'precious.txt').write_text('mine')
        with self.assertRaises(I.IngestRefused):
            self.run_ingest(source, out=out)
        self.assertEqual((out / 'precious.txt').read_text(), 'mine')
        self.run_ingest(source, out=self.tmp / 'fresh')
        (self.tmp / 'fresh' / 'precious.txt').write_text('mine')
        with self.assertRaises(I.IngestRefused):
            self.run_ingest(source, out=self.tmp / 'fresh')
        self.assertEqual((self.tmp / 'fresh' / 'precious.txt').read_text(), 'mine')

    def test_an_empty_folder_is_not_green(self):
        source = self.folder()
        report = self.run_ingest(source)
        self.assertEqual(report['pictures'], [])
        self.assertEqual(I.exit_code(report), 1)

    def cli(self, source, out, *options):
        return subprocess.run([sys.executable, '-I', str(HERE / 'ingest.py'), 'run', str(source), '--out', str(out), *options],
                              capture_output=True, text=True)

    def test_command_line_exit_codes(self):
        """MEASURED mutation: main() returning 1 always used to pass, because the ready case accepted (0, 1)."""
        source = self.folder()
        self.model(source)
        ready = self.cli(source, self.tmp / 'a', '--family', 'office', '--palette', str(self.default_palette))
        self.assertEqual(ready.returncode, 0, ready.stdout + ready.stderr)
        self.assertIn('1 ready, 0 need review, 0 rejected', ready.stdout)
        self.assertIn('copies its', ready.stdout.splitlines()[-1])
        opaque = self.folder('in-opaque')                                  # a background kept: a judgement, not a refusal
        px = sprite(32, 32)
        px[..., 3] = 255
        model_like(px, seed=3).save(opaque / 'piece.png')
        review = self.cli(opaque, self.tmp / 'r', '--family', 'office', '--palette', str(self.default_palette))
        self.assertEqual(review.returncode, 1, review.stdout + review.stderr)
        self.assertIn('NEEDS REVIEW', review.stdout)
        rejected = self.cli(source, self.tmp / 'b', '--family', 'avatars', '--palette', str(self.default_palette))
        self.assertEqual(rejected.returncode, 1)
        self.assertIn('REJECTED', rejected.stdout)
        refused = self.cli(source, I.SOURCE / 'pets' / 'x', '--family', 'office')
        self.assertEqual(refused.returncode, 2)
        self.assertIn('source art tree', refused.stderr)
        self.assertFalse((I.SOURCE / 'pets' / 'x').exists())


@needs_snapper
@needs_lane
class SecondOpinion(Base):
    """perfect_pixel is optional and has no licence: a fake one stands in, and its absence changes nothing else."""

    def setUp(self):
        super().setUp()
        self.module_dir = self.folder('fake-modules')
        (self.module_dir / 'perfect_pixel.py').write_text(FAKE_PERFECT_PIXEL)
        self.source = self.folder()
        self.model(self.source)

    def with_fake(self, answer, out):
        """Run with the fake importable (on sys.path, as an installed module would be)."""
        sys.modules.pop('perfect_pixel', None)
        try:
            with mock.patch.object(sys, 'path', [str(self.module_dir)] + sys.path):
                report = self.run_ingest(self.source, out=out)
                module = sys.modules['perfect_pixel']
                return report, module
        finally:
            sys.modules['perfect_pixel'] = None            # back to Base's "not importable"

    def run_with_answer(self, answer, out):
        (self.module_dir / 'perfect_pixel.py').write_text(FAKE_PERFECT_PIXEL.replace('(32, 32)', repr(answer)))
        return self.with_fake(answer, out)

    def test_agreement_is_recorded_and_the_picture_stays_ready(self):
        report, module = self.run_with_answer((32, 32), self.tmp / 'with')
        entry = report['pictures'][0]
        self.assertEqual(entry['secondOpinion'], {'status': 'agree', 'perfectPixelGrid': [32, 32], 'snapperGrid': [32, 32]})
        self.assertEqual(entry['verdict'], 'ready')
        self.assertEqual(module.CALLS, [((256, 256, 3), 'uint8')])        # colour channels of the input only

    def test_disagreement_marks_the_picture_needs_review(self):
        report, _ = self.run_with_answer((16, 16), self.tmp / 'with')
        entry = report['pictures'][0]
        self.assertEqual(entry['secondOpinion']['status'], 'disagree')
        self.assertEqual(entry['verdict'], 'needs review')
        self.assertIn('they disagree', entry['reasons'][0])
        self.assertEqual(I.exit_code(report), 1)

    def test_a_module_that_fails_is_recorded_and_changes_no_verdict(self):
        (self.module_dir / 'perfect_pixel.py').write_text('def get_perfect_pixel(image, **kw):\n    raise RuntimeError("no cv2")\n')
        report, _ = self.with_fake(None, self.tmp / 'with')
        entry = report['pictures'][0]
        self.assertEqual(entry['secondOpinion']['status'], 'error')
        self.assertIn('no cv2', entry['secondOpinion']['reason'])
        self.assertEqual(entry['verdict'], 'ready')

    def test_it_never_produces_the_output_and_its_absence_changes_nothing_else(self):
        without = self.run_ingest(self.source, out=self.tmp / 'without')
        agree, _ = self.run_with_answer((32, 32), self.tmp / 'agree')
        disagree, _ = self.run_with_answer((7, 9), self.tmp / 'disagree')
        for other in ('agree', 'disagree'):                                 # staged picture and preview: same bytes
            for name in ('piece.png', 'piece.preview.png'):
                self.assertEqual((self.tmp / other / name).read_bytes(), (self.tmp / 'without' / name).read_bytes())
        self.assertEqual(without['pictures'][0]['secondOpinion'], {'status': 'not available'})

        def strip(report):
            report = json.loads(json.dumps(report))
            for p in report['pictures']:
                p.pop('secondOpinion')
                p['checks'] = [c for c in p['checks'] if c['name'] != 'second-opinion']
                p.pop('reasons'), p.pop('verdict')
            report.pop('summary')
            return report
        self.assertEqual(strip(agree), strip(without))
        self.assertEqual(strip(disagree), strip(without))
        self.assertEqual(without['pictures'][0]['verdict'], 'ready')
        self.assertEqual(agree['pictures'][0]['verdict'], 'ready')
        check = [c for c in without['pictures'][0]['checks'] if c['name'] == 'second-opinion'][0]
        self.assertEqual(check['result'], 'not checked')


@needs_snapper
class Palette(Base):
    """The palette comes from the palette lane's module, looked up when the run needs it."""

    def setUp(self):
        super().setUp()
        self.source = self.folder()
        self.model(self.source)
        self.palette = self.tmp / 'mine.hex'
        self.palette.write_text(''.join('%02x%02x%02x\n' % c for c in COLOURS))

    def palette_check(self, report):
        return [c for c in report['pictures'][0]['checks'] if c['name'] == 'palette'][0]

    def fake_lane(self, text):
        lane = self.tmp / 'palettesnap.py'
        lane.write_text(text)
        return mock.patch.object(I, 'PALETTE_MODULE', lane)

    def test_no_palette_file_for_the_family_is_not_checked_and_does_not_fail(self):
        report = I.run_ingest(self.source, 'office', self.tmp / 'out')
        check = self.palette_check(report)
        self.assertEqual(check['result'], 'not checked')
        self.assertIn('no palettes/office.hex', check['reason'])
        self.assertEqual(report['pictures'][0]['verdict'], 'needs review')       # not for the palette: for the colours
        self.assertEqual([c['name'] for c in report['pictures'][0]['checks'] if c['result'] == 'fail'], ['colours'])
        self.assertIsNone(report['palette']['file'])

    def test_the_lane_is_absent_is_not_checked_and_does_not_fail(self):
        with mock.patch.object(I, 'PALETTE_MODULE', self.tmp / 'palettesnap-not-written-yet.py'):
            report = self.run_ingest(self.source, palette=self.palette)
        check = self.palette_check(report)
        self.assertEqual(check['result'], 'not checked')
        self.assertIn('palettesnap.py is not there yet', check['reason'])
        self.assertEqual(report['pictures'][0]['verdict'], 'needs review')       # the snapper had no palette: colours moved
        self.assertEqual([c['name'] for c in report['pictures'][0]['checks'] if c['result'] == 'fail'], ['colours'])
        self.assertEqual(report['palette']['lane'], 'palettesnap.py absent')

    @unittest.skipUnless(I.PALETTE_MODULE.is_file(), 'tools/palettesnap.py is not there')
    def test_with_the_real_lane_the_palette_is_given_to_the_snapper_and_checked(self):
        report = self.run_ingest(self.source, palette=self.default_palette)
        entry = report['pictures'][0]
        self.assertEqual(entry['verdict'], 'ready', entry['reasons'])
        self.assertEqual(self.palette_check(report)['result'], 'pass', entry['reasons'])
        self.assertEqual(report['palette']['colours'], 32)
        self.assertEqual(report['palette']['source'], 'explicit')
        staged = load(self.tmp / 'out' / 'piece.png')
        used = {tuple(int(v) for v in p[:3]) for p in staged.reshape(-1, 4) if p[3]}
        self.assertTrue(used <= set(COLOURS + FILLER), used - set(COLOURS + FILLER))
        self.assertLessEqual(entry['output']['colours'], 32)

    def test_a_palette_named_under_palettes_is_found(self):
        (self.no_palettes / 'mine.hex').write_text(self.palette.read_text())
        self.assertEqual(I.resolve_palette('office', 'mine'), self.no_palettes / 'mine.hex')
        (self.no_palettes / 'office.hex').write_text(self.palette.read_text())
        self.assertEqual(I.resolve_palette('office', None), self.no_palettes / 'office.hex')
        self.assertIsNone(I.resolve_palette('pets', None))

    def test_a_lane_that_cannot_read_the_palette_fails_the_check_loudly(self):
        for text, why in (('X = 1\n', 'has no read_palette'),
                          ('def read_palette(spec):\n    raise ValueError("bad line 3")\n', 'bad line 3'),
                          ('def read_palette(spec):\n    return []\n', 'non-empty'),
                          ('raise RuntimeError("syntax of the day")\n', 'cannot be loaded')):
            with self.fake_lane(text):
                report = self.run_ingest(self.source, palette=self.palette, out=self.tmp / f'out-{abs(hash(text))}')
            check = self.palette_check(report)
            self.assertEqual(check['result'], 'fail', why)
            self.assertIn(why, check['reason'])
            self.assertEqual(report['pictures'][0]['verdict'], 'needs review')

    def test_the_colours_the_lane_reads_are_handed_to_the_snapper_and_checked(self):
        with self.fake_lane('def read_palette(spec):\n    return [(200, 60, 40), (40, 120, 200)]\n'):
            report = self.run_ingest(self.source, palette=self.palette)
        entry = report['pictures'][0]
        self.assertEqual(report['palette']['colours'], 2)
        self.assertLessEqual(entry['output']['colours'], 2)
        self.assertEqual(self.palette_check(report)['result'], 'pass')


if __name__ == '__main__':
    unittest.main()
