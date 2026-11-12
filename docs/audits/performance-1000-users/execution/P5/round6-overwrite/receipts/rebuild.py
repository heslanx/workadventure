import subprocess, sys
# Rebuilds the scratch commits 7 to 12 on top of commit 6, applying text fixes to every commit that has the old text.
repo = sys.argv[1]
def git(*a, inp=None):
    return subprocess.run(['git', '-C', repo, *a], check=True, capture_output=True, input=inp).stdout.decode()
subjects = ['7-pin', '8-fix', '9-pin', '10-fix', '11-pin', '12-fix']
commits = [git('log', '-1', '--format=%H', f'--grep=^{s}$').strip() for s in subjects]
base = git('log', '-1', '--format=%H', '--grep=^6-fix-rejected-replacement-edit$').strip()
files = ['map-storage/src/MapsManager.ts', 'map-storage/src/Upload/UploadController.ts',
         'map-storage/src/tests/MapsManagerAutosave.test.ts', 'map-storage/src/tests/UploadController.test.ts']
FIXES = [tuple(x.split('\n=>\n')) for x in open(sys.argv[2]).read().split('\n====\n') if x.strip()]
contents = []
for c in commits:
    snap = {}
    for f in files:
        t = git('show', f'{c}:{f}')
        for old, new in FIXES:
            t = t.replace(old, new)
        snap[f] = t
    contents.append(snap)
git('checkout', '-q', '--detach', base)
for s, snap in zip(subjects, contents):
    for f, t in snap.items():
        open(f'{repo}/{f}', 'w').write(t)
    git('add', *files)
    git('-c', 'user.name=s', '-c', 'user.email=s@s', 'commit', '-q', '--allow-empty', '-m', s)
print(git('log', '--format=%h %s', '-7'))
