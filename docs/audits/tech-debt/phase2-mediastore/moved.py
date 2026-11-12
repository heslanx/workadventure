"""Multiset check of a patch: removed lines minus added lines, and added minus removed, whitespace-stripped.

Usage: python3 -I moved.py <patch>
"""

import sys
from collections import Counter

removed, added = Counter(), Counter()
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.rstrip("\n")
    if line.startswith("---") or line.startswith("+++"):
        continue
    if line.startswith("-"):
        removed[line[1:].strip()] += 1
    elif line.startswith("+"):
        added[line[1:].strip()] += 1

print("removed, not re-added (stripped):")
for text, n in sorted((removed - added).items()):
    print(f"  {n} x {text!r}")
print("added, not removed (stripped):")
for text, n in sorted((added - removed).items()):
    print(f"  {n} x {text!r}")
print(f"total removed {sum(removed.values())}, added {sum(added.values())}")
