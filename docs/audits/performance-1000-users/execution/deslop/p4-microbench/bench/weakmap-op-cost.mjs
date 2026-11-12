// Cost of the cache bookkeeping that the deslop edit changes, per reconciled viewport, outside PositionDispatcher.
// boxed (A):  get the box, clear its field, (reconcile), write a new rectangle into the field.
// direct (B): get the rectangle, delete the entry, (reconcile), set a new rectangle.
// Usage: node --expose-gc weakmap-op-cost.mjs
const ITERATIONS = 2_000_000;
const ROUNDS = 10;

function makeKeys(count) {
    return Array.from({ length: count }, (_, id) => ({ id }));
}

function boxed(map, keys) {
    let checksum = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        const key = keys[i % keys.length];
        let box = map.get(key);
        if (box !== undefined && box.reconciled !== undefined) checksum += box.reconciled.n;
        if (box === undefined) {
            box = { reconciled: undefined };
            map.set(key, box);
        } else {
            box.reconciled = undefined;
        }
        box.reconciled = { n: i & 1 };
    }
    return checksum;
}

function direct(map, keys) {
    let checksum = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        const key = keys[i % keys.length];
        const reconciled = map.get(key);
        if (reconciled !== undefined) checksum += reconciled.n;
        map.delete(key);
        map.set(key, { n: i & 1 });
    }
    return checksum;
}

const median = (values) => {
    const s = [...values].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const sockets of [1, 1000]) {
    const keys = makeKeys(sockets);
    const maps = { boxed: new WeakMap(), direct: new WeakMap() };
    const fns = { boxed, direct };
    const ns = { boxed: [], direct: [] };
    const checks = { boxed: 0, direct: 0 };
    for (const name of ["boxed", "direct"]) fns[name](maps[name], keys); // warmup
    for (let round = 0; round < ROUNDS; round++) {
        for (const name of round % 2 ? ["direct", "boxed"] : ["boxed", "direct"]) {
            globalThis.gc?.();
            const start = process.hrtime.bigint();
            checks[name] += fns[name](maps[name], keys);
            ns[name].push(Number(process.hrtime.bigint() - start) / ITERATIONS);
        }
    }
    const b = median(ns.boxed);
    const d = median(ns.direct);
    console.log(
        `sockets=${sockets} ns/op median boxed=${b.toFixed(1)} direct=${d.toFixed(1)} delta=${(d - b).toFixed(1)} ` +
            `range boxed=${Math.min(...ns.boxed).toFixed(1)}-${Math.max(...ns.boxed).toFixed(1)} ` +
            `direct=${Math.min(...ns.direct).toFixed(1)}-${Math.max(...ns.direct).toFixed(1)} ` +
            `checksums equal=${checks.boxed === checks.direct}`,
    );
}
