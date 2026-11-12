import json, sys
a = json.load(open(sys.argv[1]))["packages"]; b = json.load(open(sys.argv[2]))["packages"]
rem = sorted(k for k in a if k not in b); add = sorted(k for k in b if k not in a)
chg = sorted(k for k in a if k in b and a[k].get("version") != b[k].get("version"))
print("removed", len(rem)); [print("  -", k, a[k].get("version")) for k in rem]
print("added", len(add)); [print("  +", k, b[k].get("version")) for k in add]
print("version-changed", len(chg)); [print("  ~", k, a[k].get("version"), "->", b[k].get("version")) for k in chg]
