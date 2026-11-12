// Runs inside a stack container (docker exec -i ... node --input-type=module - < cdp-prof.mjs).
// Attaches to the dev-mode inspector on 127.0.0.1:9229 and writes a CPU profile of PROFILE_SECONDS.
import { writeFileSync } from "node:fs";

const seconds = Number(process.env.PROFILE_SECONDS ?? 20);
const out = process.env.PROFILE_OUT ?? "/tmp/profile.cpuprofile";
const targets = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const target = targets.find((t) => t.type === "node") ?? targets[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
    }
};
const call = (method, params = {}) =>
    new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});
await call("Profiler.enable");
await call("Profiler.setSamplingInterval", { interval: 1000 });
await call("Profiler.start");
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const stopped = await call("Profiler.stop");
writeFileSync(out, JSON.stringify(stopped.result.profile));
console.log(`profiled ${target.title} for ${seconds}s -> ${out}`);
ws.close();
