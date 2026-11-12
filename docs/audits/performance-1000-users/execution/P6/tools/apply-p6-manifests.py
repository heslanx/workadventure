#!/usr/bin/env python3
"""P6 pilot manifests, applied on top of D01a.

- Every workspace of the root lockfile that pins typescript switches to the
  official TypeScript 6 API wrapper alias, so a workspace-local real
  `typescript` cannot be installed next to the root alias and shadow it.
- The root, back and map-storage add the native compiler alias. back and
  map-storage need their own entry because CI installs them with
  `npm ci --workspace=<name>`, which does not install root devDependencies.
- Every existing `tsc` script moves to `tsc6`, so the existing gates and emit
  keep running on the JavaScript compiler. Only the two new pilot scripts call
  the native `tsc`.

Each edit must match exactly once.
"""
import pathlib

ROOT = pathlib.Path("/work")
TS6 = '"typescript": "^6.0.3"'
TS6_ALIAS = '"typescript": "npm:@typescript/typescript6@^6.0.2"'
NATIVE = '"@typescript/native": "npm:typescript@^7.0.2"'

ALIAS_ONLY = [
    "play/package.json",
    "libs/map-editor/package.json",
    "libs/math-utils/package.json",
    "libs/messages/package.json",
    "libs/shared-utils/package.json",
    "libs/store-utils/package.json",
    "benchmark/package.json",
    "contrib/tools/e2e-report/package.json",
    "contrib/tools/generate-env-docs/package.json",
]

SCRIPT_EDITS = {
    "back/package.json": [
        (
            '    "typecheck": "tsc --noEmit",\n',
            '    "typecheck": "tsc6 --noEmit",\n    "typecheck:native": "tsc --noEmit",\n',
        ),
    ],
    "map-storage/package.json": [
        (
            '    "typecheck": "tsc --project tsconfig-node.json --noEmit",\n',
            '    "typecheck": "tsc6 --project tsconfig-node.json --noEmit",\n'
            '    "typecheck:native": "tsc --project tsconfig-node.json --noEmit",\n',
        ),
    ],
    "play/package.json": [
        ('"typecheck": "cross-env tsc --noEmit"', '"typecheck": "cross-env tsc6 --noEmit"'),
        (
            '"push-sentry-sourcemaps": "tsc --project tsconfig-pusher.json',
            '"push-sentry-sourcemaps": "tsc6 --project tsconfig-pusher.json',
        ),
        (
            '"build-typings": "cross-env tsc --project tsconfig-for-iframe-api-typings.json"',
            '"build-typings": "cross-env tsc6 --project tsconfig-for-iframe-api-typings.json"',
        ),
    ],
    "libs/map-editor/package.json": [
        ('"typecheck": "tsc --noEmit"', '"typecheck": "tsc6 --noEmit"'),
        ('"build": "tsc"', '"build": "tsc6"'),
    ],
    "libs/store-utils/package.json": [
        ('"typecheck": "tsc --noEmit"', '"typecheck": "tsc6 --noEmit"'),
        ('"build": "tsc"', '"build": "tsc6"'),
    ],
    "libs/messages/package.json": [
        ('"typecheck": "tsc --noEmit"', '"typecheck": "tsc6 --noEmit"'),
        ('"build": "tsc"', '"build": "tsc6"'),
    ],
    "libs/shared-utils/package.json": [
        ('"typecheck": "tsc --noEmit"', '"typecheck": "tsc6 --noEmit"'),
        ('"build": "tsc"', '"build": "tsc6"'),
    ],
    "contrib/tools/e2e-report/package.json": [
        ('"typecheck": "tsc --noEmit"', '"typecheck": "tsc6 --noEmit"'),
    ],
}


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"{relative}: expected exactly one match of {old!r}, found {text.count(old)}")
    path.write_text(text.replace(old, new), encoding="utf-8")


for relative in ALIAS_ONLY:
    replace_once(relative, TS6, TS6_ALIAS)

for relative in ["package.json", "back/package.json", "map-storage/package.json"]:
    replace_once(relative, TS6, f"{NATIVE},\n    {TS6_ALIAS}")

for relative, edits in SCRIPT_EDITS.items():
    for old, new in edits:
        replace_once(relative, old, new)

print("P6 manifests applied")
