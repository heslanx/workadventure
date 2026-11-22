/**
 * The only module that drives a browser for the frame gate. What it reads goes through the pure helpers
 * (signals.ts, recording.ts), which have the unit tests: nothing here is covered by a test that runs a browser.
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { Browser, BrowserContext, BrowserType, CDPSession, Page } from "@playwright/test";
import type { BrowserOptions, FramesConfig } from "./args";
import { enterRoomAsGuest } from "./entry";
import type { ScheduledRun } from "./matrix";
import { parseRecording, phaseMeasurement, type Recording } from "./recording";
import {
    kibPerSecond,
    payloadBytes,
    pixelsPerGameUnit,
    summarizeLongTasks,
    summarizeRates,
    waitForStableValue,
    type LongTaskEntry,
    type Point,
    type TimedBytes,
} from "./signals";
import type { PhaseMeasurement, SessionMeasurement, View } from "./types";

/** The part of @playwright/test the probe uses. */
export interface PlaywrightModule {
    readonly chromium: BrowserType;
}

/** The keys the client reads: `konclui.fx.off` (browserEffectsPort.ts) and `avatarDetailBudget` (AvatarDetail.ts). */
const FX_OFF_KEY = "konclui.fx.off";
const DETAIL_BUDGET_KEY = "avatarDetailBudget";
/** Two game points this far apart on x give the zoom scale; any distance works, a long one reads more precisely. */
const SCALE_BASELINE = 1000;

interface ProbeHooks {
    getRendererInfo?(): { renderer: string };
    startFrameRecording(): void;
    stopFrameRecording(): unknown;
    gameToBrowserCoordinates(point: Point, options?: { timeoutMs?: number }): Promise<Point>;
}

interface ProbeWindow {
    e2eHooks?: ProbeHooks;
    __frameProbe?: { supported: boolean; tasks: LongTaskEntry[]; observer?: PerformanceObserver };
}

export async function loadPlaywright(directory: string | undefined): Promise<PlaywrightModule> {
    try {
        if (directory !== undefined) {
            return createRequire(resolve(directory, "package.json"))("@playwright/test") as PlaywrightModule;
        }
        return await import("@playwright/test");
    } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `could not load @playwright/test${directory === undefined ? "" : ` from ${directory}`}: ${reason}. ` +
                "Run npm install at the repository root, or pass --playwright-dir=<a package that has it>.",
            { cause: error },
        );
    }
}

export type BrowserChannel = "chromium" | "chrome";

/**
 * Playwright's own Chromium by default. FRAME_PROBE_BROWSER_CHANNEL=chrome runs the Google Chrome installed on the
 * machine instead, for a host where Playwright's browser is not downloaded. Any other value stops the run.
 */
export function browserChannel(value: string | undefined = process.env.FRAME_PROBE_BROWSER_CHANNEL): BrowserChannel {
    if (value === undefined || value === "" || value === "chromium") return "chromium";
    if (value === "chrome") return "chrome";
    throw new Error(`FRAME_PROBE_BROWSER_CHANNEL must be "chromium" or "chrome", got "${value}"`);
}

/** A GPU Chromium (the full build, new headless) or the headless shell on SwiftShader, as the earlier probes were run. */
export function launchOptions(
    options: BrowserOptions,
    channel: BrowserChannel = browserChannel(),
): {
    headless: true;
    channel?: BrowserChannel;
    args: string[];
} {
    if (options.renderer === "swiftshader") {
        return { headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
    }
    return {
        headless: true,
        channel,
        args: [
            ...(options.angle === undefined ? [] : [`--use-angle=${options.angle}`]),
            "--enable-gpu",
            "--ignore-gpu-blocklist",
        ],
    };
}

export async function launchBrowser(playwright: PlaywrightModule, options: BrowserOptions): Promise<Browser> {
    return playwright.chromium.launch(launchOptions(options));
}

export interface Measurer {
    readonly browserVersion: string;
    measure(run: ScheduledRun): Promise<SessionMeasurement>;
    close(): Promise<void>;
}

export interface MeasurerOptions {
    /** Where the screenshots of each phase go; none are taken without it. */
    readonly screenshotDir: string | undefined;
    readonly log: (line: string) => void;
}

export async function createBrowserMeasurer(config: FramesConfig, options: MeasurerOptions): Promise<Measurer> {
    const playwright = await loadPlaywright(config.browser.playwrightDir);
    const browser = await launchBrowser(playwright, config.browser);
    return {
        browserVersion: browser.version(),
        measure: (run) => measureSession(browser, config, run, options),
        close: () => browser.close(),
    };
}

/** Page side, before any script of the page: the A/B flags of the condition and a buffer of long tasks. */
async function installProbe(context: BrowserContext, run: ScheduledRun): Promise<void> {
    // tsx compiles with esbuild's keepNames, which wraps some inner functions in a __name() helper that exists in Node
    // and not in the page: with this, a callback sent to page.evaluate cannot fail on it
    await context.addInitScript("globalThis.__name = (target) => target;");
    await context.addInitScript(
        ({ fxOff, detailBudget, fxKey, budgetKey }) => {
            // Only the top document of the room: not an iframe, and not about:blank, which has no localStorage
            if (window !== window.top || !location.protocol.startsWith("http")) {
                return;
            }
            if (fxOff) {
                localStorage.setItem(fxKey, "1");
            } else {
                localStorage.removeItem(fxKey);
            }
            localStorage.setItem(budgetKey, detailBudget ? "1" : "0");
            const probe: NonNullable<ProbeWindow["__frameProbe"]> = {
                supported:
                    typeof PerformanceObserver !== "undefined" &&
                    PerformanceObserver.supportedEntryTypes.includes("longtask"),
                tasks: [],
            };
            (window as unknown as ProbeWindow).__frameProbe = probe;
            if (probe.supported) {
                probe.observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        probe.tasks.push({ startTime: entry.startTime, duration: entry.duration });
                    }
                });
                probe.observer.observe({ type: "longtask", buffered: true });
            }
        },
        {
            fxOff: run.condition.fx === "off",
            detailBudget: run.condition.detailBudget === "on",
            fxKey: FX_OFF_KEY,
            budgetKey: DETAIL_BUDGET_KEY,
        },
    );
}

/** The condition really applied: what the client will read is what the run says it measured. */
async function assertFlagsApplied(page: Page, run: ScheduledRun): Promise<void> {
    const stored = await page.evaluate(
        ([fxKey, budgetKey]) => ({ fx: localStorage.getItem(fxKey), budget: localStorage.getItem(budgetKey) }),
        [FX_OFF_KEY, DETAIL_BUDGET_KEY],
    );
    const expected = {
        fx: run.condition.fx === "off" ? "1" : null,
        budget: run.condition.detailBudget === "on" ? "1" : "0",
    };
    if (stored.fx !== expected.fx || stored.budget !== expected.budget) {
        throw new Error(
            `the condition was not applied: localStorage holds ${JSON.stringify(stored)}, expected ${JSON.stringify(expected)}`,
        );
    }
}

async function readRenderer(page: Page): Promise<string> {
    return page.evaluate(() => {
        const actual = (window as ProbeWindow).e2eHooks?.getRendererInfo?.();
        if (actual) return actual.renderer;
        const gl = document.createElement("canvas").getContext("webgl");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        return gl !== null && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });
}

async function assertRecorder(page: Page): Promise<void> {
    const present = await page.evaluate(() => {
        const hooks = (window as unknown as ProbeWindow).e2eHooks;
        return typeof hooks?.startFrameRecording === "function" && typeof hooks.stopFrameRecording === "function";
    });
    if (!present) {
        throw new Error("window.e2eHooks has no startFrameRecording: the client behind this URL has no frame recorder");
    }
}

interface RecordedWindow {
    readonly recording: Recording;
    /** On the page clock, as the long-task entries are. */
    readonly startMs: number;
    readonly endMs: number;
}

/** One recording of `seconds`; `during` runs inside it right after it starts (the wheel events of the zoom step). */
async function record(page: Page, seconds: number, during?: () => Promise<void>): Promise<RecordedWindow> {
    const startMs = await page.evaluate(() => {
        const hooks = (window as unknown as ProbeWindow).e2eHooks;
        if (!hooks) {
            throw new Error("window.e2eHooks disappeared");
        }
        hooks.startFrameRecording();
        return performance.now();
    });
    await during?.();
    await page.waitForTimeout(seconds * 1000);
    const stopped = await page.evaluate(() => {
        const hooks = (window as unknown as ProbeWindow).e2eHooks;
        if (!hooks) {
            throw new Error("window.e2eHooks disappeared");
        }
        return { recording: hooks.stopFrameRecording(), endMs: performance.now() };
    });
    return { recording: parseRecording(stopped.recording), startMs, endMs: stopped.endMs };
}

/** `.username-display` is the DOM name tag of an avatar (UsernameDisplay.ts); the local player's own is counted too. */
async function countNameTags(page: Page): Promise<{ present: number; shown: number }> {
    return page.evaluate(() => {
        const tags = [...document.querySelectorAll(".username-display")];
        return { present: tags.length, shown: tags.filter((tag) => tag.getClientRects().length > 0).length };
    });
}

/**
 * WebSocket bytes through CDP, in a window of their own. Every frame event copies its payload (base64 for a binary
 * one) on the page's main thread, so it is switched on only between recordings, never inside one.
 */
async function sampleWebSocket(cdp: CDPSession, page: Page, seconds: number) {
    const received: TimedBytes[] = [];
    const sent: TimedBytes[] = [];
    const onReceived = (event: { response: { opcode: number; payloadData: string } }) =>
        received.push({
            atMs: performance.now(),
            bytes: payloadBytes(event.response.opcode, event.response.payloadData),
        });
    const onSent = (event: { response: { opcode: number; payloadData: string } }) =>
        sent.push({ atMs: performance.now(), bytes: payloadBytes(event.response.opcode, event.response.payloadData) });
    await cdp.send("Network.enable");
    cdp.on("Network.webSocketFrameReceived", onReceived);
    cdp.on("Network.webSocketFrameSent", onSent);
    const startMs = performance.now();
    await page.waitForTimeout(seconds * 1000);
    const endMs = performance.now();
    cdp.off("Network.webSocketFrameReceived", onReceived);
    cdp.off("Network.webSocketFrameSent", onSent);
    await cdp.send("Network.disable");
    return {
        rx: summarizeRates(kibPerSecond(received, startMs, endMs)),
        tx: summarizeRates(kibPerSecond(sent, startMs, endMs)),
    };
}

/** CSS pixels per game pixel now, or null while the camera is still moving (the hook refuses a moving camera). */
async function readScale(page: Page): Promise<number | null> {
    try {
        const points = await page.evaluate(async (baseline) => {
            const hooks = (window as unknown as ProbeWindow).e2eHooks;
            if (!hooks) {
                throw new Error("window.e2eHooks disappeared");
            }
            const origin = await hooks.gameToBrowserCoordinates({ x: 0, y: 0 }, { timeoutMs: 1000 });
            const along = await hooks.gameToBrowserCoordinates({ x: baseline, y: 0 }, { timeoutMs: 1000 });
            return { origin, along };
        }, SCALE_BASELINE);
        return pixelsPerGameUnit(points.origin, points.along, SCALE_BASELINE);
    } catch (error: unknown) {
        if (error instanceof Error && error.message.includes("stable browser coordinates")) {
            return null;
        }
        throw error;
    }
}

function settledScale(page: Page, timeoutMs: number): Promise<number> {
    return waitForStableValue(() => readScale(page), {
        intervalMs: 250,
        stableSamples: 3,
        tolerance: 0.005,
        timeoutMs,
        sleep: (ms) => page.waitForTimeout(ms),
        now: () => Date.now(),
    });
}

async function drainLongTasks(page: Page): Promise<LongTaskEntry[] | null> {
    return page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__frameProbe;
        if (!probe?.supported) {
            return null;
        }
        // Entries the browser queued but did not deliver yet would be lost otherwise
        for (const entry of probe.observer?.takeRecords() ?? []) {
            probe.tasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
        return probe.tasks;
    });
}

interface RawPhase {
    readonly recorded: RecordedWindow;
    readonly nameTags: { present: number; shown: number };
    readonly ws: Awaited<ReturnType<typeof sampleWebSocket>> | null;
}

async function measureSession(
    browser: Browser,
    config: FramesConfig,
    run: ScheduledRun,
    options: MeasurerOptions,
): Promise<SessionMeasurement> {
    const context = await browser.newContext({ viewport: config.viewport, locale: config.browser.locale });
    try {
        await installProbe(context, run);
        const page = await context.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(String(error)));

        await enterRoomAsGuest(page, config.url, { name: config.name });
        await assertFlagsApplied(page, run);
        await assertRecorder(page);
        await page.waitForTimeout(config.settleSeconds * 1000);
        const renderer = await readRenderer(page);
        const cdp = await context.newCDPSession(page);
        const label = `run${run.index}-fx-${run.condition.fx}-budget-${run.condition.detailBudget}`;

        const finishPhase = async (view: View, recorded: RecordedWindow): Promise<RawPhase> => {
            const ws = config.wsSampleSeconds > 0 ? await sampleWebSocket(cdp, page, config.wsSampleSeconds) : null;
            // Counted last: a crowd that leaves during the WebSocket window is still seen by an expectation on it
            const nameTags = await countNameTags(page);
            if (options.screenshotDir !== undefined) {
                await page.screenshot({ path: join(options.screenshotDir, `${label}-${view}.png`) });
            }
            return { recorded, nameTags, ws };
        };

        const raw: Partial<Record<View, RawPhase>> = {};
        if (config.views.includes("default")) {
            raw.default = await finishPhase("default", await record(page, config.recordSeconds));
        }

        let zoom: SessionMeasurement["zoom"] = null;
        if (config.views.includes("wholeMap")) {
            const defaultScale = await settledScale(page, 15_000);
            const canvas = await page.locator("#game canvas").boundingBox();
            if (canvas === null) {
                throw new Error("#game canvas has no box: nothing to zoom");
            }
            // The wheel reaches the game only over the canvas, not over the dock or the side panel on top of it
            await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
            // The zoom step is a recording that starts with the wheel: the avatar rebuilds it causes are its frames
            const zoomWindow = await record(page, config.zoomWindowSeconds, async () => {
                for (let event = 0; event < config.wheelEvents; event++) {
                    await page.mouse.wheel(0, config.wheelDelta);
                }
            });
            raw.zoom = { recorded: zoomWindow, nameTags: await countNameTags(page), ws: null };
            const wholeMapScale = await settledScale(page, 15_000);
            zoom = { defaultScale, wholeMapScale };
            // The detail budget recomputes 150 ms after the zoom settles and every 250 ms (AvatarDetail.ts)
            await page.waitForTimeout(config.zoomSettleSeconds * 1000);
            raw.wholeMap = await finishPhase("wholeMap", await record(page, config.recordSeconds));
        }

        const tasks = await drainLongTasks(page);
        const phases: Partial<Record<View, PhaseMeasurement>> = {};
        for (const [view, phase] of Object.entries(raw) as [View, RawPhase][]) {
            phases[view] = phaseMeasurement({
                recording: phase.recorded.recording,
                longTasks:
                    tasks === null ? null : summarizeLongTasks(tasks, phase.recorded.startMs, phase.recorded.endMs),
                nameTags: phase.nameTags,
                ws: phase.ws,
            });
        }
        return { phases, renderer, zoom, pageErrors };
    } finally {
        await context.close();
    }
}
