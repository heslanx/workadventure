/**
 * The browser half of Gate 1: one Chromium on a real GPU, one guest in the HQ office, the page's e2eHooks driven through
 * `Gate1Session`. The sequence and the judgement are in gate1.ts, which has the tests: nothing here is covered by a test
 * that runs a browser.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Gate1Config } from "./args";
import { launchBrowser, loadPlaywright } from "./browser";
import { enterRoomAsGuest } from "./entry";
import {
    Gate1InvalidRun,
    GATE1,
    measureGate1,
    phaserModeProblem,
    runGate1Report,
    type Gate1Context,
    type Gate1Session,
    type Gate1Setup,
} from "./gate1";

/**
 * The keys a gate run sets. The three avatar flags (avatarDetailBudget, avatarZeroWork, avatarBake) are on by default in
 * the client since the 2026-11-22 run, so a normal run sets none of them and measures what ships.
 */
export const GATE1_STORAGE: Readonly<Record<string, string>> = {
    // Opens the page to the synthetic crowd (E2E_BENCH_KEY in play/src/front/Utils/E2EHooks.ts)
    "konclui.e2e.bench": "1",
    // The night-lit preview, which loads the normal map with the map (browserEffectsPort.ts)
    "konclui.fx.rim": "1",
};

/** The avatar flags a baseline turns off: "0" is the value each of them reads as off (the client's default is on). */
export const GATE1_BASELINE_STORAGE: Readonly<Record<string, string>> = {
    avatarDetailBudget: "0",
    avatarZeroWork: "0",
    avatarBake: "0",
};

/**
 * Keys a `--flag` may not set: the two the gate sets itself, and the one it removes (the effects' kill switch, which
 * would turn the scene the gate names off).
 */
export const GATE1_RESERVED_KEYS: readonly string[] = [...Object.keys(GATE1_STORAGE), "konclui.fx.off"];

/**
 * The URL the page is opened at. WebGL 2 is forced with `?phaserMode=webgl2` (App.svelte; a client without that case
 * throws at start, which phaserModeProblem names). The default context forces nothing, and refuses a URL that does:
 * a `phaserMode` there would make the run a WebGL 2 or canvas run labelled as the default one.
 */
export function gate1Url(roomUrl: string, context: Gate1Context): URL {
    const url = new URL(roomUrl);
    if (context === "webgl2") {
        url.searchParams.set("phaserMode", "webgl2");
        return url;
    }
    // App.svelte reads the query first and the hash (`#phaserMode=canvas`) when the query has none: both force a renderer
    const forced = url.searchParams.get("phaserMode") ?? new URLSearchParams(url.hash.slice(1)).get("phaserMode");
    if (forced !== null) {
        throw new Error(
            `--context=default must not force a renderer, and the URL carries phaserMode=${forced}: remove it from the URL`,
        );
    }
    return url;
}

/**
 * The storage a run starts with. FRAME_PROBE_GATE1_BASELINE=1 adds the three avatar flags forced off ("0") to the keys of
 * a normal run, so the same command measures the layered avatars with no budget, no zero-work states and no bake: the
 * "before" of a comparison, with the same scene and lights. `flags` (`--flag=KEY=VALUE`) go on top, to measure the flags
 * of a change without editing the probe. The report records which keys the page ran with.
 */
export function gate1Storage(
    baseline: string | undefined = process.env.FRAME_PROBE_GATE1_BASELINE,
    flags: Readonly<Record<string, string>> = {},
): Record<string, string> {
    const reserved = Object.keys(flags).filter((key) => GATE1_RESERVED_KEYS.includes(key));
    if (reserved.length > 0) {
        throw new Error(`--flag cannot set ${reserved.join(", ")}: the gate sets or clears that key itself`);
    }
    if (baseline !== undefined && baseline !== "" && baseline !== "0" && baseline !== "1") {
        // "true" or "yes" must not quietly give a normal run, which would be taken for the "before" of a comparison
        throw new Error(`FRAME_PROBE_GATE1_BASELINE is "${baseline}": use 1 for the baseline, or leave it empty or 0`);
    }
    if (baseline === "1") return { ...GATE1_STORAGE, ...GATE1_BASELINE_STORAGE, ...flags };
    return { ...GATE1_STORAGE, ...flags };
}

const AVATAR_FLAGS = ["avatarDetailBudget", "avatarZeroWork", "avatarBake"] as const;

/**
 * What the page says the three avatar flags are, against what the run is meant to measure: all on for a normal run (the
 * shipping defaults), all off for a baseline. A normal run sets no avatar key, so a client built before the defaults
 * changed would measure the layered avatars under the same storage as a correct run; the page's own answer catches it.
 */
export function avatarFlagProblems(reported: unknown, baseline: boolean): string[] {
    const wanted = !baseline;
    if (typeof reported !== "object" || reported === null) {
        return [
            "the client does not report its avatar flags (window.e2eHooks.getAvatarFlags), so the run cannot say what it measured",
        ];
    }
    const flags = reported as Record<string, unknown>;
    return AVATAR_FLAGS.filter((name) => flags[name] !== wanted).map(
        (name) =>
            `${name} is ${String(flags[name])} in the page, and a ${baseline ? "baseline" : "normal"} run needs it ${wanted ? "on" : "off"}`,
    );
}

/** The part of window.e2eHooks (play/src/front/Utils/E2EHooks.ts) this module calls. */
interface HqHooks {
    sizeBenchToViewport(): Promise<void>;
    getRendererInfo(): unknown;
    getAvatarFlags?(): unknown;
    spawnSyntheticCrowd(count: number): Promise<unknown>;
    clearSyntheticCrowd(): Promise<unknown>;
    setBenchNight(level: number | null): unknown;
    captureFrameBench(): Promise<unknown>;
    panCamera(dx: number, dy: number, ms: number): Promise<boolean>;
    releaseCameraPan(): void;
}

/** Installed in the page before its scripts: the hooks, or an error that says what is missing. */
const BRIDGE = `globalThis.__gate1Hooks = () => {
    const hooks = window.e2eHooks;
    if (!hooks) throw new Error("window.e2eHooks is missing: the client behind this URL has no frame bench");
    return hooks;
};`;

interface Bridge {
    __gate1Hooks(): HqHooks;
}

function sessionOn(page: Page, outDir: string): Gate1Session {
    return {
        rendererInfo: () => page.evaluate(() => (globalThis as unknown as Bridge).__gate1Hooks().getRendererInfo()),
        spawnCrowd: (count) =>
            page.evaluate((n) => (globalThis as unknown as Bridge).__gate1Hooks().spawnSyntheticCrowd(n), count),
        setNight: (level) =>
            page.evaluate((l) => (globalThis as unknown as Bridge).__gate1Hooks().setBenchNight(l), level),
        wait: (ms) => page.waitForTimeout(ms),
        captureWindow: () => page.evaluate(() => (globalThis as unknown as Bridge).__gate1Hooks().captureFrameBench()),
        pan: (dx, dy, ms) =>
            page.evaluate(([x, y, t]) => (globalThis as unknown as Bridge).__gate1Hooks().panCamera(x, y, t), [
                dx,
                dy,
                ms,
            ] as const),
        releasePan: () => page.evaluate(() => (globalThis as unknown as Bridge).__gate1Hooks().releaseCameraPan()),
        screenshot: async (name) => {
            const path = join(outDir, `${name}.png`);
            await page.screenshot({ path });
            return path;
        },
        clearCrowd: () =>
            page.evaluate(async () => {
                await (globalThis as unknown as Bridge).__gate1Hooks().clearSyntheticCrowd();
            }),
    };
}

/** How far the drawing buffer is from the gate's size, in each dimension: what the window has to grow by. */
export function missingBuffer(
    buffer: { width: number; height: number },
    wanted: { width: number; height: number } = GATE1.viewport,
): { width: number; height: number } {
    return { width: Math.max(0, wanted.width - buffer.width), height: Math.max(0, wanted.height - buffer.height) };
}

/**
 * The gate is defined on a 1920x1080 drawing buffer. An office shell draws the game in a frame smaller than the window
 * (a side panel, a gutter), so a 1920x1080 window gives a smaller buffer: the window grows by what the frame takes, at
 * most three times, and the size it ended at is in the report.
 */
async function growWindowToDrawingBuffer(
    page: Page,
    log: (line: string) => void,
): Promise<{ width: number; height: number }> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const buffer = await page.evaluate(() => {
            const info = (globalThis as unknown as Bridge).__gate1Hooks().getRendererInfo() as {
                width?: number;
                height?: number;
            };
            return { width: info.width ?? 0, height: info.height ?? 0 };
        });
        const missing = missingBuffer(buffer);
        if (missing.width === 0 && missing.height === 0) break;
        const current = page.viewportSize() ?? GATE1.viewport;
        const next = { width: current.width + missing.width, height: current.height + missing.height };
        log(
            `the game is drawn in a ${buffer.width}x${buffer.height} frame: the window grows to ${next.width}x${next.height}`,
        );
        await page.setViewportSize(next);
        await page.waitForTimeout(1500);
        await page.evaluate(() => (globalThis as unknown as Bridge).__gate1Hooks().sizeBenchToViewport());
    }
    return page.viewportSize() ?? GATE1.viewport;
}

export async function runGate1(config: Gate1Config, outDir: string, log: (line: string) => void): Promise<number> {
    mkdirSync(outDir, { recursive: true });
    const playwright = await loadPlaywright(config.browser.playwrightDir);
    // Phaser's default context is WebGL 1 and the gate is defined on WebGL 2, which phaserMode=webgl2 asks for
    // explicitly (App.svelte) and refuses to run without; --context=default leaves the choice to the client
    const url = gate1Url(config.url, config.context);
    // Before the browser: a FRAME_PROBE_GATE1_BASELINE or a --flag that means nothing stops the run here
    const storage = gate1Storage(undefined, config.flags);
    const baseline = process.env.FRAME_PROBE_GATE1_BASELINE === "1";
    const setup: Gate1Setup = { context: config.context, flags: config.flags };
    const browser = await launchBrowser(playwright, config.browser);
    try {
        const context = await browser.newContext({
            viewport: GATE1.viewport,
            deviceScaleFactor: 1,
            locale: config.browser.locale,
        });
        // tsx compiles with keepNames, whose __name() helper exists in Node and not in the page
        await context.addInitScript("globalThis.__name = (target) => target;");
        await context.addInitScript(BRIDGE);
        await context.addInitScript((storage) => {
            if (window !== window.top || !location.protocol.startsWith("http")) return;
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
            localStorage.removeItem("konclui.fx.off");
        }, storage);
        const page = await context.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        try {
            await enterRoomAsGuest(page, url.href, { name: config.name });
        } catch (error: unknown) {
            // A client without the ?phaserMode=webgl2 case throws at start and never shows the room: say so
            const problem = phaserModeProblem(pageErrors);
            throw problem ? new Error(problem, { cause: error }) : error;
        }
        await page.evaluate(() => (globalThis as unknown as Bridge).__gate1Hooks().sizeBenchToViewport());
        const windowSize = await growWindowToDrawingBuffer(page, log);
        let avatarFlags: unknown;
        return await runGate1Report(
            async () => {
                avatarFlags = await page.evaluate(() =>
                    (globalThis as unknown as Bridge).__gate1Hooks().getAvatarFlags?.(),
                );
                const problems = avatarFlagProblems(avatarFlags, baseline);
                if (problems.length > 0) throw new Gate1InvalidRun(problems.join("; "));
                return measureGate1(sessionOn(page, outDir), { settleMs: config.settleSeconds * 1000, log, setup });
            },
            (fileName, content) => writeFileSync(join(outDir, fileName), content),
            log,
            // What the numbers were measured with: the storage the page started with, the avatar flags it reported, the
            // URL it ended on (after any redirect of the room) and the window, so that a later number can be tied to its
            // configuration
            () => ({
                engine: { storage, avatarFlags, requestedUrl: url.href, finalUrl: page.url(), window: windowSize },
            }),
            setup,
        );
    } finally {
        await browser.close();
    }
}
