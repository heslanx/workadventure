"""Behaviour tests of tools/toolchain.py: where a SpriteFusion tool is found, what it is, and what happens when it is
missing, wrong or the wrong version. Fake tools are shell scripts in a temporary directory; the three real tools are
exercised too, and skipped with their install command on a host that lacks one.
Run (from assets/konclui/source): python3 -I tools/test_toolchain.py"""
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

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pixelgrid as PG  # noqa: E402
import toolchain as TC  # noqa: E402

SCRIPT = HERE / 'toolchain.py'
ENVS = [spec['env'] for spec in TC.TOOLS.values()]


FIXED_HELP = 'usage: tool INPUT OUTPUT [COLORS] [--pixel-size N] [--expect-cell N] [--palette HEX]'
STOCK_HELP = 'usage: tool INPUT OUTPUT [COLORS] [--pixel-size N] [--palette HEX]'


def fake_tool(directory, binary, version='1.0.0', mode='ok', help_text=FIXED_HELP):
    """A shell script named `binary` in `directory`. --version prints `<binary> <version>` (mode 'ok'), fails (mode
    'novers') or prints no number (mode 'garbage'), prints a good number but exits 1 (mode 'failver') or hangs (mode 'hang');
    --help prints `help_text` (FIXED_HELP lists --expect-cell, which is how the fixed pixel snapper is told from the stock
    one; STOCK_HELP does not); any other call prints to stdout and stderr and exits with the first argument when it is a
    number."""
    path = Path(directory) / binary
    versions = {'ok': f'echo "{binary} {version}"', 'novers': 'echo broken >&2; exit 3', 'garbage': 'echo "no number here"',
                'failver': f'echo "{binary} {version}"; exit 1', 'hang': 'exec /bin/sleep 30'}
    path.write_text('#!/bin/sh\n'
                    f'if [ "$1" = "--version" ]; then {versions.get(mode) or mode}; exit 0; fi\n'
                    f'if [ "$1" = "--help" ]; then echo "{help_text}"; exit 0; fi\n'
                    'echo "out:$*"; echo "err:$*" >&2; case "$1" in [0-9]*) exit "$1";; esac; exit 0\n')
    path.chmod(0o755)
    return str(path)


def clean_env(tmp, **extra):
    """An environment with an empty PATH directory, a HOME with no ~/.cargo, and no tool variable set."""
    empty, home = Path(tmp) / 'empty-path', Path(tmp) / 'home'
    empty.mkdir(exist_ok=True)
    home.mkdir(exist_ok=True)
    env = {'PATH': str(empty), 'HOME': str(home), **{name: '' for name in ENVS}}
    env.update({k: '' for k in (TC.ALLOW_MISMATCH_ENV, TC.SHA256_ENV)})
    env.update(extra)
    return env


def pinned(name):
    return TC.TOOLS[name]['version']


class Pins(unittest.TestCase):
    def test_the_three_tools_are_read_from_the_json_file(self):
        data = json.loads(TC.PINS_FILE.read_text())['tools']
        self.assertEqual(sorted(TC.TOOLS), ['palette-snapper', 'pixel-snapper', 'sprite-normals'])
        for name, spec in TC.TOOLS.items():
            self.assertEqual({k: v for k, v in spec.items() if k != 'sha256'}, {k: v for k, v in data[name].items() if k != 'sha256'})
            self.assertEqual(list(spec['sha256']), data[name]['sha256'])
            self.assertRegex(spec['commit'], r'^[0-9a-f]{40}$')
            self.assertEqual(spec['license'], 'MIT')

    def test_the_existing_variables_keep_their_names_and_the_new_one_follows_the_pattern(self):
        self.assertEqual(TC.TOOLS['pixel-snapper']['env'], 'SPRITEFUSION_PIXEL_SNAPPER_BIN')
        self.assertEqual(TC.TOOLS['sprite-normals']['env'], 'SPRITEFUSION_NORMALS_BIN')
        self.assertEqual(TC.TOOLS['palette-snapper']['env'], 'SPRITEFUSION_PALETTE_SNAPPER_BIN')
        self.assertEqual({s['binary'] for s in TC.TOOLS.values()},
                         {'spritefusion-pixel-snapper-fixed', 'spritefusion-sprite-normals', 'spritefusion-palette-snapper'})

    def test_a_cargo_install_command_pins_the_commit_it_is_compared_against(self):
        for name in ('sprite-normals', 'palette-snapper'):
            spec = TC.TOOLS[name]
            self.assertIn(f'--rev {spec["commit"]}', spec['install'])
            self.assertIn(spec['repository'], spec['install'])
            self.assertIn('--locked', spec['install'])
        self.assertIn('tools/build_pixel_snapper.py', TC.TOOLS['pixel-snapper']['install'])     # the fixed build is made here, not brewed

    def test_a_malformed_pin_file_is_rejected_naming_the_file(self):
        good = json.loads(TC.PINS_FILE.read_text())
        broken = {
            'a short commit': lambda d: d['tools']['pixel-snapper'].update(commit='abc123'),
            'a missing tool': lambda d: d['tools'].pop('palette-snapper'),
            'an extra field': lambda d: d['tools']['sprite-normals'].update(extra='x'),
            'an empty version': lambda d: d['tools']['sprite-normals'].update(version=' '),
            'a bad hash': lambda d: d['tools']['pixel-snapper'].update(sha256=['xyz']),
            'a patch with no hash': lambda d: d['tools']['pixel-snapper'].pop('patchSha256'),
            'a patch hash with no patch': lambda d: d['tools']['sprite-normals'].update(patchSha256='0' * 64),
            'a bad patch hash': lambda d: d['tools']['pixel-snapper'].update(patchSha256='abc'),
            'an absolute patch path': lambda d: d['tools']['pixel-snapper'].update(patch='/etc/passwd'),
            'a patch path that leaves the folder': lambda d: d['tools']['pixel-snapper'].update(patch='../x.patch'),
            'a capability with no needle': lambda d: d['tools']['pixel-snapper'].update(capability={'args': ['--help']}),
            'a capability with no args': lambda d: d['tools']['pixel-snapper'].update(capability={'args': [], 'contains': 'x'}),
            'a stock entry with an extra field': lambda d: d['stock']['pixel-snapper'].update(extra='x'),
            'a stock entry of an unknown tool': lambda d: d['stock'].update({'perfect-pixel': d['stock']['pixel-snapper']}),
            'a stock bad hash': lambda d: d['stock']['pixel-snapper'].update(sha256=['xyz']),
            'a stock short commit': lambda d: d['stock']['pixel-snapper'].update(commit='abc123'),
        }
        with tempfile.TemporaryDirectory() as tmp:
            for label, mutate in broken.items():
                data = json.loads(json.dumps(good))
                mutate(data)
                path = Path(tmp) / 'toolchain.json'
                path.write_text(json.dumps(data))
                with self.subTest(label), self.assertRaises(ValueError) as raised:
                    TC.load_pins(path)
                    TC.load_stock(path)
                self.assertIn(str(path), str(raised.exception))
            path.write_text(json.dumps(good))
            self.assertEqual(sorted(TC.load_pins(path)), sorted(TC.TOOLS))
            self.assertEqual(sorted(TC.load_stock(path)), sorted(TC.STOCK))

    def test_an_unknown_tool_name_is_a_key_error(self):
        with self.assertRaises(KeyError):
            TC.resolve('perfect-pixel')

    def test_the_pixel_snapper_entry_is_the_fixed_build_and_the_stock_one_is_kept_apart(self):
        fixed, stock = TC.TOOLS['pixel-snapper'], TC.STOCK['pixel-snapper']
        self.assertEqual(fixed['binary'], 'spritefusion-pixel-snapper-fixed')
        self.assertEqual(stock['binary'], 'spritefusion-pixel-snapper')
        self.assertEqual((fixed['version'], fixed['commit']), (stock['version'], stock['commit']))   # the same crate version and commit
        self.assertEqual(fixed['env'], 'SPRITEFUSION_PIXEL_SNAPPER_BIN')
        self.assertEqual(fixed['capability'], {'args': ['--help'], 'contains': '--expect-cell'})
        self.assertEqual(stock['install'], 'brew install hugo-dz/tap/spritefusion-pixel-snapper')
        self.assertTrue(set(stock['sha256']).isdisjoint(fixed['sha256']))
        self.assertNotIn('capability', TC.TOOLS['sprite-normals'])

    def test_the_carried_patch_is_the_file_whose_hash_is_pinned(self):
        fixed = TC.TOOLS['pixel-snapper']
        patch = TC.PINS_FILE.parent / fixed['patch']
        self.assertTrue(patch.is_file(), patch)
        self.assertEqual(hashlib.sha256(patch.read_bytes()).hexdigest(), fixed['patchSha256'])
        text = patch.read_text()
        self.assertEqual([line for line in text.splitlines() if line.startswith('diff --git')],
                         ['diff --git a/README.md b/README.md', 'diff --git a/src/lib.rs b/src/lib.rs'])
        notes = (patch.parent / 'README.md').read_text()
        for wanted in (fixed['patchSha256'], fixed['commit'], 'https://github.com/Hugo-Dz/spritefusion-pixel-snapper/issues/15',
                       'Remov'):
            self.assertIn(wanted, notes)


class Resolve(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.addCleanup(self._tmp.cleanup)
        self.binary = TC.TOOLS['palette-snapper']['binary']
        self.env_name = TC.TOOLS['palette-snapper']['env']

    def test_found_by_the_environment_override(self):
        path = fake_tool(self.tmp, 'whatever-name')
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{self.env_name: path})):
            self.assertEqual(TC.resolve('palette-snapper'), path)

    def test_the_override_wins_over_PATH(self):
        elsewhere = Path(self.tmp) / 'elsewhere'
        elsewhere.mkdir()
        on_path = fake_tool(elsewhere, self.binary)
        chosen = fake_tool(self.tmp, 'chosen')
        with mock.patch.dict(os.environ, clean_env(self.tmp, PATH=str(elsewhere), **{self.env_name: chosen})):
            self.assertEqual(TC.resolve('palette-snapper'), chosen)
            self.assertNotEqual(chosen, on_path)

    def test_found_on_PATH(self):
        bin_dir = Path(self.tmp) / 'bin'
        bin_dir.mkdir()
        path = fake_tool(bin_dir, self.binary)
        with mock.patch.dict(os.environ, clean_env(self.tmp, PATH=str(bin_dir))):
            self.assertEqual(TC.resolve('palette-snapper'), path)

    def test_found_in_the_cargo_bin_directory_when_not_on_PATH(self):
        env = clean_env(self.tmp)
        cargo = Path(env['HOME']) / '.cargo' / 'bin'
        cargo.mkdir(parents=True)
        path = fake_tool(cargo, self.binary)
        with mock.patch.dict(os.environ, env):
            self.assertEqual(TC.resolve('palette-snapper'), path)
            self.assertTrue(os.path.isabs(TC.resolve('palette-snapper')))

    def test_PATH_comes_before_the_cargo_bin_directory(self):
        env = clean_env(self.tmp)
        cargo = Path(env['HOME']) / '.cargo' / 'bin'
        cargo.mkdir(parents=True)
        fake_tool(cargo, self.binary)
        bin_dir = Path(self.tmp) / 'bin'
        bin_dir.mkdir()
        on_path = fake_tool(bin_dir, self.binary)
        with mock.patch.dict(os.environ, {**env, 'PATH': str(bin_dir)}):
            self.assertEqual(TC.resolve('palette-snapper'), on_path)

    def test_cargo_can_be_left_out_for_the_older_lookups(self):
        env = clean_env(self.tmp)
        cargo = Path(env['HOME']) / '.cargo' / 'bin'
        cargo.mkdir(parents=True)
        fake_tool(cargo, self.binary)
        with mock.patch.dict(os.environ, env), self.assertRaises(TC.ToolMissing) as raised:
            TC.resolve('palette-snapper', cargo=False)
        self.assertNotIn('.cargo', str(raised.exception))

    def test_a_set_but_wrong_override_is_an_error_never_a_fallback_to_PATH(self):
        bin_dir = Path(self.tmp) / 'bin'
        bin_dir.mkdir()
        fake_tool(bin_dir, self.binary)                                   # a good tool IS on PATH
        for wrong in ('/no/such/binary', self.tmp):                      # a missing file, a directory
            with self.subTest(wrong), mock.patch.dict(os.environ, clean_env(self.tmp, PATH=str(bin_dir), **{self.env_name: wrong})):
                with self.assertRaises(TC.ToolMissing) as raised:
                    TC.resolve('palette-snapper')
                self.assertIn(f"{self.env_name} is set to {wrong!r}, which is not a file", str(raised.exception))
                self.assertIn(TC.TOOLS['palette-snapper']['install'], str(raised.exception))

    def test_a_set_override_that_is_not_executable_is_an_error(self):
        path = Path(self.tmp) / 'plain'
        path.write_text('#!/bin/sh\n')
        path.chmod(0o644)
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{self.env_name: str(path)})), self.assertRaises(TC.ToolMissing) as raised:
            TC.resolve('palette-snapper')
        self.assertIn('not executable', str(raised.exception))

    def test_missing_raises_ToolMissing_with_the_tool_the_reason_and_the_install_command(self):
        for name, spec in TC.TOOLS.items():
            with self.subTest(name), mock.patch.dict(os.environ, clean_env(self.tmp)):
                with self.assertRaises(TC.ToolMissing) as raised:
                    TC.resolve(name)
                message = str(raised.exception)
                self.assertIn(spec['binary'], message)
                self.assertIn(f'{spec["env"]} is not set and {spec["binary"]} is not on PATH or in ~/.cargo/bin', message)
                self.assertIn(f'install: {spec["install"]}', message)
                self.assertNotIn('None', message)

    def test_an_empty_override_counts_as_unset(self):
        bin_dir = Path(self.tmp) / 'bin'
        bin_dir.mkdir()
        path = fake_tool(bin_dir, self.binary)
        with mock.patch.dict(os.environ, clean_env(self.tmp, PATH=str(bin_dir))):
            self.assertEqual(os.environ[self.env_name], '')
            self.assertEqual(TC.resolve('palette-snapper'), path)

    def test_a_relative_override_and_a_relative_PATH_entry_resolve_to_an_absolute_path(self):
        bin_dir = Path(self.tmp) / 'bin'
        bin_dir.mkdir()
        fake_tool(bin_dir, self.binary)
        here = os.getcwd()
        self.addCleanup(os.chdir, here)
        os.chdir(self.tmp)
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{self.env_name: 'bin/' + self.binary})):
            found = TC.resolve('palette-snapper')
        self.assertTrue(os.path.isabs(found), found)
        self.assertEqual(os.path.realpath(found), os.path.realpath(bin_dir / self.binary))
        with mock.patch.dict(os.environ, clean_env(self.tmp, PATH='bin')):
            found = TC.resolve('palette-snapper')
        self.assertTrue(os.path.isabs(found), found)
        self.assertEqual(os.path.realpath(found), os.path.realpath(bin_dir / self.binary))

    def test_a_file_in_the_cargo_bin_directory_without_the_executable_bit_is_ignored(self):
        env = clean_env(self.tmp)
        cargo = Path(env['HOME']) / '.cargo' / 'bin'
        cargo.mkdir(parents=True)
        (cargo / self.binary).write_text('#!/bin/sh\n')
        (cargo / self.binary).chmod(0o644)
        with mock.patch.dict(os.environ, env), self.assertRaises(TC.ToolMissing):
            TC.resolve('palette-snapper')

    def test_declared_is_true_for_a_wrong_override_so_that_resolving_it_raises(self):
        with mock.patch.dict(os.environ, clean_env(self.tmp)):
            self.assertFalse(TC.declared('palette-snapper'))
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{self.env_name: '/no/such'})):
            self.assertTrue(TC.declared('palette-snapper'))
            with self.assertRaises(TC.ToolMissing):
                TC.resolve('palette-snapper')


class Identity(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def identity_of(self, name, version=None, mode='ok'):
        path = fake_tool(self.tmp, f'fake-{name}', version or pinned(name), mode)
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{TC.TOOLS[name]['env']: path})):
            return path, TC.identity(name)

    def test_the_fields_the_manifest_needs(self):
        path, ident = self.identity_of('sprite-normals')
        self.assertEqual({k: ident[k] for k in ('name', 'path', 'version', 'sha256', 'pinnedVersion', 'pinnedCommit', 'matches')}, {
            'name': 'sprite-normals', 'path': path, 'version': pinned('sprite-normals'),
            'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            'pinnedVersion': pinned('sprite-normals'), 'pinnedCommit': TC.TOOLS['sprite-normals']['commit'], 'matches': True})

    def test_a_version_that_differs_from_the_pin_is_reported(self):
        _, ident = self.identity_of('pixel-snapper', version='1.0.1')
        self.assertEqual(ident['version'], '1.0.1')
        self.assertEqual(ident['pinnedVersion'], '1.0.0')
        self.assertFalse(ident['matches'])

    def test_a_tool_whose_version_cannot_be_read_does_not_match(self):
        for mode in ('novers', 'garbage'):
            with self.subTest(mode):
                _, ident = self.identity_of('palette-snapper', mode=mode)
                self.assertIsNone(ident['version'])
                self.assertFalse(ident['matches'])
                self.assertTrue(ident['versionOutput'])

    def test_a_build_that_is_not_the_pin_does_not_match_whatever_follows_the_number(self):
        for printed in ('1.0.0.1', '1.0.0_beta', 'v1.0.0x', '1.0.0-rc1', '1.0.0+build5', '1.0.01', '11.0.0'):
            with self.subTest(printed):
                _, ident = self.identity_of('pixel-snapper', version=printed)
                self.assertEqual(pinned('pixel-snapper'), '1.0.0')
                self.assertFalse(ident['matches'], ident)
        for printed in ('1.0.0', 'v1.0.0', '1.0.0.'):                     # a leading v and a closing full stop are the same build
            with self.subTest(printed):
                _, ident = self.identity_of('pixel-snapper', version=printed)
                self.assertEqual((ident['version'], ident['matches']), ('1.0.0', True))

    def test_a_suffix_is_kept_in_the_reported_version(self):
        _, ident = self.identity_of('pixel-snapper', version='1.0.0-rc1')
        self.assertEqual(ident['version'], '1.0.0-rc1')

    def test_a_non_zero_exit_of_version_is_not_a_version_even_when_it_printed_a_number(self):
        _, ident = self.identity_of('pixel-snapper', mode='failver')
        self.assertIsNone(ident['version'])
        self.assertFalse(ident['matches'])
        self.assertIn('exit 1', ident['versionOutput'])

    def test_a_version_check_that_hangs_is_reported_as_unreadable_not_as_a_hang(self):
        with mock.patch.object(TC, 'VERSION_TIMEOUT', 0.5):
            _, ident = self.identity_of('pixel-snapper', mode='hang')
        self.assertIsNone(ident['version'])
        self.assertFalse(ident['matches'])
        self.assertIn('could not run', ident['versionOutput'])

    @unittest.skipIf(os.geteuid() == 0, 'root can read a mode 111 file')
    def test_an_executable_but_unreadable_binary_is_reported_not_a_traceback(self):
        path = fake_tool(self.tmp, 'locked')
        os.chmod(path, 0o111)
        self.addCleanup(os.chmod, path, 0o755)
        env = clean_env(self.tmp, **{TC.TOOLS['pixel-snapper']['env']: path})
        with mock.patch.dict(os.environ, env):
            for call in (TC.identity, TC.require, TC.problem):
                with self.subTest(call.__name__):
                    if call is TC.problem:
                        self.assertIn('cannot be read', call('pixel-snapper'))
                        continue
                    with self.assertRaises(TC.ToolMissing) as raised:
                        call('pixel-snapper')
                    self.assertIn('cannot be read', str(raised.exception))
                    self.assertIn(TC.TOOLS['pixel-snapper']['install'], str(raised.exception))
            found = TC.versions()
        self.assertIn('pixel-snapper', found['missing'])
        self.assertIn('cannot be read', found['missing']['pixel-snapper'])

    def test_the_version_comes_from_the_tool_not_from_its_file_name(self):
        _, ident = self.identity_of('palette-snapper', version='9.9.9')
        self.assertEqual(ident['version'], '9.9.9')
        self.assertIn('fake-palette-snapper', ident['path'])

    def test_a_changed_binary_is_probed_again(self):
        path, first = self.identity_of('palette-snapper')
        fake_tool(self.tmp, 'fake-palette-snapper', '7.7.7')
        os.utime(path, (1_000_000_000, 1_000_000_000))                   # a rewrite is told apart by mtime and size
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{TC.TOOLS['palette-snapper']['env']: path})):
            second = TC.identity('palette-snapper')
        self.assertEqual((first['version'], second['version']), (pinned('palette-snapper'), '7.7.7'))
        self.assertNotEqual(first['sha256'], second['sha256'])

    def test_a_binary_rewritten_with_the_same_mtime_but_another_size_is_probed_again(self):
        path, first = self.identity_of('palette-snapper', version='1.0.0')
        os.utime(path, (1_000_000_000, 1_000_000_000))
        env = clean_env(self.tmp, **{TC.TOOLS['palette-snapper']['env']: path})
        with mock.patch.dict(os.environ, env):
            TC.identity('palette-snapper')                                # now cached under the fixed mtime
            fake_tool(self.tmp, 'fake-palette-snapper', '10.20.30')       # longer output, so another size
            os.utime(path, (1_000_000_000, 1_000_000_000))                # the same mtime again
            second = TC.identity('palette-snapper')
        self.assertEqual(second['version'], '10.20.30')

    def test_identity_of_a_missing_tool_raises(self):
        with mock.patch.dict(os.environ, clean_env(self.tmp)), self.assertRaises(TC.ToolMissing):
            TC.identity('pixel-snapper')


class FixedAndStock(unittest.TestCase):
    """The patch does not change the crate version: the fixed pixel snapper and the stock one both say 1.0.0, so the toolchain
    tells them apart by a probe (the fixed build's --help lists --expect-cell) and refuses the stock one."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.addCleanup(self._tmp.cleanup)
        self.env_name = TC.TOOLS['pixel-snapper']['env']

    def given(self, binary='spritefusion-pixel-snapper', help_text=STOCK_HELP, **extra):
        path = fake_tool(self.tmp, binary, '1.0.0', help_text=help_text)
        patcher = mock.patch.dict(os.environ, clean_env(self.tmp, **{self.env_name: path}, **extra))
        patcher.start()
        self.addCleanup(patcher.stop)
        return path

    def test_a_build_that_lists_expect_cell_is_the_fixed_one(self):
        path = self.given(help_text=FIXED_HELP)
        ident = TC.identity('pixel-snapper')
        self.assertEqual((ident['version'], ident['capability'], ident['matches']), ('1.0.0', True, True))
        self.assertEqual(TC.require('pixel-snapper'), path)
        self.assertIsNone(TC.problem('pixel-snapper'))
        self.assertFalse(TC.is_stock(ident))

    def test_the_stock_build_says_1_0_0_too_and_does_not_match(self):
        self.given(help_text=STOCK_HELP)
        ident = TC.identity('pixel-snapper')
        self.assertEqual((ident['version'], ident['capability'], ident['matches']), ('1.0.0', False, False))
        self.assertTrue(TC.is_stock(ident))

    def test_the_stock_build_through_the_override_is_refused_with_the_install_command(self):
        path = self.given(help_text=STOCK_HELP)
        with self.assertRaises(TC.ToolMismatch) as raised:
            TC.require('pixel-snapper')
        message = str(raised.exception)
        for wanted in (path, 'STOCK', TC.TOOLS['pixel-snapper']['install'], '--expect-cell', TC.TOOLS['pixel-snapper']['commit']):
            self.assertIn(wanted, message)
        with self.assertRaises(TC.ToolMismatch):
            TC.run('pixel-snapper', ['in.png', 'out.png'])
        self.assertIn(TC.TOOLS['pixel-snapper']['install'], TC.problem('pixel-snapper'))

    def test_allow_mismatch_does_not_waive_a_missing_capability(self):
        self.given(help_text=STOCK_HELP, **{TC.ALLOW_MISMATCH_ENV: '1'})
        with contextlib.redirect_stderr(io.StringIO()) as err, self.assertRaises(TC.ToolMismatch) as raised:
            TC.require('pixel-snapper')
        self.assertIn('does not waive', str(raised.exception))
        self.assertNotIn('NOT the pinned one', err.getvalue())

    def test_another_version_without_the_capability_is_refused_without_offering_the_waiver(self):
        path = fake_tool(self.tmp, 'other', '9.9.9', help_text=STOCK_HELP)
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{self.env_name: path, TC.ALLOW_MISMATCH_ENV: '1'})):
            with self.assertRaises(TC.ToolMismatch) as raised:
                TC.require('pixel-snapper')
        self.assertIn('9.9.9', str(raised.exception))
        self.assertIn('does not waive', str(raised.exception))
        self.assertNotIn('to run anyway', str(raised.exception))

    def test_allow_mismatch_still_waives_a_version_for_a_tool_without_a_probe(self):
        path = fake_tool(self.tmp, 'n', '0.2.0')
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{TC.TOOLS['sprite-normals']['env']: path, TC.ALLOW_MISMATCH_ENV: '1'})), \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(TC.require('sprite-normals'), path)
            self.assertIsNone(TC.identity('sprite-normals')['capability'])

    def test_a_tool_that_crashes_or_hangs_on_the_probe_fails_it(self):
        path = Path(self.tmp) / 'p'
        path.write_text('#!/bin/sh\n[ "$1" = "--version" ] && { echo "p 1.0.0"; exit 0; }\nexit 7\n')
        path.chmod(0o755)
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{self.env_name: str(path)})):
            self.assertIs(TC.identity('pixel-snapper')['capability'], False)
        hang = Path(self.tmp) / 'h'
        hang.write_text('#!/bin/sh\n[ "$1" = "--version" ] && { echo "h 1.0.0"; exit 0; }\nexec /bin/sleep 30\n')
        hang.chmod(0o755)
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{self.env_name: str(hang)})), mock.patch.object(TC, 'VERSION_TIMEOUT', 0.5):
            self.assertIs(TC.identity('pixel-snapper')['capability'], False)

    def test_a_rewritten_binary_is_probed_again(self):
        path = self.given(help_text=STOCK_HELP)
        self.assertFalse(TC.identity('pixel-snapper')['matches'])
        fake_tool(self.tmp, 'spritefusion-pixel-snapper', '1.0.0', help_text=FIXED_HELP + ' (fixed)')
        os.utime(path, (1_000_000_000, 1_000_000_000))
        self.assertTrue(TC.identity('pixel-snapper')['matches'])

    def test_the_hash_of_the_stock_build_alone_marks_it_stock(self):
        path = self.given(help_text=STOCK_HELP)
        digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
        listed = {**TC.STOCK['pixel-snapper'], 'sha256': (digest,)}
        with mock.patch.object(TC, 'STOCK', {'pixel-snapper': listed}):
            self.assertTrue(TC.is_stock({'name': 'pixel-snapper', 'sha256': digest, 'version': '2.0.0', 'capability': True}))
            self.assertFalse(TC.is_stock({'name': 'pixel-snapper', 'sha256': '0' * 64, 'version': '2.0.0', 'capability': False}))
        self.assertFalse(TC.is_stock({'name': 'sprite-normals', 'sha256': digest, 'version': '1.0.0', 'capability': False}))

    def test_inspect_binary_judges_a_file_that_resolve_did_not_find(self):
        path = fake_tool(self.tmp, 'elsewhere', '1.0.0', help_text=FIXED_HELP)
        with mock.patch.dict(os.environ, clean_env(self.tmp)):
            ident = TC.inspect_binary('pixel-snapper', path)
        self.assertEqual((ident['path'], ident['matches'], ident['capability']), (path, True, True))
        with self.assertRaises(TC.ToolMissing) as raised:
            TC.inspect_binary('pixel-snapper', str(Path(self.tmp) / 'nope'))
        self.assertIn(TC.TOOLS['pixel-snapper']['install'], str(raised.exception))

    def test_status_names_the_stock_build_as_a_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            fakes = StatusCommand.all_fakes(None, tmp)
            fakes[self.env_name] = fake_tool(tmp, 'stock', '1.0.0', help_text=STOCK_HELP)
            run = subprocess.run([sys.executable, '-I', str(SCRIPT), 'status'], env=clean_env(tmp, **fakes), capture_output=True, text=True)
        self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
        self.assertIn('MISMATCH', run.stdout)
        self.assertIn('STOCK', run.stdout)
        self.assertIn('1 of 3 tools need attention', run.stdout)

    def test_the_manifest_keeps_the_capability_and_stays_json(self):
        self.given(help_text=FIXED_HELP)
        found = TC.versions()
        self.assertIs(found['tools']['pixel-snapper']['capability'], True)
        json.dumps(found)


class Require(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def env_for(self, name, version, **extra):
        path = fake_tool(self.tmp, f'fake-{name}', version)
        return path, clean_env(self.tmp, **{TC.TOOLS[name]['env']: path}, **extra)

    def test_a_pinned_version_returns_the_path(self):
        path, env = self.env_for('pixel-snapper', pinned('pixel-snapper'))
        with mock.patch.dict(os.environ, env):
            self.assertEqual(TC.require('pixel-snapper'), path)

    def test_a_version_mismatch_is_caught_and_the_message_says_both_versions_and_the_fix(self):
        _, env = self.env_for('sprite-normals', '0.2.0')
        with mock.patch.dict(os.environ, env), self.assertRaises(TC.ToolMismatch) as raised:
            TC.require('sprite-normals')
        message = str(raised.exception)
        for wanted in ('0.2.0', pinned('sprite-normals'), TC.TOOLS['sprite-normals']['commit'],
                       TC.TOOLS['sprite-normals']['install'], TC.ALLOW_MISMATCH_ENV):
            self.assertIn(wanted, message)

    def test_an_unreadable_version_is_also_a_mismatch(self):
        path = fake_tool(self.tmp, 'fake', mode='novers')
        env = clean_env(self.tmp, **{TC.TOOLS['pixel-snapper']['env']: path})
        with mock.patch.dict(os.environ, env), self.assertRaises(TC.ToolMismatch) as raised:
            TC.require('pixel-snapper')
        self.assertIn('unreadable', str(raised.exception))

    def test_allow_mismatch_runs_it_with_a_loud_warning(self):
        path, env = self.env_for('sprite-normals', '0.2.0', **{TC.ALLOW_MISMATCH_ENV: '1'})
        err = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stderr(err):
            self.assertEqual(TC.require('sprite-normals'), path)
        self.assertIn('!!!', err.getvalue())
        self.assertIn('NOT the pinned one', err.getvalue())
        self.assertIn('0.2.0', err.getvalue())

    def test_allow_mismatch_needs_exactly_1(self):
        _, env = self.env_for('sprite-normals', '0.2.0', **{TC.ALLOW_MISMATCH_ENV: 'yes'})
        with mock.patch.dict(os.environ, env), self.assertRaises(TC.ToolMismatch):
            TC.require('sprite-normals')

    def test_the_hash_is_recorded_but_not_enforced_by_default(self):
        _, env = self.env_for('pixel-snapper', pinned('pixel-snapper'))
        self.assertNotIn(hashlib.sha256(Path(env[TC.TOOLS['pixel-snapper']['env']]).read_bytes()).hexdigest(), TC.TOOLS['pixel-snapper']['sha256'])
        with mock.patch.dict(os.environ, env):
            TC.require('pixel-snapper')

    def test_enforce_makes_a_listed_hash_mandatory(self):
        path, env = self.env_for('pixel-snapper', pinned('pixel-snapper'), **{TC.SHA256_ENV: 'enforce'})
        with mock.patch.dict(os.environ, env), self.assertRaises(TC.ToolMismatch) as raised:
            TC.require('pixel-snapper')
        self.assertIn('not listed in toolchain.json', str(raised.exception))
        listed = {**TC.TOOLS['pixel-snapper'], 'sha256': (hashlib.sha256(Path(path).read_bytes()).hexdigest(),)}
        with mock.patch.dict(os.environ, env), mock.patch.object(TC, 'TOOLS', {**TC.TOOLS, 'pixel-snapper': listed}):
            self.assertEqual(TC.require('pixel-snapper'), path)

    def test_enforce_with_an_empty_list_refuses_everything(self):
        path, env = self.env_for('pixel-snapper', pinned('pixel-snapper'), **{TC.SHA256_ENV: 'enforce'})
        empty = {**TC.TOOLS['pixel-snapper'], 'sha256': ()}
        with mock.patch.dict(os.environ, env), mock.patch.object(TC, 'TOOLS', {**TC.TOOLS, 'pixel-snapper': empty}):
            with self.assertRaises(TC.ToolMismatch):
                TC.require('pixel-snapper')

    def test_allow_mismatch_does_not_waive_the_hash(self):
        _, env = self.env_for('pixel-snapper', '0.0.1', **{TC.SHA256_ENV: 'enforce', TC.ALLOW_MISMATCH_ENV: '1'})
        with mock.patch.dict(os.environ, env), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(TC.ToolMismatch):
            TC.require('pixel-snapper')

    def test_an_unknown_hash_mode_is_an_error_not_a_silent_skip(self):
        _, env = self.env_for('pixel-snapper', pinned('pixel-snapper'), **{TC.SHA256_ENV: 'enforced'})
        with mock.patch.dict(os.environ, env), self.assertRaises(TC.ToolError):
            TC.require('pixel-snapper')


class Run(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.addCleanup(self._tmp.cleanup)
        path = fake_tool(self.tmp, 'fake-palette', pinned('palette-snapper'))
        patcher = mock.patch.dict(os.environ, clean_env(self.tmp, **{TC.TOOLS['palette-snapper']['env']: path}))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_stdout_and_stderr_are_captured(self):
        done = TC.run('palette-snapper', ['0', 'a b', Path('c')])
        self.assertEqual((done.returncode, done.stdout.strip(), done.stderr.strip()), (0, 'out:0 a b c', 'err:0 a b c'))

    def test_a_non_zero_exit_raises_with_the_stderr_quoted(self):
        with self.assertRaises(TC.ToolFailed) as raised:
            TC.run('palette-snapper', ['4', 'boom'])
        self.assertEqual(raised.exception.returncode, 4)
        self.assertIn('err:4 boom', str(raised.exception))
        self.assertIn('failed (4)', str(raised.exception))
        self.assertEqual(raised.exception.command[1:], ['4', 'boom'])

    def test_a_long_stderr_keeps_its_tail(self):
        path = Path(self.tmp) / 'loud'
        path.write_text('#!/bin/sh\n[ "$1" = "--version" ] && { echo "x ' + pinned('palette-snapper') + '"; exit 0; }\n'
                        'i=0; while [ $i -lt 400 ]; do echo "line-$i-padding-padding-padding" >&2; i=$((i+1)); done; exit 1\n')
        path.chmod(0o755)
        with mock.patch.dict(os.environ, {TC.TOOLS['palette-snapper']['env']: str(path)}), self.assertRaises(TC.ToolFailed) as raised:
            TC.run('palette-snapper', [])
        self.assertIn('line-399', str(raised.exception))
        self.assertNotIn('line-0-', str(raised.exception))

    def test_it_refuses_to_be_told_how_to_capture_or_to_ignore_a_failure(self):
        for kw in ({'check': False}, {'capture_output': False}, {'stdout': None}, {'stderr': None}):
            with self.subTest(kw), self.assertRaises(TypeError):
                TC.run('palette-snapper', [], **kw)

    def test_it_runs_the_version_check_first(self):
        path = fake_tool(self.tmp, 'old', '0.0.1')
        with mock.patch.dict(os.environ, {TC.TOOLS['palette-snapper']['env']: path}), self.assertRaises(TC.ToolMismatch):
            TC.run('palette-snapper', ['0'])

    def test_other_keywords_reach_subprocess(self):
        done = TC.run('palette-snapper', ['0'], cwd=self.tmp, input='')
        self.assertEqual(done.returncode, 0)


class Versions(unittest.TestCase):
    def test_the_identity_of_each_tool_that_resolves_and_the_reason_for_each_that_does_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = clean_env(tmp, **{TC.TOOLS['pixel-snapper']['env']: fake_tool(tmp, 'p', pinned('pixel-snapper')),
                                    TC.TOOLS['sprite-normals']['env']: '/no/such/normals'})
            with mock.patch.dict(os.environ, env):
                found = TC.versions()
        self.assertEqual(sorted(found['tools']), ['pixel-snapper'])
        self.assertTrue(found['tools']['pixel-snapper']['matches'])
        self.assertEqual(sorted(found['missing']), ['palette-snapper', 'sprite-normals'])
        self.assertIn('/no/such/normals', found['missing']['sprite-normals'])
        self.assertIn(TC.TOOLS['palette-snapper']['install'], found['missing']['palette-snapper'])
        json.dumps(found)                                                 # a manifest can hold it

    def test_the_same_inputs_give_the_same_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = clean_env(tmp, **{spec['env']: fake_tool(tmp, f'f-{name}', spec['version']) for name, spec in TC.TOOLS.items()})
            with mock.patch.dict(os.environ, env):
                first = json.dumps(TC.versions(), sort_keys=True)
                TC._CACHE.clear()
                second = json.dumps(TC.versions(), sort_keys=True)
        self.assertEqual(first, second)


class StatusCommand(unittest.TestCase):
    """`python3 -I toolchain.py status`, a real child process with a controlled environment."""

    def status(self, tmp, *flags, **overrides):
        env = clean_env(tmp, **overrides)
        return subprocess.run([sys.executable, '-I', str(SCRIPT), 'status', *flags], env=env, capture_output=True, text=True)

    def all_fakes(self, tmp, **versions):
        return {spec['env']: fake_tool(tmp, f'f-{name}', versions.get(name, spec['version'])) for name, spec in TC.TOOLS.items()}

    def test_exit_0_when_all_three_resolve_and_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = self.status(tmp, **self.all_fakes(tmp))
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        for name in TC.TOOLS:
            self.assertIn(name, run.stdout)
        self.assertEqual(run.stdout.count('  ok  '), 3)
        self.assertIn('all three tools resolve and match', run.stdout)

    def test_exit_non_zero_when_one_is_missing_and_the_install_command_is_printed(self):
        with tempfile.TemporaryDirectory() as tmp:
            fakes = self.all_fakes(tmp)
            del fakes[TC.TOOLS['palette-snapper']['env']]
            run = self.status(tmp, **fakes)
        self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
        self.assertIn('MISSING', run.stdout)
        self.assertIn(TC.TOOLS['palette-snapper']['install'], run.stdout)
        self.assertIn('1 of 3 tools need attention', run.stdout)

    def test_exit_non_zero_when_one_is_the_wrong_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = self.status(tmp, **self.all_fakes(tmp, **{'sprite-normals': '0.0.9'}))
        self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
        self.assertIn('MISMATCH', run.stdout)
        self.assertIn('0.0.9', run.stdout)

    def test_the_allow_mismatch_variable_does_not_turn_the_status_green(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = self.status(tmp, **self.all_fakes(tmp, **{'sprite-normals': '0.0.9'}), **{TC.ALLOW_MISMATCH_ENV: '1'})
        self.assertEqual(run.returncode, 1, run.stdout + run.stderr)

    def test_json_output_and_the_exit_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = self.status(tmp, '--json', **self.all_fakes(tmp))
            bad = self.status(tmp, '--json')                              # nothing installed
        self.assertEqual(good.returncode, 0, good.stderr)
        report = json.loads(good.stdout)
        self.assertTrue(report['ok'])
        self.assertEqual(sorted(report['tools']), sorted(TC.TOOLS))
        self.assertEqual(report['problems'], {})
        self.assertEqual(bad.returncode, 1)
        report = json.loads(bad.stdout)
        self.assertFalse(report['ok'])
        self.assertEqual(sorted(report['missing']), sorted(TC.TOOLS))
        self.assertEqual(sorted(report['problems']), sorted(TC.TOOLS))

    def test_enforce_turns_the_status_red_when_the_hashes_are_not_listed(self):
        with tempfile.TemporaryDirectory() as tmp:
            fakes = self.all_fakes(tmp)
            off = self.status(tmp, **fakes)
            run = self.status(tmp, **fakes, **{TC.SHA256_ENV: 'enforce'})
        self.assertEqual(off.returncode, 0, off.stdout + off.stderr)       # the same fakes are green without enforce
        self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
        self.assertEqual(run.stdout.count('HASH NOT LISTED'), 3)
        self.assertIn('not listed in toolchain.json', run.stdout)
        self.assertIn('3 of 3 tools need attention', run.stdout)

    def test_enforce_in_json_lists_the_problems(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = self.status(tmp, '--json', **self.all_fakes(tmp), **{TC.SHA256_ENV: 'enforce'})
        self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
        report = json.loads(run.stdout)
        self.assertFalse(report['ok'])
        self.assertEqual(sorted(report['problems']), sorted(TC.TOOLS))

    def test_an_invalid_hash_mode_is_a_usage_error_whatever_else_is_wrong(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = self.status(tmp, **self.all_fakes(tmp), **{TC.SHA256_ENV: 'enforced'})
            nothing = self.status(tmp, **{TC.SHA256_ENV: 'enforced'})     # no tool installed at all
        for run in (good, nothing):
            self.assertEqual(run.returncode, 2, run.stdout + run.stderr)
            self.assertIn(TC.SHA256_ENV, run.stderr)

    def test_the_json_keys_are_sorted(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = self.status(tmp, '--json', **self.all_fakes(tmp))
        def sorted_keys(pairs):
            keys = [k for k, _ in pairs]
            self.assertEqual(keys, sorted(keys))
            return dict(pairs)
        json.loads(run.stdout, object_pairs_hook=sorted_keys)

    @unittest.skipIf(os.geteuid() == 0, 'root can read a mode 111 file')
    def test_an_unreadable_binary_is_a_row_not_a_traceback(self):
        with tempfile.TemporaryDirectory() as tmp:
            fakes = self.all_fakes(tmp)
            locked = fakes[TC.TOOLS['pixel-snapper']['env']]
            os.chmod(locked, 0o111)
            run = self.status(tmp, **fakes)
        self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
        self.assertNotIn('Traceback', run.stderr)
        self.assertIn('MISSING', run.stdout)
        self.assertIn('cannot be read', run.stdout)

    def test_the_same_inputs_give_the_same_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            fakes = self.all_fakes(tmp)
            first, second = (self.status(tmp, '--json', **fakes).stdout for _ in range(2))
            text_1, text_2 = (self.status(tmp, **fakes).stdout for _ in range(2))
        self.assertEqual(first, second)
        self.assertEqual(text_1, text_2)

    def test_no_subcommand_is_a_usage_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = subprocess.run([sys.executable, '-I', str(SCRIPT)], env=clean_env(tmp), capture_output=True, text=True)
        self.assertEqual(run.returncode, 2)


class LegacyLookups(unittest.TestCase):
    """pixelgrid.tool_path and normals.resolve_method now go through toolchain and find what they always found."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def test_the_constants_of_the_older_modules_come_from_the_pins(self):
        import normals as N
        self.assertEqual((PG.SNAPPER_ENV, PG.SNAPPER_DEFAULT),
                         (TC.TOOLS['pixel-snapper']['env'], TC.TOOLS['pixel-snapper']['binary']))
        self.assertEqual((N.NORMALS_ENV, N.NORMALS_DEFAULT),
                         (TC.TOOLS['sprite-normals']['env'], TC.TOOLS['sprite-normals']['binary']))

    def test_tool_path_uses_the_override_and_the_error_is_a_system_exit_with_the_install_command(self):
        path = fake_tool(self.tmp, 'snapper')
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{PG.SNAPPER_ENV: path})):
            self.assertEqual(PG.tool_path(PG.SNAPPER_ENV, PG.SNAPPER_DEFAULT), path)
        with mock.patch.dict(os.environ, clean_env(self.tmp)), self.assertRaises(SystemExit) as raised:
            PG.tool_path(PG.SNAPPER_ENV, PG.SNAPPER_DEFAULT)
        self.assertIn(TC.TOOLS['pixel-snapper']['install'], str(raised.exception))

    def test_the_older_lookup_does_not_search_cargo_bin_so_it_finds_what_it_always_found(self):
        env = clean_env(self.tmp)
        cargo = Path(env['HOME']) / '.cargo' / 'bin'
        cargo.mkdir(parents=True)
        fake_tool(cargo, PG.SNAPPER_DEFAULT)
        with mock.patch.dict(os.environ, env):
            self.assertTrue(TC.resolve('pixel-snapper').startswith(str(cargo)))
            with self.assertRaises(SystemExit):
                PG.tool_path(PG.SNAPPER_ENV, PG.SNAPPER_DEFAULT)

    def test_auto_still_falls_back_to_luminance_without_the_tool_on_PATH_even_with_one_in_cargo_bin(self):
        import normals as N
        env = clean_env(self.tmp)
        cargo = Path(env['HOME']) / '.cargo' / 'bin'
        cargo.mkdir(parents=True)
        fake_tool(cargo, N.NORMALS_DEFAULT)
        with mock.patch.dict(os.environ, env), contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(N.resolve_method('auto'), 'legacy')
        self.assertIn('LUMINANCE FALLBACK', err.getvalue())

    def test_auto_takes_the_tool_when_it_is_on_PATH_or_the_variable_is_set(self):
        import normals as N
        bin_dir = Path(self.tmp) / 'bin'
        bin_dir.mkdir()
        fake_tool(bin_dir, N.NORMALS_DEFAULT)
        with mock.patch.dict(os.environ, clean_env(self.tmp, PATH=str(bin_dir))):
            self.assertEqual(N.resolve_method('auto'), 'tool')
        with mock.patch.dict(os.environ, clean_env(self.tmp, **{N.NORMALS_ENV: '/no/such'})):
            self.assertEqual(N.resolve_method('auto'), 'tool')


FAKE_CARGO = """#!/bin/sh
# a stand-in for cargo: records how it was called and "builds" a tool that is fixed only when src/lib.rs carries the marker
echo "args:$*" >> "$CARGO_LOG"
echo "cwd:$(pwd)" >> "$CARGO_LOG"
echo "cargo_home:$CARGO_HOME" >> "$CARGO_LOG"
echo "rustflags:$RUSTFLAGS" >> "$CARGO_LOG"
[ "$1" = "build" ] || exit 9
mkdir -p target/release
if grep -q PATCHED src/lib.rs; then help='usage: tool [--expect-cell N]'; else help='usage: tool'; fi
printf '#!/bin/sh\\nif [ "$1" = "--version" ]; then echo "spritefusion-pixel-snapper 1.0.0"; exit 0; fi\\nif [ "$1" = "--help" ]; then echo "%s"; exit 0; fi\\nexit 0\\n' "$help" > target/release/spritefusion-pixel-snapper
chmod +x target/release/spritefusion-pixel-snapper
"""


class BuildScript(unittest.TestCase):
    """tools/build_pixel_snapper.py against a tiny local git repository and a stand-in for cargo: nothing is compiled,
    nothing is cloned from the network and nothing is installed outside a temporary folder."""

    @classmethod
    def setUpClass(cls):
        import build_pixel_snapper as B
        cls.B = B

    def git(self, *args, cwd=None):
        done = subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', *args],
                              cwd=cwd or self.repo, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout.strip()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name).resolve()
        self.addCleanup(self._tmp.cleanup)
        self.repo = self.tmp / 'upstream'
        (self.repo / 'src').mkdir(parents=True)
        (self.repo / 'README.md').write_text('readme\n')
        (self.repo / 'src' / 'lib.rs').write_text('fn snap() {}\n')
        (self.repo / 'Cargo.lock').write_text('# lock\n')
        (self.repo / 'Cargo.toml').write_text('[package]\nname = "x"\n')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('commit', '-q', '-m', 'upstream')
        self.commit = self.git('rev-parse', 'HEAD')
        # the carried patch: README.md and src/lib.rs, made by git as the real one was
        (self.repo / 'README.md').write_text('readme\nfixed\n')
        (self.repo / 'src' / 'lib.rs').write_text('fn snap() {}\n// PATCHED\n')
        self.patch = self.tmp / 'fix.patch'
        self.patch.write_text(self.git('diff', '--', 'README.md', 'src/lib.rs') + '\n')
        self.git('checkout', '-q', '--', '.')
        self.pin = {**TC.TOOLS['pixel-snapper'], 'commit': self.commit, 'patchSha256': hashlib.sha256(self.patch.read_bytes()).hexdigest(),
                    'sha256': ()}
        fake_bin = self.tmp / 'fakebin'
        fake_bin.mkdir()
        (fake_bin / 'cargo').write_text(FAKE_CARGO)
        (fake_bin / 'cargo').chmod(0o755)
        self.log = self.tmp / 'cargo.log'
        self.bin_dir, self.build_dir = self.tmp / 'bin', self.tmp / 'build'
        patcher = mock.patch.dict(os.environ, {'PATH': f'{fake_bin}:{os.environ.get("PATH", "")}', 'CARGO_LOG': str(self.log),
                                               'CARGO_HOME': str(self.tmp / 'cargo-home')})
        patcher.start()
        self.addCleanup(patcher.stop)
        patch_file = mock.patch.object(TC, 'PINS_FILE', self.tmp / 'toolchain.json')       # the patch is looked for beside the pins
        patch_file.start()
        self.addCleanup(patch_file.stop)
        (self.tmp / 'patches').mkdir()
        (self.tmp / 'patches' / 'pixel-snapper-fix.patch').write_bytes(self.patch.read_bytes())
        self.pin['patch'] = 'patches/pixel-snapper-fix.patch'

    def run_build(self, *extra, pin=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = self.B.main(['--repo', str(self.repo), '--build-dir', str(self.build_dir), '--bin-dir', str(self.bin_dir), *extra],
                               out=out, pin=pin or self.pin)
        return code, out.getvalue(), err.getvalue()

    def installed(self):
        return self.bin_dir / 'spritefusion-pixel-snapper-fixed'

    def test_it_builds_the_pinned_commit_with_the_patch_and_installs_the_fixed_name(self):
        stock = self.bin_dir / 'spritefusion-pixel-snapper'
        self.bin_dir.mkdir()
        stock.write_text('the stock tool, untouched')
        code, out, err = self.run_build()
        self.assertEqual(code, 0, out + err)
        digest = hashlib.sha256(self.installed().read_bytes()).hexdigest()
        self.assertIn(f'sha256: {digest}', out)
        self.assertIn('does NOT list this hash', out)                       # a fixture hash is not in toolchain.json
        self.assertTrue(os.access(self.installed(), os.X_OK))
        self.assertEqual(stock.read_text(), 'the stock tool, untouched')    # the stock tool stays where it is
        self.assertEqual(sorted(p.name for p in self.bin_dir.iterdir()), ['spritefusion-pixel-snapper', 'spritefusion-pixel-snapper-fixed'])
        ident = TC.inspect_binary('pixel-snapper', str(self.installed()))
        self.assertTrue(ident['matches'] and ident['capability'])           # the installed file is the fixed one
        source = self.build_dir / self.commit[:12] / 'src'
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=source), self.commit)
        self.assertIn('PATCHED', (source / 'src' / 'lib.rs').read_text())

    def test_cargo_is_called_locked_and_release_and_the_paths_are_remapped(self):
        self.assertEqual(self.run_build()[0], 0)
        log = self.log.read_text()
        self.assertIn('args:build --release --locked\n', log)
        self.assertNotIn('--offline', log)
        source = self.build_dir / self.commit[:12] / 'src'
        self.assertIn(f'cwd:{source}\n', log)
        self.assertIn(f'cargo_home:{self.tmp / "cargo-home"}\n', log)                 # the caller's CARGO_HOME reaches cargo
        self.assertIn(f'--remap-path-prefix={source}=/build/pixel-snapper', log)
        self.assertIn(f'--remap-path-prefix={self.tmp / "cargo-home"}=/cargo', log)

    def test_offline_adds_the_cargo_flag_and_cargo_home_is_the_callers(self):
        self.assertEqual(self.run_build('--offline')[0], 0)
        self.assertIn('args:build --release --locked --offline\n', self.log.read_text())

    def test_a_second_run_is_a_no_op_and_prints_the_same_hash(self):
        first = self.run_build()
        stamp = self.installed().stat().st_mtime_ns
        second = self.run_build()
        self.assertEqual((first[0], second[0]), (0, 0), first[2] + second[2])
        self.assertIn('already installed', second[1])
        self.assertEqual(self.installed().stat().st_mtime_ns, stamp)
        digest = lambda text: [line for line in text.splitlines() if line.startswith('sha256: ')]
        self.assertEqual(digest(first[1]), digest(second[1]))
        self.assertEqual(len(digest(first[1])), 1)
        forced = self.run_build('--force')
        self.assertIn('installed:', forced[1])
        self.assertEqual(digest(forced[1]), digest(first[1]))

    def test_a_listed_hash_is_reported_as_listed(self):
        first = self.run_build()
        digest = hashlib.sha256(self.installed().read_bytes()).hexdigest()
        code, out, _ = self.run_build(pin={**self.pin, 'sha256': (digest,)})
        self.assertEqual(code, 0)
        self.assertIn('toolchain.json lists this hash', out)

    def test_a_patch_that_is_not_the_pinned_one_is_refused_before_anything_is_built(self):
        (self.tmp / 'patches' / 'pixel-snapper-fix.patch').write_text(self.patch.read_text() + ' \n')
        code, out, err = self.run_build()
        self.assertEqual(code, 2, out + err)
        self.assertIn('patchSha256', err)
        self.assertIn(self.pin['patchSha256'], err)
        self.assertFalse(self.log.exists(), 'cargo was not called')
        self.assertFalse(self.bin_dir.exists())
        self.assertFalse(self.build_dir.exists())

    def test_a_commit_the_repository_does_not_have_is_refused(self):
        code, out, err = self.run_build(pin={**self.pin, 'commit': 'f' * 40})
        self.assertEqual(code, 2, out + err)
        self.assertIn('ffffffffffffffffffffffffffffffffffffffff', err)
        self.assertFalse(self.bin_dir.exists())

    def test_a_patch_that_touches_other_files_is_a_failure_and_installs_nothing(self):
        (self.repo / 'Cargo.toml').write_text('[package]\nname = "y"\n')
        wide = self.git('diff', '--', 'Cargo.toml') + '\n'
        self.git('checkout', '-q', '--', '.')
        (self.tmp / 'patches' / 'pixel-snapper-fix.patch').write_text(wide)
        code, out, err = self.run_build(pin={**self.pin, 'patchSha256': hashlib.sha256(wide.encode()).hexdigest()})
        self.assertEqual(code, 1, out + err)
        self.assertIn('expected exactly', err)
        self.assertFalse(self.bin_dir.exists())

    def test_a_build_that_is_not_the_fixed_tool_is_not_installed(self):
        (self.repo / 'src' / 'lib.rs').write_text('fn snap() {}\n')            # the same patch, but the marker is not in it
        self.git('add', '.')
        stock_like = {**self.pin}
        with mock.patch.object(self.B, 'apply_patch', lambda source, patch: None):
            code, out, err = self.run_build(pin=stock_like)
        self.assertEqual(code, 1, out + err)
        self.assertIn('expect-cell', err)
        self.assertFalse(self.installed().exists())

    def test_a_tree_changed_by_hand_is_reset_to_the_pinned_commit_and_the_patch_applies_once(self):
        self.assertEqual(self.run_build()[0], 0)
        source = self.build_dir / self.commit[:12] / 'src'
        (source / 'src' / 'lib.rs').write_text('garbage\n')
        (source / 'stray.txt').write_text('x')
        code, out, err = self.run_build('--force')
        self.assertEqual(code, 0, out + err)
        self.assertEqual((source / 'src' / 'lib.rs').read_text().count('PATCHED'), 1)
        self.assertFalse((source / 'stray.txt').exists())

    def test_without_cargo_or_git_it_is_refused_naming_the_tool(self):
        for tool in ('cargo', 'git'):
            with self.subTest(tool), mock.patch.object(self.B.shutil, 'which', lambda name, tool=tool: None if name == tool else '/usr/bin/' + name):
                code, out, err = self.run_build()
            self.assertEqual(code, 2, out + err)
            self.assertIn(f'{tool} is not on PATH', err)

    def test_a_commit_without_a_lockfile_is_refused_because_locked_could_not_hold(self):
        (self.repo / 'Cargo.lock').unlink()
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'no lock')
        pin = {**self.pin, 'commit': self.git('rev-parse', 'HEAD')}
        code, out, err = self.run_build(pin=pin)
        self.assertEqual(code, 2, out + err)
        self.assertIn('no Cargo.lock', err)


def real_tool_test(name):
    spec = TC.TOOLS[name]
    return unittest.skipUnless(TC.declared(name), f'{spec["binary"]} not installed here; install: {spec["install"]}')


class RealTools(unittest.TestCase):
    """The three real tools on this host (skipped, with the install command, where one is absent)."""

    def check(self, name):
        spec = TC.TOOLS[name]
        path = TC.resolve(name)
        self.assertTrue(os.path.isabs(path) and os.path.isfile(path), path)
        ident = TC.identity(name)
        self.assertEqual(ident['version'], spec['version'], f'{path} prints {ident["versionOutput"]!r}')
        self.assertTrue(ident['matches'])
        self.assertEqual(ident['sha256'], hashlib.sha256(Path(path).resolve().read_bytes()).hexdigest())
        self.assertEqual(TC.require(name), path)
        self.assertEqual(TC.run(name, ['--version']).stdout.split()[-1], spec['version'])

    @real_tool_test('pixel-snapper')
    def test_pixel_snapper(self):
        self.check('pixel-snapper')

    @real_tool_test('sprite-normals')
    def test_sprite_normals(self):
        self.check('sprite-normals')

    @real_tool_test('palette-snapper')
    def test_palette_snapper(self):
        self.check('palette-snapper')

    def test_status_is_green_when_all_three_are_here(self):
        missing = [n for n in TC.TOOLS if not TC.declared(n)]
        if missing:
            self.skipTest('not installed here: ' + ', '.join(f'{TC.TOOLS[n]["binary"]} ({TC.TOOLS[n]["install"]})' for n in missing))
        run = subprocess.run([sys.executable, '-I', str(SCRIPT), 'status'], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == '__main__':
    unittest.main()
