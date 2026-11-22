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
import { GATE1, measureGate1, phaserModeProblem, runGate1Report, type Gate1Session } from "./gate1";

/** The keys the client reads for a synthetic-crowd measurement; every one is default-off in the shipping build. */
export const GATE1_STORAGE: Readonly<Record<string, string>> = {
    // Opens the page to the synthetic crowd (E2E_BENCH_KEY in play/src/front/Utils/E2EHooks.ts)
    "konclui.e2e.bench": "1",
    // The engine changes that ship behind a flag until a real run measures them
    avatarDetailBudget: "1",
    avatarZeroWork: "1",
    avatarBake: "1",
    // The night-lit preview, which loads the normal map with the map (browserEffectsPort.ts)
    "konclui.fx.rim": "1",
};

/** The part of window.e2eHooks (play/src/front/Utils/E2EHooks.ts) this module calls. */
interface HqHooks {
    sizeBenchToViewport(): Promise<void>;
    getRendererInfo(): unknown;
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

export async function runGate1(config: Gate1Config, outDir: string, log: (line: string) => void): Promise<number> {
    mkdirSync(outDir, { recursive: true });
    const playwright = await loadPlaywright(config.browser.playwrightDir);
    // Phaser's default context is WebGL 1 and the gate is defined on WebGL 2, which phaserMode=webgl2 asks for
    // explicitly (App.svelte) and refuses to run without
    const url = new URL(config.url);
    url.searchParams.set("phaserMode", "webgl2");
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
        }, GATE1_STORAGE);
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
        return await runGate1Report(
            () => measureGate1(sessionOn(page, outDir), { settleMs: config.settleSeconds * 1000, log }),
            (fileName, content) => writeFileSync(join(outDir, fileName), content),
            log,
            // What the numbers were measured with: the flags the page ran under and the URL it ended on (after any
            // redirect of the room), so that a later number can be tied to its configuration
            () => ({ engine: { storage: GATE1_STORAGE, requestedUrl: url.href, finalUrl: page.url() } }),
        );
    } finally {
        await browser.close();
    }
}
