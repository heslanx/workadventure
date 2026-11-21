/**
 * The side panel pass: whether the panel opens by itself once per room on a wide screen only, closes on Escape, gives
 * the focus back to the control that opened it, and whether the people and chat buttons toggle it.
 */
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import type { PanelConfig, Viewport } from "./args";
import { launchBrowser, loadPlaywright } from "./browser";
import { enterRoomAsGuest } from "./entry";

/** The shell's wide breakpoint: the people panel opens by itself, once per room, from this width up. */
const WIDE_BREAKPOINT = 768;

export interface PanelCheck {
    readonly name: string;
    readonly ok: boolean;
    readonly detail: string;
}

const panelOpen = (page: Page): Promise<boolean | undefined> =>
    page.evaluate(() => document.querySelector(".konclui")?.classList.contains("panel-open"));

// Escape closes the panel when the focus is in it: put the focus on its first control
const focusInPanel = (page: Page): Promise<boolean> =>
    page.evaluate(() => {
        const first = document
            .querySelector(".konclui aside")
            ?.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
        if (first instanceof HTMLElement) {
            first.focus();
        }
        return first instanceof HTMLElement && document.activeElement === first;
    });

async function checkViewport(browser: Browser, url: string, viewport: Viewport, config: PanelConfig, outDir: string) {
    const { width } = viewport;
    const results: PanelCheck[] = [];
    const check = (name: string, ok: boolean, detail = "") => results.push({ name: `${width}: ${name}`, ok, detail });

    const page = await browser.newPage({ viewport, locale: config.browser.locale });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    try {
        await enterRoomAsGuest(page, url, { name: `Painel${width}` });
        await page.waitForTimeout(1500);

        const opened = await panelOpen(page);
        await page.screenshot({ path: join(outDir, `panel-${width}-arrival.png`) });
        check("arrival", width >= WIDE_BREAKPOINT ? opened === true : opened === false, `panel-open=${opened}`);

        const people =
            width < WIDE_BREAKPOINT
                ? page.locator(".people-slot button.people-pill")
                : page.locator("nav.rail button[aria-pressed]").first();
        if (opened) {
            const focused = await focusInPanel(page);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            check("Escape closes", (await panelOpen(page)) === false, `focus-in-panel=${focused}`);
        }
        if (await people.isVisible()) {
            await people.focus();
            await page.keyboard.press("Enter");
            await page.waitForTimeout(400);
            check("people button opens", (await panelOpen(page)) === true);
            await page.screenshot({ path: join(outDir, `panel-${width}-people.png`) });
            await focusInPanel(page);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(400);
            const focusBack = await people.evaluate((element) => element === document.activeElement);
            check(
                "Escape returns focus to the opener",
                (await panelOpen(page)) === false && focusBack,
                `focus=${focusBack}`,
            );
        } else {
            check("people button visible", false);
        }
        if (width >= WIDE_BREAKPOINT) {
            const chat = page.locator("nav.rail button[aria-pressed]").nth(1);
            await chat.click();
            await page.waitForTimeout(500);
            check("chat button opens the conversation", (await chat.getAttribute("aria-pressed")) === "true");
            await chat.click();
            await page.waitForTimeout(400);
            check("chat button closes it", (await panelOpen(page)) === false);
        }
        check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    } finally {
        await page.close();
    }
    return results;
}

export async function runPanel(config: PanelConfig, outDir: string, log: (line: string) => void): Promise<number> {
    const playwright = await loadPlaywright(config.browser.playwrightDir);
    const browser = await launchBrowser(playwright, config.browser);
    const results: PanelCheck[] = [];
    try {
        for (const viewport of config.viewports) {
            results.push(...(await checkViewport(browser, config.url, viewport, config, outDir)));
        }
    } finally {
        await browser.close();
    }
    for (const result of results) {
        log(`${result.ok ? "pass" : "FAIL"}: ${result.name}${result.detail === "" ? "" : ` (${result.detail})`}`);
    }
    const failed = results.filter((result) => !result.ok);
    log(failed.length === 0 ? "ALL PASS" : `${failed.length} of ${results.length} checks failed`);
    log(`screenshots in ${outDir}`);
    return failed.length === 0 ? 0 : 1;
}
