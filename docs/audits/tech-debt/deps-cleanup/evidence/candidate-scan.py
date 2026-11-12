#!/usr/bin/env python3
"""For each DEP-01 candidate, list every reference to it anywhere in the snapshot, grouped by evidence class."""
import json, os, re, subprocess, sys

ROOT = sys.argv[1]
CANDS = {
    "back": ["@grpc/proto-loader","busboy","@types/busboy","google-protobuf","@types/google-protobuf","mkdirp","@types/mkdirp","query-string","source-map-support","uuidv4","@types/http-status-codes"],
    "map-storage": ["@grpc/proto-loader","busboy","google-protobuf","nodemon","npm-check-updates","reflect-metadata","rxjs","zod-to-json-schema","@total-typescript/ts-reset","source-map-support","ts-loader","tsconfig-paths"],
    "libs/messages": ["google-protobuf","long","rxjs"],
    "libs/store-utils": ["@types/debug"],
    "play": ["hyper-express","live-directory","qs","@types/qs","ts-proto-descriptors","google-protobuf","@types/google-protobuf","livekit-server-sdk","@livekit/track-processors","@sentry/browser","@16bits/nes.css","@rollup/plugin-inject","vitest-websocket-mock","@types/jsonwebtoken","@types/uuid","@types/http-status-codes"],
}
lock = json.load(open(os.path.join(ROOT, "package-lock.json")))["packages"]
EXCL = ["--glob","!node_modules","--glob","!package-lock.json","--glob","!**/dist/**","--glob","!*.map"]

def rg(pattern, *extra, fixed=False):
    cmd = ["rg","-n","--no-heading","--hidden","-P","--glob","!.git"] + EXCL + list(extra) + ["-e", pattern, "."]
    err = None
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if r.returncode not in (0,1): print("RG ERROR:", r.stderr[:200]); sys.exit(2)
    return [l for l in r.stdout.splitlines() if l]

def bins_of(name):
    e = lock.get("node_modules/" + name, {})
    b = e.get("bin", {})
    return list(b.keys()) if isinstance(b, dict) else ([name.split("/")[-1]] if b else [])

def dependents(name):
    out = []
    for k, v in lock.items():
        for sec in ("dependencies","devDependencies","optionalDependencies","peerDependencies"):
            if name in v.get(sec, {}):
                out.append(f"{k or '<root>'}[{sec[:3]}]={v[sec][name]}")
    return out

def declared_in(pkg, name):
    d = lock[pkg]
    return [s for s in ("dependencies","devDependencies") if name in d.get(s, {})]

def clip(lines, n=10):
    return lines[:n] + ([f"... (+{len(lines)-n} more)"] if len(lines) > n else [])

def grp(lines):
    from collections import Counter
    c = Counter()
    for l in lines:
        p = l.split(":",1)[0].lstrip("./").split("/")
        c["/".join(p[:3]) if p[0]=="libs" or p[0]=="contrib" else p[0]] += 1
    return dict(c)

for pkg, names in CANDS.items():
    for name in names:
        esc = re.escape(name)
        base = name.split("/", 1)[1] if name.startswith("@types/") else name
        print("=" * 100)
        print(f"## {pkg} :: {name}   declared in lock: {declared_in(pkg, name)}   version: {lock.get('node_modules/'+name,{}).get('version')}")
        # 1 module specifier use: quote or path start then name then quote or slash
        spec = rg(r"""['"`(]""" + re.escape(base) + r"""(['"`)/]|$)""")
        spec = [l for l in spec if not re.search(r"(^|/)package\.json:", l)]
        print(f"[specifier refs of '{base}']", len(spec), grp(spec)); [print("   ", l[:170]) for l in clip(spec)]
        # 2 word mentions outside package.json deps lines and lock
        word = rg(r"(?<![\w@/.-])" + re.escape(base) + r"(?![\w-])")
        word = [l for l in word if l not in spec and not re.search(r"(^|/)package\.json:\d+:\s+\"" + esc, l)]
        print(f"[word mentions of '{base}' not already listed]", len(word), grp(word)); [print("   ", l[:170]) for l in clip(word)]
        # 3 bin names
        for b in bins_of(name):
            bl = rg(r"(?<![\w@/.-])" + re.escape(b) + r"(?![\w-])")
            bl = [l for l in bl if not re.search(r"(^|/)package\.json:\d+:\s+\"" + re.escape(b) + r"\"\s*:", l) and l not in spec and l not in word]
            print(f"[bin '{b}' mentions]", len(bl)); [print("   ", l[:200]) for l in clip(bl)]
        # 4 what else in the lockfile requires it
        print("[required by in lockfile]", clip(dependents(name), 8))
