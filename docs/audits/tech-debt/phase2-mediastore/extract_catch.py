"""Item 2: move the catch body of runRawStreamUpdate into handleGetUserMediaFailure, unchanged, 8 spaces less indented.

Usage: python3 -I extract_catch.py <MediaStore.ts>
"""

import sys

path = sys.argv[1]
lines = open(path, encoding="utf-8").read().split("\n")


def find(text, start=0):
    hits = [i for i in range(start, len(lines)) if lines[i] == text]
    assert hits, f"missing: {text!r}"
    return hits[0]


run = find("async function runRawStreamUpdate(")
catch = find("        } catch (e) {", run)
assert lines[catch + 1] == '            if (isOverConstrainedError(e) && e.constraint === "deviceId") {', lines[catch + 1]
end = find("        }", catch + 1)  # the closer of the catch block
assert lines[end - 1] == "            }", lines[end - 1]
assert lines[end + 1] == "    }" and lines[end + 3] == "    return nextConstraints;", lines[end + 1 : end + 4]
body = lines[catch + 1 : end]
for line in body:
    assert line == "" or line.startswith("            "), line
moved = [line[8:] if line else line for line in body]

function = [
    "/**",
    " * After a failed getUserMedia: falls back to the default devices when a chosen one cannot be opened, or turns off",
    " * the device that failed and records why. Turning a device off queues a new run without it.",
    " */",
    "function handleGetUserMediaFailure(",
    "    e: unknown,",
    "    constraints: MediaStreamConstraintsValue,",
    "    newConstraints: MediaStreamConstraints,",
    "    { mustRequestNewVideo, mustRequestNewAudio }: { mustRequestNewVideo: boolean; mustRequestNewAudio: boolean },",
    "    setIfCurrent: SetRawStreamIfCurrent,",
    "): void {",
    *moved,
    "}",
    "",
]
call = [
    "        } catch (e) {",
    "            handleGetUserMediaFailure(e, constraints, newConstraints, { mustRequestNewVideo, mustRequestNewAudio }, setIfCurrent);",
    "        }",
]
lines[catch : end + 1] = call
lines[run:run] = function
open(path, "w", encoding="utf-8").write("\n".join(lines))
print(f"moved {len(body)} lines; catch was at :{catch + 1}-{end + 1}; function inserted at :{run + 1}")
