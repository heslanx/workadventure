// Usage: node analyze.mjs results/run1.json results/run2.json ...
// Paired per-replay time ratios B/A and A2/A (same rotation round, adjacent in time), per run and across runs.
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
const runs = files.map((file) => ({ file, data: JSON.parse(readFileSync(file, "utf8")) }));
const scenarios = Object.keys(runs[0].data.scenarios);
const pairs = [
    ["B", "A"],
    ["A2", "A"],
    ["B", "A2"],
];

const sorted = (values) => [...values].sort((a, b) => a - b);
function quantile(values, q) {
    const s = sorted(values);
    const position = (s.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return s[low] + (s[high] - s[low]) * (position - low);
}
const median = (values) => quantile(values, 0.5);
const fmt = (value, digits = 3) => value.toFixed(digits);

// Mann-Whitney U, normal approximation with tie correction; returns the two-sided p value.
function mannWhitney(x, y) {
    const all = [...x.map((v) => [v, 0]), ...y.map((v) => [v, 1])].sort((a, b) => a[0] - b[0]);
    const ranks = new Array(all.length);
    let tieTerm = 0;
    for (let i = 0; i < all.length; ) {
        let j = i;
        while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
        const rank = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) ranks[k] = rank;
        const t = j - i + 1;
        tieTerm += t ** 3 - t;
        i = j + 1;
    }
    let rankSumX = 0;
    all.forEach(([, group], index) => {
        if (group === 0) rankSumX += ranks[index];
    });
    const n1 = x.length;
    const n2 = y.length;
    const n = n1 + n2;
    const u = rankSumX - (n1 * (n1 + 1)) / 2;
    const mean = (n1 * n2) / 2;
    const sd = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
    const z = (u - mean) / sd;
    const erfc = (v) => {
        const t = 1 / (1 + 0.5 * Math.abs(v));
        const r =
            t *
            Math.exp(
                -v * v -
                    1.26551223 +
                    t *
                        (1.00002368 +
                            t *
                                (0.37409196 +
                                    t *
                                        (0.09678418 +
                                            t *
                                                (-0.18628806 +
                                                    t *
                                                        (0.27886807 +
                                                            t *
                                                                (-1.13520398 +
                                                                    t * (1.48851499 + t * (-0.82215223 + t * 0.17087277)))))))),
            );
        return v >= 0 ? r : 2 - r;
    };
    return { z, p: erfc(Math.abs(z) / Math.SQRT2) };
}

let problems = 0;
for (const { file, data } of runs) {
    const order = data.implementations.map(({ label }) => label).join(",");
    console.log(`# ${file} node=${data.node} load order=${order}`);
}
console.log("");

for (const scenario of scenarios) {
    const pooled = Object.fromEntries(pairs.map(([x, y]) => [`${x}/${y}`, []]));
    const perRun = Object.fromEntries(pairs.map(([x, y]) => [`${x}/${y}`, []]));
    const ns = { A: [], A2: [], B: [] };
    const bytes = { A: [], A2: [], B: [] };
    const lines = [];
    for (const [runIndex, { data }] of runs.entries()) {
        const s = data.scenarios[scenario];
        const impl = s.implementations;
        const traces = new Set(Object.values(impl).map((i) => i.behavior.traceSha256));
        const hits = new Set(Object.values(impl).map((i) => i.behavior.hits));
        if (traces.size !== 1 || hits.size !== 1) {
            problems++;
            lines.push(`  run${runIndex + 1} TRACE OR HIT MISMATCH`);
        }
        for (const label of ["A", "A2", "B"]) {
            ns[label].push(impl[label].nsPerUpdate.median);
            bytes[label].push(impl[label].bytesPerUpdate.median);
        }
        const cells = [];
        for (const [x, y] of pairs) {
            const ratios = impl[x].raw.nsPerUpdate.map((value, round) => value / impl[y].raw.nsPerUpdate[round]);
            pooled[`${x}/${y}`].push(...ratios);
            perRun[`${x}/${y}`].push(median(ratios));
            cells.push(`${x}/${y}=${fmt(median(ratios))}`);
        }
        lines.push(
            `  run${runIndex + 1} ${cells.join(" ")}  ns med A=${Math.round(impl.A.nsPerUpdate.median)} A2=${Math.round(impl.A2.nsPerUpdate.median)} B=${Math.round(impl.B.nsPerUpdate.median)}  hit=${(impl.A.behavior.hitRatio * 100).toFixed(1)}% trace=${[...traces][0].slice(0, 12)}`,
        );
    }
    console.log(`## ${scenario}`);
    for (const line of lines) console.log(line);
    for (const key of Object.keys(perRun)) {
        const values = perRun[key];
        console.log(
            `  ${key.padEnd(5)} per-run medians: median=${fmt(median(values))} min=${fmt(Math.min(...values))} max=${fmt(Math.max(...values))} | pooled replays n=${pooled[key].length} median=${fmt(median(pooled[key]))} p10=${fmt(quantile(pooled[key], 0.1))} p90=${fmt(quantile(pooled[key], 0.9))}`,
        );
    }
    const byPosition = [[], [], []];
    for (const { data } of runs) {
        const impl = data.scenarios[scenario].implementations;
        const labels = data.implementations.map(({ label }) => label);
        const mean = labels.reduce((total, label) => total + impl[label].nsPerUpdate.median, 0) / labels.length;
        labels.forEach((label, position) => byPosition[position].push(impl[label].nsPerUpdate.median / mean));
    }
    console.log(
        `  load position (label ns median / mean of the 3 labels, median over runs): 1st=${fmt(median(byPosition[0]))} 2nd=${fmt(median(byPosition[1]))} 3rd=${fmt(median(byPosition[2]))}`,
    );
    const test = mannWhitney(pooled["B/A"], pooled["A2/A"]);
    console.log(`  rank-sum pooled B/A vs A2/A: z=${fmt(test.z, 2)} p=${fmt(test.p, 3)}`);
    console.log(
        `  ns/update median of run medians: A=${Math.round(median(ns.A))} A2=${Math.round(median(ns.A2))} B=${Math.round(median(ns.B))}  B/update median: A=${Math.round(median(bytes.A))} A2=${Math.round(median(bytes.A2))} B=${Math.round(median(bytes.B))}`,
    );
    console.log("");
}
console.log("| Scenario | Pair | " + runs.map((_, index) => `run ${index + 1}`).join(" | ") + " | median | min to max |");
console.log("|---|---|" + runs.map(() => "---|").join("") + "---|---|");
for (const scenario of scenarios) {
    for (const [x, y] of pairs.slice(0, 2)) {
        const values = runs.map(({ data }) => {
            const impl = data.scenarios[scenario].implementations;
            return median(impl[x].raw.nsPerUpdate.map((value, round) => value / impl[y].raw.nsPerUpdate[round]));
        });
        console.log(
            `| ${scenario} | ${x}/${y} | ${values.map((value) => fmt(value)).join(" | ")} | ${fmt(median(values))} | ${fmt(Math.min(...values))} to ${fmt(Math.max(...values))} |`,
        );
    }
}
console.log("");
console.log(problems === 0 ? "traces and hit counts identical for A, A2, B in every scenario and run" : `PROBLEMS=${problems}`);
