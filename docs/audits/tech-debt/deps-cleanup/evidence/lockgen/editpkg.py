import json, sys
step = json.load(open(sys.argv[1]))[int(sys.argv[2])]
path = step["pkg"] + "/package.json"
d = json.load(open(path))
for sec, items in step.get("add", {}).items():
    for n, v in items.items():
        assert not any(n in d.get(s, {}) for s in ("dependencies", "devDependencies")), f"{n} already declared in {path}"
    merged = dict(d.get(sec, {})); merged.update(items)
    d[sec] = dict(sorted(merged.items()))
for n in step.get("remove", []):
    hit = [s for s in ("dependencies", "devDependencies") if n in d.get(s, {})]
    assert len(hit) == 1, f"{n}: found in {hit} of {path}"
    del d[hit[0]][n]
open(path, "w").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
