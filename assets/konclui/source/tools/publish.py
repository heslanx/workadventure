#!/usr/bin/env python3
"""The only door from a build to a served map directory, with a way back. Standard library only.

A built map (for the office: the build's `dist` directory itself, as hq-office/build.py writes it: office.tmj, office.wam,
tilesets/, entities/, fx/, scripts/ ...) is served by map-storage from a directory that people also EDIT in place through
the map editor. A plain copy would destroy those edits, so nothing reaches that directory except through here.

    publish.py plan     DIST TARGET [--public-base-url URL] [--only GLOB ...] [--exclude GLOB ...] [--json] [--all]
    publish.py apply    DIST TARGET --backup DIR [--public-base-url URL] [--only ...] [--exclude ...]
                        [--include-edited GLOB ...] [--time ISO8601] [--json]
    publish.py rollback TARGET --backup DIR [--release ID] [--include-edited GLOB ...] [--time ISO8601] [--json]
    publish.py verify   TARGET [--json]

(Put the positional paths before the glob lists: `--only` takes every argument that follows it.)

plan      No writes. Every build file as new, changed or identical (sha256 and size) in TARGET; every file of TARGET the build
          does not have (left alone, listed; `in_ledger` says whether this tool wrote it once); for every changed file whether
          the target copy still is what the LAST publish wrote (`as-published`), was edited since (`edited`), or the ledger never
          heard of it (`unrecorded`). Text output lists identical files only with --all; --json always has every file.
apply     Writes the new and changed files. Before replacing a file, the target's version is copied to
          BACKUP/<release id>/files/<path>. Each file is written under a temporary dot-name in its own directory and renamed
          into place (a reader sees the old file or the whole new one, never a part); map files go last (tilesets and assets,
          then .tmj/.tsj, then .wam). After writing, every file is read back and its hash compared. The release is recorded in
          TARGET/.konclui-release.json and a copy of its entry in BACKUP/<release id>/ledger-entry.json. A failure at any
          point restores what was replaced, removes what was added, and leaves the ledger untouched.
          PROTECTED, and never overwritten unless named by --include-edited GLOB: (a) a changed file whose target copy is
          neither the build nor what the ledger last recorded (edited in place, or never recorded by this tool); (b) the map
          editor's own files (EDITOR_OWNED below). When a protected file would change, nothing is written and the exit code is 3.
rollback  Puts back the files of one release from its backup (the latest publish by default), removes the files it added (only
          those, and directories it created if they are empty again), checks every hash, and records the rollback in the
          ledger. The rollback restores what the ledger knew before the release (`recorded`), so a file this tool never wrote
          stays protected afterwards (not-in-ledger). Refused, before writing anything, if a file of the release changed since (a later publish, an editor edit;
          --include-edited GLOB overrides), if the backup is incomplete, or if the release was already rolled back.
verify    Every file of the latest ledger entry still has the hash that entry says; lists what drifted (exit 1).

entityCollections (--public-base-url). The client does not resolve the "url" of a WAM's `entityCollections` against the map: it
calls fetch() on it, which resolves a relative URL against the page's own <base href="/"> (the play origin, never the
map-storage), and then new URL(imagePath, url), which throws on a relative url (play/src/front/Phaser/Game/GameScene.ts
loadEntityCollections, MapEditor/EntitiesCollectionsManager.ts loadCollections). A map whose WAM has relative URLs, as
hq-office/build.py writes them (the build's own tools read them relative to the dist), therefore loads with no furniture.
No relative form works, so the URL has to be absolute in the file that is served. The build is not changed: this tool writes
the absolute form into the STAGED copy of each .wam, from a base the operator names, never guessed:
  --public-base-url URL  the URL under which TARGET is served: http or https, ending in "/", no credentials, query or
                         fragment. Every relative `entityCollections` url of a selected .wam is resolved against the .wam's
                         own public URL (URL + its path in the target), exactly as the client resolves `mapUrl`. An absolute
                         url is left alone and listed. Only the url values change: the rest of the file keeps its bytes.
  Without it a selected .wam with a relative url is REFUSED (plan and apply, exit 2, nothing written): a map published like
  that has no furniture. Leave the .wam out with --exclude '*.wam' to publish the rest. A .wam that is not JSON with an
  `entityCollections` list is published as it is and said so in the plan.
The DIST is never written. The rewritten bytes are written to BACKUP/<release id>/staged/<path> (kept, as the record of what
was published) and copied from there; their hash is what the plan, the ledger and `verify` know, so a .wam whose only
difference from the last publish is the rewrite is identical, and one that differs in anything else is `as-published` or
`edited` by the same rules as any file. The ledger entry records `public_base_url` and, per rewritten file, `rewrites`
(the hash of the DIST copy and the old and new value of every url). A rollback puts back the bytes the target held.

Exit codes: 0 ok, 1 verify found drift, 2 refused or invalid input, or an OS error before the first write (an unusable
backup directory, a full disk while saving the originals, an unreadable file): nothing was written to the target; 3 apply
stopped by a protected file (nothing written), 4 a write failed and everything was restored, 5 a write or an interrupt
(Ctrl-C, SystemExit) came with an incomplete restore (the message says which files, and the backup is kept). An interrupt
whose restore was complete is re-raised as it is, and the backup of the failed release is removed.

A file that changes between the plan and its own write (the editor rewrites the .wam after every command) is never
overwritten: its backup copy is compared with the hash the plan saw, and the target is compared again just before the
rename. A difference stops the apply with "changed since the plan, run plan again" (exit 2 before any write, exit 4 with the
earlier writes undone after). Nothing can close the last few microseconds between that comparison and the rename.

Ownership: every written file is a new inode. Mode is kept from the file it replaces; the user and group are given back with
chown when the process may (root, or a member of the group), silently not otherwise. A file the tool creates belongs to
whoever runs it. If map-storage runs as another user it may be unable to edit those files in place: run the tool as that
user, or as root.

map-storage keeps loaded WAMs in memory and rewrites the whole WAM after each editor command (MapsManager, UploadController
replaceStoredMaps). A .wam renamed into place behind its back can be overwritten by that in-memory copy on the next editor
command, and this tool cannot tell. After publishing a .wam (--include-edited '*.wam'), close the editor sessions and reload
the room, or restart map-storage, before anybody edits.

After a crash (SIGKILL, power loss) in the middle of an apply: the ledger was not written, so `rollback` and `verify` do not
know the release. BACKUP/<release id>/intent.json (written before anything else, removed when the apply succeeds) lists every
file the release meant to write with the hash it was to have and the hash it replaced (null: a new file); the originals are in
BACKUP/<release id>/files/<path>, saved before the first write. `plan` lists a stale .<name>.konclui-tmp-<pid> file in the
target as "left alone": delete it by hand. To go back by hand, copy files/<path> over the target's file and delete the files
whose "previous" is null. To go forward, run the same apply again: the files already written are identical to the build and
are skipped, the rest is written, and the ledger records only that second release (a rollback of it restores the files it
replaced, not the ones the crashed run had already written; use the copies under the crashed release's files/ for those).

The release id is the first 16 hex digits of the sha256 of {the published file list with hashes, the hash written for each file
it wrote, the time (--time, or taken once at the start), the tool identities when DIST/fx/manifest.json has a "tools" entry}. The
same build with the same --time into the same state gives the same id and the same ledger bytes. A second apply of a build that
is already in place writes nothing and answers with the release id the ledger already holds.

The target may be a directory another process is serving: no partial file under a served name, nothing deleted that the
ledger does not say this tool wrote, a target that is not a directory, a destination that crosses a symlink (any component, or
the file itself), a build holding a symlink, and a backup inside the target or the build are all refused. The target
directory itself may be reached through a symlink: it is resolved once, and everything below it must be real.
Not atomic across files: while an apply runs a reader can see some files new and some old (never a torn file; the map files
go last so a map never points at an asset that is not there yet).
"""
import argparse
import contextlib
import datetime
import hashlib
import json
import os
import re
import shutil
import stat
import sys
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit

try:
    import fcntl
except ImportError:                                      # not on Windows; the lock is then skipped
    fcntl = None

LEDGER_NAME = '.konclui-release.json'
LEDGER_FORMAT = 1
TMP_INFIX = '.konclui-tmp-'
INTENT_NAME = 'intent.json'
# What the map editor (map-storage) writes by itself, found in the code (map-storage/src and libs/map-editor/src):
#   *.wam                      MapsManager writes the whole WAM after every editor command (areas, entities), and the PATCH
#                              route of UploadController rewrites it (Services/MapsManager.ts).
#   __cache.json               MapListService.CACHE_NAME, the map list the server regenerates at the root of the world.
#   assets/entities/**         CustomEntityCollectionService: entities.json (ENTITY_COLLECTION_FILE) and the uploaded images
#                              (libs/map-editor Constants/CustomEntityCollectionConstants.ts: ENTITIES_FOLDER_PATH).
#   assets/sounds/**, private/files/**   uploaded sounds and documents (Constants/FileUploadSupportedFormats.ts).
# A pattern without "/" matches the file name at any depth, as in .gitignore.
EDITOR_OWNED = ('*.wam', '__cache.json', 'assets/entities/**', 'assets/sounds/**', 'private/files/**')
EXIT_DRIFT, EXIT_REFUSED, EXIT_PROTECTED, EXIT_RESTORED, EXIT_PARTIAL = 1, 2, 3, 4, 5


class PublishError(Exception):
    """A refusal: nothing was written."""
    code = EXIT_REFUSED


class ProtectedFiles(PublishError):
    code = EXIT_PROTECTED


class WriteFailed(PublishError):
    """A write failed; `problems` is empty when everything was restored."""

    def __init__(self, message, problems=()):
        super().__init__(message)
        self.problems = list(problems)
        self.code = EXIT_PARTIAL if self.problems else EXIT_RESTORED


# ---------------------------------------------------------------------------------------------------------------- globs
def glob_regex(pattern):
    """`*` and `?` stay inside a path segment, `**` crosses segments (`**/` also matches no directory), `[...]` is a class."""
    out, i = [], 0
    while i < len(pattern):
        c = pattern[i]
        if c == '*':
            if pattern[i:i + 2] == '**':
                i += 2
                if pattern[i:i + 1] == '/':
                    i += 1
                    out.append('(?:.*/)?')
                else:
                    out.append('.*')
                continue
            out.append('[^/]*')
        elif c == '?':
            out.append('[^/]')
        elif c == '[' and pattern.find(']', i + 2) != -1:
            j = pattern.find(']', i + 2)
            body = pattern[i + 1:j].replace('\\', '\\\\')
            out.append('[' + ('^' + body[1:] if body.startswith('!') else body) + ']')
            i = j
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile(''.join(out) + r'\Z')


def matches(rel, patterns):
    """True when a pattern matches the path, one of its parent directories, or (a pattern without "/") its file name."""
    parts = rel.split('/')
    candidates = ['/'.join(parts[:n]) for n in range(1, len(parts) + 1)]
    for pattern in patterns:
        regex = glob_regex(pattern)
        if any(regex.match(c) for c in candidates) or ('/' not in pattern and regex.match(parts[-1])):
            return True
    return False


def editor_owned(rel):
    return matches(rel, EDITOR_OWNED)


# ------------------------------------------------------------------------------------------------------- files and paths
def hash_file(path):
    """(sha256 hex, size) of a regular file, never through a symlink."""
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    digest, size = hashlib.sha256(), 0
    fd = os.open(path, flags)
    with os.fdopen(fd, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def check_rel(rel):
    if (not isinstance(rel, str) or not rel or rel.startswith('/') or '\\' in rel or '\0' in rel
            or any(part in ('', '.', '..') for part in rel.split('/'))):
        raise PublishError(f'unsafe path {rel!r}: it must be relative, with no "..", empty or "." part')
    return rel


def dest_state(root, rel):
    """lstat of root/rel, or None when it does not exist. Refuses a symlink in any component, a directory or other
    non-regular entry where a file goes, and a file where a directory goes."""
    check_rel(rel)
    parts = rel.split('/')
    current = str(root)
    for i, part in enumerate(parts):
        current = os.path.join(current, part)
        shown = '/'.join(parts[:i + 1])
        try:
            st = os.lstat(current)
        except FileNotFoundError:
            return None
        except NotADirectoryError:
            raise PublishError(f'{rel}: {"/".join(parts[:i])} is a file, not a directory') from None
        if stat.S_ISLNK(st.st_mode):
            raise PublishError(f'{rel}: {shown} is a symlink; refusing to write through it')
        if i < len(parts) - 1:
            if not stat.S_ISDIR(st.st_mode):
                raise PublishError(f'{rel}: {shown} is not a directory')
        elif not stat.S_ISREG(st.st_mode):
            raise PublishError(f'{rel}: {shown} is not a regular file (a directory or special file is in the way)')
    return st


def _inside(child, parent):
    child, parent = os.path.realpath(child), os.path.realpath(parent)
    return os.path.commonpath([child, parent]) == parent


def resolve_roots(dist, target, backup=None):
    target_real = Path(target).resolve()
    if not target_real.is_dir():
        raise PublishError(f'target {target} is not a directory')
    dist_real = None
    if dist is not None:
        dist_real = Path(dist).resolve()
        if not dist_real.is_dir():
            raise PublishError(f'build {dist} is not a directory')
        if _inside(dist_real, target_real) or _inside(target_real, dist_real):
            raise PublishError(f'the build {dist_real} and the target {target_real} are the same directory or one is inside the other')
    backup_real = None
    if backup is not None:
        backup_real = Path(backup).resolve()
        if backup_real.exists() and not backup_real.is_dir():
            raise PublishError(f'backup {backup} is not a directory')
        for what, root in (('target', target_real), ('build', dist_real)):
            if root is not None and _inside(backup_real, root):
                raise PublishError(f'the backup directory {backup_real} is inside the {what} {root}: it would be published or served')
    return dist_real, target_real, backup_real


def scan_dist(dist):
    """{rel: absolute path} of the files to publish, and the skipped dot entries. A symlink or special file is refused."""
    files, skipped = {}, []
    for dirpath, dirnames, filenames in os.walk(dist, followlinks=False):
        for name in sorted(dirnames + filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, dist).replace(os.sep, '/')
            st = os.lstat(full)
            if stat.S_ISLNK(st.st_mode):
                raise PublishError(f'the build holds a symlink: {rel}')
            if name.startswith('.'):
                skipped.append(rel + ('/' if stat.S_ISDIR(st.st_mode) else ''))
            elif not (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)):
                raise PublishError(f'the build holds a file that is neither regular nor a directory: {rel}')
            elif stat.S_ISREG(st.st_mode):
                files[rel] = full
        dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
    if not files:
        raise PublishError(f'the build {dist} has no file to publish')
    return files, sorted(skipped)


def scan_target(target):
    """Every file or symlink under the target (symlinked directories are listed, not entered), as relative paths."""
    found = []
    for dirpath, dirnames, filenames in os.walk(target, followlinks=False):
        for name in dirnames:
            if os.path.islink(os.path.join(dirpath, name)):
                found.append(os.path.relpath(os.path.join(dirpath, name), target).replace(os.sep, '/'))
        dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
        for name in filenames:
            found.append(os.path.relpath(os.path.join(dirpath, name), target).replace(os.sep, '/'))
    return sorted(found)


def read_tools(dist):
    """The tool identities of the build, when its fx manifest records them under "tools"."""
    path = os.path.join(dist, 'fx', 'manifest.json')
    try:
        tools = json.loads(Path(path).read_text()).get('tools')
    except (OSError, ValueError, AttributeError):
        return None
    return tools if isinstance(tools, dict) and tools else None


def read_bytes(path):
    """The bytes of a regular file, never through a symlink."""
    with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)), 'rb') as handle:
        return handle.read()


# ---------------------------------------------------------------------------------------------------- entity collections
WAM_SUFFIX = '.wam'
_JSON = json.JSONDecoder()
_JSON_SPACE = ' \t\n\r'


def check_public_base_url(value):
    """The URL under which the target directory is served, as the operator gave it (None: not given). Refused unless it is
    an http or https URL with a host, ending in "/", with no credentials (fetch() rejects them), query or fragment: it is
    never completed, trimmed or guessed, because a wrong base is a map with no furniture again."""
    if value is None:
        return None
    problem = None
    try:
        parts = urlsplit(value)
        parts.port                                           # a bad port raises ValueError here
    except ValueError as error:
        parts, problem = None, str(error)
    if parts is not None:
        if any(ord(c) <= 32 or ord(c) == 127 for c in value):
            problem = 'it has a space or a control character'
        elif parts.scheme not in ('http', 'https'):
            problem = 'it must be an absolute http or https URL'
        elif not parts.hostname:
            problem = 'it has no host'
        elif '@' in parts.netloc:
            problem = 'it has credentials, which fetch() refuses'
        elif '?' in value or '#' in value:
            problem = 'it has a query or a fragment'
        elif not parts.path.endswith('/'):
            problem = 'it must end in "/" (it is the URL of a directory)'
    if problem:
        raise PublishError(f'--public-base-url {value!r}: {problem}; give the URL under which the target is served, '
                           'for example http://localhost:9090/maps/office/')
    return value


def _skip_space(text, i):
    while text[i] in _JSON_SPACE:
        i += 1
    return i


def _json_members(text, start):
    """(key, value start, value end) for each member of the JSON object at text[start] == "{". `text` is valid JSON (the
    caller parsed it); values are decoded only to learn where they end, so nothing is copied or re-formatted."""
    i = _skip_space(text, start + 1)
    while text[i] != '}':
        key, i = _JSON.raw_decode(text, i)
        i = _skip_space(text, _skip_space(text, i) + 1)      # past the ':'
        end = _JSON.raw_decode(text, i)[1]
        yield key, i, end
        i = _skip_space(text, end)
        if text[i] == ',':
            i = _skip_space(text, i + 1)


def _json_items(text, start):
    """(value start, value end) for each item of the JSON array at text[start] == "["."""
    i = _skip_space(text, start + 1)
    while text[i] != ']':
        end = _JSON.raw_decode(text, i)[1]
        yield i, end
        i = _skip_space(text, end)
        if text[i] == ',':
            i = _skip_space(text, i + 1)


def collection_entries(text):
    """The entries of the top-level "entityCollections" list of a WAM, as [dict(index, url, span)] where span is where the
    url's JSON string sits in `text` (url None: the entry has no string url, span None). None when `text` is not a JSON
    object with that list. The last of two duplicate keys wins, as in every JSON parser."""
    try:
        document = json.loads(text)
    except (ValueError, RecursionError):
        return None
    if not isinstance(document, dict) or not isinstance(document.get('entityCollections'), list):
        return None
    listed = [(s, e) for key, s, e in _json_members(text, _skip_space(text, 0)) if key == 'entityCollections']
    entries = []
    for index, (start, _end) in enumerate(_json_items(text, listed[-1][0])):
        url, span = None, None
        if text[start] == '{':
            urls = [(s, e) for key, s, e in _json_members(text, start) if key == 'url']
            if urls:
                value = _JSON.raw_decode(text, urls[-1][0])[0]
                url, span = (value if isinstance(value, str) else None), urls[-1]
        entries.append(dict(index=index, url=url, span=span))
    return entries


def resolve_collections(rel, data, base):
    """What to do with the entityCollections of one build .wam, `rel` its path in the build and `data` its bytes.
    Returns (entries, staged): `staged` is the rewritten bytes, or None when nothing changes; `entries` is None when the file
    is not a JSON object with an "entityCollections" list (then it is published as it is), else one dict(index, old, new,
    action) per entry, the action being
      rewrite     a relative url, resolved against the .wam's own public URL (base + rel), as the client resolves `mapUrl`
      keep        an absolute url (any scheme): left alone
      unresolved  a relative url and no base: apply refuses
      invalid     no usable string url: left alone
    Only the url values are replaced, in the text, so the rest keeps its bytes; the result is parsed again and compared with
    the original to prove it."""
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return None, None
    found = collection_entries(text)
    if found is None:
        return None, None
    wam_url = None if base is None else base + quote(rel)
    entries, edits = [], []
    for item in found:
        old = item['url']
        entry = dict(index=item['index'], old=old, new=old, action='invalid')
        try:
            if old is not None and old.strip():
                if urlsplit(old).scheme:
                    entry.update(action='keep')
                elif wam_url is None:
                    entry.update(new=None, action='unresolved')
                else:
                    entry.update(new=urljoin(wam_url, old), action='rewrite')
                    edits.append((item['span'], entry['new']))
        except ValueError:                                   # urlsplit: a malformed url is not ours to fix; it stays invalid
            pass
        entries.append(entry)
    if not edits:
        return entries, None
    staged = text
    for (start, end), new in sorted(edits, reverse=True):
        staged = staged[:start] + json.dumps(new, ensure_ascii=False) + staged[end:]
    expected = json.loads(text)
    for entry in entries:
        if entry['action'] == 'rewrite':
            expected['entityCollections'][entry['index']]['url'] = entry['new']
    if json.loads(staged) != expected:
        raise PublishError(f'{rel}: the rewrite of its entityCollections would change more than the urls (a bug of this tool); '
                           'nothing was written')
    return entries, staged.encode('utf-8')


# --------------------------------------------------------------------------------------------------------------- ledger
def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def release_id(published, written, time, tools, public_base_url=None):
    payload = dict(files=published, written=written, time=time, tools=tools)
    if public_base_url is not None:                          # absent when not given: the id of a plain publish is unchanged
        payload['public_base_url'] = public_base_url
    return hashlib.sha256(canonical(payload).encode()).hexdigest()[:16]


def load_ledger(target):
    path = os.path.join(target, LEDGER_NAME)
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return dict(format=LEDGER_FORMAT, entries=[])
    if not stat.S_ISREG(st.st_mode):
        raise PublishError(f'{LEDGER_NAME} in the target is not a regular file; refusing to use it')
    try:
        data = json.loads(Path(path).read_text())
        assert isinstance(data, dict) and data.get('format') == LEDGER_FORMAT and isinstance(data.get('entries'), list)
        for entry in data['entries']:
            assert isinstance(entry, dict) and entry.get('kind') in ('publish', 'rollback') and isinstance(entry.get('id'), str)
    except (ValueError, AssertionError):
        raise PublishError(f'{path} is not a ledger this tool understands; nothing was touched') from None
    return data


def ledger_bytes(ledger):
    return (json.dumps(ledger, sort_keys=True, indent=1, ensure_ascii=False) + '\n').encode()


def known_state(ledger):
    """{rel: sha256} this tool wrote and the target should still hold, replaying every entry in order. A rollback gives
    back what the ledger knew BEFORE the release (`recorded`: the hash, or None for a file the ledger never heard of): a
    restored file that was never recorded stays unrecorded, so a rollback never turns somebody's bytes into "ours"."""
    known = {}
    for entry in ledger['entries']:
        if entry['kind'] == 'publish':
            known.update({rel: f['sha256'] for rel, f in entry['files'].items()})
        else:
            for rel in entry['restored']:
                recorded = entry.get('recorded', {}).get(rel)
                if recorded is None:
                    known.pop(rel, None)
                else:
                    known[rel] = recorded
            for rel in entry['removed']:
                known.pop(rel, None)
    return known


def rolled_back(ledger):
    return {e['rolls_back'] for e in ledger['entries'] if e['kind'] == 'rollback'}


def latest_publish(ledger):
    return next((e for e in reversed(ledger['entries']) if e['kind'] == 'publish'), None)


# ----------------------------------------------------------------------------------------------------------------- plan
def _unresolved_message(unresolved):
    lines = []
    for rel, entries in sorted(unresolved.items()):
        shown = ', '.join(e['old'] for e in entries[:3]) + (f' and {len(entries) - 3} more' if len(entries) > 3 else '')
        lines.append(f'  {rel}: {len(entries)} relative entityCollections url(s): {shown}')
    return ('a .wam would be published with relative entityCollections urls and no --public-base-url. The client resolves them '
            'against the play page, not against the map, so the map would load with no furniture. Nothing was written.\n'
            + '\n'.join(lines) + '\ngive --public-base-url URL (the URL under which the target is served, ending in "/"), '
            "or leave the .wam out with --exclude '*.wam'")


def _make_plan(dist, target, only=(), exclude=(), include_edited=(), public_base_url=None):
    """(plan dict, ledger, staged) where staged is {rel: rewritten bytes} for the .wam files whose entityCollections get the
    absolute form. No writes: the dist is only read, and the rewrite exists only in memory."""
    base = check_public_base_url(public_base_url)
    ledger = load_ledger(target)
    known = known_state(ledger)
    build, skipped = scan_dist(dist)
    files, staged, unresolved = [], {}, {}
    for rel in sorted(build):
        st = dest_state(target, rel)
        collections, rewritten, source_sha, source_size = None, False, None, None
        if rel.endswith(WAM_SUFFIX):
            data = read_bytes(build[rel])
            sha, size = hashlib.sha256(data).hexdigest(), len(data)
            collections, rewrite = resolve_collections(rel, data, base)
            if rewrite is not None:
                source_sha, source_size, rewritten = sha, size, True
                sha, size = hashlib.sha256(rewrite).hexdigest(), len(rewrite)
                staged[rel] = rewrite
        else:
            sha, size = hash_file(build[rel])
        item = dict(path=rel, size=size, sha256=sha, status='new', editor_owned=editor_owned(rel),
                    selected=(not only or matches(rel, only)) and not matches(rel, exclude),
                    edit_state=None, target_size=None, target_sha256=None, protected_by=[], protection_overridden=False,
                    entity_collections=collections, rewritten=rewritten, source_sha256=source_sha, source_size=source_size)
        if item['selected'] and collections and any(e['action'] == 'unresolved' for e in collections):
            unresolved[rel] = [e for e in collections if e['action'] == 'unresolved']
        if st is not None:
            item['target_sha256'], item['target_size'] = hash_file(os.path.join(target, rel))
            item['status'] = 'identical' if item['target_sha256'] == sha else 'changed'
        if item['status'] == 'changed':
            recorded = known.get(rel)
            item['edit_state'] = ('unrecorded' if recorded is None
                                  else 'as-published' if recorded == item['target_sha256'] else 'edited')
            if item['editor_owned']:
                item['protected_by'].append('editor-owned')
            if item['edit_state'] == 'edited':
                item['protected_by'].append('edited-in-place')
            elif item['edit_state'] == 'unrecorded':
                item['protected_by'].append('not-in-ledger')
            item['protection_overridden'] = bool(item['protected_by']) and matches(rel, include_edited)
        files.append(item)
    if unresolved:                                           # before any protection or write: a map without furniture
        raise PublishError(_unresolved_message(unresolved))
    left_alone = [dict(path=rel, in_ledger=rel in known) for rel in scan_target(target)
                  if rel not in build and rel != LEDGER_NAME]
    chosen = [f for f in files if f['selected']]
    counts = {s: sum(f['status'] == s for f in chosen) for s in ('new', 'changed', 'identical')}
    counts.update(left_alone=len(left_alone), excluded=len(files) - len(chosen), skipped=len(skipped),
                  protected=sum(bool(f['protected_by']) and not f['protection_overridden']
                                for f in chosen if f['status'] == 'changed'))
    latest = latest_publish(ledger)
    plan = dict(dist=str(dist), target=str(target), public_base_url=base, counts=counts, files=files, left_alone=left_alone,
                skipped_in_build=skipped, ledger=dict(entries=len(ledger['entries']), latest_publish=latest and latest['id']))
    return plan, ledger, staged


def make_plan(dist, target, only=(), exclude=(), include_edited=(), public_base_url=None):
    """(plan dict, ledger). No writes."""
    plan, ledger, _staged = _make_plan(dist, target, only, exclude, include_edited, public_base_url)
    return plan, ledger


def format_collections(f):
    """The lines that say what happens to the entityCollections of a planned .wam: old and new value of every entry."""
    if f['entity_collections'] is None:
        return ['    entityCollections: not inspected (not a JSON object with an entityCollections list), published as it is']
    lines = []
    for e in f['entity_collections']:
        where = f"    entityCollections[{e['index']}]  "
        if e['action'] == 'rewrite':
            lines.append(f"{where}{e['old']}  ->  {e['new']}")
        elif e['action'] == 'keep':
            lines.append(f"{where}{e['old']}  absolute, left alone")
        elif e['action'] == 'unresolved':
            lines.append(f"{where}{e['old']}  RELATIVE: apply refuses without --public-base-url")
        else:
            lines.append(f"{where}{e['old']!r}  no usable url, left alone")
    return lines


def format_plan(plan, show_identical=False):
    c = plan['counts']
    lines = [f"plan {plan['dist']} -> {plan['target']}",
             f"new {c['new']}, changed {c['changed']}, identical {c['identical']}, left alone {c['left_alone']}, "
             f"protected {c['protected']}, excluded {c['excluded']}, skipped dot files in the build {c['skipped']}"]
    if plan.get('public_base_url'):
        lines.append(f"public base url {plan['public_base_url']}: relative entityCollections urls of a .wam are resolved against it")
    for f in plan['files']:
        if not f['selected']:
            continue
        if f['status'] == 'identical':
            if show_identical:
                lines.append(f"identical  {f['path']}")
                if f['path'].endswith(WAM_SUFFIX):
                    lines.extend(format_collections(f))
            continue
        extra = ''
        if f['status'] == 'changed':
            extra = f"  target {f['target_sha256'][:12]} -> build {f['sha256'][:12]}  {f['edit_state']}"
            if f['protected_by']:
                extra += '  PROTECTED (' + ', '.join(f['protected_by']) + ')' + (' overridden' if f['protection_overridden'] else '')
        if f['rewritten']:
            extra += f"  REWRITTEN (the build's copy is {f['source_sha256'][:12]}, {f['source_size']} B)"
        lines.append(f"{f['status']:<9}  {f['path']}  {f['size']} B{extra}")
        if f['path'].endswith(WAM_SUFFIX):
            lines.extend(format_collections(f))
    for f in plan['left_alone']:
        lines.append(f"left alone  {f['path']}" + ('  (written by this tool once)' if f['in_ledger'] else ''))
    if plan['counts']['excluded']:
        lines.append(f"excluded by --only/--exclude: {plan['counts']['excluded']} files (not touched)")
    return '\n'.join(lines)


# --------------------------------------------------------------------------------------------------------- transactions
def default_mode():
    umask = os.umask(0)
    os.umask(umask)
    return 0o666 & ~umask


def copy_atomic(src, dest, mode, times_from_src=False, owner=None):
    """Write `src` to a temporary dot-name beside `dest`, then rename it over `dest`. `owner`: the stat of the file being
    replaced; its user and group are given to the new file when the process may (best effort: a new inode is otherwise owned
    by whoever runs this tool, and the map editor may not be able to edit it in place)."""
    tmp = os.path.join(os.path.dirname(dest), f'.{os.path.basename(dest)}{TMP_INFIX}{os.getpid()}')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    try:
        with os.fdopen(os.open(src, flags), 'rb') as source, os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
            for chunk in iter(lambda: source.read(1 << 20), b''):
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        if owner is not None:
            with contextlib.suppress(OSError):               # not permitted unless root or a member of the group
                os.chown(tmp, owner.st_uid, owner.st_gid)
        os.chmod(tmp, mode)                                  # after the chown, which may clear setuid bits
        if times_from_src:
            st = os.stat(src)
            os.utime(tmp, ns=(st.st_atime_ns, st.st_mtime_ns))
        os.replace(tmp, dest)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)


def write_bytes_atomic(dest, data, mode):
    tmp = os.path.join(os.path.dirname(dest), f'.{os.path.basename(dest)}{TMP_INFIX}{os.getpid()}')
    try:
        with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, dest)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)


def run_transaction(root, save_root, ops, finalize, from_source=False):
    """ops: [(rel, source path or None, sha256 to write or None, sha256 the target holds now or None when absent)]; None as
    source deletes the file. The last item is what the plan saw: a file that differs from it when its backup is made, or
    just before it is replaced, was changed by somebody else in between and stops everything (PublishError before any
    write; WriteFailed, with the earlier writes undone, after). Saves what exists to save_root/<rel> first, applies the
    ops, reads every written file back, then runs finalize(created_dirs). On any failure everything is put back (written
    files restored from save_root, added ones removed, created directories removed when empty) and WriteFailed is raised;
    `problems` lists what could not be put back (an interrupt, a BaseException, is re-raised only when the restore was
    complete). Returns the directories it created.
    from_source: the written files take the mode and times of their source (a restore from a backup copy)."""
    root = str(root)
    saved, created, done = set(), [], []
    owners = {}
    for rel, _src, _sha, expected in ops:                     # 1. originals first, so a half-way failure can come back
        st = dest_state(root, rel)
        if st is None:
            if expected is not None:
                raise PublishError(f'{rel}: it is gone since the plan; nothing was written, run plan again')
            continue
        if expected is None:
            raise PublishError(f'{rel}: it appeared since the plan; nothing was written, run plan again')
        keep = os.path.join(save_root, *rel.split('/'))
        os.makedirs(os.path.dirname(keep), exist_ok=True)
        shutil.copy2(os.path.join(root, rel), keep)
        if hash_file(keep)[0] != expected:
            raise PublishError(f'{rel}: it changed since the plan (the editor or somebody else wrote it); nothing was written, '
                               'run plan again')
        saved.add(rel)
        owners[rel] = st
    try:
        for rel, src, _sha, expected in ops:                  # 2. write
            dest = os.path.join(root, *rel.split('/'))
            now = hash_file(dest)[0] if dest_state(root, rel) is not None else None
            if now != expected:                               # raised before `done` knows it: this file is never "restored"
                raise OSError(f'{rel}: it changed since the plan, just before its write; left as it is')
            if src is None:
                done.append((rel, 'delete'))
                os.unlink(dest)
                continue
            parent, missing = os.path.dirname(dest), []
            while not os.path.isdir(parent):
                missing.append(parent)
                parent = os.path.dirname(parent)
            for directory in reversed(missing):
                os.mkdir(directory)
                created.append(os.path.relpath(directory, root).replace(os.sep, '/'))
            mode = (stat.S_IMODE(os.stat(src).st_mode) if from_source
                    else stat.S_IMODE(os.lstat(dest).st_mode) if rel in saved else default_mode())
            done.append((rel, 'put'))
            copy_atomic(src, dest, mode, times_from_src=from_source, owner=None if from_source else owners.get(rel))
        for rel, src, sha, _expected in ops:                  # 3. read back
            dest = os.path.join(root, *rel.split('/'))
            if src is None:
                if os.path.lexists(dest):
                    raise OSError(f'{rel} is still there after the delete')
            elif hash_file(dest)[0] != sha:
                raise OSError(f'{rel}: the hash read back differs from the one written')
        finalize(created)                                     # 4. ledger (its rename is the last step)
    except BaseException as exc:
        problems = []
        for rel, kind in reversed(done):
            dest = os.path.join(root, *rel.split('/'))
            keep = os.path.join(save_root, *rel.split('/'))
            try:
                if rel in saved:
                    if os.path.isfile(dest) and not os.path.islink(dest) and hash_file(dest) == hash_file(keep):
                        continue                                  # this one never changed (the write that failed)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    copy_atomic(keep, dest, stat.S_IMODE(os.stat(keep).st_mode), times_from_src=True)
                elif kind == 'put':
                    with contextlib.suppress(FileNotFoundError):
                        os.unlink(dest)
            except Exception as error:                        # report, keep restoring the others
                problems.append(f'{rel}: {error}')
        for directory in reversed(created):
            with contextlib.suppress(OSError):
                os.rmdir(os.path.join(root, directory))
        if not isinstance(exc, Exception) and not problems:
            raise                                             # an interrupt after a complete restore: let it go on
        reason = str(exc) or type(exc).__name__
        raise WriteFailed(f'a write failed ({reason}); ' + ('everything was restored' if not problems else f'{len(problems)} files could not be restored'), problems) from exc
    return created


@contextlib.contextmanager
def locked(target):
    """An advisory lock on the target directory itself (no lock file is left in a served directory)."""
    fd = os.open(target, os.O_RDONLY)
    try:
        if fcntl is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise PublishError('another publish or rollback is running on this target') from None
        yield
    finally:
        os.close(fd)


def resolve_time(value, now=None):
    if value is None:
        moment = (now or (lambda: datetime.datetime.now(datetime.timezone.utc)))()
        return moment.strftime('%Y-%m-%dT%H:%M:%SZ')
    try:
        datetime.datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise PublishError(f'--time {value!r} is not an ISO 8601 time (2026-11-22T10:00:00Z)') from None
    return value


def _order(rel):
    return (2 if rel.endswith('.wam') else 1 if rel.endswith(('.tmj', '.tsj')) else 0, rel)


def _entry_files(items):
    return {f['path']: dict(sha256=f['sha256'], size=f['size']) for f in items}


# ----------------------------------------------------------------------------------------------------------------- apply
def apply(dist, target, backup, only=(), exclude=(), include_edited=(), time=None, now=None, public_base_url=None):
    stamp = resolve_time(time, now)
    dist_real, target_real, backup_real = resolve_roots(dist, target, backup)
    with locked(target_real):
        plan, ledger, staged = _make_plan(dist_real, target_real, only, exclude, include_edited, public_base_url)
        chosen = [f for f in plan['files'] if f['selected']]
        blocked = [f for f in chosen if f['status'] == 'changed' and f['protected_by'] and not f['protection_overridden']]
        if blocked:
            raise ProtectedFiles('protected files would change; nothing was written:\n' + '\n'.join(
                f"  {f['path']}  ({', '.join(f['protected_by'])}; {f['edit_state']})" for f in blocked)
                + '\nname them with --include-edited GLOB once the plan has been read')
        todo = sorted((f for f in chosen if f['status'] != 'identical'), key=lambda f: _order(f['path']))
        if not todo:
            latest = latest_publish(ledger)
            held = latest if latest and latest['id'] not in rolled_back(ledger) else None
            return dict(noop=True, release=held and held['id'], written=[], plan=plan, backup=None,
                        public_base_url=public_base_url, rewritten=[])
        tools = read_tools(dist_real)
        published = {f['path']: f['sha256'] for f in chosen}
        written = {f['path']: f['sha256'] for f in todo}
        rid = release_id(published, written, stamp, tools, public_base_url)
        release_dir = backup_real / rid
        if release_dir.exists():
            raise PublishError(f'{release_dir} already exists; choose another backup directory')
        backup_real.mkdir(parents=True, exist_ok=True)
        release_dir.mkdir()
        recorded = known_state(ledger)
        rewrites = {f['path']: dict(source_sha256=f['source_sha256'], source_size=f['source_size'],
                                    entity_collections=[dict(index=e['index'], old=e['old'], new=e['new'])
                                                        for e in f['entity_collections'] if e['action'] == 'rewrite'])
                    for f in chosen if f['rewritten']}

        def finalize(created):
            entry = dict(id=rid, kind='publish', time=stamp, tools=tools, public_base_url=public_base_url, rewrites=rewrites,
                         files=_entry_files(chosen),
                         written={f['path']: dict(sha256=f['sha256'], size=f['size'],
                                                  previous=None if f['status'] == 'new'
                                                  else dict(sha256=f['target_sha256'], size=f['target_size']),
                                                  previous_recorded=recorded.get(f['path'])) for f in todo},
                         created_dirs=sorted(created),
                         overrode_protection={f['path']: f['protected_by'] for f in todo if f['protection_overridden']})
            write_bytes_atomic(str(release_dir / 'ledger-entry.json'), ledger_bytes(entry), default_mode())
            ledger['entries'].append(entry)
            ledger_path = os.path.join(target_real, LEDGER_NAME)
            write_bytes_atomic(ledger_path, ledger_bytes(ledger),
                               stat.S_IMODE(os.lstat(ledger_path).st_mode) if os.path.exists(ledger_path) else default_mode())

        try:
            sources = scan_dist(dist_real)[0]
            for f in todo:                                    # a rewritten file is copied from its staged bytes, never from the dist
                if f['path'] in staged:
                    staged_path = release_dir / 'staged' / f['path']
                    staged_path.parent.mkdir(parents=True, exist_ok=True)
                    write_bytes_atomic(str(staged_path), staged[f['path']], default_mode())
                    sources[f['path']] = str(staged_path)
            ops = [(f['path'], sources[f['path']], f['sha256'], f['target_sha256']) for f in todo]
            # What this release means to do, written before anything is saved or written and removed once the ledger has it.
            # After a hard crash (SIGKILL, power loss) it is the only record: see "After a crash" in the module docstring.
            write_bytes_atomic(str(release_dir / INTENT_NAME), ledger_bytes(dict(
                release=rid, time=stamp, target=str(target_real), tools=tools, public_base_url=public_base_url,
                written={f['path']: dict(sha256=f['sha256'], previous=None if f['status'] == 'new' else f['target_sha256'])
                         for f in todo})), default_mode())
            run_transaction(target_real, release_dir / 'files', ops, finalize)
        except WriteFailed as failure:
            if not failure.problems:
                shutil.rmtree(release_dir, ignore_errors=True)    # our own, empty of value: the target is as it was
            raise
        except BaseException:
            shutil.rmtree(release_dir, ignore_errors=True)        # nothing was written to the target yet, or it was all put back
            raise
        with contextlib.suppress(OSError):
            os.unlink(release_dir / INTENT_NAME)
        return dict(noop=False, release=rid, written=[f['path'] for f in todo], plan=plan, backup=str(release_dir),
                    public_base_url=public_base_url, rewritten=sorted(rewrites))


# --------------------------------------------------------------------------------------------------------------- rollback
def rollback(target, backup, release=None, include_edited=(), time=None, now=None):
    stamp = resolve_time(time, now)
    _dist, target_real, backup_real = resolve_roots(None, target, backup)
    with locked(target_real):
        ledger = load_ledger(target_real)
        done = rolled_back(ledger)
        publishes = {e['id']: e for e in ledger['entries'] if e['kind'] == 'publish'}
        if release is None:
            entry = latest_publish(ledger)
            if entry is None:
                raise PublishError('the ledger has no publish to roll back')
        elif release in publishes:
            entry = publishes[release]
        else:
            raise PublishError(f'release {release} is not in the ledger (known: {", ".join(publishes) or "none"})')
        rid = entry['id']
        if rid in done:
            raise PublishError(f'release {rid} was already rolled back; rolling back twice is refused'
                               + ('' if release else ' (name an earlier one with --release)'))
        release_dir = backup_real / rid
        saved_entry = release_dir / 'ledger-entry.json'
        try:
            matching = saved_entry.is_file() and json.loads(saved_entry.read_text()) == entry
        except (OSError, ValueError):
            matching = False
        if not matching:
            raise PublishError(f'{release_dir} is not the backup of release {rid} (ledger-entry.json is missing or differs)')
        drifted, ops, restored, removed, overridden, recorded = [], [], {}, [], [], {}
        for rel in sorted(entry['written'], key=_order, reverse=True):
            info = entry['written'][rel]
            check_rel(rel)
            st = dest_state(target_real, rel)
            current = hash_file(os.path.join(target_real, rel))[0] if st is not None else None
            if current is not None and current != info['sha256'] and not matches(rel, include_edited):
                drifted.append(f'{rel}  (now {current[:12]}, the release wrote {info["sha256"][:12]})')
                continue
            if current is not None and current != info['sha256']:
                overridden.append(rel)
            previous = info['previous']
            if previous is None:
                if current is not None:
                    ops.append((rel, None, None, current))
                removed.append(rel)
            else:
                keep = release_dir / 'files' / rel
                if not keep.is_file() or hash_file(keep)[0] != previous['sha256']:
                    raise PublishError(f'the backup of {rel} is missing or damaged in {release_dir}; nothing was written')
                ops.append((rel, str(keep), previous['sha256'], current))
                restored[rel] = dict(previous)
                recorded[rel] = info.get('previous_recorded')
        if drifted:
            raise PublishError('files of this release changed since it was published (a later publish, or an edit); nothing was '
                               'written:\n' + '\n'.join('  ' + d for d in drifted) + '\nname them with --include-edited GLOB to put the backup over them')
        removed_dirs = []

        def finalize(_created):
            outcome = dict(id=hashlib.sha256(canonical(dict(rolls_back=rid, restored={r: v['sha256'] for r, v in restored.items()},
                                                            removed=sorted(removed), time=stamp)).encode()).hexdigest()[:16],
                           kind='rollback', rolls_back=rid, time=stamp, restored=restored, recorded=recorded, removed=sorted(removed),
                           removed_dirs=[], overrode_protection=sorted(overridden))
            for directory in sorted(entry.get('created_dirs', []), key=lambda d: d.count('/'), reverse=True):
                check_rel(directory)
                with contextlib.suppress(OSError):             # only when empty again: never a directory with other content
                    os.rmdir(os.path.join(target_real, directory))
                    outcome['removed_dirs'].append(directory)
            outcome['removed_dirs'].sort()
            removed_dirs.extend(outcome['removed_dirs'])
            write_bytes_atomic(str(release_dir / 'rollback-entry.json'), ledger_bytes(outcome), default_mode())
            ledger['entries'].append(outcome)
            ledger_path = os.path.join(target_real, LEDGER_NAME)
            write_bytes_atomic(ledger_path, ledger_bytes(ledger), stat.S_IMODE(os.lstat(ledger_path).st_mode))

        run_transaction(target_real, release_dir / 'rollback-saved', ops, finalize, from_source=True)
        return dict(release=rid, restored=sorted(restored), removed=sorted(removed), removed_dirs=removed_dirs,
                    id=ledger['entries'][-1]['id'])


# ----------------------------------------------------------------------------------------------------------------- verify
def verify(target):
    _dist, target_real, _backup = resolve_roots(None, target)
    ledger = load_ledger(target_real)
    if not ledger['entries']:
        raise PublishError('the target has no ledger: nothing was published through this tool')
    entry = ledger['entries'][-1]
    drift, checked = [], 0
    expected = ({r: f['sha256'] for r, f in entry['files'].items()} if entry['kind'] == 'publish'
                else {r: f['sha256'] for r, f in entry['restored'].items()})
    for rel, sha in sorted(expected.items()):
        checked += 1
        st = dest_state(target_real, rel)
        actual = hash_file(os.path.join(target_real, rel))[0] if st is not None else None
        if actual != sha:
            drift.append(dict(path=rel, expected=sha, actual=actual or 'missing'))
    for rel in sorted(entry['removed'] if entry['kind'] == 'rollback' else ()):
        checked += 1
        if dest_state(target_real, rel) is not None:
            drift.append(dict(path=rel, expected='absent', actual='present'))
    return dict(release=entry['id'], kind=entry['kind'], checked=checked, drift=drift, ok=not drift)


# --------------------------------------------------------------------------------------------------------------- command line
def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    def globs(p, edited=True, selection=True):
        if selection:
            p.add_argument('--only', nargs='+', action='extend', default=[], metavar='GLOB', help='publish only these paths')
            p.add_argument('--exclude', nargs='+', action='extend', default=[], metavar='GLOB', help='leave these paths out')
        if edited:
            p.add_argument('--include-edited', nargs='+', action='extend', default=[], metavar='GLOB',
                           help='allow overwriting these protected files (edited in place, never recorded, or the editor\'s own)')
        p.add_argument('--json', action='store_true', help='machine-readable result on stdout')

    def base_url(p):
        p.add_argument('--public-base-url', metavar='URL', default=None,
                       help='the URL under which TARGET is served (http or https, ending in "/"): relative entityCollections urls of '
                            'a .wam are written absolute against it in the published copy; required when a selected .wam has any')

    p = sub.add_parser('plan', help='what apply would do; writes nothing')
    p.add_argument('dist')
    p.add_argument('target')
    p.add_argument('--all', action='store_true', help='also list identical files in the text output')
    base_url(p)
    globs(p, edited=False)
    p = sub.add_parser('apply', help='publish the build into the target, with a backup and a ledger entry')
    p.add_argument('dist')
    p.add_argument('target')
    p.add_argument('--backup', required=True, help='directory for the copies of what is replaced (outside the target and the build)')
    base_url(p)
    p.add_argument('--time', help='ISO 8601 time recorded in the release (default: now, taken once)')
    globs(p)
    p = sub.add_parser('rollback', help='undo one release from its backup')
    p.add_argument('target')
    p.add_argument('--backup', required=True)
    p.add_argument('--release', help='release id (default: the latest publish)')
    p.add_argument('--time', help='ISO 8601 time recorded in the rollback (default: now)')
    globs(p, selection=False)
    p = sub.add_parser('verify', help='does the target still hold what the latest ledger entry says')
    p.add_argument('target')
    p.add_argument('--json', action='store_true')
    return parser


def main(argv=None, out=None, now=None):
    out = out or sys.stdout
    args = build_parser().parse_args(argv)
    emit = (lambda data, text: print(json.dumps(data, indent=1, sort_keys=True), file=out)) if args.json else (lambda data, text: print(text, file=out))
    try:
        if args.command == 'plan':
            dist, target, _ = resolve_roots(args.dist, args.target)
            plan, _ledger = make_plan(dist, target, args.only, args.exclude, public_base_url=args.public_base_url)
            emit(plan, format_plan(plan, args.all))
            return 0
        if args.command == 'apply':
            result = apply(args.dist, args.target, args.backup, args.only, args.exclude, args.include_edited, args.time, now,
                           args.public_base_url)
            counts = result['plan']['counts']
            text = (f"nothing to publish: the target already holds the build (release {result['release']})" if result['noop'] else
                    f"published {len(result['written'])} files as release {result['release']}\nbackup: {result['backup']}\n"
                    f"ledger: {Path(args.target).resolve() / LEDGER_NAME}\n"
                    f"left alone: {counts['left_alone']} files only the target has; identical: {counts['identical']}"
                    + (f"\nentityCollections rewritten against {result['public_base_url']} in: {', '.join(result['rewritten'])}"
                       if result['rewritten'] else ''))
            emit({k: v for k, v in result.items() if k != 'plan'} | dict(counts=counts), text)
            return 0
        if args.command == 'rollback':
            result = rollback(args.target, args.backup, args.release, args.include_edited, args.time, now)
            emit(result, f"rolled back release {result['release']}: restored {len(result['restored'])}, removed {len(result['removed'])}"
                         f" files and {len(result['removed_dirs'])} directories")
            return 0
        result = verify(args.target)
        emit(result, (f"ok: {result['checked']} files of {result['kind']} {result['release']} have the hash that was recorded" if result['ok'] else
                      f"DRIFT in {len(result['drift'])} of {result['checked']} files of {result['kind']} {result['release']}:\n"
                      + '\n'.join(f"  {d['path']}  expected {d['expected'][:12]}  now {d['actual'][:12]}" for d in result['drift'])))
        return 0 if result['ok'] else EXIT_DRIFT
    except WriteFailed as failure:
        print(f'publish: {failure}', file=sys.stderr)
        for problem in failure.problems:
            print(f'  not restored: {problem}', file=sys.stderr)
        return failure.code
    except PublishError as failure:
        print(f'publish: {failure}', file=sys.stderr)
        return failure.code
    except OSError as failure:                    # before the first write to the target (unusable backup, disk full, unreadable file)
        print(f'publish: {failure}; nothing was written to the target', file=sys.stderr)
        return EXIT_REFUSED


if __name__ == '__main__':
    sys.exit(main())
