#!/usr/bin/env python3
"""D01a tsconfig fixes for the TypeScript 6 default changes. Each edit must match exactly once."""
import pathlib

ROOT = pathlib.Path("/work")

EDITS = [
    (
        "libs/messages/tsconfig.json",
        '    "lib": [ "ES2020" ],\n',
        '    "lib": [ "ES2020" ],\n    "types": [ "node" ],\n',
    ),
    (
        "contrib/tools/e2e-report/tsconfig.json",
        '    "lib": ["ES2022"],\n',
        '    "lib": ["ES2022"],\n    "types": ["node"],\n',
    ),
    (
        "play/tsconfig.json",
        '    "outDir": "./dist/public",\n',
        '    "outDir": "./dist/public",\n'
        "    // vite.config.ts imports ../libs/messages by relative path, so the sources span the monorepo root.\n"
        "    // TypeScript 6 no longer infers the common root and defaults rootDir to this directory.\n"
        '    "rootDir": "..",\n',
    ),
    (
        "play/tsconfig-pusher.json",
        '    "outDir": "./dist",\n    "preserveValueImports": false,\n',
        '    "rootDir": ".",\n    "outDir": "./dist",\n',
    ),
]

for relative, old, new in EDITS:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"{relative}: expected exactly one match, found {text.count(old)}")
    path.write_text(text.replace(old, new), encoding="utf-8")
    print(f"edited {relative}")
