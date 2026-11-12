// Prints the top self-time frames of a V8 .cpuprofile, aggregated by function, file and line.
// usage: node topframes.mjs <file.cpuprofile> [count]
import { readFileSync } from "node:fs";

const [file, countArg] = process.argv.slice(2);
const profile = JSON.parse(readFileSync(file, "utf8"));
const count = Number(countArg ?? 25);
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const selfMicros = new Map();
for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i + 1] ?? 0;
    selfMicros.set(profile.samples[i], (selfMicros.get(profile.samples[i]) ?? 0) + delta);
}
const total = [...selfMicros.values()].reduce((a, b) => a + b, 0);
const frames = new Map();
for (const [id, micros] of selfMicros) {
    const { callFrame } = byId.get(id);
    const url = callFrame.url.replace(/^file:\/\/\/usr\/src\/app\//, "").replace(/\?.*$/, "");
    const key = `${callFrame.functionName || "(anonymous)"}  ${url}:${callFrame.lineNumber + 1}`;
    frames.set(key, (frames.get(key) ?? 0) + micros);
}
const idle = [...frames].filter(([k]) => k.startsWith("(idle)")).reduce((a, [, v]) => a + v, 0);
console.log(`profile ${((profile.endTime - profile.startTime) / 1e6).toFixed(1)} s, busy ${(((total - idle) / total) * 100).toFixed(1)}% of samples`);
for (const [key, micros] of [...frames].sort((a, b) => b[1] - a[1]).slice(0, count)) {
    console.log(`${((micros / total) * 100).toFixed(2).padStart(6)}%  ${(micros / 1000).toFixed(0).padStart(7)} ms  ${key}`);
}
