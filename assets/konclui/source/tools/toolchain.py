"""The one place that knows the three SpriteFusion command-line tools of the art pipeline.

Standard library only. The pins (version, repository, commit, licence, install command, accepted hashes) are DATA in
toolchain.json beside this file; nothing in code decides a version.

  TOOLS            {"pixel-snapper" | "sprite-normals" | "palette-snapper": {binary, env, version, repository, commit,
                   license, install, sha256}}
  resolve(name)    absolute path: the environment override when set (set but wrong is an error, never a fallback), else
                   PATH, else ~/.cargo/bin. ToolMissing when none.
  identity(name)   {name, path, version (the tool's own --version), sha256 (of the binary), pinnedVersion, pinnedCommit,
                   matches (version == pin), versionOutput}
  require(name)    the path, after identity: ToolMismatch when the version differs from the pin, unless
                   KONCLUI_TOOLCHAIN_ALLOW_MISMATCH=1 (a loud warning on stderr). KONCLUI_TOOLCHAIN_SHA256=enforce makes
                   a hash listed in toolchain.json mandatory (the hash is otherwise recorded and printed, not enforced:
                   a rebuild of the same commit gives another one).
  run(name, args)  require, then run with stdout and stderr captured; a non-zero exit raises ToolFailed quoting stderr.
  versions()       {"tools": {name: identity}, "missing": {name: why}} for a build manifest.

Command line (from this directory or by path): python3 -I tools/toolchain.py status [--json]
prints a table and exits 0 only when all three tools resolve and match their pins.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from types import MappingProxyType

PINS_FILE = Path(__file__).resolve().parent / 'toolchain.json'
ALLOW_MISMATCH_ENV = 'KONCLUI_TOOLCHAIN_ALLOW_MISMATCH'
SHA256_ENV = 'KONCLUI_TOOLCHAIN_SHA256'
NAMES = ('pixel-snapper', 'sprite-normals', 'palette-snapper')
_FIELDS = ('binary', 'env', 'version', 'repository', 'commit', 'license', 'install', 'sha256')
VERSION_TIMEOUT = 10


class ToolError(Exception):
    """Base of every error this module raises about a tool."""


class ToolMissing(ToolError):
    """The tool cannot be found (or its override is wrong). The message says which tool, why and how to install it."""


class ToolMismatch(ToolError):
    """The tool found is not the pinned one."""


class ToolFailed(ToolError):
    """The tool ran and exited non-zero. `returncode`, `stderr` and `command` are kept; the message quotes stderr."""

    def __init__(self, name, command, returncode, stderr):
        if isinstance(stderr, bytes):
            stderr = stderr.decode('utf-8', 'replace')
        self.name, self.command, self.returncode, self.stderr = name, list(command), returncode, stderr or ''
        super().__init__(f'{name} failed ({returncode}): {self.stderr[-2000:].strip()}')


def load_pins(path=PINS_FILE):
    """The validated pins of `path` as {name: read-only dict}. A malformed file is a ValueError naming the file."""
    path = Path(path)
    data = json.loads(path.read_text(encoding='utf-8'))
    tools = data.get('tools') if isinstance(data, dict) else None
    if not isinstance(tools, dict) or sorted(tools) != sorted(NAMES):
        raise ValueError(f'{path}: "tools" must hold exactly {", ".join(NAMES)}')
    out = {}
    for name in NAMES:
        entry = tools[name]
        if not isinstance(entry, dict) or sorted(entry) != sorted(_FIELDS):
            raise ValueError(f'{path}: {name} must have exactly the fields {", ".join(_FIELDS)}')
        for field in _FIELDS[:-1]:
            if not isinstance(entry[field], str) or not entry[field].strip():
                raise ValueError(f'{path}: {name}.{field} must be a non-empty string')
        if not re.fullmatch(r'[0-9a-f]{40}', entry['commit']):
            raise ValueError(f'{path}: {name}.commit must be a 40-digit lowercase hex commit')
        hashes = entry['sha256']
        if not isinstance(hashes, list) or not all(isinstance(h, str) and re.fullmatch(r'[0-9a-f]{64}', h) for h in hashes):
            raise ValueError(f'{path}: {name}.sha256 must be a list of 64-digit lowercase hex hashes')
        out[name] = MappingProxyType({**entry, 'sha256': tuple(hashes)})
    return MappingProxyType(out)


TOOLS = load_pins()


def _spec(name):
    if name not in TOOLS:
        raise KeyError(f'unknown tool {name!r}: expected one of {", ".join(sorted(TOOLS))}')
    return TOOLS[name]


def cargo_bin():
    return Path(os.path.expanduser('~/.cargo/bin'))


def locate(env, binary, cargo=True, install=None):
    """The override `env` when set, else `binary` on PATH, else (when `cargo`) in ~/.cargo/bin. ToolMissing when none.
    A set-but-wrong override is an error: it never falls through to PATH."""
    hint = f'\n  install: {install}\n  or point {env} at the binary' if install else ''
    value = os.environ.get(env)
    if value:
        if not Path(value).is_file():
            raise ToolMissing(f'{binary} not found: {env} is set to {value!r}, which is not a file{hint}')
        if not os.access(value, os.X_OK):
            raise ToolMissing(f'{binary} not usable: {env} is set to {value!r}, which is not executable{hint}')
        return os.path.abspath(value)
    found = shutil.which(binary)
    if found:
        return os.path.abspath(found)
    if cargo:
        candidate = cargo_bin() / binary
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return os.path.abspath(candidate)
    where = ' or in ~/.cargo/bin' if cargo else ''
    raise ToolMissing(f'{binary} not found: {env} is not set and {binary} is not on PATH{where}{hint}')


def resolve(name, cargo=True):
    """Absolute path of the binary of tool `name`. ToolMissing, with the install command, when it cannot be found.
    `cargo=False` leaves ~/.cargo/bin out (the lookup the older step wrappers always had)."""
    spec = _spec(name)
    return locate(spec['env'], spec['binary'], cargo, spec['install'])


def declared(name, cargo=True):
    """True when the tool is asked for or present: the override is set (even a wrong one, so that resolving it raises
    instead of falling back), or the binary is on PATH (or, with `cargo`, in ~/.cargo/bin)."""
    spec = _spec(name)
    if os.environ.get(spec['env']):
        return True
    try:
        locate(spec['env'], spec['binary'], cargo)
    except ToolMissing:
        return False
    return True


def sha256_of(path):
    """sha256 of the binary at `path`. ToolMissing (not a bare OSError) when it cannot be read, e.g. mode 111."""
    try:
        return hashlib.sha256(Path(path).resolve().read_bytes()).hexdigest()
    except OSError as error:
        raise ToolMissing(f'{path} cannot be read ({error.strerror or error}): the tool is not usable') from error


# A whole version number, optionally with a "-" or "+" suffix (1.0.0, 1.0.0-rc1, 1.0.0+build5), and nothing glued to it:
# "1.0.0.1", "1.0.0_beta" and "1.0.0x" are other builds, not 1.0.0. A "v" before it and a full stop after it are allowed.
_VERSION = re.compile(r'(?<![\w.])v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)(?![\w+-]|\.\w)')
_CACHE = {}


def _probe(path):
    """(version or None, the first line the tool printed for --version, sha256), cached on the file's identity."""
    try:
        stat = os.stat(path)
    except OSError as error:
        raise ToolMissing(f'{path} cannot be read ({error.strerror or error}): the tool is not usable') from error
    key = (path, stat.st_mtime_ns, stat.st_size)
    if key not in _CACHE:
        try:
            run = subprocess.run([path, '--version'], capture_output=True, text=True, timeout=VERSION_TIMEOUT)
            text = run.stdout if run.stdout.strip() else run.stderr
            line = (text.strip().splitlines() or [''])[0][:200]
            found = _VERSION.search(f'{run.stdout}\n{run.stderr}') if run.returncode == 0 else None
            version = found.group(1) if found else None
            if run.returncode:
                line = f'exit {run.returncode}: {line}'.strip()
        except (OSError, subprocess.SubprocessError) as error:
            version, line = None, f'could not run: {error}'
        _CACHE[key] = (version, line, sha256_of(path))
    return _CACHE[key]


def identity(name):
    """What `name` is on this host: its path, its own --version, the hash of its binary and the pin it is compared to."""
    spec = _spec(name)
    path = resolve(name)
    try:
        version, line, digest = _probe(path)
    except ToolMissing as error:
        raise ToolMissing(f'{error}\n  install: {spec["install"]}\n  or point {spec["env"]} at a readable binary') from error
    return {'name': name, 'path': path, 'version': version, 'sha256': digest, 'pinnedVersion': spec['version'],
            'pinnedCommit': spec['commit'], 'matches': version == spec['version'], 'versionOutput': line}


def _mismatch_message(ident):
    spec = _spec(ident['name'])
    seen = ident['version'] or f'unreadable (--version printed {ident["versionOutput"]!r})'
    return (f'{spec["binary"]} at {ident["path"]} is version {seen}, but the pin is {spec["version"]} '
            f'(commit {spec["commit"]}).\n  install the pinned one: {spec["install"]}\n'
            f'  to run anyway, with a loud warning: {ALLOW_MISMATCH_ENV}=1')


def _sha_mode():
    mode = os.environ.get(SHA256_ENV, '')
    if mode not in ('', 'enforce'):
        raise ToolError(f'{SHA256_ENV} is {mode!r}: the only value is "enforce" (or leave it unset)')
    return mode


def problem(name):
    """None when `name` resolves, matches its pin (and, with KONCLUI_TOOLCHAIN_SHA256=enforce, has a listed hash); else
    the reason, as text. Ignores KONCLUI_TOOLCHAIN_ALLOW_MISMATCH: it reports what is wrong, `require` decides."""
    try:
        ident = identity(name)
    except ToolMissing as error:
        return str(error)
    if not ident['matches']:
        return _mismatch_message(ident)
    if _sha_mode() == 'enforce' and ident['sha256'] not in _spec(name)['sha256']:
        return _sha_message(ident)
    return None


def _sha_message(ident):
    spec = _spec(ident['name'])
    listed = ', '.join(h[:16] for h in spec['sha256']) or 'none'
    return (f'{spec["binary"]} at {ident["path"]} has sha256 {ident["sha256"]}, which is not listed in toolchain.json '
            f'(listed: {listed}) and {SHA256_ENV}=enforce is set')


def require(name):
    """The path of `name`, after resolve and identity. ToolMismatch when the version is not the pin (a loud warning
    instead with KONCLUI_TOOLCHAIN_ALLOW_MISMATCH=1) or, with KONCLUI_TOOLCHAIN_SHA256=enforce, the hash is not listed."""
    ident = identity(name)
    if not ident['matches']:
        if os.environ.get(ALLOW_MISMATCH_ENV) != '1':
            raise ToolMismatch(_mismatch_message(ident))
        print(f'toolchain: !!! {ALLOW_MISMATCH_ENV}=1: running a tool that is NOT the pinned one: '
              + _mismatch_message(ident).splitlines()[0], file=sys.stderr)
    if _sha_mode() == 'enforce' and ident['sha256'] not in _spec(name)['sha256']:
        raise ToolMismatch(_sha_message(ident))
    return ident['path']


def run(name, args, **kw):
    """Run tool `name` (after `require`) with `args`; stdout and stderr captured (text unless text=False is passed).
    A non-zero exit raises ToolFailed quoting stderr. Other keywords (cwd, env, input, timeout) go to subprocess.run."""
    for forbidden in ('capture_output', 'stdout', 'stderr', 'check'):
        if forbidden in kw:
            raise TypeError(f'run() always captures stdout and stderr and raises on a failure: {forbidden} is not accepted')
    path = require(name)
    kw.setdefault('text', True)
    command = [path, *map(str, args)]
    done = subprocess.run(command, capture_output=True, **kw)
    if done.returncode:
        raise ToolFailed(name, command, done.returncode, done.stderr)
    return done


def versions():
    """For a build manifest: {"tools": {name: identity of each tool that resolves}, "missing": {name: why not}}."""
    found, missing = {}, {}
    for name in NAMES:
        try:
            found[name] = identity(name)
        except ToolMissing as error:
            missing[name] = str(error)
    return {'tools': found, 'missing': missing}


def status(as_json=False, out=None):
    """Print the table (or JSON) of the three tools; the exit status: 0 only when every tool resolves and matches."""
    out = out or sys.stdout
    _sha_mode()                                       # a bad KONCLUI_TOOLCHAIN_SHA256 is a usage error whatever else is wrong
    report = versions()
    problems = {name: problem(name) for name in NAMES}
    problems = {name: text for name, text in problems.items() if text}
    ok = not problems
    if as_json:
        print(json.dumps({'ok': ok, **report, 'problems': problems}, indent=2, sort_keys=True), file=out)
        return 0 if ok else 1
    rows = [('tool', 'pinned', 'found', 'sha256', 'status', 'path')]
    for name in NAMES:
        ident = report['tools'].get(name)
        if ident is None:
            rows.append((name, TOOLS[name]['version'], '-', '-', 'MISSING', '-'))
            continue
        state = 'ok' if name not in problems else ('MISMATCH' if not ident['matches'] else 'HASH NOT LISTED')
        rows.append((name, ident['pinnedVersion'], ident['version'] or 'unreadable', ident['sha256'][:16], state, ident['path']))
    widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]))]
    for row in rows:
        print('  '.join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip(), file=out)
    for name, text in problems.items():
        print(f'\n{name}: {text}', file=out)
    print('\ntoolchain: ' + ('all three tools resolve and match their pins' if ok else f'{len(problems)} of 3 tools need attention'),
          file=out)
    return 0 if ok else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('status', help='table of the three tools; exit 0 only when all resolve and match').add_argument(
        '--json', action='store_true')
    args = parser.parse_args(argv)
    try:
        return status(args.json)
    except ToolError as error:
        print(f'toolchain: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
