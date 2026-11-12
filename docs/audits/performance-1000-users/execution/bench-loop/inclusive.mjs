// Inclusive (self + callees) time of the frames whose function name matches, for a V8 .cpuprofile.
// usage: node inclusive.mjs <file.cpuprofile> <name regex>
import { readFileSync } from "node:fs";
const [file, pattern] = process.argv.slice(2);
const profile = JSON.parse(readFileSync(file, "utf8"));
const re = new RegExp(pattern);
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const total = profile.timeDeltas.reduce((a, b) => a + b, 0);
const inclusive = new Map();
for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i + 1] ?? 0;
    const seen = new Set();
    for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) {
        const f = byId.get(id).callFrame;
        const key = `${f.functionName || "(anonymous)"}  ${f.url.replace(/^file:\/\/\/usr\/src\/app\//, "")}:${f.lineNumber + 1}`;
        if (!re.test(f.functionName) || seen.has(key)) continue;
        seen.add(key);
        inclusive.set(key, (inclusive.get(key) ?? 0) + delta);
    }
}
for (const [key, micros] of [...inclusive].sort((a, b) => b[1] - a[1])) console.log(`${((micros / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
