// Reads a profile written by inspector-profile.mjs and prints where the busy main-thread time went.
//
//   node profile-summary.mjs <profile json> [function name ...]
//
// Self time is grouped by kind of work: the pusher's own JavaScript, its dependencies, Node's internals, the garbage
// collector, native code called from JavaScript (the uWebSockets addon and V8 builtins) and native code outside it
// (the uWebSockets loop, syscalls, libuv). For each function name given, the inclusive time of every function of that
// name is printed too, one line per place it is defined: its own time plus everything it calls.
import { readFileSync } from "node:fs";

const [, , file, ...functionNames] = process.argv;
if (file === undefined) {
    console.error("usage: node profile-summary.mjs <profile json> [function name ...]");
    process.exit(1);
}
const { profile, before, after } = JSON.parse(readFileSync(file, "utf8"));

const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parentOf = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parentOf.set(child, node.id);

const selfMicroseconds = new Map();
profile.samples.forEach((nodeId, index) => {
    selfMicroseconds.set(nodeId, (selfMicroseconds.get(nodeId) ?? 0) + profile.timeDeltas[index]);
});

const IDLE = "idle";
const ROOT = "root";
const GARBAGE = "garbage collector";
function kindOf({ functionName, url }) {
    if (functionName === "(idle)") return IDLE;
    if (functionName === "(root)") return ROOT;
    if (functionName === "(garbage collector)") return GARBAGE;
    if (functionName === "(program)") return "native outside JS (uWebSockets loop, syscalls, libuv)";
    if (url === "") return "native called from JS (addon and V8 builtins)";
    if (url.startsWith("node:")) return "JavaScript: Node internals";
    if (url.includes("/node_modules/")) return "JavaScript: dependencies";
    return "JavaScript: pusher code";
}

function placeOf({ url, lineNumber }) {
    const where = url.split("/node_modules/").pop().split("/usr/src/").pop();
    return where ? `${where}:${lineNumber + 1}` : "";
}

const byKind = new Map();
const byFunction = new Map();
const inclusive = new Map();
let total = 0;
for (const [nodeId, microseconds] of selfMicroseconds) {
    const frame = nodes.get(nodeId).callFrame;
    const kind = kindOf(frame);
    total += microseconds;
    byKind.set(kind, (byKind.get(kind) ?? 0) + microseconds);
    const label = `${frame.functionName || "(anonymous)"}  ${placeOf(frame)}  [${kind.split(":")[0].split(" (")[0]}]`;
    byFunction.set(label, { kind, microseconds: (byFunction.get(label)?.microseconds ?? 0) + microseconds });
    // Each function on the stack gets the sample once, however often it recurs. Two functions that share a name are
    // two functions: the place tells them apart.
    const seen = new Set();
    for (let current = nodeId; current !== undefined; current = parentOf.get(current)) {
        const { callFrame } = nodes.get(current);
        const place = placeOf(callFrame);
        const key = `${callFrame.functionName}  ${place}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const places = inclusive.get(callFrame.functionName) ?? new Map();
        places.set(place, (places.get(place) ?? 0) + microseconds);
        inclusive.set(callFrame.functionName, places);
    }
}

const busy = total - (byKind.get(IDLE) ?? 0) - (byKind.get(ROOT) ?? 0);
const seconds = (microseconds) => (microseconds / 1e6).toFixed(2);
const share = (microseconds) => `${((microseconds / busy) * 100).toFixed(1).padStart(5)} %`;
const sorted = (map, value = (entry) => entry) => [...map].sort((a, b) => value(b[1]) - value(a[1]));

const wallSeconds = (after.at - before.at) / 1000;
const userSeconds = (after.cpu.user - before.cpu.user) / 1e6;
const systemSeconds = (after.cpu.system - before.cpu.system) / 1e6;
const cpuSeconds = userSeconds + systemSeconds;
const loopActive = after.elu.active - before.elu.active;
const loopIdle = after.elu.idle - before.elu.idle;
console.log(
    `wall ${wallSeconds.toFixed(1)} s, process CPU ${cpuSeconds.toFixed(1)} s (${((cpuSeconds / wallSeconds) * 100).toFixed(0)} % of a core; user ${userSeconds.toFixed(1)} s, system ${systemSeconds.toFixed(1)} s)`,
);
console.log(
    `event loop utilization ${((loopActive / (loopActive + loopIdle)) * 100).toFixed(0)} %, RSS ${(after.rss / 1e6).toFixed(0)} MB`,
);
console.log(
    `profile: ${seconds(total)} s sampled on the main thread, ${seconds(busy)} s busy (${((busy / total) * 100).toFixed(0)} %)`,
);

console.log("\nshare of the busy main-thread time:");
let javascript = 0;
for (const [kind, microseconds] of sorted(byKind)) {
    if (kind === IDLE || kind === ROOT) continue;
    if (kind.startsWith("JavaScript")) javascript += microseconds;
    console.log(`  ${share(microseconds)}  ${seconds(microseconds).padStart(7)} s  ${kind}`);
}
const garbage = byKind.get(GARBAGE) ?? 0;
console.log(
    `\nJavaScript self time: ${((javascript / busy) * 100).toFixed(1)} % of busy; with the garbage collector: ${(((javascript + garbage) / busy) * 100).toFixed(1)} %`,
);

console.log("\ntop 25 functions by self time:");
sorted(byFunction, (entry) => entry.microseconds)
    .filter(([, entry]) => entry.kind !== IDLE && entry.kind !== ROOT)
    .slice(0, 25)
    .forEach(([label, entry]) => console.log(`  ${share(entry.microseconds)}  ${label}`));

if (functionNames.length > 0) {
    console.log("\ninclusive time (the function and everything it calls):");
    for (const name of functionNames) {
        const places = inclusive.get(name);
        if (places === undefined) console.log(`  ${share(0)}  ${name}  (not in the profile)`);
        else
            for (const [place, microseconds] of sorted(places))
                console.log(`  ${share(microseconds)}  ${name}  ${place || "(native)"}`);
    }
}
