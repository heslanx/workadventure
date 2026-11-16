// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    getPermissionHelpBrowser,
    getPermissionHelpScreenshot,
} from "../../../../src/front/Components/HelpSettings/permissionHelp";

const CHROME =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const SAFARI =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

function stubUserAgent(userAgent: string): void {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

describe("getPermissionHelpBrowser", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        { userAgent: CHROME, browser: "chrome" },
        { userAgent: FIREFOX, browser: "firefox" },
        { userAgent: SAFARI, browser: "safari" },
        { userAgent: ANDROID_CHROME, browser: "android" },
    ])("names $browser", ({ userAgent, browser }) => {
        stubUserAgent(userAgent);

        expect(getPermissionHelpBrowser()).toBe(browser);
    });

    it("falls back on 'other' where the browser cannot be told", () => {
        stubUserAgent("SomeEmbeddedWebview/1.0");

        expect(getPermissionHelpBrowser()).toBe("other");
    });
});

describe("getPermissionHelpScreenshot", () => {
    it("gives a screenshot of this browser in this language", () => {
        expect(getPermissionHelpScreenshot("firefox", "en-US")).toBe(
            "/resources/help-setting-camera-permission/en-US-firefox.png",
        );
        expect(getPermissionHelpScreenshot("chrome", "fr-FR")).toBe(
            "/resources/help-setting-camera-permission/fr-FR-chrome.png",
        );
    });

    it("gives none where no screenshot shows this browser in this language", () => {
        expect(getPermissionHelpScreenshot("chrome", "en-US")).toBeUndefined();
        expect(getPermissionHelpScreenshot("firefox", "fr-FR")).toBeUndefined();
        expect(getPermissionHelpScreenshot("safari", "en-US")).toBeUndefined();
        expect(getPermissionHelpScreenshot("android", "en-US")).toBeUndefined();
        expect(getPermissionHelpScreenshot("other", "en-US")).toBeUndefined();
    });

    it("only gives a file that exists", () => {
        const browsers = ["firefox", "chrome", "safari", "android", "other"] as const;
        for (const browser of browsers) {
            for (const locale of ["en-US", "de-DE", "fr-FR", "es-ES"]) {
                const screenshot = getPermissionHelpScreenshot(browser, locale);
                if (screenshot !== undefined) {
                    expect(fs.existsSync(path.join(__dirname, "../../../../public", screenshot))).toBe(true);
                }
            }
        }
    });
});
