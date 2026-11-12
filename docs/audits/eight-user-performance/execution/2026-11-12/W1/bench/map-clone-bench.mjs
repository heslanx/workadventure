// W1 H08 micro-measurement: cost of the deep copy GameScene.onMapLoad makes (structuredClone of the parsed map).
// Dependency-free; run with host node: node map-clone-bench.mjs <map.json> [iterations]
import { readFileSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [, , mapPath, iterArg] = process.argv;
if (!mapPath) {
    console.error("usage: node map-clone-bench.mjs <map.json> [iterations]");
    process.exit(2);
}
const iterations = Number(iterArg ?? 30);
const bytes = statSync(mapPath).size;
const data = JSON.parse(readFileSync(mapPath, "utf8"));
const layers = Array.isArray(data.layers) ? data.layers.length : 0;
const tilesets = Array.isArray(data.tilesets) ? data.tilesets.length : 0;

for (let i = 0; i < 5; i++) structuredClone(data);

const samples = [];
let sink = 0;
for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const copy = structuredClone(data);
    samples.push(performance.now() - start);
    sink += copy.width ?? 0;
}
samples.sort((a, b) => a - b);
const pick = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
const before = process.memoryUsage().heapUsed;
const held = structuredClone(data);
const heapDeltaBytes = process.memoryUsage().heapUsed - before;
console.log(
    JSON.stringify({
        map: mapPath,
        fileBytes: bytes,
        width: data.width,
        height: data.height,
        layers,
        tilesets,
        iterations,
        cloneMedianMs: Number(pick(0.5).toFixed(3)),
        cloneP95Ms: Number(pick(0.95).toFixed(3)),
        cloneMaxMs: Number(samples[samples.length - 1].toFixed(3)),
        heapDeltaBytesOneCopy: heapDeltaBytes,
        node: process.version,
        sink: sink + (held.width ?? 0) > -1,
    }),
);
