/**
 * The screenshot walkthrough of the QA passes: the entry, the office and every tab of the settings, one screenshot per
 * step, and with a reference build each step side by side. It reads the two builds by their own markup, which is why
 * the selectors below differ by side.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import type { CompareConfig, Viewport } from "./args";
import { launchBrowser, loadPlaywright } from "./browser";
import { enterRoomAsGuest } from "./entry";

export type Side = "native" | "reference";

export interface Shot {
    /** The step without its label: "1-login", "5-settings-02". The native and the reference pair on it. */
    readonly key: string;
    readonly label: string;
    readonly path: string;
}

export function shotFileName(side: Side, width: number, shot: Pick<Shot, "key" | "label">): string {
    return `${side}-${width}-${shot.key}${shot.label === "" ? "" : `-${shot.label}`}.png`;
}

export interface ShotPair {
    readonly key: string;
    readonly native: Shot;
    readonly reference: Shot;
}

/** Steps both sides took, in the native's order, and the steps only one side has (a tab one build does not show). */
export function pairShots(
    native: readonly Shot[],
    reference: readonly Shot[],
): { pairs: ShotPair[]; unmatched: { side: Side; key: string }[] } {
    const referenceByKey = new Map(reference.map((shot) => [shot.key, shot]));
    const nativeKeys = new Set(native.map((shot) => shot.key));
    const pairs = native.flatMap((shot): ShotPair[] => {
        const other = referenceByKey.get(shot.key);
        return other === undefined ? [] : [{ key: shot.key, native: shot, reference: other }];
    });
    return {
        pairs,
        unmatched: [
            ...native
                .filter((shot) => !referenceByKey.has(shot.key))
                .map((shot) => ({ side: "native" as const, key: shot.key })),
            ...reference
                .filter((shot) => !nativeKeys.has(shot.key))
                .map((shot) => ({ side: "reference" as const, key: shot.key })),
        ],
    };
}

function dataUri(path: string): string {
    return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}

/** The two screenshots next to each other, native on the left, each under its name. */
export function sideBySideHtml(native: string, reference: string): string {
    const cell = (title: string, source: string) =>
        `<figure style="margin:0"><figcaption style="font:600 14px sans-serif;padding:6px">${title}</figcaption><img src="${source}" style="display:block"></figure>`;
    return `<body style="margin:0;display:flex;gap:8px;background:#888">${cell("native", native)}${cell("reference", reference)}</body>`;
}

async function walk(
    browser: Browser,
    side: Side,
    url: string,
    viewport: Viewport,
    outDir: string,
    locale: string,
): Promise<{ shots: Shot[]; errors: string[] }> {
    const page = await browser.newPage({ viewport, locale });
    const shots: Shot[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const shoot = async (key: string, label = "") => {
        const path = join(outDir, shotFileName(side, viewport.width, { key, label }));
        await page.screenshot({ path });
        shots.push({ key, label, path });
    };
    // A screenshot waits for the entry animation of the step to end
    const onStep = async (step: "login" | "woka" | "camera") => {
        await page.waitForTimeout(800);
        await shoot({ login: "1-login", woka: "2-woka", camera: "3-camera" }[step]);
    };
    try {
        await enterRoomAsGuest(page, url, { name: "Comparacao", onStep });
        await page.waitForTimeout(5000);
        await shoot("4-office");
        await walkSettings(page, side, shoot, errors);
    } finally {
        await page.close();
    }
    return { shots, errors };
}

/** The settings, opened from the rail's gear on both sides, one screenshot per tab. */
async function walkSettings(
    page: Page,
    side: Side,
    shoot: (key: string, label?: string) => Promise<void>,
    errors: string[],
): Promise<void> {
    const gear = side === "native" ? page.locator("nav.rail button.settings") : page.locator('[data-rail="settings"]');
    if ((await gear.count()) === 0) {
        errors.push(`${side}: no settings gear found`);
        return;
    }
    await gear.first().click();
    await page.waitForTimeout(800);
    const tabs = side === "native" ? page.locator('[role="tab"]') : page.locator(".kmh-set-tab");
    const count = await tabs.count();
    for (let index = 0; index < count; index++) {
        const tab = tabs.nth(index);
        const label = ((await tab.innerText()) || `tab${index}`)
            .trim()
            .split("\n")[0]
            .replace(/[^\p{L}\p{N}]+/gu, "-");
        await tab.click();
        await page.waitForTimeout(500);
        await shoot(`5-settings-${String(index).padStart(2, "0")}`, label);
    }
    await page.keyboard.press("Escape");
}

export async function runCompare(config: CompareConfig, outDir: string, log: (line: string) => void): Promise<number> {
    const playwright = await loadPlaywright(config.browser.playwrightDir);
    const browser = await launchBrowser(playwright, config.browser);
    const problems: string[] = [];
    try {
        for (const viewport of config.viewports) {
            const native = await walk(browser, "native", config.url, viewport, outDir, config.browser.locale);
            problems.push(...native.errors);
            log(`native ${viewport.width}x${viewport.height}: ${native.shots.length} screenshots`);
            if (config.referenceUrl === undefined) {
                continue;
            }
            const reference = await walk(
                browser,
                "reference",
                config.referenceUrl,
                viewport,
                outDir,
                config.browser.locale,
            );
            problems.push(...reference.errors);
            log(`reference ${viewport.width}x${viewport.height}: ${reference.shots.length} screenshots`);

            const { pairs, unmatched } = pairShots(native.shots, reference.shots);
            problems.push(...unmatched.map((step) => `${step.side} has a step the other side lacks: ${step.key}`));
            const page = await browser.newPage();
            try {
                for (const pair of pairs) {
                    await page.setViewportSize({ width: viewport.width * 2 + 8, height: viewport.height + 40 });
                    await page.setContent(sideBySideHtml(dataUri(pair.native.path), dataUri(pair.reference.path)));
                    const path = join(outDir, `side-by-side-${viewport.width}-${pair.key}.png`);
                    await page.screenshot({ path });
                    log(path);
                }
            } finally {
                await page.close();
            }
        }
    } finally {
        await browser.close();
    }
    for (const problem of problems) {
        log(`problem: ${problem}`);
    }
    log(`screenshots in ${outDir}`);
    return problems.length === 0 ? 0 : 1;
}
