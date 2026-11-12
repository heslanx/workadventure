"""One-change mutants of the stage files. usage: python3 -I make_mutants.py <scratch repo> <out dir>

Each mutant names its stage, its file and one exact old block that must occur once in that file.
Writes <out>/<name>/<file> and a unified diff of every mutant to <out>/mutants.diff.
"""
import difflib
import pathlib
import subprocess
import sys

repo, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
ROOM = "play/src/front/Chat/Components/Room/"
STAGE = {"s1": "HEAD~2", "s2": "HEAD~1"}
SVELTE, MODULE = "RoomTimeline.svelte", "RoomTimelineRenderItems.ts"

MUTANTS = [
    ("E1", "s1", SVELTE, "        if (isSameLocalDay(d, today)) return labels.chat.timeLine.today();\n",
     "        if (isSameLocalDay(d, today)) return labels.chat.timeLine.yesterday();\n"),
    ("E2", "s1", SVELTE, "        yesterday.setDate(today.getDate() - 1);\n",
     "        yesterday.setDate(today.getDate() - 2);\n"),
    ("E3", "s1", SVELTE, '            weekday: "short",\n', '            weekday: "long",\n'),
    ("E4", "s1", MODULE, '        return next.kind === "separator" && previous.label === next.label;\n',
     '        return next.kind === "separator";\n'),
    ("E5", "s1", SVELTE, "            previousMessage = currentMessage;\n",
     "            previousMessage = currentMessage ?? previousMessage;\n"),
    ("R1", "s2", MODULE, "        if (insertedSeparator) {\n            previousMessage = undefined;\n        }\n", ""),
    ("R2", "s2", MODULE, '        if (item.kind === "item" && next?.kind === "item" && !next.showHeader) {\n',
     '        if (item.kind === "item" && next?.kind === "item" && !next.showHeader && index < 0) {\n'),
    ("R3", "s2", MODULE, "    if (isSameLocalDay(d, today)) return labels.chat.timeLine.today();\n",
     "    if (isSameLocalDay(d, today)) return labels.chat.timeLine.yesterday();\n"),
    ("R4", "s2", MODULE, "const TIME_GAP_THRESHOLD = 5 * 60 * 1000;\n", "const TIME_GAP_THRESHOLD = 10 * 60 * 1000;\n"),
]

diffs = []
for name, stage, file, old, new in MUTANTS:
    text = subprocess.run(["git", "-C", str(repo), "show", f"{STAGE[stage]}:{ROOM}{file}"],
                          check=True, capture_output=True, text=True).stdout
    assert text.count(old) == 1, (name, old)
    mutated = text.replace(old, new)
    target = out / name / file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(mutated)
    (out / name / "STAGE").write_text(stage + "\n")
    diffs.extend(difflib.unified_diff(text.splitlines(True), mutated.splitlines(True),
                                      f"a/{ROOM}{file} ({name}, {stage})", f"b/{ROOM}{file} ({name}, {stage})"))
(out / "mutants.diff").write_text("".join(diffs))
