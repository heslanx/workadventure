"""Build and install the FIXED spritefusion-pixel-snapper: the pinned commit plus tools/patches/pixel-snapper-fix.patch.

  python3 -I tools/build_pixel_snapper.py [--repo URL_OR_PATH] [--build-dir DIR] [--bin-dir DIR] [--offline] [--force]

Run from assets/konclui/source, once, on the host that runs `ingest.py`. Standard library only (git and cargo are called).
The pins (repository, commit, patch, the patch's sha256, the version) are DATA in tools/toolchain.json, "pixel-snapper".

  1  the patch must have the sha256 listed as `patchSha256` (nothing else is applied, whatever the file says)
  2  a checkout of the pinned commit is cloned into the build directory (default: <system temp>/konclui-pixel-snapper-build) or
     reused; HEAD must be exactly the pinned commit, the tree is reset to it and cleaned, then the patch is applied and the
     files it touches are checked
  3  cargo build --release --locked (the pinned commit has a Cargo.lock; without one the run stops). --offline adds
     cargo's --offline, for a CARGO_HOME that already holds the crates. RUSTFLAGS is set to remap the build and cargo paths so the
     binary does not carry the build directory (a path in a panic message changes the hash)
  4  the binary must say its own pinned version and list --expect-cell in --help (the stock tool does not)
  5  it is installed as spritefusion-pixel-snapper-fixed into --bin-dir (default ~/.cargo/bin, where toolchain.py looks), written
     beside the target and renamed into place. The stock spritefusion-pixel-snapper is never touched.

Idempotent: a second run on the same host rebuilds nothing, finds the same bytes already installed and leaves the file alone.
It prints the sha256 of what is installed and says whether toolchain.json lists it (the list is enforced only with
KONCLUI_TOOLCHAIN_SHA256=enforce; a different host or compiler can give another hash, then list the new one).

Exit: 0 installed or already installed; 1 the build or the checks of its result failed; 2 refused before building (a patch whose
hash differs, git or cargo missing, a build directory that is not the pinned checkout).
"""
import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import toolchain  # noqa: E402

TOOL = 'pixel-snapper'
INSTALLED_NAME = toolchain.TOOLS[TOOL]['binary']                  # spritefusion-pixel-snapper-fixed
BUILT_NAME = 'spritefusion-pixel-snapper'                         # what cargo makes: the crate's own binary name
BUILD_DIR_NAME = 'konclui-pixel-snapper-build'
EXPECTED_TOUCHED = ('README.md', 'src/lib.rs')                    # the files the patch is allowed to change


class BuildRefused(Exception):
    """Refused before building: nothing was installed."""


class BuildFailed(Exception):
    """A step failed or the built binary is not the fixed tool: nothing was installed."""


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def default_build_dir():
    return Path(tempfile.gettempdir()) / BUILD_DIR_NAME


def default_bin_dir():
    return toolchain.cargo_bin()


def _run(command, cwd=None, env=None, passthrough=False):
    """Run `command`; the captured stdout (text) on success, BuildFailed quoting stderr otherwise. With `passthrough` the
    tool's own output (cargo's progress, stdout and stderr together) is also written to this process's stderr as it comes."""
    try:
        if passthrough:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            lines = []
            for line in process.stdout:
                sys.stderr.write(line)
                lines.append(line)
            code, stdout, stderr = process.wait(), '', ''.join(lines)
        else:
            done = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True)
            code, stdout, stderr = done.returncode, done.stdout or '', done.stderr or ''
    except OSError as error:
        raise BuildFailed(f'{command[0]} could not run: {error}') from error
    if code:
        raise BuildFailed(f'{" ".join(map(str, command))} failed ({code}): {stderr.strip()[-1500:]}')
    return stdout


def check_patch(patch_path, pin):
    """The patch's sha256, after checking it is the one pinned in toolchain.json. BuildRefused otherwise."""
    expected = pin.get('patchSha256')
    if not expected or not pin.get('patch'):
        raise BuildRefused('toolchain.json lists no patch for pixel-snapper: nothing to build')
    try:
        actual = sha256_of(patch_path)
    except OSError as error:
        raise BuildRefused(f'the patch {patch_path} cannot be read ({error.strerror or error})') from error
    if actual != expected:
        raise BuildRefused(f'{patch_path} has sha256 {actual}, but toolchain.json pins patchSha256 {expected}: the patch was '
                           f'changed (an editor or a formatter?). Restore it from git, or review the change and update the pin')
    return actual


def checkout(pin, repo, build_dir, offline=False):
    """The path of a clean checkout of the pinned commit in `build_dir` (cloned or reused). BuildRefused when an existing
    folder there is not a checkout that can be put on the pinned commit."""
    commit = pin['commit']
    source = Path(build_dir) / commit[:12] / 'src'
    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        _run(['git', 'clone', '--no-checkout', '--quiet', str(repo), str(source)])
    elif not (source / '.git').exists():
        raise BuildRefused(f'{source} exists and is not a git checkout: delete {source.parent} and run again')
    try:
        _run(['git', '-C', str(source), 'cat-file', '-e', f'{commit}^{{commit}}'])
    except BuildFailed as error:
        raise BuildRefused(f'{repo} has no commit {commit} (the pinned one): {error}') from error
    _run(['git', '-C', str(source), 'checkout', '--quiet', '--force', '--detach', commit])
    _run(['git', '-C', str(source), 'reset', '--quiet', '--hard', commit])
    _run(['git', '-C', str(source), 'clean', '--quiet', '-fd'])
    head = _run(['git', '-C', str(source), 'rev-parse', 'HEAD']).strip()
    if head != commit:
        raise BuildRefused(f'{source} is at {head}, not at the pinned commit {commit}')
    if not (source / 'Cargo.lock').is_file():
        raise BuildRefused(f'the pinned commit {commit} has no Cargo.lock, so `cargo build --locked` cannot hold the dependencies')
    return source


def apply_patch(source, patch_path):
    """Apply the patch to the clean checkout and check that it changed the expected files and no others."""
    _run(['git', '-C', str(source), 'apply', '--check', str(patch_path)])
    _run(['git', '-C', str(source), 'apply', str(patch_path)])
    status = _run(['git', '-C', str(source), 'status', '--porcelain', '--untracked-files=no'])
    touched = sorted(line[3:] for line in status.splitlines())
    if touched != sorted(EXPECTED_TOUCHED):
        raise BuildFailed(f'the patch changed {touched}, expected exactly {sorted(EXPECTED_TOUCHED)}')


def cargo_env(source, env=None):
    """The environment of the build: the caller's, with RUSTFLAGS remapping the checkout and cargo paths so that the binary
    does not embed this host's build directory."""
    env = dict(os.environ if env is None else env)
    cargo_home = env.get('CARGO_HOME') or os.path.expanduser('~/.cargo')
    flags = [f'--remap-path-prefix={Path(source).resolve()}=/build/pixel-snapper',
             f'--remap-path-prefix={Path(cargo_home).resolve()}=/cargo']
    env['RUSTFLAGS'] = ' '.join(flags)
    return env


def build(source, offline=False, env=None):
    """cargo build --release --locked in `source`; the path of the binary it made."""
    command = ['cargo', 'build', '--release', '--locked'] + (['--offline'] if offline else [])
    _run(command, cwd=source, env=cargo_env(source, env), passthrough=True)
    built = Path(source) / 'target' / 'release' / BUILT_NAME
    if not built.is_file():
        raise BuildFailed(f'cargo finished but {built} does not exist')
    return built


def check_built(built, pin):
    """The built binary must say the pinned version and list --expect-cell. BuildFailed otherwise."""
    ident = toolchain.inspect_binary(TOOL, str(built))
    if ident['version'] != pin['version']:
        raise BuildFailed(f'{built} says version {ident["version"]!r}, expected {pin["version"]!r}')
    if ident['capability'] is not True:
        raise BuildFailed(f'{built} does not list {toolchain.capability_text(TOOL)}: it is not the fixed tool '
                          f'(the patch did not take effect?)')
    return ident


def install(built, bin_dir, force=False):
    """Copy `built` to bin_dir/spritefusion-pixel-snapper-fixed unless the same bytes are already there. Returns
    (path, sha256, changed). Written beside the target and renamed into place; nothing else in `bin_dir` is touched."""
    bin_dir = Path(bin_dir)
    target = bin_dir / INSTALLED_NAME
    digest = sha256_of(built)
    if target.is_file() and not force and sha256_of(target) == digest and os.access(target, os.X_OK):
        return target, digest, False
    bin_dir.mkdir(parents=True, exist_ok=True)
    temporary = bin_dir / f'.{INSTALLED_NAME}.tmp-{os.getpid()}'
    try:
        shutil.copyfile(built, temporary)
        os.chmod(temporary, 0o755)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    if sha256_of(target) != digest:
        raise BuildFailed(f'{target} does not have the hash of the binary that was built')
    return target, digest, True


def main(argv=None, out=None, pin=None):
    """The command line. `pin` is toolchain.TOOLS['pixel-snapper'] unless a test passes another one."""
    out = out or sys.stdout
    pin = pin or toolchain.TOOLS[TOOL]
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--repo', default=pin['repository'], help='where to clone the pinned commit from (a URL or a local '
                        f'path that has it; default {pin["repository"]})')
    parser.add_argument('--build-dir', default=str(default_build_dir()), help='checkout and target folder (default: %(default)s)')
    parser.add_argument('--bin-dir', default=str(default_bin_dir()), help='where to install (default: %(default)s)')
    parser.add_argument('--offline', action='store_true', help='cargo --offline: use the crates already in CARGO_HOME')
    parser.add_argument('--force', action='store_true', help='write the installed file even when it has the same bytes')
    args = parser.parse_args(argv)
    patch_path = toolchain.PINS_FILE.parent / pin['patch'] if pin.get('patch') else None
    try:
        for tool in ('git', 'cargo'):
            if not shutil.which(tool):
                raise BuildRefused(f'{tool} is not on PATH: it is needed to build the fixed pixel snapper')
        patch_digest = check_patch(patch_path, pin)
        source = checkout(pin, args.repo, args.build_dir, args.offline)
        apply_patch(source, patch_path)
        built = build(source, args.offline)
        ident = check_built(built, pin)
        target, digest, changed = install(built, args.bin_dir, args.force)
    except BuildRefused as error:
        print(f'build_pixel_snapper: refused: {error}', file=sys.stderr)
        return 2
    except BuildFailed as error:
        print(f'build_pixel_snapper: failed: {error}', file=sys.stderr)
        return 1
    listed = digest in pin['sha256']
    print(f'pixel snapper {ident["version"]} at commit {pin["commit"]} + patch sha256 {patch_digest}', file=out)
    print(f'{"installed" if changed else "already installed (same bytes)"}: {target}', file=out)
    print(f'sha256: {digest}', file=out)
    print('toolchain.json lists this hash' if listed else
          f'toolchain.json does NOT list this hash: add {digest} to pixel-snapper.sha256 (it is enforced only with '
          f'{toolchain.SHA256_ENV}=enforce)', file=out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
