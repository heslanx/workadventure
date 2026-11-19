// Records a CPU profile of the running pusher through its inspector, with no restart and no start flag.
//
//   node inspector-profile.mjs <start delay s> <record s> <out file>
//
// Run it inside the container of the pusher, as the user the pusher runs as. It finds the pusher process, opens its
// inspector with SIGUSR1 (127.0.0.1:9229, reachable from inside the container only), waits the delay, records, writes
// { before, after, profile } and closes the inspector again. `before` and `after` hold process.cpuUsage(), the event
// loop utilization and the RSS at the two ends of the recording. Read the result with profile-summary.mjs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [, , delayArg, secondsArg, out] = process.argv;
const delaySeconds = Number(delayArg);
const recordSeconds = Number(secondsArg);
if (!Number.isFinite(delaySeconds) || !Number.isFinite(recordSeconds) || recordSeconds <= 0 || out === undefined) {
    console.error("usage: node inspector-profile.mjs <start delay s> <record s> <out file>");
    process.exit(1);
}

const INSPECTOR_LIST = "http://127.0.0.1:9229/json/list";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** The node process that runs the pusher's bootstrap through the tsx loader (the tsx launcher has no loader argument). */
function pusherPid() {
    for (const entry of readdirSync("/proc")) {
        if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
        let cmdline;
        try {
            cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
        } catch (error) {
            // The process ended between the listing and the read, or belongs to another user: it is not the pusher.
            if (error.code === "ENOENT" || error.code === "ESRCH" || error.code === "EACCES") continue;
            throw error;
        }
        const runsBootstrap = cmdline.some((argument) => argument.endsWith("bootstrap.ts"));
        const throughLoader = cmdline.some((argument) => argument.includes("tsx/dist/loader"));
        if (basename(cmdline[0] ?? "") === "node" && runsBootstrap && throughLoader) return Number(entry);
    }
    return undefined;
}

async function inspectorTargets() {
    try {
        return await (await fetch(INSPECTOR_LIST)).json();
    } catch (error) {
        // Refused: the inspector is not open (yet). Any other failure is reported by the caller's timeout.
        if (error.cause?.code === "ECONNREFUSED") return undefined;
        throw error;
    }
}

let targets = await inspectorTargets();
if (targets === undefined) {
    const pid = pusherPid();
    if (pid === undefined) throw new Error("no pusher process found (a node process running bootstrap.ts through tsx)");
    process.kill(pid, "SIGUSR1");
    for (let attempt = 0; attempt < 50 && targets === undefined; attempt++) {
        await sleep(100);
        targets = await inspectorTargets();
    }
    if (targets === undefined) throw new Error(`the inspector of process ${pid} did not open within 5 s of SIGUSR1`);
}

const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("the inspector socket did not open")), { once: true });
});
let nextId = 0;
const waiting = new Map();
socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const settle = waiting.get(message.id);
    if (settle === undefined) return;
    waiting.delete(message.id);
    if (message.error) settle.reject(new Error(JSON.stringify(message.error)));
    else settle.resolve(message.result);
});
const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
        const id = ++nextId;
        waiting.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
const usage = async () =>
    JSON.parse(
        await evaluate(
            "JSON.stringify({ cpu: process.cpuUsage(), elu: performance.eventLoopUtilization(), rss: process.memoryUsage().rss, at: Date.now() })",
        ),
    );

await sleep(delaySeconds * 1000);
await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 1000 });
const before = await usage();
await send("Profiler.start");
await sleep(recordSeconds * 1000);
const { profile } = await send("Profiler.stop");
const after = await usage();
writeFileSync(out, JSON.stringify({ before, after, profile }));
// Leave the pusher as it was found: the inspector closes after this answer is sent.
await evaluate('setTimeout(() => process.getBuiltinModule("node:inspector").close(), 200); "closing"');
socket.close();
console.log(
    JSON.stringify({
        recordedSeconds: (after.at - before.at) / 1000,
        nodes: profile.nodes.length,
        samples: profile.samples.length,
        out,
    }),
);
