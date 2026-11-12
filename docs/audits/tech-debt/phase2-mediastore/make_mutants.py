"""Writes each mutant as <out>/<name>/MediaStore.ts (one line changed in its stage file) and prints a unified diff.

Usage: python3 -I make_mutants.py <dir with s1.ts s2.ts s3.ts> <out>
"""

import difflib
import os
import sys

src, out = sys.argv[1], sys.argv[2]
FN = "function handleGetUserMediaFailure("
PLAN = "function planTracks("
RUN = "async function runRawStreamUpdate("
CLASSIFY = "function classifyMediaAccessError("

# name, stage, region start marker (the change must fall after it), old line (stripped), new line (stripped)
MUTANTS = [
    ("e1", "s1", CLASSIFY, 'if (name === "NotFoundError" || name === "DevicesNotFoundError") {',
     'if (name === "DevicesNotFoundError") {'),
    ("e2", "s1", RUN, "emitCurrentStreamOrError(setIfCurrent, e);", ""),
    ("e3", "s1", RUN, "} else if (mustRequestNewVideo) {",
     "} else if (mustRequestNewVideo && classifyMediaAccessError(e) !== null) {"),
    ("e4", "s1", CLASSIFY, 'if (name === "NotFoundError" || name === "DevicesNotFoundError") {',
     'if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "NotReadableError") {'),
    ("r1", "s2", FN, "requestedCameraState.disableWebcam();",
     "requestedCameraState.disableWebcam(); requestedMicrophoneState.disableMicrophone();"),
    ("r2", "s2", FN, "requestedMicrophoneDeviceIdStore.set(undefined);", ""),
    ("r3", "s2", FN, "} else if (mustRequestNewVideo) {",
     "} else if (mustRequestNewVideo && classifyMediaAccessError(e) !== null) {"),
    ("p1", "s3", PLAN, "(!deepEqual(oldConstraints.audio, constraints.audio) || !hasLiveAudioTrack);", "true;"),
    ("p2", "s3", PLAN, "const mustStopVideo = oldConstraints.video !== false && constraints.video === false;",
     "const mustStopVideo = !(oldConstraints.video !== false && constraints.video === false);"),
    ("p3", "s3", RUN, "{ hasLiveVideoTrack, hasLiveAudioTrack, hasWarmAudioTrack: warmAudioTrack !== undefined },",
     "{ hasLiveVideoTrack, hasLiveAudioTrack, hasWarmAudioTrack: false },"),
    ("p4", "s3", PLAN,
     "return { mustRequestNewVideo, mustRequestNewAudio, mustStopVideo, mustStopAudio: true, oldAudioConstraints };",
     "return { mustRequestNewVideo, mustRequestNewAudio, mustStopVideo, mustStopAudio: false, oldAudioConstraints };"),
]

for name, stage, marker, old, new in MUTANTS:
    lines = open(os.path.join(src, stage + ".ts"), encoding="utf-8").read().split("\n")
    start = [i for i, line in enumerate(lines) if line.startswith(marker)]
    assert len(start) == 1, (name, marker)
    hits = [i for i in range(start[0], len(lines)) if lines[i].strip() == old]
    assert hits, (name, old)
    i = hits[0]
    indent = lines[i][: len(lines[i]) - len(lines[i].lstrip())]
    mutated = list(lines)
    mutated[i] = indent + new if new else indent + "// " + old
    os.makedirs(os.path.join(out, name), exist_ok=True)
    open(os.path.join(out, name, "MediaStore.ts"), "w", encoding="utf-8").write("\n".join(mutated))
    sys.stdout.write(f"### {name}: {stage} line {i + 1}\n")
    sys.stdout.writelines(
        difflib.unified_diff(
            [l + "\n" for l in lines], [l + "\n" for l in mutated], f"a/{stage}/MediaStore.ts", f"b/{name}/MediaStore.ts", n=1
        )
    )
