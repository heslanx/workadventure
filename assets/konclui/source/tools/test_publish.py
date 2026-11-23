"""Behaviour tests of tools/publish.py, the only door from a build to a served map directory.
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_publish.py
Every test works in temporary directories (a build, a target, a backup) and runs the real tool code, in process or as a
subprocess for the command line. No external tool is needed, so nothing is skipped except the test that needs a directory
the process cannot write to (it is skipped when run as root, where permissions do not bind; the injected variant runs
everywhere)."""
import contextlib
import hashlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import publish as P  # noqa: E402

try:
    import fcntl
except ImportError:
    fcntl = None


class Interrupted(BaseException):
    """Stands for Ctrl-C or SystemExit: not an Exception, so nothing may swallow it."""

BUILD = {
    'office.wam': b'wam v2 from the build',
    'office.tmj': b'{"tmj": 2}',
    'tilesets/Floor.png': b'floor-png',
    'entities/mobilia/chair.png': b'chair-png',
    'entities/mobilia/collection.json': b'{"collection": []}',
    'fx/manifest.json': json.dumps({'normal': True, 'tools': {'sprite-normals': {'version': '0.1.0', 'sha256': 'aa'}}}).encode(),
    'scripts/office.js': b'console.log(1)',
    '.hq-office-build': b'marker\n',
}
TIME = '2026-11-22T10:00:00Z'


def write_tree(root, files):
    for rel, data in files.items():
        path = Path(root) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def snapshot(root):
    """Everything under root: files with bytes, mode and mtime, and the directories."""
    state = {}
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames:
            full = os.path.join(dirpath, name)
            state[os.path.relpath(full, root) + '/'] = None
        for name in filenames:
            full = os.path.join(dirpath, name)
            st = os.lstat(full)
            state[os.path.relpath(full, root)] = (hashlib.sha256(Path(full).read_bytes()).hexdigest(), st.st_mode, st.st_mtime_ns)
    return state


def run(*argv, now=None):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stderr(err):
        code = P.main([str(a) for a in argv], out=out, now=now)
    return code, out.getvalue(), err.getvalue()


def run_json(*argv):
    code, out, err = run(*argv, '--json')
    return code, (json.loads(out) if out.strip() else None), err


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.dist, self.target, self.backup = self.root / 'dist', self.root / 'served', self.root / 'backup'
        self.dist.mkdir()
        self.target.mkdir()
        write_tree(self.dist, BUILD)

    def apply(self, *extra, time=TIME, dist=None):
        return run_json('apply', dist or self.dist, self.target, '--backup', self.backup, '--time', time, *extra)

    def ledger(self):
        return json.loads((self.target / P.LEDGER_NAME).read_text())

    def files_of(self, root):
        return {k: v for k, v in snapshot(root).items() if v is not None}

    def published(self):
        return {rel for rel in BUILD if not rel.startswith('.')}

    def no_temporary_files(self):
        left = [rel for rel in snapshot(self.target) if P.TMP_INFIX in rel]
        self.assertEqual(left, [])


class Globs(unittest.TestCase):
    def test_star_stays_in_a_segment_and_double_star_crosses(self):
        self.assertTrue(P.matches('tilesets/Floor.png', ['tilesets/*.png']))
        self.assertFalse(P.matches('entities/mobilia/chair.png', ['entities/*.png']))
        self.assertTrue(P.matches('entities/mobilia/chair.png', ['entities/**']))
        self.assertTrue(P.matches('entities/mobilia/chair.png', ['**/chair.png']))
        self.assertTrue(P.matches('chair.png', ['**/chair.png']))

    def test_a_pattern_without_slash_matches_the_name_at_any_depth_and_a_directory_matches_its_content(self):
        self.assertTrue(P.matches('a/b/office.wam', ['*.wam']))
        self.assertTrue(P.matches('entities/mobilia/chair.png', ['entities']))
        self.assertFalse(P.matches('entities2/x.png', ['entities']))

    def test_a_character_class_matches_one_character_and_can_be_negated(self):
        self.assertTrue(P.matches('tilesets/b.png', ['tilesets/[a-c].png']))
        self.assertFalse(P.matches('tilesets/d.png', ['tilesets/[a-c].png']))
        self.assertTrue(P.matches('tilesets/d.png', ['tilesets/[!a-c].png']))
        self.assertFalse(P.matches('tilesets/b.png', ['tilesets/[!a-c].png']))
        self.assertFalse(P.matches('tilesets/[a-c].png', ['tilesets/x.png']))

    def test_editor_files_are_the_ones_the_code_writes(self):
        for rel in ('office.wam', 'x/y.wam', '__cache.json', 'assets/entities/entities.json', 'assets/sounds/a.mp3', 'private/files/a.pdf'):
            self.assertTrue(P.editor_owned(rel), rel)
        for rel in ('office.tmj', 'entities/mobilia/collection.json', 'tilesets/Floor.png', 'fx/manifest.json'):
            self.assertFalse(P.editor_owned(rel), rel)


class Plan(Case):
    def test_plan_writes_nothing_and_classifies_every_file(self):
        write_tree(self.target, {'office.tmj': BUILD['office.tmj'], 'office.wam': b'edited in the editor', 'only-here.txt': b'x',
                                 'assets/entities/entities.json': b'{}'})
        before = snapshot(self.target)
        dist_before = snapshot(self.dist)
        code, plan, _ = run_json('plan', self.dist, self.target)
        self.assertEqual(code, 0)
        self.assertEqual(snapshot(self.target), before)
        self.assertEqual(snapshot(self.dist), dist_before)
        status = {f['path']: f['status'] for f in plan['files']}
        self.assertEqual(status['office.tmj'], 'identical')
        self.assertEqual(status['office.wam'], 'changed')
        self.assertEqual(status['tilesets/Floor.png'], 'new')
        self.assertEqual({p['path'] for p in plan['left_alone']}, {'only-here.txt', 'assets/entities/entities.json'})
        self.assertEqual(plan['skipped_in_build'], ['.hq-office-build'])
        self.assertEqual(plan['counts']['new'], 5)
        wam = next(f for f in plan['files'] if f['path'] == 'office.wam')
        self.assertEqual((wam['sha256'], wam['size']), (hashlib.sha256(BUILD['office.wam']).hexdigest(), len(BUILD['office.wam'])))
        self.assertEqual(wam['target_sha256'], hashlib.sha256(b'edited in the editor').hexdigest())
        self.assertEqual(wam['edit_state'], 'unrecorded')

    def test_plan_tells_published_from_edited_since_the_last_publish(self):
        self.assertEqual(self.apply()[0], 0)
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2', 'scripts/office.js': b'js v2', 'office.wam': b'wam v3'})
        (self.target / 'scripts/office.js').write_bytes(b'hand edited')
        _, plan, _ = run_json('plan', self.dist, self.target)
        state = {f['path']: f['edit_state'] for f in plan['files'] if f['status'] == 'changed'}
        self.assertEqual(state, {'tilesets/Floor.png': 'as-published', 'scripts/office.js': 'edited', 'office.wam': 'as-published'})
        protected = {f['path']: f['protected_by'] for f in plan['files'] if f['protected_by']}
        self.assertEqual(protected, {'scripts/office.js': ['edited-in-place'], 'office.wam': ['editor-owned']})

    def test_text_output_lists_changes_and_only_counts_identical_files(self):
        self.apply()
        write_tree(self.dist, {'tilesets/Floor.png': b'v2'})
        code, text, _ = run('plan', self.dist, self.target)
        self.assertIn('changed    tilesets/Floor.png', text)
        self.assertNotIn('identical  office.tmj', text)
        self.assertIn('identical  office.tmj', run('plan', self.dist, self.target, '--all')[1])

    def test_a_symlink_in_the_build_or_in_the_way_is_refused_by_plan_too(self):
        os.symlink(self.root, self.dist / 'link')
        code, _, err = run('plan', self.dist, self.target)
        self.assertEqual(code, 2)
        self.assertIn('symlink', err)


class Apply(Case):
    def test_apply_then_verify_and_the_ledger_and_backup_copy(self):
        code, result, _ = self.apply()
        self.assertEqual(code, 0)
        self.assertEqual(self.files_of(self.target).keys() - {P.LEDGER_NAME}, self.published())
        for rel in self.published():
            self.assertEqual((self.target / rel).read_bytes(), BUILD[rel])
        code, report, _ = run_json('verify', self.target)
        self.assertEqual((code, report['ok'], report['checked']), (0, True, len(self.published())))
        entry = self.ledger()['entries'][-1]
        self.assertEqual(entry['id'], result['release'])
        self.assertEqual(entry['time'], TIME)
        self.assertEqual(entry['tools'], {'sprite-normals': {'version': '0.1.0', 'sha256': 'aa'}})
        self.assertEqual(set(entry['written']), self.published())
        self.assertTrue(all(w['previous'] is None for w in entry['written'].values()))
        self.assertEqual(json.loads((self.backup / result['release'] / 'ledger-entry.json').read_text()), entry)
        self.no_temporary_files()

    def test_a_replaced_file_is_copied_to_the_backup_first(self):
        write_tree(self.target, {'tilesets/Floor.png': b'what the server had'})
        self.assertEqual(self.apply('--include-edited', 'tilesets/*')[0], 0)
        release = self.ledger()['entries'][-1]['id']
        self.assertEqual((self.backup / release / 'files/tilesets/Floor.png').read_bytes(), b'what the server had')
        self.assertEqual((self.target / 'tilesets/Floor.png').read_bytes(), b'floor-png')

    def test_new_files_get_readable_modes_and_the_ledger_is_not_one_of_the_published_files(self):
        self.apply()
        self.assertEqual(os.stat(self.target / 'office.tmj').st_mode & 0o444, 0o444)
        self.assertNotIn(P.LEDGER_NAME, self.ledger()['entries'][-1]['files'])
        self.assertFalse((self.target / '.hq-office-build').exists())

    def test_an_edited_file_is_protected_and_nothing_is_written(self):
        self.apply()
        write_tree(self.dist, {'scripts/office.js': b'js v2', 'tilesets/Floor.png': b'floor v2'})
        (self.target / 'scripts/office.js').write_bytes(b'hand edited')
        before, ledger_before = snapshot(self.target), (self.target / P.LEDGER_NAME).read_bytes()
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T11:00:00Z')
        self.assertEqual(code, 3)
        self.assertIn('scripts/office.js', err)
        self.assertNotIn('tilesets/Floor.png', err)
        self.assertEqual(snapshot(self.target), before)
        self.assertEqual((self.target / P.LEDGER_NAME).read_bytes(), ledger_before)
        self.assertEqual(len(list(self.backup.iterdir())), 1)       # only the first release's backup
        self.assertEqual(self.apply('--include-edited', 'scripts/*', time='2026-11-22T11:00:00Z')[0], 0)
        self.assertEqual((self.target / 'scripts/office.js').read_bytes(), b'js v2')
        release = self.ledger()['entries'][-1]
        self.assertEqual((self.backup / release['id'] / 'files/scripts/office.js').read_bytes(), b'hand edited')
        self.assertEqual(release['overrode_protection'], {'scripts/office.js': ['edited-in-place']})

    def test_a_changed_file_the_ledger_never_heard_of_is_protected(self):
        write_tree(self.target, {'tilesets/Floor.png': b'already served, origin unknown'})
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup)
        self.assertEqual(code, 3)
        self.assertIn('not-in-ledger', err)
        self.assertFalse((self.target / 'office.tmj').exists())     # not even the new files

    def test_the_editor_owned_wam_is_protected_even_when_nobody_edited_it(self):
        self.apply()
        write_tree(self.dist, {'office.wam': b'wam v3'})
        before = snapshot(self.target)
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T11:00:00Z')
        self.assertEqual(code, 3)
        self.assertIn('editor-owned', err)
        self.assertEqual(snapshot(self.target), before)
        self.assertEqual(self.apply('--include-edited', '*.wam', time='2026-11-22T11:00:00Z')[0], 0)
        self.assertEqual((self.target / 'office.wam').read_bytes(), b'wam v3')

    def test_a_new_wam_is_not_an_overwrite(self):
        self.assertEqual(self.apply()[0], 0)
        self.assertEqual((self.target / 'office.wam').read_bytes(), BUILD['office.wam'])

    def test_only_and_exclude_choose_the_files(self):
        self.assertEqual(self.apply('--only', 'tilesets/**', 'scripts/**', '--exclude', 'scripts/office.js')[0], 0)
        self.assertEqual(self.files_of(self.target).keys() - {P.LEDGER_NAME}, {'tilesets/Floor.png'})
        self.assertEqual(set(self.ledger()['entries'][-1]['files']), {'tilesets/Floor.png'})
        self.assertEqual(self.apply('--exclude', '*.wam', '--exclude', 'entities/**', time='2026-11-22T11:00:00Z')[0], 0)
        self.assertEqual(self.files_of(self.target).keys() - {P.LEDGER_NAME},
                         {'tilesets/Floor.png', 'office.tmj', 'fx/manifest.json', 'scripts/office.js'})

    def test_a_protected_file_that_is_excluded_does_not_stop_the_rest(self):
        self.apply()
        write_tree(self.dist, {'office.wam': b'wam v3', 'tilesets/Floor.png': b'floor v2'})
        self.assertEqual(self.apply('--exclude', '*.wam', time='2026-11-22T11:00:00Z')[0], 0)
        self.assertEqual((self.target / 'tilesets/Floor.png').read_bytes(), b'floor v2')
        self.assertEqual((self.target / 'office.wam').read_bytes(), BUILD['office.wam'])

    def test_files_only_the_target_has_are_never_touched(self):
        write_tree(self.target, {'editor-note.txt': b'mine', 'assets/entities/entities.json': b'{"custom": 1}'})
        self.apply()
        self.assertEqual((self.target / 'editor-note.txt').read_bytes(), b'mine')
        self.assertEqual((self.target / 'assets/entities/entities.json').read_bytes(), b'{"custom": 1}')

    def test_map_files_are_written_last(self):
        order = []
        real = P.copy_atomic
        with mock.patch.object(P, 'copy_atomic', side_effect=lambda src, dest, *a, **k: (order.append(os.path.basename(dest)), real(src, dest, *a, **k))):
            self.apply()
        self.assertEqual(order[-2:], ['office.tmj', 'office.wam'])

    def test_a_bad_time_is_refused(self):
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', 'yesterday')
        self.assertEqual(code, 2)
        self.assertIn('--time', err)
        self.assertEqual(os.listdir(self.target), [])

    def test_the_time_is_taken_once_when_not_given(self):
        calls = []

        def clock():
            import datetime
            calls.append(1)
            return datetime.datetime(2026, 11, 22, 9, 0, 0, tzinfo=datetime.timezone.utc)
        code, _, _ = run('apply', self.dist, self.target, '--backup', self.backup, now=clock)
        self.assertEqual((code, len(calls)), (0, 1))
        self.assertEqual(self.ledger()['entries'][-1]['time'], '2026-11-22T09:00:00Z')


class Idempotence(Case):
    def test_two_applies_of_the_same_build_are_a_no_op_with_the_same_release_id(self):
        _, first, _ = self.apply()
        state = snapshot(self.target)
        backups = snapshot(self.backup)
        code, second, _ = self.apply(time='2027-01-01T00:00:00Z')
        self.assertEqual(code, 0)
        self.assertTrue(second['noop'])
        self.assertEqual(second['release'], first['release'])
        self.assertEqual(snapshot(self.target), state)
        self.assertEqual(snapshot(self.backup), backups)
        self.assertEqual(len(self.ledger()['entries']), 1)

    def test_the_same_inputs_give_the_same_id_and_the_same_ledger_bytes(self):
        other = self.root / 'served2'
        other.mkdir()
        _, a, _ = self.apply()
        code, b, _ = run_json('apply', self.dist, other, '--backup', self.root / 'backup2', '--time', TIME)
        self.assertEqual(a['release'], b['release'])
        self.assertEqual((self.target / P.LEDGER_NAME).read_bytes(), (other / P.LEDGER_NAME).read_bytes())

    def test_time_content_and_tool_identities_all_change_the_id(self):
        ids = {self.apply()[1]['release']}
        for n, change in enumerate(({'time': '2026-11-22T10:00:01Z'}, {'file': ('tilesets/Floor.png', b'other')},
                                    {'tools': {'sprite-normals': {'version': '0.2.0'}}}), start=1):
            dist, target = self.root / f'd{n}', self.root / f't{n}'
            dist.mkdir()
            target.mkdir()
            files = dict(BUILD)
            if 'file' in change:
                files[change['file'][0]] = change['file'][1]
            if 'tools' in change:
                files['fx/manifest.json'] = json.dumps({'tools': change['tools']}).encode()
            write_tree(dist, files)
            _, out, _ = run_json('apply', dist, target, '--backup', self.root / f'b{n}', '--time', change.get('time', TIME))
            ids.add(out['release'])
        self.assertEqual(len(ids), 4)

    def test_the_tool_identities_alone_change_the_id(self):
        # the manifest is itself a published file, so a real change shows twice; patched, only the identities differ
        other = self.root / 'served2'
        other.mkdir()
        with mock.patch.object(P, 'read_tools', return_value={'pixel-snapper': {'version': '1.0.0'}}):
            _, a, _ = self.apply()
        with mock.patch.object(P, 'read_tools', return_value={'pixel-snapper': {'version': '1.0.1'}}):
            _, b, _ = run_json('apply', self.dist, other, '--backup', self.root / 'backup2', '--time', TIME)
        self.assertNotEqual(a['release'], b['release'])

    def test_the_tool_identities_come_from_the_build_manifest_only_when_it_has_them(self):
        (self.dist / 'fx/manifest.json').write_text('{"normal": true}')
        self.apply()
        self.assertIsNone(self.ledger()['entries'][-1]['tools'])


class Failure(Case):
    def seed(self):
        """A published first release, then a build with a changed file, a new one in a new directory, and a changed one last."""
        self.apply()
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2', 'new/dir/added.png': b'added', 'scripts/office.js': b'js v2'})
        return snapshot(self.target), (self.target / P.LEDGER_NAME).read_bytes()

    def assert_untouched(self, before, ledger):
        after = snapshot(self.target)
        self.assertEqual(after, before)
        self.assertEqual((self.target / P.LEDGER_NAME).read_bytes(), ledger)
        self.no_temporary_files()

    def test_an_injected_failure_half_way_restores_everything(self):
        before, ledger = self.seed()
        real, calls = os.replace, []

        def flaky(src, dst):
            calls.append(dst)
            if dst.endswith('tilesets/Floor.png'):
                raise OSError(28, 'injected: no space left')
            return real(src, dst)
        with mock.patch.object(P.os, 'replace', flaky):
            code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T11:00:00Z')
        self.assertEqual(code, 4)
        self.assertIn('everything was restored', err)
        self.assertTrue(any(c.endswith('scripts/office.js') for c in calls) and any(c.endswith('added.png') for c in calls))
        self.assert_untouched(before, ledger)
        self.assertEqual(len(list(self.backup.iterdir())), 1)        # the failed release left no backup behind

    @unittest.skipIf(hasattr(os, 'geteuid') and os.geteuid() == 0, 'permissions do not bind root')
    def test_an_unwritable_destination_directory_restores_the_rest(self):
        before, ledger = self.seed()
        (self.target / 'tilesets').chmod(0o555)
        self.addCleanup((self.target / 'tilesets').chmod, 0o755)
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T11:00:00Z')
        (self.target / 'tilesets').chmod(0o755)
        self.assertEqual(code, 4, err)
        before = {k: (v[0], v[1] & 0o777, None) if v else v for k, v in before.items()}
        after = {k: (v[0], v[1] & 0o777, None) if v else v for k, v in snapshot(self.target).items()}
        self.assertEqual(after.keys(), before.keys())
        self.assertEqual({k: v[0] for k, v in after.items() if v}, {k: v[0] for k, v in before.items() if v})
        self.assertEqual((self.target / P.LEDGER_NAME).read_bytes(), ledger)
        self.no_temporary_files()

    def test_a_hash_that_reads_back_wrong_restores_everything(self):
        before, ledger = self.seed()
        real = P.copy_atomic

        def corrupting(src, dest, *args, **kwargs):
            real(src, dest, *args, **kwargs)
            if dest.endswith('added.png'):
                with open(dest, 'ab') as handle:
                    handle.write(b'!')
        with mock.patch.object(P, 'copy_atomic', corrupting):
            code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T11:00:00Z')
        self.assertEqual(code, 4)
        self.assertIn('hash read back', err)
        self.assert_untouched(before, ledger)

    def test_a_failing_ledger_write_restores_everything(self):
        before, ledger = self.seed()
        real = P.write_bytes_atomic

        def failing(dest, data, mode):
            if dest.endswith(P.LEDGER_NAME):
                raise OSError(5, 'injected: ledger')
            return real(dest, data, mode)
        with mock.patch.object(P, 'write_bytes_atomic', failing):
            code, _, _ = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T11:00:00Z')
        self.assertEqual(code, 4)
        self.assert_untouched(before, ledger)

    def test_a_failure_on_a_first_publish_leaves_no_ledger_and_no_directory(self):
        real = os.replace

        def flaky(src, dst):
            if dst.endswith('office.wam'):
                raise OSError(5, 'injected')
            return real(src, dst)
        with mock.patch.object(P.os, 'replace', flaky):
            code, _, _ = self.apply()
        self.assertEqual(code, 4)
        self.assertEqual(os.listdir(self.target), [])
        self.assertEqual(os.listdir(self.backup), [])

    def test_a_failed_restore_is_reported_with_its_files_and_keeps_the_backup(self):
        self.seed()
        real, seen = os.replace, {}

        def flaky(src, dst):
            seen[dst] = seen.get(dst, 0) + 1
            if dst.endswith('tilesets/Floor.png') or (dst.endswith('scripts/office.js') and seen[dst] > 1):
                raise OSError(5, 'injected')            # the write that fails, then the restore of an earlier file
            return real(src, dst)
        with mock.patch.object(P.os, 'replace', flaky):
            code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T11:00:00Z')
        self.assertEqual(code, 5)
        self.assertIn('not restored: scripts/office.js', err)
        self.assertEqual(len(list(self.backup.iterdir())), 2)


class Rollback(Case):
    def test_rollback_restores_bytes_exactly_and_removes_what_was_added(self):
        write_tree(self.target, {'tilesets/Floor.png': b'served before any publish', 'keep.txt': b'k'})
        os.chmod(self.target / 'tilesets/Floor.png', 0o640)
        os.utime(self.target / 'tilesets/Floor.png', ns=(10**18, 10**18))
        before = snapshot(self.target)
        self.assertEqual(self.apply('--include-edited', 'tilesets/*')[0], 0)
        release = self.ledger()['entries'][-1]['id']
        self.assertGreater(len(self.ledger()['entries'][-1]['created_dirs']), 0)
        code, result, _ = run_json('rollback', self.target, '--backup', self.backup, '--time', '2026-11-22T12:00:00Z')
        self.assertEqual(code, 0)
        self.assertEqual(result['release'], release)
        after = snapshot(self.target)
        ledger_row = after.pop(P.LEDGER_NAME)
        self.assertEqual(after, before)                 # bytes, modes, mtimes and directories as they were
        self.assertEqual(result['restored'], ['tilesets/Floor.png'])
        entry = self.ledger()['entries'][-1]
        self.assertEqual((entry['kind'], entry['rolls_back']), ('rollback', release))
        self.assertEqual(self.ledger()['entries'][0]['id'], release)
        self.assertTrue(ledger_row)
        self.assertEqual(run_json('verify', self.target)[1]['ok'], True)
        self.no_temporary_files()

    def test_a_second_rollback_is_refused_with_a_clear_message(self):
        self.apply()
        self.assertEqual(run('rollback', self.target, '--backup', self.backup)[0], 0)
        state = snapshot(self.target)
        code, _, err = run('rollback', self.target, '--backup', self.backup)
        self.assertEqual(code, 2)
        self.assertIn('already rolled back', err)
        self.assertEqual(snapshot(self.target), state)
        release = self.ledger()['entries'][0]['id']
        code, _, err = run('rollback', self.target, '--backup', self.backup, '--release', release)
        self.assertEqual(code, 2)
        self.assertIn('already rolled back', err)

    def test_rollback_refuses_when_a_file_of_the_release_changed_since(self):
        self.apply()
        (self.target / 'scripts/office.js').write_bytes(b'edited after the publish')
        state = snapshot(self.target)
        code, _, err = run('rollback', self.target, '--backup', self.backup)
        self.assertEqual(code, 2)
        self.assertIn('scripts/office.js', err)
        self.assertEqual(snapshot(self.target), state)                      # nothing at all was removed
        self.assertEqual(run('rollback', self.target, '--backup', self.backup, '--include-edited', 'scripts/*')[0], 0)
        self.assertFalse((self.target / 'scripts/office.js').exists())

    def test_rollback_only_removes_what_the_ledger_says_was_written(self):
        write_tree(self.target, {'extra.txt': b'not ours', 'tilesets/Other.png': b'not ours either'})
        self.apply()
        write_tree(self.target, {'scripts/note.txt': b'added later by somebody'})
        self.assertEqual(run('rollback', self.target, '--backup', self.backup)[0], 0)
        self.assertEqual((self.target / 'extra.txt').read_bytes(), b'not ours')
        self.assertEqual((self.target / 'tilesets/Other.png').read_bytes(), b'not ours either')
        self.assertEqual((self.target / 'scripts/note.txt').read_bytes(), b'added later by somebody')   # its directory kept too
        self.assertFalse((self.target / 'office.wam').exists())
        self.assertFalse((self.target / 'entities').exists())

    def test_rolling_back_an_older_release_is_allowed_only_when_nothing_later_touched_it(self):
        self.apply('--only', 'tilesets/**')
        _, second, _ = self.apply('--only', 'scripts/**', time='2026-11-22T11:00:00Z')
        first = self.ledger()['entries'][0]['id']
        self.assertEqual(run('rollback', self.target, '--backup', self.backup, '--release', first)[0], 0)
        self.assertFalse((self.target / 'tilesets/Floor.png').exists())
        self.assertTrue((self.target / 'scripts/office.js').exists())
        self.assertEqual(second['release'], self.ledger()['entries'][1]['id'])

    def test_rollback_of_an_older_release_is_refused_when_a_later_one_replaced_its_file(self):
        self.apply()
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2'})
        self.assertEqual(self.apply('--include-edited', 'tilesets/*', time='2026-11-22T11:00:00Z')[0], 0)
        first = self.ledger()['entries'][0]['id']
        code, _, err = run('rollback', self.target, '--backup', self.backup, '--release', first)
        self.assertEqual(code, 2)
        self.assertIn('tilesets/Floor.png', err)

    def test_a_damaged_backup_stops_the_rollback_before_any_write(self):
        write_tree(self.target, {'tilesets/Floor.png': b'old'})
        self.apply('--include-edited', 'tilesets/*')
        release = self.ledger()['entries'][-1]['id']
        (self.backup / release / 'files/tilesets/Floor.png').write_bytes(b'tampered')
        state = snapshot(self.target)
        code, _, err = run('rollback', self.target, '--backup', self.backup)
        self.assertEqual(code, 2)
        self.assertIn('damaged', err)
        self.assertEqual(snapshot(self.target), state)

    def test_the_backup_of_another_release_is_not_accepted(self):
        self.apply()
        other = self.root / 'other-backup'
        (other / 'deadbeefdeadbeef').mkdir(parents=True)
        release = self.ledger()['entries'][-1]['id']
        (other / release).mkdir()
        code, _, err = run('rollback', self.target, '--backup', other)
        self.assertEqual(code, 2)
        self.assertIn('not the backup', err)

    def test_a_failure_during_rollback_puts_the_release_back(self):
        write_tree(self.target, {'tilesets/Floor.png': b'old'})
        self.apply('--include-edited', 'tilesets/*')
        before, ledger = snapshot(self.target), (self.target / P.LEDGER_NAME).read_bytes()
        real = os.replace

        def flaky(src, dst):
            if dst.endswith('tilesets/Floor.png'):
                raise OSError(5, 'injected')
            return real(src, dst)
        with mock.patch.object(P.os, 'replace', flaky):
            code, _, _ = run('rollback', self.target, '--backup', self.backup)
        self.assertEqual(code, 4)
        self.assertEqual(snapshot(self.target), before)
        self.assertEqual((self.target / P.LEDGER_NAME).read_bytes(), ledger)

    def test_a_tampered_ledger_cannot_make_rollback_or_verify_leave_the_target(self):
        self.apply()
        ledger = self.ledger()
        outside = self.root / 'outside.txt'
        outside.write_text('precious')
        entry = ledger['entries'][-1]
        entry['written']['../outside.txt'] = dict(sha256='0' * 64, size=1, previous=None)
        entry['files']['../outside.txt'] = dict(sha256='0' * 64, size=1)
        (self.target / P.LEDGER_NAME).write_text(json.dumps(ledger))
        (self.backup / entry['id'] / 'ledger-entry.json').write_text(json.dumps(entry))
        self.assertEqual(run('verify', self.target)[0], 2)
        code, _, err = run('rollback', self.target, '--backup', self.backup)
        self.assertEqual(code, 2)
        self.assertIn('unsafe path', err)
        self.assertEqual(outside.read_text(), 'precious')


class Verify(Case):
    def test_verify_lists_what_drifted(self):
        self.apply()
        (self.target / 'tilesets/Floor.png').write_bytes(b'changed')
        (self.target / 'scripts/office.js').unlink()
        code, report, _ = run_json('verify', self.target)
        self.assertEqual(code, 1)
        self.assertFalse(report['ok'])
        self.assertEqual({d['path']: d['actual'] for d in report['drift']}['scripts/office.js'], 'missing')
        self.assertEqual({d['path'] for d in report['drift']}, {'tilesets/Floor.png', 'scripts/office.js'})
        self.assertIn('DRIFT', run('verify', self.target)[1])

    def test_verify_without_a_ledger_is_an_error_not_a_pass(self):
        code, _, err = run('verify', self.target)
        self.assertEqual(code, 2)
        self.assertIn('no ledger', err)

    def test_verify_after_a_rollback_checks_the_restored_state(self):
        write_tree(self.target, {'tilesets/Floor.png': b'old'})
        self.apply('--include-edited', 'tilesets/*')
        run('rollback', self.target, '--backup', self.backup)
        self.assertEqual(run('verify', self.target)[0], 0)
        (self.target / 'tilesets/Floor.png').write_bytes(b'drift')
        self.assertEqual(run('verify', self.target)[0], 1)
        (self.target / 'tilesets/Floor.png').write_bytes(b'old')
        (self.target / 'office.tmj').write_bytes(b'came back')
        self.assertEqual(run('verify', self.target)[0], 1)

    def test_a_corrupt_ledger_stops_everything(self):
        (self.target / P.LEDGER_NAME).write_text('not json')
        for argv in (('verify', self.target), ('plan', self.dist, self.target)):
            self.assertEqual(run(*argv)[0], 2)
        self.assertEqual(run('apply', self.dist, self.target, '--backup', self.backup)[0], 2)
        self.assertEqual((self.target / P.LEDGER_NAME).read_text(), 'not json')


class Refusals(Case):
    def refuse(self, *argv, message):
        before = snapshot(self.root)
        code, _, err = run(*argv)
        self.assertEqual(code, 2, err)
        self.assertIn(message, err)
        self.assertEqual(snapshot(self.root), before)

    def test_a_symlinked_directory_that_points_out_of_the_target_is_refused(self):
        outside = self.root / 'outside'
        outside.mkdir()
        os.symlink(outside, self.target / 'tilesets')
        self.refuse('apply', self.dist, self.target, '--backup', self.backup, message='symlink')
        self.assertEqual(os.listdir(outside), [])

    def test_a_symlinked_file_in_the_target_is_refused_even_when_it_points_inside(self):
        (self.target / 'real.js').write_bytes(b'x')
        os.symlink(self.target / 'real.js', self.target / 'scripts_office.js')
        write_tree(self.dist, {'scripts_office.js': b'js'})
        self.refuse('apply', self.dist, self.target, '--backup', self.backup, message='symlink')

    def test_a_symlink_to_a_file_outside_is_not_written_through(self):
        outside = self.root / 'outside.txt'
        outside.write_text('precious')
        os.symlink(outside, self.target / 'office.tmj')
        self.refuse('apply', self.dist, self.target, '--backup', self.backup, message='symlink')
        self.assertEqual(outside.read_text(), 'precious')

    def test_a_symlink_in_the_build_is_refused(self):
        os.symlink(self.root / 'dist', self.dist / 'loop')
        self.refuse('apply', self.dist, self.target, '--backup', self.backup, message='symlink')

    def test_a_target_that_is_not_a_directory_is_refused(self):
        file = self.root / 'a-file'
        file.write_text('x')
        self.refuse('apply', self.dist, file, '--backup', self.backup, message='not a directory')
        self.refuse('plan', self.dist, self.root / 'missing', message='not a directory')
        self.refuse('verify', file, message='not a directory')

    def test_a_directory_where_a_file_goes_is_refused(self):
        (self.target / 'office.tmj').mkdir()
        self.refuse('apply', self.dist, self.target, '--backup', self.backup, message='not a regular file')

    def test_a_backup_inside_the_target_or_the_build_is_refused(self):
        self.refuse('apply', self.dist, self.target, '--backup', self.target / 'bk', message='inside the target')
        self.refuse('apply', self.dist, self.target, '--backup', self.dist / 'bk', message='inside the build')
        self.refuse('apply', self.dist, self.target, '--backup', self.target, message='inside the target')
        link = self.root / 'sneaky'
        os.symlink(self.target, link)
        self.refuse('apply', self.dist, self.target, '--backup', link / 'bk', message='inside the target')
        self.refuse('rollback', self.target, '--backup', self.target / 'bk', message='inside the target')

    def test_a_target_inside_the_build_or_the_same_directory_is_refused(self):
        self.refuse('apply', self.dist, self.dist, '--backup', self.backup, message='same directory')
        inner = self.dist / 'inner'
        inner.mkdir()
        self.refuse('apply', self.dist, inner, '--backup', self.backup, message='inside the other')

    def test_an_empty_build_is_refused(self):
        empty = self.root / 'empty'
        (empty).mkdir()
        write_tree(empty, {'.hq-office-build': b'm'})
        self.refuse('apply', empty, self.target, '--backup', self.backup, message='no file to publish')

    def test_the_target_may_be_reached_through_a_symlink(self):
        link = self.root / 'link-to-served'
        os.symlink(self.target, link)
        self.assertEqual(run('apply', self.dist, link, '--backup', self.backup)[0], 0)
        self.assertTrue((self.target / 'office.tmj').exists())

    def test_the_existing_backup_of_that_release_is_never_overwritten(self):
        _, first, _ = self.apply()
        run('rollback', self.target, '--backup', self.backup)
        # the same build and time again: the id repeats and its backup directory exists
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', TIME)
        self.assertEqual(code, 2)
        self.assertIn('already exists', err)


class Repairs(Case):
    """Problems found by the review of the first version, each with the test that failed before the fix."""
    LATER = '2026-11-22T11:00:00Z'

    def later(self, *extra):
        return run('apply', self.dist, self.target, '--backup', self.backup, '--time', self.LATER, *extra)

    # --- a rollback must not turn a file the tool never wrote into one it did
    def test_a_rollback_keeps_the_protection_of_a_file_the_tool_never_wrote(self):
        write_tree(self.target, {'tilesets/Floor.png': b'HAND EDITED by the owner'})
        self.assertEqual(run('apply', self.dist, self.target, '--backup', self.backup)[0], 3)
        self.assertEqual(self.apply('--include-edited', 'tilesets/*')[0], 0)
        self.assertEqual(run('rollback', self.target, '--backup', self.backup, '--time', '2026-11-22T10:30:00Z')[0], 0)
        self.assertEqual((self.target / 'tilesets/Floor.png').read_bytes(), b'HAND EDITED by the owner')
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2'})
        _, plan, _ = run_json('plan', self.dist, self.target)
        floor = next(f for f in plan['files'] if f['path'] == 'tilesets/Floor.png')
        self.assertEqual((floor['edit_state'], floor['protected_by']), ('unrecorded', ['not-in-ledger']))
        before = snapshot(self.target)
        code, _, err = self.later()
        self.assertEqual(code, 3, err)
        self.assertIn('not-in-ledger', err)
        self.assertEqual(snapshot(self.target), before)

    def test_a_rollback_gives_back_the_state_the_ledger_knew_before_the_release(self):
        self.assertEqual(self.apply()[0], 0)
        floor_v1 = hashlib.sha256(BUILD['tilesets/Floor.png']).hexdigest()
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2'})
        self.assertEqual(self.later()[0], 0)
        entry = self.ledger()['entries'][-1]
        self.assertEqual(entry['written']['tilesets/Floor.png']['previous_recorded'], floor_v1)
        self.assertEqual(run('rollback', self.target, '--backup', self.backup, '--time', '2026-11-22T12:00:00Z')[0], 0)
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v3'})
        _, plan, _ = run_json('plan', self.dist, self.target)
        floor = next(f for f in plan['files'] if f['path'] == 'tilesets/Floor.png')
        self.assertEqual((floor['edit_state'], floor['protected_by']), ('as-published', []))
        self.assertEqual(run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T13:00:00Z')[0], 0)

    def test_a_file_edited_after_a_rollback_is_still_seen_as_edited(self):
        self.assertEqual(self.apply()[0], 0)
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2'})
        self.assertEqual(self.later()[0], 0)
        run('rollback', self.target, '--backup', self.backup, '--time', '2026-11-22T12:00:00Z')
        (self.target / 'tilesets/Floor.png').write_bytes(b'hand edited after the rollback')
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v3'})
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T13:00:00Z')
        self.assertEqual(code, 3, err)
        self.assertIn('edited-in-place', err)

    # --- Ctrl-C or SystemExit during an apply
    def interrupted_apply(self, restore_also_fails):
        before, ledger = Failure.seed(self)
        real, seen = os.replace, {}

        def flaky(src, dst):
            seen[dst] = seen.get(dst, 0) + 1
            if dst.endswith('tilesets/Floor.png'):
                raise Interrupted()                      # Ctrl-C while the last file is written
            if restore_also_fails and dst.endswith('scripts/office.js') and seen[dst] > 1:
                raise OSError(5, 'injected')             # and the restore of an earlier file fails too
            return real(src, dst)
        with mock.patch.object(P.os, 'replace', flaky):
            return before, ledger, run('apply', self.dist, self.target, '--backup', self.backup, '--time', self.LATER)

    def test_an_interrupt_with_an_incomplete_restore_keeps_the_backup_and_reports_the_files(self):
        _before, _ledger, (code, _, err) = self.interrupted_apply(restore_also_fails=True)
        self.assertEqual(code, 5, err)
        self.assertIn('not restored: scripts/office.js', err)
        kept = sorted(p.name for p in self.backup.iterdir())
        self.assertEqual(len(kept), 2)                   # the first release and the failed one
        failed = next(self.backup / name for name in kept if name != self.ledger()['entries'][-1]['id'])
        self.assertEqual((failed / 'files/scripts/office.js').read_bytes(), BUILD['scripts/office.js'])

    def test_an_interrupt_with_a_complete_restore_is_re_raised_and_leaves_no_backup(self):
        real = os.replace

        def interrupt(src, dst):
            if dst.endswith('tilesets/Floor.png'):
                raise Interrupted()
            return real(src, dst)
        before, ledger = Failure.seed(self)
        with mock.patch.object(P.os, 'replace', interrupt):
            with self.assertRaises(Interrupted):
                run('apply', self.dist, self.target, '--backup', self.backup, '--time', self.LATER)
        self.assertEqual(snapshot(self.target), before)
        self.assertEqual((self.target / P.LEDGER_NAME).read_bytes(), ledger)
        self.assertEqual(len(list(self.backup.iterdir())), 1)
        self.no_temporary_files()

    # --- a file the editor rewrites between the plan and the backup copy
    def test_a_file_that_changes_between_the_plan_and_the_backup_copy_stops_the_apply(self):
        self.apply()
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2', 'new/added.png': b'added'})
        ledger, backups = (self.target / P.LEDGER_NAME).read_bytes(), snapshot(self.backup)
        real = shutil.copy2

        def racing(src, dst, **kwargs):
            if str(src).endswith('tilesets/Floor.png'):
                Path(src).write_bytes(b'the editor wrote this meanwhile')
            return real(src, dst, **kwargs)
        with mock.patch.object(P.shutil, 'copy2', racing):
            code, _, err = self.later()
        self.assertEqual(code, 2, err)
        self.assertIn('changed since the plan', err)
        self.assertEqual((self.target / 'tilesets/Floor.png').read_bytes(), b'the editor wrote this meanwhile')
        self.assertFalse((self.target / 'new').exists())
        self.assertEqual((self.target / P.LEDGER_NAME).read_bytes(), ledger)
        self.assertEqual(snapshot(self.backup), backups)
        self.no_temporary_files()

    def test_a_file_that_appears_where_the_plan_saw_none_stops_the_apply(self):
        real = shutil.copy2
        write_tree(self.target, {'tilesets/Floor.png': b'old'})
        self.assertEqual(self.apply('--include-edited', 'tilesets/*')[0], 0)
        write_tree(self.dist, {'zz/added.png': b'added', 'tilesets/Floor.png': b'floor v2'})

        def racing(src, dst, **kwargs):                  # runs while the copies of existing files are made
            write_tree(self.target, {'zz/added.png': b'editor created it'})
            return real(src, dst, **kwargs)
        with mock.patch.object(P.shutil, 'copy2', racing):
            code, _, err = self.later()
        self.assertEqual(code, 2, err)
        self.assertEqual((self.target / 'zz/added.png').read_bytes(), b'editor created it')
        self.assertIn('appeared since the plan', err)

    def test_a_file_changed_just_before_its_own_write_is_not_overwritten(self):
        self.apply()
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2', 'scripts/office.js': b'js v2'})
        real = P.copy_atomic

        def racing(src, dest, *args, **kwargs):
            real(src, dest, *args, **kwargs)
            if dest.endswith('scripts/office.js'):       # written first; the editor then touches the next one
                (self.target / 'tilesets/Floor.png').write_bytes(b'editor, just now')
        with mock.patch.object(P, 'copy_atomic', racing):
            code, _, err = self.later()
        self.assertEqual(code, 4, err)
        self.assertEqual((self.target / 'tilesets/Floor.png').read_bytes(), b'editor, just now')
        self.assertEqual((self.target / 'scripts/office.js').read_bytes(), BUILD['scripts/office.js'])
        self.no_temporary_files()

    # --- an OSError before the first write is a refusal, never the exit code of verify
    def test_an_unusable_backup_directory_is_a_refusal_with_nothing_written(self):
        (self.root / 'a-file').write_text('x')
        code, _, err = run('apply', self.dist, self.target, '--backup', self.root / 'a-file' / 'x')
        self.assertEqual(code, 2, err)
        self.assertIn('publish:', err)
        self.assertEqual(os.listdir(self.target), [])

    def test_a_backup_copy_that_fails_is_a_refusal_with_the_target_untouched(self):
        self.apply()
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2'})
        before, backups = snapshot(self.target), snapshot(self.backup)
        with mock.patch.object(P.shutil, 'copy2', side_effect=OSError(28, 'injected: no space left')):
            code, _, err = self.later()
        self.assertEqual(code, 2, err)
        self.assertIn('no space left', err)
        self.assertEqual(snapshot(self.target), before)
        self.assertEqual(snapshot(self.backup), backups)

    def test_an_unreadable_ledger_entry_in_the_backup_is_a_refusal(self):
        self.apply()
        release = self.ledger()['entries'][-1]['id']
        (self.backup / release / 'ledger-entry.json').write_text('{ not json')
        state = snapshot(self.target)
        code, _, err = run('rollback', self.target, '--backup', self.backup)
        self.assertEqual(code, 2, err)
        self.assertEqual(snapshot(self.target), state)

    # --- gaps the mutation run showed
    @unittest.skipIf(fcntl is None, 'no flock on this platform')
    def test_a_target_held_by_another_publish_is_refused(self):
        self.apply()
        fd = os.open(self.target, os.O_RDONLY)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        write_tree(self.dist, {'tilesets/Floor.png': b'floor v2'})
        before = snapshot(self.target)
        for argv in (('apply', self.dist, self.target, '--backup', self.backup, '--time', self.LATER),
                     ('rollback', self.target, '--backup', self.backup)):
            code, _, err = run(*argv)
            self.assertEqual(code, 2, err)
            self.assertIn('another publish or rollback', err)
        self.assertEqual(snapshot(self.target), before)

    def test_a_replaced_file_and_the_ledger_keep_their_modes(self):
        write_tree(self.target, {'tilesets/Floor.png': b'old'})
        os.chmod(self.target / 'tilesets/Floor.png', 0o604)
        self.assertEqual(self.apply('--include-edited', 'tilesets/*')[0], 0)
        self.assertEqual(stat.S_IMODE(os.stat(self.target / 'tilesets/Floor.png').st_mode), 0o604)
        os.chmod(self.target / P.LEDGER_NAME, 0o604)
        write_tree(self.dist, {'scripts/office.js': b'js v2'})
        os.chmod(self.target / 'scripts/office.js', 0o604)
        self.assertEqual(self.later()[0], 0)
        self.assertEqual(stat.S_IMODE(os.stat(self.target / 'scripts/office.js').st_mode), 0o604)
        self.assertEqual(stat.S_IMODE(os.stat(self.target / P.LEDGER_NAME).st_mode), 0o604)
        self.assertEqual(run('rollback', self.target, '--backup', self.backup, '--time', '2026-11-22T12:00:00Z')[0], 0)
        self.assertEqual(stat.S_IMODE(os.stat(self.target / P.LEDGER_NAME).st_mode), 0o604)

    def test_a_replaced_file_keeps_its_owner_when_the_process_may_set_it(self):
        write_tree(self.target, {'tilesets/Floor.png': b'old'})
        old = os.stat(self.target / 'tilesets/Floor.png')
        calls = []
        with mock.patch.object(P.os, 'chown', side_effect=lambda path, uid, gid: calls.append((os.path.basename(path), uid, gid))):
            self.assertEqual(self.apply('--include-edited', 'tilesets/*')[0], 0)
        self.assertEqual([(uid, gid) for name, uid, gid in calls if 'Floor.png' in name], [(old.st_uid, old.st_gid)])
        self.assertFalse([c for c in calls if 'Floor.png' not in c[0]])      # new files belong to whoever runs the tool

    def test_a_chown_that_is_not_allowed_does_not_fail_the_publish(self):
        write_tree(self.target, {'tilesets/Floor.png': b'old'})
        with mock.patch.object(P.os, 'chown', side_effect=PermissionError(1, 'not permitted')):
            self.assertEqual(self.apply('--include-edited', 'tilesets/*')[0], 0)
        self.assertEqual((self.target / 'tilesets/Floor.png').read_bytes(), BUILD['tilesets/Floor.png'])

    def test_the_plan_says_which_files_only_the_target_has_were_written_by_the_tool(self):
        self.apply()
        (self.dist / 'scripts/office.js').unlink()
        write_tree(self.target, {'mine.txt': b'x'})
        _, plan, _ = run_json('plan', self.dist, self.target)
        self.assertEqual({f['path']: f['in_ledger'] for f in plan['left_alone']}, {'scripts/office.js': True, 'mine.txt': False})
        text = run('plan', self.dist, self.target)[1]
        self.assertIn('left alone  scripts/office.js  (written by this tool once)', text)
        self.assertIn('left alone  mine.txt\n', text + '\n')

    def test_a_ledger_entry_in_the_backup_that_differs_is_not_the_backup_of_the_release(self):
        self.apply()
        release = self.ledger()['entries'][-1]['id']
        saved = self.backup / release / 'ledger-entry.json'
        entry = json.loads(saved.read_text())
        entry['time'] = '2030-01-01T00:00:00Z'
        saved.write_text(json.dumps(entry))
        state = snapshot(self.target)
        code, _, err = run('rollback', self.target, '--backup', self.backup)
        self.assertEqual(code, 2)
        self.assertIn('not the backup', err)
        self.assertEqual(snapshot(self.target), state)

    @unittest.skipUnless(hasattr(os, 'O_NOFOLLOW'), 'no O_NOFOLLOW on this platform')
    def test_hashing_never_follows_a_symlink(self):
        (self.root / 'real.txt').write_bytes(b'x')
        os.symlink(self.root / 'real.txt', self.root / 'link.txt')
        self.assertEqual(P.hash_file(self.root / 'real.txt')[1], 1)
        with self.assertRaises(OSError):
            P.hash_file(self.root / 'link.txt')

    # --- a hard crash leaves a record of what was meant to happen
    def test_a_hard_crash_half_way_leaves_an_intent_record_next_to_the_saved_originals(self):
        Failure.seed(self)
        script = (f'import os, sys\nsys.path.insert(0, {str(HERE)!r})\nimport publish as P\nreal, n = P.copy_atomic, [0]\n'
                  'def dying(*a, **k):\n    real(*a, **k)\n    n[0] += 1\n    if n[0] == 2:\n        os._exit(9)\n'
                  'P.copy_atomic = dying\n'
                  f'sys.exit(P.main(["apply", {str(self.dist)!r}, {str(self.target)!r}, "--backup", {str(self.backup)!r}, "--time", {self.LATER!r}]))\n')
        crashed = subprocess.run([sys.executable, '-I', '-c', script], capture_output=True, text=True)
        self.assertEqual(crashed.returncode, 9, crashed.stderr)
        self.assertEqual(len(self.ledger()['entries']), 1)             # the ledger never heard of it
        crashed_dirs = [p for p in self.backup.iterdir() if p.name != self.ledger()['entries'][-1]['id']]
        self.assertEqual(len(crashed_dirs), 1)
        intent = json.loads((crashed_dirs[0] / 'intent.json').read_text())
        self.assertEqual(intent['release'], crashed_dirs[0].name)
        self.assertEqual(set(intent['written']), {'new/dir/added.png', 'scripts/office.js', 'tilesets/Floor.png'})
        self.assertIsNone(intent['written']['new/dir/added.png']['previous'])
        self.assertEqual(intent['written']['scripts/office.js']['previous'], hashlib.sha256(BUILD['scripts/office.js']).hexdigest())
        for rel in ('scripts/office.js', 'tilesets/Floor.png'):      # every original is saved before the first write
            self.assertEqual((crashed_dirs[0] / 'files' / rel).read_bytes(), BUILD[rel])
        self.assertEqual((self.target / 'scripts/office.js').read_bytes(), b'js v2')          # half published, as the crash left it
        self.assertEqual((self.target / 'tilesets/Floor.png').read_bytes(), BUILD['tilesets/Floor.png'])
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T12:00:00Z')
        self.assertEqual(code, 0, err)                                  # running the same apply again finishes the release
        self.assertEqual((self.target / 'tilesets/Floor.png').read_bytes(), b'floor v2')
        self.assertEqual(run('verify', self.target)[0], 0)

    def test_a_finished_apply_leaves_no_intent_record(self):
        _, result, _ = self.apply()
        self.assertEqual(sorted(p.name for p in (self.backup / result['release']).iterdir()), ['ledger-entry.json'])


BASE = 'http://example.test/maps/office/'
OTHER_BASE = 'https://maps.example.test/office/'
ELSEWHERE = 'https://cdn.example.test/collections/FurnitureCollection.json'
RELATIVE = ['entities/mobilia/collection.json', 'entities/konclui/collection.json']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def wam(urls, **changes):
    """A WAM shaped like the build's (indent 1, no ASCII escaping), with decoys a naive search would trip on: a "url" inside
    an entity and an "entityCollections" key inside settings."""
    document = {'version': '2.1.0', 'mapUrl': 'office.tmj',
                'entities': {'e1': {'x': 32, 'y': 64, 'url': 'not/a/collection.json',
                                    'prefabRef': {'collectionName': 'mobilia', 'id': 'chair'}}},
                'areas': [], 'entityCollections': [{'url': u, 'type': 'file'} for u in urls],
                'settings': {'entityCollections': 'entities/decoy/collection.json', 'megaphone': {'enabled': True}}}
    document.update(changes)
    return json.dumps(document, ensure_ascii=False, indent=1).encode()


class EntityCollections(Case):
    """The client fetches a WAM's entityCollections urls as they are written and fails on a relative one (see the module
    docstring), so a published .wam must hold absolute urls, built from a base the operator names."""

    def put_wam(self, urls, **changes):
        write_tree(self.dist, {'office.wam': wam(urls, **changes)})

    def served_urls(self, target=None, rel='office.wam'):
        return [c['url'] for c in json.loads((Path(target or self.target) / rel).read_text())['entityCollections']]

    def cli(self, *argv):
        return subprocess.run([sys.executable, '-I', str(HERE / 'publish.py'), *map(str, argv)], capture_output=True, text=True)

    def test_plan_shows_the_old_and_new_value_of_every_entry_and_writes_nothing(self):
        self.put_wam(RELATIVE + [ELSEWHERE])
        dist_before, target_before = snapshot(self.dist), snapshot(self.target)
        code, plan, _ = run_json('plan', self.dist, self.target, '--public-base-url', BASE)
        self.assertEqual(code, 0)
        item = next(f for f in plan['files'] if f['path'] == 'office.wam')
        self.assertEqual(item['entity_collections'], [
            dict(index=0, old=RELATIVE[0], new=BASE + RELATIVE[0], action='rewrite'),
            dict(index=1, old=RELATIVE[1], new=BASE + RELATIVE[1], action='rewrite'),
            dict(index=2, old=ELSEWHERE, new=ELSEWHERE, action='keep')])
        self.assertTrue(item['rewritten'])
        self.assertEqual(plan['public_base_url'], BASE)
        source = (self.dist / 'office.wam').read_bytes()
        self.assertEqual((item['source_sha256'], item['source_size']), (sha(source), len(source)))
        self.assertNotEqual(item['sha256'], item['source_sha256'])
        self.assertEqual(snapshot(self.dist), dist_before)
        self.assertEqual(snapshot(self.target), target_before)
        self.assertFalse(self.backup.exists())
        text = run('plan', self.dist, self.target, '--public-base-url', BASE)[1]
        self.assertIn(f'entityCollections[0]  {RELATIVE[0]}  ->  {BASE}{RELATIVE[0]}', text)
        self.assertIn(f'entityCollections[2]  {ELSEWHERE}  absolute, left alone', text)
        self.assertIn(f'public base url {BASE}', text)

    def test_apply_writes_absolute_urls_into_the_target_and_never_touches_the_dist(self):
        self.put_wam(RELATIVE + [ELSEWHERE])
        dist_before = snapshot(self.dist)
        code, result, _ = self.apply('--public-base-url', BASE)
        self.assertEqual((code, result['rewritten'], result['public_base_url']), (0, ['office.wam'], BASE))
        self.assertEqual(snapshot(self.dist), dist_before)                       # not a byte, not an mtime
        self.assertEqual(self.served_urls(), [BASE + RELATIVE[0], BASE + RELATIVE[1], ELSEWHERE])
        # Only the url strings differ: put the old ones back and the file is the build's again, byte for byte.
        served = (self.target / 'office.wam').read_text()
        for url in RELATIVE:
            served = served.replace(json.dumps(BASE + url), json.dumps(url))
        self.assertEqual(served, (self.dist / 'office.wam').read_text())
        code, report, _ = run_json('verify', self.target)
        self.assertEqual((code, report['ok']), (0, True))
        (self.target / 'office.wam').write_bytes((self.target / 'office.wam').read_bytes() + b' ')
        code, report, _ = run_json('verify', self.target)
        self.assertEqual((code, [d['path'] for d in report['drift']]), (1, ['office.wam']))

    def test_the_ledger_records_the_base_the_rewrite_and_the_hash_of_what_was_written(self):
        self.put_wam(RELATIVE)
        source = (self.dist / 'office.wam').read_bytes()
        _, result, _ = self.apply('--public-base-url', BASE)
        served = (self.target / 'office.wam').read_bytes()
        entry = self.ledger()['entries'][-1]
        self.assertEqual(entry['public_base_url'], BASE)
        self.assertEqual(entry['rewrites'], {'office.wam': dict(
            source_sha256=sha(source), source_size=len(source),
            entity_collections=[dict(index=i, old=u, new=BASE + u) for i, u in enumerate(RELATIVE)])})
        self.assertEqual(entry['files']['office.wam'], dict(sha256=sha(served), size=len(served)))
        self.assertEqual(entry['written']['office.wam']['sha256'], sha(served))
        saved = self.backup / result['release']
        self.assertEqual(json.loads((saved / 'ledger-entry.json').read_text()), entry)
        self.assertEqual((saved / 'staged/office.wam').read_bytes(), served)     # the record of what was published
        self.assertFalse((saved / P.INTENT_NAME).exists())
        self.assertFalse([rel for rel in snapshot(self.target) if rel.startswith('staged')])
        self.no_temporary_files()

    def test_the_release_id_follows_the_base_and_is_the_same_for_the_same_inputs(self):
        self.put_wam(RELATIVE)
        ids = []
        for n, base in enumerate((BASE, BASE, OTHER_BASE)):
            target = self.root / f'served-{n}'
            target.mkdir()
            code, result, _ = run_json('apply', self.dist, target, '--backup', self.root / f'backup-{n}', '--time', TIME,
                                       '--public-base-url', base)
            self.assertEqual(code, 0)
            ids.append(result['release'])
        self.assertEqual(ids[0], ids[1])
        self.assertNotEqual(ids[0], ids[2])
        self.assertEqual(self.served_urls(self.root / 'served-2'), [OTHER_BASE + u for u in RELATIVE])

    def test_a_relative_url_without_a_base_is_refused_by_plan_and_apply_and_nothing_is_written(self):
        self.put_wam(RELATIVE + [ELSEWHERE])
        for argv in (('plan', self.dist, self.target), ('apply', self.dist, self.target, '--backup', self.backup)):
            code, out, err = run(*argv)
            self.assertEqual((code, out), (2, ''), argv[0])
            self.assertIn('--public-base-url', err)
            self.assertIn(RELATIVE[0], err)
            self.assertNotIn(ELSEWHERE, err)                                       # only the relative ones are named
        self.assertEqual(os.listdir(self.target), [])
        self.assertFalse(self.backup.exists())
        self.assertEqual(self.apply('--only', 'office.wam')[0], 2)
        self.assertEqual(self.apply('--only', 'tilesets/**')[0], 0)                # the wam is not selected: nothing to refuse
        self.assertEqual(self.apply('--exclude', '*.wam', time='2026-11-22T11:00:00Z')[0], 0)
        self.assertFalse((self.target / 'office.wam').exists())

    def test_a_refusal_comes_before_the_protection_check(self):
        self.put_wam(RELATIVE)
        self.assertEqual(self.apply('--public-base-url', BASE)[0], 0)
        self.put_wam(RELATIVE + ['entities/extra/collection.json'])
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T11:00:00Z')
        self.assertEqual(code, 2)                                                  # not 3: the missing base is named first
        self.assertIn('--public-base-url', err)

    def test_absolute_urls_are_left_alone_and_a_wam_with_only_those_needs_no_base(self):
        absolute = ['http://localhost:9090/maps/office/entities/a/collection.json', ELSEWHERE]
        self.put_wam(absolute)
        source = (self.dist / 'office.wam').read_bytes()
        code, plan, _ = run_json('plan', self.dist, self.target)                   # no base, nothing relative: no refusal
        item = next(f for f in plan['files'] if f['path'] == 'office.wam')
        self.assertEqual((code, item['rewritten'], item['source_sha256'], {e['action'] for e in item['entity_collections']}),
                         (0, False, None, {'keep'}))
        self.assertEqual(self.apply()[0], 0)
        self.assertEqual((self.target / 'office.wam').read_bytes(), source)
        entry = self.ledger()['entries'][-1]
        self.assertEqual((entry['public_base_url'], entry['rewrites']), (None, {}))
        code, plan, _ = run_json('plan', self.dist, self.target, '--public-base-url', BASE)   # a base changes nothing here
        self.assertEqual((code, next(f for f in plan['files'] if f['path'] == 'office.wam')['status']), (0, 'identical'))

    def test_the_same_publish_twice_is_a_no_op_and_the_rewrite_alone_is_not_an_edit(self):
        self.put_wam(RELATIVE)
        _, first, _ = self.apply('--public-base-url', BASE)
        code, again, _ = self.apply('--public-base-url', BASE, time='2026-11-22T11:00:00Z')
        self.assertEqual((code, again['noop'], again['release']), (0, True, first['release']))
        _, plan, _ = run_json('plan', self.dist, self.target, '--public-base-url', BASE)
        item = next(f for f in plan['files'] if f['path'] == 'office.wam')
        self.assertEqual((item['status'], item['edit_state'], item['protected_by']), ('identical', None, []))
        self.assertEqual(plan['counts']['protected'], 0)
        # Another base is a real change of the file, and the file is still what the last publish wrote: as-published.
        _, plan, _ = run_json('plan', self.dist, self.target, '--public-base-url', OTHER_BASE)
        item = next(f for f in plan['files'] if f['path'] == 'office.wam')
        self.assertEqual((item['status'], item['edit_state'], item['protected_by']), ('changed', 'as-published', ['editor-owned']))

    def test_a_rebuilt_wam_is_protected_as_editor_owned_and_a_real_edit_is_still_caught(self):
        self.put_wam(RELATIVE)
        self.apply('--public-base-url', BASE)
        self.put_wam(RELATIVE + ['entities/extra/collection.json'])
        later = '2026-11-22T11:00:00Z'
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', later, '--public-base-url', BASE)
        self.assertEqual(code, 3)
        self.assertIn('editor-owned', err)
        self.assertNotIn('edited-in-place', err)
        self.assertEqual(self.apply('--public-base-url', BASE, '--include-edited', '*.wam', time=later)[0], 0)
        self.assertEqual(self.served_urls(), [BASE + u for u in RELATIVE + ['entities/extra/collection.json']])
        served = json.loads((self.target / 'office.wam').read_text())                # the editor adds an area and rewrites it
        served['areas'].append({'id': 'a1'})
        (self.target / 'office.wam').write_text(json.dumps(served))
        _, plan, _ = run_json('plan', self.dist, self.target, '--public-base-url', BASE)
        item = next(f for f in plan['files'] if f['path'] == 'office.wam')
        self.assertEqual((item['edit_state'], item['protected_by']), ('edited', ['editor-owned', 'edited-in-place']))
        code, _, err = run('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T12:00:00Z',
                           '--public-base-url', BASE)
        self.assertEqual(code, 3)
        self.assertIn('edited-in-place', err)

    def test_a_wam_published_before_the_rewrite_existed_is_changed_not_edited_and_rolls_back(self):
        self.put_wam(RELATIVE)
        with mock.patch.object(P, 'resolve_collections', lambda rel, data, base: (None, None)):    # the tool as it was
            self.assertEqual(self.apply()[0], 0)
        relative_bytes = (self.target / 'office.wam').read_bytes()
        self.assertEqual(relative_bytes, (self.dist / 'office.wam').read_bytes())
        later = '2026-11-22T11:00:00Z'
        _, plan, _ = run_json('plan', self.dist, self.target, '--public-base-url', BASE)
        item = next(f for f in plan['files'] if f['path'] == 'office.wam')
        self.assertEqual((item['status'], item['edit_state'], item['protected_by'], item['rewritten']),
                         ('changed', 'as-published', ['editor-owned'], True))
        self.assertEqual(self.apply('--public-base-url', BASE, '--include-edited', '*.wam', time=later)[0], 0)
        self.assertEqual(self.served_urls(), [BASE + u for u in RELATIVE])
        code, result, _ = run_json('rollback', self.target, '--backup', self.backup, '--time', '2026-11-22T12:00:00Z')
        self.assertEqual((code, result['restored']), (0, ['office.wam']))
        self.assertEqual((self.target / 'office.wam').read_bytes(), relative_bytes)       # the previous bytes, exactly
        self.assertEqual(run_json('verify', self.target)[1]['ok'], True)
        _, plan, _ = run_json('plan', self.dist, self.target, '--public-base-url', BASE)  # still as-published after the rollback
        self.assertEqual(next(f for f in plan['files'] if f['path'] == 'office.wam')['edit_state'], 'as-published')

    def test_rollback_of_a_new_rewritten_wam_removes_it(self):
        self.put_wam(RELATIVE)
        before = snapshot(self.target)
        self.assertEqual(self.apply('--public-base-url', BASE)[0], 0)
        self.assertTrue((self.target / 'office.wam').exists())
        self.assertEqual(run_json('rollback', self.target, '--backup', self.backup, '--time', '2026-11-22T12:00:00Z')[0], 0)
        self.assertFalse((self.target / 'office.wam').exists())
        after = snapshot(self.target)
        after.pop(P.LEDGER_NAME)
        self.assertEqual(after, before)

    def test_a_wam_in_a_subdirectory_is_resolved_against_its_own_public_url(self):
        write_tree(self.dist, {'maps/office/office.wam': wam(['entities/x/collection.json', '../shared/y.json', '/root/z.json',
                                                              '//cdn.example.test/w.json']),
                               'maps/my office/room.wam': wam(['entities/a.json'])})
        self.assertEqual(self.apply('--public-base-url', BASE)[0], 0)
        self.assertEqual(self.served_urls(rel='maps/office/office.wam'),
                         [BASE + 'maps/office/entities/x/collection.json', BASE + 'maps/shared/y.json',
                          'http://example.test/root/z.json', 'http://cdn.example.test/w.json'])
        self.assertEqual(self.served_urls(rel='maps/my office/room.wam'), [BASE + 'maps/my%20office/entities/a.json'])

    def test_a_bad_base_is_refused_and_nothing_is_written(self):
        self.put_wam(RELATIVE)
        bad = ['', 'example.test/maps/', '/maps/office/', 'ftp://example.test/maps/', 'file:///tmp/maps/',
               'http://example.test/maps', 'http://example.test', 'http://user:pw@example.test/maps/',
               'http://example.test/maps/?x=1', 'http://example.test/maps/#f', 'http://example.test/ maps/', 'http://:80/maps/',
               'http://example.test:99999/maps/', 'http://example.test/maps/\n']
        for base in bad:
            for argv in (('plan', self.dist, self.target), ('apply', self.dist, self.target, '--backup', self.backup)):
                with self.subTest(base=base, command=argv[0]):
                    code, _, err = run(*argv, '--public-base-url', base)
                    self.assertEqual(code, 2)
                    self.assertIn('--public-base-url', err)
        self.assertEqual(os.listdir(self.target), [])
        self.assertFalse(self.backup.exists())
        for base in ('https://maps.example.test/', 'http://localhost:9090/maps/office/', 'http://[::1]:9090/office/'):
            with self.subTest(base=base):
                self.assertEqual(P.check_public_base_url(base), base)                # kept exactly as given
                self.assertEqual(run('plan', self.dist, self.target, '--public-base-url', base)[0], 0)

    def test_only_the_urls_change_whatever_the_formatting_and_escapes(self):
        text = ('{"version":"2.1.0",\r\n "entityCollections" : [ {"type":"file","url":"entities\\/mobilia\\/collection.json"} ,'
                ' {"url" :"entities/caf\\u00e9/c.json","type":"file"} ],\r\n"areas":[],"entities":{},"mapUrl":"office.tmj"}')
        write_tree(self.dist, {'office.wam': text.encode()})
        self.assertEqual(self.apply('--public-base-url', BASE)[0], 0)
        served = (self.target / 'office.wam').read_bytes().decode()               # read_text() would turn CRLF into LF
        expected = (text.replace('"entities\\/mobilia\\/collection.json"', json.dumps(BASE + 'entities/mobilia/collection.json'))
                    .replace('"entities/caf\\u00e9/c.json"', json.dumps(BASE + 'entities/café/c.json', ensure_ascii=False)))
        self.assertEqual(served, expected)                                         # CRLF, spaces and key order are the build's
        self.assertEqual(self.served_urls(), [BASE + 'entities/mobilia/collection.json', BASE + 'entities/café/c.json'])

    def test_the_last_of_two_duplicate_keys_is_the_one_that_counts(self):
        text = '{"entityCollections":[{"url":"first/a.json"}],"entityCollections":[{"url":"last/b.json"}]}'
        entries, staged = P.resolve_collections('office.wam', text.encode(), BASE)
        self.assertEqual([(e['old'], e['new']) for e in entries], [('last/b.json', BASE + 'last/b.json')])
        self.assertEqual(staged.decode(), text.replace('"last/b.json"', json.dumps(BASE + 'last/b.json')))

    def test_a_wam_that_is_not_a_collection_list_is_published_as_it_is_and_said_so(self):
        for n, data in enumerate((b'wam v2 from the build', b'\xff\xfe not utf-8', b'[1, 2]', b'{"version": "2.1.0"}',
                                  b'{"entityCollections": "x"}', b'{"entityCollections": [', b'')):
            with self.subTest(data=data):
                dist, target = self.root / f'dist-{n}', self.root / f'served-{n}'
                target.mkdir()
                write_tree(dist, {'office.wam': data, 'office.tmj': b'{}'})
                code, plan, _ = run_json('plan', dist, target)
                item = next(f for f in plan['files'] if f['path'] == 'office.wam')
                self.assertEqual((code, item['entity_collections'], item['rewritten']), (0, None, False))
                self.assertIn('not inspected', run('plan', dist, target)[1])
                code, _, _ = run_json('apply', dist, target, '--backup', self.root / f'backup-{n}', '--time', TIME)
                self.assertEqual((code, (target / 'office.wam').read_bytes()), (0, data))

    def test_entries_without_a_usable_url_are_listed_and_left_alone(self):
        document = json.loads(wam(['entities/a.json']))
        document['entityCollections'] = [{'type': 'file'}, {'url': 5, 'type': 'file'}, 'x', {'url': '  ', 'type': 'file'},
                                         {'url': 'entities/a.json', 'type': 'file'}]
        write_tree(self.dist, {'office.wam': json.dumps(document, indent=1).encode()})
        code, plan, _ = run_json('plan', self.dist, self.target, '--public-base-url', BASE)
        item = next(f for f in plan['files'] if f['path'] == 'office.wam')
        self.assertEqual((code, [e['action'] for e in item['entity_collections']]), (0, ['invalid'] * 4 + ['rewrite']))
        self.assertEqual(self.apply('--public-base-url', BASE)[0], 0)
        served = json.loads((self.target / 'office.wam').read_text())['entityCollections']
        self.assertEqual(served, document['entityCollections'][:4] + [{'url': BASE + 'entities/a.json', 'type': 'file'}])
        self.assertEqual(run('plan', self.dist, self.target)[0], 2)               # without a base the one relative entry is refused

    def test_the_rewrite_cannot_change_more_than_the_urls(self):
        text = wam(RELATIVE).decode()
        start = text.index('"2.1.0"')
        wrong = [dict(index=0, url='entities/a.json', span=(start, start + len('"2.1.0"')))]     # a span on the wrong value
        with mock.patch.object(P, 'collection_entries', return_value=wrong):
            with self.assertRaises(P.PublishError) as caught:
                P.resolve_collections('office.wam', text.encode(), BASE)
        self.assertIn('more than the urls', str(caught.exception))

    def test_a_failed_write_of_a_rewritten_wam_leaves_neither_target_nor_backup_behind(self):
        self.put_wam(RELATIVE)
        real = os.replace

        def flaky(src, dst):
            if dst.startswith(str(self.target)) and dst.endswith('office.wam'):      # the write into the target, not the staging
                raise OSError(5, 'injected')
            return real(src, dst)
        with mock.patch.object(P.os, 'replace', flaky):
            code, _, _ = self.apply('--public-base-url', BASE)
        self.assertEqual(code, 4)
        self.assertEqual(os.listdir(self.target), [])
        self.assertEqual(os.listdir(self.backup), [])                                # the staged copy went with the release

    def test_a_failure_while_staging_is_refused_before_any_write_and_leaves_no_backup_behind(self):
        self.put_wam(RELATIVE)
        real = os.replace

        def flaky(src, dst):
            if '/staged/' in dst:
                raise OSError(28, 'injected: no space left')
            return real(src, dst)
        with mock.patch.object(P.os, 'replace', flaky):
            code, _, err = self.apply('--public-base-url', BASE)
        self.assertEqual(code, 2)
        self.assertIn('nothing was written to the target', err)
        self.assertEqual(os.listdir(self.target), [])
        self.assertEqual(os.listdir(self.backup), [])

    def test_the_flag_works_as_a_program(self):
        self.put_wam(RELATIVE)
        refused = self.cli('plan', self.dist, self.target)
        self.assertEqual((refused.returncode, refused.stdout), (2, ''))
        self.assertIn('--public-base-url', refused.stderr)
        planned = self.cli('plan', self.dist, self.target, '--public-base-url', BASE)
        self.assertEqual(planned.returncode, 0, planned.stderr)
        self.assertIn(f'{RELATIVE[0]}  ->  {BASE}{RELATIVE[0]}', planned.stdout)
        applied = self.cli('apply', self.dist, self.target, '--backup', self.backup, '--time', TIME, '--public-base-url', BASE)
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertIn(f'entityCollections rewritten against {BASE} in: office.wam', applied.stdout)
        self.assertEqual(self.cli('verify', self.target).returncode, 0)
        self.assertEqual(self.cli('rollback', self.target, '--backup', self.backup).returncode, 0)
        self.assertEqual(self.cli('rollback', self.target, '--help').returncode, 0)
        self.assertNotIn('--public-base-url', self.cli('rollback', self.target, '--help').stdout)   # only plan and apply take it


class CommandLine(Case):
    def cli(self, *argv):
        return subprocess.run([sys.executable, '-I', str(HERE / 'publish.py'), *map(str, argv)], capture_output=True, text=True)

    def test_the_four_commands_run_as_a_program_with_their_exit_codes(self):
        plan = self.cli('plan', self.dist, self.target, '--json')
        self.assertEqual(plan.returncode, 0, plan.stderr)
        self.assertEqual(json.loads(plan.stdout)['counts']['new'], len(self.published()))
        applied = self.cli('apply', self.dist, self.target, '--backup', self.backup, '--time', TIME)
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertIn('published 7 files as release', applied.stdout)
        self.assertEqual(self.cli('verify', self.target).returncode, 0)
        (self.target / 'office.tmj').write_bytes(b'drift')
        self.assertEqual(self.cli('verify', self.target).returncode, 1)
        write_tree(self.dist, {'office.wam': b'v3'})
        self.assertEqual(self.cli('apply', self.dist, self.target, '--backup', self.backup, '--time', '2026-11-22T11:00:00Z').returncode, 3)
        (self.target / 'office.tmj').write_bytes(BUILD['office.tmj'])
        self.assertEqual(self.cli('rollback', self.target, '--backup', self.backup).returncode, 0)
        self.assertEqual(self.cli('rollback', self.target, '--backup', self.backup).returncode, 2)

    def test_the_tool_is_standard_library_only(self):
        source = (HERE / 'publish.py').read_text()
        imports = {line.split()[1].split('.')[0] for line in source.splitlines() if line.startswith(('import ', 'from '))}
        self.assertTrue(imports <= set(sys.stdlib_module_names), imports - set(sys.stdlib_module_names))


if __name__ == '__main__':
    unittest.main()
