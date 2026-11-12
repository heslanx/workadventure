"""Multiset check of a move: lines removed and not re-added, and lines added that were not removed.

usage: python3 -I moved.py <patch>   (leading whitespace ignored, blank lines skipped)
"""
import collections
import sys

removed, added = collections.Counter(), collections.Counter()
for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith(("---", "+++")):
        continue
    if line[:1] in "-+" and line[1:].strip():
        (removed if line[0] == "-" else added)[line[1:].strip()] += 1
print("removed, not re-added:")
for text, n in sorted((removed - added).items()):
    print(f"  {n}x {text}")
print("added, not removed:")
for text, n in sorted((added - removed).items()):
    print(f"  {n}x {text}")
