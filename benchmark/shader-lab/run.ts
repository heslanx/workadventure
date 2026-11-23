/**
 * The shader lab's driver. From benchmark/:
 *   npx tsx shader-lab/run.ts <built map dir> --out <dir> [--hour 19.3] [--camera x,y,zoom] [--people x,y;x,y...]
 *       [--flag key=value ...] [--preset reception|lounge|entrance|floor-lamps|overview|all]
 *
 * It bundles lab.ts with the runtime's real shader source in memory (esbuild), launches the installed Google Chrome
 * through Playwright, serves the page and the built map with page.route (no server process), runs the lab in the page
 * and writes the pictures and the JSON. Any shader that does not compile stops the run with the driver's message.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadPlaywright } from "../frame-probe/browser";
import { parseArgs, UsageError, type LabConfig } from "./args";
import { contentType, frameCandidates, presetsToRun, safeJoin } from "./files";
import { PRESETS, presetNames, resolveHour } from "./model";
import type { LabRequest, LabResult } from "./lab";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const DOMAIN = join(REPO, "play", "src", "front", "Konclui", "Ambience", "domain");
const ORIGIN = "https://lab.test";

/** Runtime modules the lab uses when they exist (plan 1d): [file, the export it reads]. */
const OPTIONAL_MODULES: readonly [string, readonly string[]][] = [
    ["lightUniforms", ["lightUniformsInto"]],
    ["keyLight", ["keyLightAt", "newKeyLight"]],
    ["shadeUniforms", ["shadeUniformsInto", "newShadeUniforms"]],
    ["shadeBake", ["bakeCast", "newCastBuffer", "lampCasters", "SHADOW_FLOOR_PX", "SHADOW_CAP_PX"]],
    ["shadeShapes", ["silhouetteOf", "hasPaintedShadow", "lengthScale"]],
    ["casterKind", ["classifyPiece"]],
    ["lamps", ["casterLampsFrom"]],
    [
        "personShadow",
        [
            "personShadowFrames",
            "pickPersonShadow",
            "newPersonShadow",
            "stampFrameAt",
            "STAMP_SIZE",
            "STAMP_ATLAS_WIDTH",
            "STAMP_COLOUR",
        ],
    ],
];

/** Bundles the page: lab.ts plus the shaders and whichever optional runtime modules are in the tree. */
export async function bundlePage(): Promise<{ code: string; present: string[] }> {
    const present = OPTIONAL_MODULES.filter(([file]) => existsSync(join(DOMAIN, `${file}.ts`))).map(([file]) => file);
    const imports = present
        .map((file) => `import * as m_${file} from ${JSON.stringify(join(DOMAIN, file))};`)
        .join("\n");
    const hooks = OPTIONAL_MODULES.filter(([file]) => present.includes(file))
        .flatMap(([file, names]) => names.map((name) => `${name}: m_${file}.${name}`))
        .join(", ");
    const entry = `
import { install } from ${JSON.stringify(join(HERE, "lab"))};
import * as shaders from ${JSON.stringify(join(DOMAIN, "shaders"))};
${imports}
install({ shaders: shaders as unknown as Record<string, unknown>, hooks: { ${hooks} }, present: ${JSON.stringify(present)} });
`;
    const result = await build({
        stdin: { contents: entry, resolveDir: HERE, loader: "ts", sourcefile: "lab-entry.ts" },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "es2022",
        logLevel: "silent",
        sourcemap: "inline",
    });
    return { code: result.outputFiles[0].text, present };
}

function requestFor(config: LabConfig, preset: string, frameUrl: string | null, selfTest: boolean): LabRequest {
    const chosen = PRESETS[preset];
    const camera = config.camera ?? chosen.camera;
    return {
        base: `${ORIGIN}/dist`,
        frameUrl,
        hour: resolveHour(config.hour, config.flags),
        camera: { ...camera },
        size: config.size,
        people: config.people ?? chosen.people,
        flags: config.flags,
        gl: config.gl,
        timing: config.timing,
        timingDraws: config.timingDraws,
        timingSize: config.timingSize,
        onShader: config.onShader ? readFileSync(config.onShader, "utf8") : null,
        offShader: config.offShader ? readFileSync(config.offShader, "utf8") : null,
        clouds: config.clouds,
        selfTest,
        unmarked: config.unmarked,
        shimmer: config.shimmer,
    };
}

function write(dir: string, result: LabResult): void {
    mkdirSync(dir, { recursive: true });
    for (const [name, base64] of Object.entries(result.files))
        writeFileSync(join(dir, name), Buffer.from(base64, "base64"));
    const { timing, compile, ...stats } = result.json as Record<string, unknown> & {
        timing?: unknown;
        compile?: unknown;
    };
    writeFileSync(join(dir, "stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
    writeFileSync(
        join(dir, "timing.json"),
        `${JSON.stringify({ timing: timing ?? "skipped (--no-timing)", compile }, null, 2)}\n`,
    );
    writeFileSync(join(dir, "log.txt"), `${result.log.join("\n")}\n`);
}

function summary(preset: string, dir: string, json: Record<string, unknown>): string[] {
    const lines = [`${preset}: ${dir}`];
    const variants = json.variants as Record<string, Record<string, number | string | null>>;
    for (const [id, v] of Object.entries(variants)) {
        lines.push(
            `  ${id.padEnd(13)} changed ${(Number(v.changedShare) * 100).toFixed(2)}%  max delta ${v.maxDelta}  rug px ${v.rugChanged}  flat-normal px ${v.flatPropChanged}  wall/water/facade px ${v.wallWaterFacadeChanged}  ${v.label}`,
        );
    }
    const lampShadow = (json.acceptance as { lampShadow?: Record<string, unknown> } | undefined)?.lampShadow;
    if (lampShadow) {
        const verdict =
            lampShadow.meets === null ? "n/a (no lamp with casters in view)" : lampShadow.meets ? "ok" : "FAILS";
        lines.push(
            `  acceptance: lamp shadow >= ${Number(lampShadow.minShare) * 100}% of the window and delta >= ${Number(lampShadow.minDelta)}: ${verdict}`,
        );
    }
    interface Acceptance {
        reliefLit?: {
            correlation: number | null;
            minCorrelation: number;
            covered: number;
            lightShare: number | null;
            minLightShare: number;
            meets: boolean | null;
        };
        peopleLampSide?: { checked: number; meets: boolean | null };
        shadowCoverage?: Record<
            "stand" | "top",
            { inWindow: number; visible: number; without: { key: string; reason: string }[] }
        >;
        shimmer?: { rows: { zoom: number; scroll: number; off: number; on: number }[]; meets: boolean };
        unmarkedPeopleTakeNoRelief?: { people: number; listed: number; meets: boolean | null };
    }
    const acceptance = (json.acceptance ?? {}) as Acceptance;
    const verdict = (meets: boolean | null | undefined): string =>
        meets === null || meets === undefined ? "n/a" : meets ? "ok" : "FAILS";
    const relief = acceptance.reliefLit;
    if (relief)
        lines.push(
            `  acceptance: relief lit from the lamp side (correlation ${(relief.correlation ?? Number.NaN).toFixed(2)} >= ${relief.minCorrelation} over ${relief.covered} px, ${((relief.lightShare ?? 0) * 100).toFixed(0)}% not darker >= ${relief.minLightShare * 100}%): ${verdict(relief.meets)}`,
        );
    const side = acceptance.peopleLampSide;
    if (side)
        lines.push(
            `  acceptance: people near a lamp lit on its side (${side.checked} checked): ${verdict(side.meets)}`,
        );
    if (acceptance.shadowCoverage) {
        for (const kind of ["stand", "top"] as const) {
            const c = acceptance.shadowCoverage[kind];
            const reasons = c.without
                .map((g) => `${g.key.split("/").pop() ?? g.key} (${g.reason})`)
                .slice(0, 4)
                .join(", ");
            lines.push(
                `  acceptance: ${kind} pieces with a shadow that shows: ${c.visible} of ${c.inWindow}${reasons ? `; without: ${reasons}` : ""}`,
            );
        }
    }
    if (acceptance.shimmer) {
        const rows = acceptance.shimmer.rows.map((r) => `z${r.zoom}+${r.scroll}: ${r.on}/${r.off}`).join("  ");
        lines.push(`  acceptance: shimmer, on within the slack of off: ${verdict(acceptance.shimmer.meets)} (${rows})`);
    }
    const crowd = acceptance.unmarkedPeopleTakeNoRelief;
    if (crowd)
        lines.push(
            `  acceptance: unmarked people take no relief (${crowd.people} drawn, ${crowd.listed} listed): ${verdict(crowd.meets)}`,
        );
    for (const skipped of (json.skippedElements as { id: string; reason: string }[]) ?? [])
        lines.push(`  ${skipped.id}: skipped (${skipped.reason})`);
    const timing = json.timing as Record<string, Record<string, unknown>> | undefined;
    for (const [context, t] of Object.entries(timing ?? {})) {
        const rows =
            (t.rows as
                | {
                      variant: string;
                      samples: { median: number; p99: number; count: number } | null;
                      roundMedians?: number[];
                  }[]
                | undefined) ?? [];
        const valid = t.valid === false ? " (INVALID: software renderer)" : "";
        if (typeof t.error === "string") lines.push(`  ${context}: ${t.error}`);
        else if (t.gpuTimer !== "ok")
            lines.push(
                `  ${context}: gpuTimer unavailable (${typeof t.reason === "string" ? t.reason : "no samples"})`,
            );
        else {
            lines.push(`  ${context} ${String(t.renderer)}${valid} at ${String(t.size)}:`);
            for (const row of rows) {
                lines.push(
                    row.samples
                        ? `    ${row.variant.padEnd(6)} median ${row.samples.median.toFixed(3)} ms  p99 ${row.samples.p99.toFixed(3)} ms  (${row.samples.count} samples; round medians ${(row.roundMedians ?? []).map((m) => m.toFixed(2)).join(" / ")})`
                        : `    ${row.variant.padEnd(6)} no samples`,
                );
            }
        }
    }
    return lines;
}

export async function main(argv: readonly string[]): Promise<number> {
    let config: LabConfig;
    try {
        config = parseArgs(argv);
    } catch (error: unknown) {
        if (error instanceof UsageError) {
            console.error(error.message);
            return 64;
        }
        throw error;
    }
    if (config.listPresets) {
        for (const name of presetNames()) {
            const preset = PRESETS[name];
            console.log(
                `${name.padEnd(12)} ${preset.camera.x},${preset.camera.y},${preset.camera.zoom}  ${preset.note}`,
            );
        }
        return 0;
    }
    if (config.phaser)
        return (await import("./phaser-probe")).runPhaserProbe(config.out, config.gl === 2, config.channel);
    const dist = resolve(config.dist);
    if (!existsSync(join(dist, "fx", "manifest.json"))) {
        console.error(`${dist} has no fx/manifest.json: give the directory of a built map`);
        return 66;
    }
    const names = presetsToRun(config.preset);
    let frameFile: string | null = null;
    if (config.frame === "map") frameFile = frameCandidates(dist).find((path) => existsSync(path)) ?? null;
    else if (config.frame !== "compose") {
        frameFile = resolve(config.frame);
        if (!existsSync(frameFile)) {
            console.error(`--frame ${frameFile} does not exist`);
            return 66;
        }
    }
    if (config.flags["konclui.fx.off"] === "1")
        console.error("note: konclui.fx.off=1 is ignored; the lab always draws the pass");
    const { code, present } = await bundlePage();
    const playwright = await loadPlaywright(undefined);
    const browser = await playwright.chromium.launch({
        headless: true,
        channel: config.channel,
        args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
    });
    let exit = 0;
    try {
        const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
        const page = await context.newPage();
        page.on("console", (message) => {
            if (message.type() === "error" || message.type() === "warning")
                console.error(`[page ${message.type()}] ${message.text()}`);
        });
        page.on("pageerror", (error) => console.error(`[page error] ${error.message}`));
        await page.route(`${ORIGIN}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            let file: string | null = null;
            if (path === "/index.html")
                return route.fulfill({
                    status: 200,
                    contentType: "text/html",
                    body: readFileSync(join(HERE, "lab.html")),
                });
            if (path === "/lab.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: code });
            if (path === "/frame.png" && frameFile !== null) file = frameFile;
            else if (path.startsWith("/dist/")) file = safeJoin(dist, path.slice("/dist".length));
            if (file === null || !existsSync(file)) return route.fulfill({ status: 404, body: `not found: ${path}` });
            return route.fulfill({ status: 200, contentType: contentType(file), body: readFileSync(file) });
        });
        await page.goto(`${ORIGIN}/index.html`);
        await page.waitForFunction(() => "runLab" in window);
        const several = names.length > 1;
        for (const [index, name] of names.entries()) {
            const request = requestFor(config, name, frameFile === null ? null : `${ORIGIN}/frame.png`, index === 0);
            let result: LabResult;
            try {
                result = await page.evaluate(
                    (r) => (window as unknown as { runLab: (q: typeof r) => Promise<LabResult> }).runLab(r),
                    request,
                );
            } catch (error: unknown) {
                console.error(
                    `the lab failed on preset "${name}":\n${error instanceof Error ? error.message : String(error)}`,
                );
                return 1;
            }
            const dir = several ? join(resolve(config.out), name) : resolve(config.out);
            write(dir, result);
            console.log(summary(name, dir, result.json).join("\n"));
            const self = result.json.selfTest as { pass: boolean } | undefined;
            if (self && !self.pass) {
                console.error(`SELF-TEST FAILED: ${JSON.stringify(result.json.selfTest)}`);
                exit = 2;
            } else if (self) console.log("  self-test: ok (texture orientation, camera pass, legacy POST twice)");
            if (index === 0)
                console.log(`  optional runtime modules found: ${present.length === 0 ? "none" : present.join(", ")}`);
        }
    } finally {
        await browser.close();
    }
    return exit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        },
    );
}
