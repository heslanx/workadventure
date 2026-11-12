import os, subprocess, sys
# usage: python3 export_states.py <scratch repo> <output dir>
repo, out = sys.argv[1], sys.argv[2]
C = {'head': '856cddf', 'p1': 'fb7ac65', 'p2': 'b89c49b', 'p3': '9ee2f79', 'p4': '869fb0f', 'p5': '70f03ad', 'p6': '3e690ec'}
SRC = {'MapsManager.ts': 'MapsManager.ts', 'UploadController.ts': 'Upload/UploadController.ts'}
TST = {'MapsManagerAutosave.test.ts': 'tests/MapsManagerAutosave.test.ts', 'UploadController.test.ts': 'tests/UploadController.test.ts'}
def show(rev, f):
    r = subprocess.run(['git', '-C', repo, 'show', f'{C[rev]}:map-storage/src/{f}'], capture_output=True)
    return r.stdout.decode() if r.returncode == 0 else None
# state: (sources from, tests from)
STATES = {
    'e1-a-on-head': ('head', 'p1'), 'e2-a-pin-on-b': ('p2', 'p1'), 'e3-b-tests-on-a': ('p1', 'p2'), 'e4-b': ('p2', 'p2'),
    'e5-c-on-b': ('p2', 'p3'), 'e6-c-pin-on-d': ('p4', 'p3'), 'e7-d-tests-on-c': ('p3', 'p4'), 'e8-d': ('p4', 'p4'),
    'e9-e-on-d': ('p4', 'p5'), 'e10-e-pin-on-f': ('p6', 'p5'), 'e11-f-tests-on-e': ('p5', 'p6'), 'e12-f': ('p6', 'p6'),
}
for name, (s, t) in STATES.items():
    d = f'{out}/{name}'
    os.makedirs(d, exist_ok=True)
    for k, v in SRC.items():
        open(f'{d}/{k}', 'w').write(show(s, v))
    for k, v in TST.items():
        text = show(t, v)
        if text is not None:
            open(f'{d}/{k}', 'w').write(text)
print(' '.join(STATES))
