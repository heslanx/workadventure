// Usage: node profile-top.mjs <file.cpuprofile> [count]
// Self time per function (sample count share), largest first.
import { readFileSync } from "node:fs";

const [file, countArg] = process.argv.slice(2);
const profile = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const self = new Map();
let total = 0;
for (const id of profile.samples) {
    const { callFrame } = byId.get(id);
    const key = `${callFrame.functionName || "(anonymous)"} ${callFrame.url.split("/").slice(-2).join("/")}:${callFrame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + 1);
    total++;
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(countArg ?? 15));
console.log(`samples=${total}`);
for (const [key, samples] of top) {
    console.log(`${((samples / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
}
