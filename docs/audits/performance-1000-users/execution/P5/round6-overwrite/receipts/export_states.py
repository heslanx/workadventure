import os, subprocess, sys
# usage: python3 export_states.py <scratch repo> <output dir>
# Scratch commits: HEAD 50632e874 plus patches 6 to 12, one commit each. Letters f to l name patches 6 to 12.
repo, out = sys.argv[1], sys.argv[2]
SUBJECTS = {'f': '6-fix-rejected-replacement-edit', 'g': '7-pin', 'h': '8-fix', 'i': '9-pin', 'j': '10-fix', 'k': '11-pin', 'l': '12-fix'}
C = {k: subprocess.check_output(['git', '-C', repo, 'log', '-1', '--format=%h', f'--grep=^{v}$']).decode().strip() for k, v in SUBJECTS.items()}
SRC = {'MapsManager.ts': 'MapsManager.ts', 'UploadController.ts': 'Upload/UploadController.ts'}
TST = {'MapsManagerAutosave.test.ts': 'tests/MapsManagerAutosave.test.ts', 'UploadController.test.ts': 'tests/UploadController.test.ts'}
def show(rev, f):
    return subprocess.check_output(['git', '-C', repo, 'show', f'{C[rev]}:map-storage/src/{f}']).decode()
# state: (sources from, tests from)
STATES = {
    's1-g-on-f': ('f', 'g'), 's2-g-pin-on-h': ('h', 'g'), 's3-h-tests-on-g': ('g', 'h'), 's4-h': ('h', 'h'),
    's5-i-on-h': ('h', 'i'), 's6-i-pin-on-j': ('j', 'i'), 's7-j-tests-on-i': ('i', 'j'), 's8-j': ('j', 'j'),
    's9-k-on-j': ('j', 'k'), 's10-k-pin-on-l': ('l', 'k'), 's11-l-tests-on-k': ('k', 'l'), 's12-l': ('l', 'l'),
}
for name, (s, t) in STATES.items():
    d = f'{out}/{name}'
    os.makedirs(f'{d}/tests', exist_ok=True)
    for k, v in SRC.items():
        open(f'{d}/{k}', 'w').write(show(s, v))
    for k, v in TST.items():
        open(f'{d}/tests/{k}', 'w').write(show(t, v))
    open(f'{d}/tests/MapStorageServer.test.ts', 'w').write(show(t, 'tests/MapStorageServer.test.ts'))
print(' '.join(STATES), C)
