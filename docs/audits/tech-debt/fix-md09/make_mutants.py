"""Write one-line mutants of MediaStore.ts (stage 1) to <out>/mN/play/src/front/Stores/MediaStore.ts and a combined diff."""
import sys, pathlib, difflib

src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
out = pathlib.Path(sys.argv[2])

# (name, anchor that must precede the line, old line, new line)
MUTANTS = [
    ("m1", "function classifyMediaAccessError", '        return "device_in_use";', '        return "no_device";'),
    ("m2", "export const cameraButtonHelpContextStore", '            return "device_in_use" as const;', "            return null;"),
    ("m3", "export const microphoneButtonHelpContextStore", '            return "device_in_use" as const;', '            return "no_device" as const;'),
]

diffs = []
for name, anchor, old, new in MUTANTS:
    lines = src.split("\n")
    start = [i for i, l in enumerate(lines) if l.startswith(anchor)]
    assert len(start) == 1, (name, anchor)
    hits = [i for i in range(start[0], len(lines)) if lines[i] == old]
    assert hits, (name, old)
    i = hits[0]
    assert i - start[0] < 20, (name, i - start[0])
    lines[i] = new
    mutated = "\n".join(lines)
    path = out / name / "play/src/front/Stores/MediaStore.ts"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(mutated, encoding="utf-8")
    diffs.append(f"# {name}: line {i + 1}\n" + "".join(difflib.unified_diff(
        src.splitlines(True), mutated.splitlines(True),
        "a/play/src/front/Stores/MediaStore.ts", "b/play/src/front/Stores/MediaStore.ts", n=3)))
    print(name, "line", i + 1)
(out / "mutants.diff").write_text("".join(diffs), encoding="utf-8")
