#!/usr/bin/env python3
"""Usage: removed-packages-scan.py <source-root> <lock-before.json> <lock-after.json>
Lists every package that disappears from the lockfile and searches the source tree for any module specifier that names it."""
import json, re, subprocess, sys
root, before, after = sys.argv[1:4]
a = json.load(open(before))["packages"]; b = json.load(open(after))["packages"]
removed = sorted({m.group(1) for k in a if k not in b
                  for m in [re.match(r"node_modules/((?:@[^/]+/)?[^/]+)$", k)] if m})
print(len(removed), "top-level packages leave the lockfile")
excl = ["--glob", "!node_modules", "--glob", "!**/package.json", "--glob", "!**/package-lock.json", "--glob", "!**/yarn.lock"]
for n in removed:
    base = n.split("/", 1)[1] if n.startswith("@types/") else n
    pat = r"""['"`(]""" + re.escape(n) + r"""(['"`)/]|$)""" + (r"|types=['\"]" + re.escape(base) + r"['\"]" if base != n else "")
    out = subprocess.run(["rg", "-n", "--no-heading", "-P", *excl, "-e", pat, root], capture_output=True, text=True).stdout.splitlines()
    print(f"{n}\t{len(out)} specifier refs" + ("" if not out else "\t" + out[0][:140]))
