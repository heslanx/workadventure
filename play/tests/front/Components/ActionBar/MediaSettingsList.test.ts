// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { Component } from "svelte";
import { loadLocale } from "../../../../src/i18n/i18n-util.sync";
import { setLocale } from "../../../../src/i18n/i18n-svelte";
import { IconCamera } from "../../../../src/front/Components/Icons";
import MediaSettingsList from "../../../../src/front/Components/ActionBar/MediaSettingsList/MediaSettingsList.svelte";
import MediaSettingsListHeader from "../../../../src/front/Components/ActionBar/MediaSettingsList/MediaSettingsListHeader.svelte";
import BackgroundSettingsPanel from "../../../../src/front/Components/ActionBar/MediaSettingsList/BackgroundSettingsPanel.svelte";
import DeviceListItem from "../../../../src/front/Components/ActionBar/MediaSettingsList/DeviceListItem.svelte";
import SelectionCheckOverlay from "../../../../src/front/Components/ActionBar/MediaSettingsList/SelectionCheckOverlay.svelte";

// Link seam: the Phaser game. Without it, importing MediaStore first reaches GameScene through OnboardingStore,
// and GameScene's stores read MediaStore's exports before MediaStore has finished loading.
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => undefined },
}));

// The background effects probe WebGL2, which jsdom lacks: the device here supports them.
vi.mock("../../../../src/front/WebRtc/BackgroundProcessor/createBackgroundTransformer", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getBackgroundProcessingUnsupportedReason: () => null,
}));

// MediaStatusStore queries the browser's permissions once, when MediaStore's module graph loads.
vi.hoisted(() => {
    const status = Object.assign(new EventTarget(), { state: "prompt" });
    Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query: () => Promise.resolve(status) },
    });
});

/**
 * The camera and microphone popover of the dock on the office's menu standard (docs/konclui-migration/ui-contracts.md,
 * "Menus and controls over the map"): the classes of libs/tailwind/style/konclui.css carry the measured values, so
 * the markup is checked for them here and the browser measures the result.
 */
describe("MediaSettingsList", () => {
    let target: HTMLElement;
    let mounted: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        loadLocale("en-US");
        setLocale("en-US");
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(async () => {
        const component = mounted;
        mounted = undefined;
        if (component) {
            await unmount(component);
        }
        target.remove();
    });

    function render<Props extends Record<string, unknown>>(component: Component<Props>, props: Props): HTMLElement {
        // No intro: jsdom has no Web Animations API for the popover's fly-in.
        mounted = mount(component, { target, props, intro: false });
        flushSync();
        return target;
    }

    describe("the popover surface", () => {
        it("keeps a 6 px edge and puts the tabs straight on it, with no sticky wrapper outside the scroller", () => {
            render(MediaSettingsList, {});
            const surface = target.querySelector<HTMLElement>('[data-testid="media-settings-panel"]');

            expect(surface?.classList).toContain("p-1.5");
            expect(surface?.classList).not.toContain("pb-2");
            expect(surface?.classList).not.toContain("p-1");
            expect(surface?.getAttribute("style") ?? "").not.toContain("max-height");
            expect(target.querySelector(".sticky")).toBeNull();
            expect(surface?.firstElementChild?.querySelector('[data-testid="background-settings-tab"]')).not.toBeNull();
        });

        it("is a column whose content can shrink, so a height cap scrolls the list instead of overflowing", () => {
            render(MediaSettingsList, {});
            const surface = target.querySelector<HTMLElement>('[data-testid="media-settings-panel"]');
            const content = surface?.children[1];

            expect(surface?.classList).toContain("flex");
            expect(surface?.classList).toContain("flex-col");
            expect(content?.classList).toContain("min-h-0");
            expect(content?.classList).toContain("flex-1");
            // A divider brings its own 6 px: a gap here would double it.
            expect(content?.className).not.toMatch(/\bgap-/);
        });
    });

    describe("the tabs", () => {
        it("are one segmented pair of two buttons, with no title-styled wrappers around them", () => {
            render(MediaSettingsListHeader, {});
            const pair = target.firstElementChild;
            const tabs = [...target.querySelectorAll("button")];

            expect(tabs).toHaveLength(2);
            expect(tabs.every((tab) => tab.parentElement === pair)).toBe(true);
            expect(target.querySelector(".uppercase, .text-xxs")).toBeNull();
            // A label longer than its share wraps inside the segment rather than running past the rim.
            expect(tabs.some((tab) => tab.classList.contains("text-nowrap"))).toBe(false);
            expect(tabs.every((tab) => tab.classList.contains("min-w-0"))).toBe(true);
            expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(["Settings", "Camera background"]);
        });

        it("presses the tab that was chosen", () => {
            render(MediaSettingsListHeader, {});
            const [settings, background] = target.querySelectorAll("button");

            expect(settings.getAttribute("aria-pressed")).toBe("true");
            expect(background.getAttribute("data-testid")).toBe("background-settings-tab");
            background.click();
            flushSync();

            expect(settings.getAttribute("aria-pressed")).toBe("false");
            expect(background.getAttribute("aria-pressed")).toBe("true");
        });
    });

    describe("a device row", () => {
        it("is a menu row with the device's icon in the lead and its full name on the ellipsized label", () => {
            render(DeviceListItem, {
                label: "FaceTime HD Camera (05ac:8514)",
                isSelected: false,
                onclick: vi.fn(),
                icon: IconCamera,
            });
            const row = target.querySelector("button");

            expect(row?.classList).toContain("k-menu-row");
            expect(row?.firstElementChild?.classList).toContain("k-menu-lead");
            expect(row?.querySelector(".k-menu-lead > svg")).not.toBeNull();
            const label = row?.querySelector(".k-menu-label");
            expect(label?.getAttribute("title")).toBe("FaceTime HD Camera");
            expect(label?.textContent?.trim()).toBe("FaceTime HD Camera");
            expect(row?.querySelector(".k-menu-mark")).toBeNull();
        });

        it("marks the selected device with a trailing check instead of a filled row", () => {
            render(DeviceListItem, { label: "USB Microphone", isSelected: true, onclick: vi.fn() });
            const row = target.querySelector("button");

            expect(row?.getAttribute("aria-current")).toBe("true");
            expect(row?.className).not.toContain("bg-secondary");
            expect(row?.lastElementChild?.tagName.toLowerCase()).toBe("svg");
            expect(row?.lastElementChild?.classList).toContain("k-menu-mark");
            // No icon given: the slot stays, empty, so the label keeps its place.
            expect(row?.querySelector(".k-menu-lead")?.childElementCount).toBe(0);
        });

        it("selects the device on a click", () => {
            const onclick = vi.fn();
            render(DeviceListItem, { label: "USB Microphone", isSelected: false, onclick });

            target.querySelector("button")?.click();

            expect(onclick).toHaveBeenCalledOnce();
        });
    });

    describe("the background tab", () => {
        it("scrolls with the standard scroller and keeps the last tiles off the rim", () => {
            render(BackgroundSettingsPanel, {});
            const scroller = target.querySelector(".k-scroll-y");

            expect(scroller).not.toBeNull();
            expect(scroller?.classList).toContain("min-h-0");
            expect(scroller?.classList).toContain("pb-1.5");
            expect(target.querySelector(".scrollable-content")).toBeNull();
        });

        it("gives 'No effect' the hit area of one tile, on the same grid as the blur tiles", () => {
            render(BackgroundSettingsPanel, {});
            const noEffect = [...target.querySelectorAll("button")].find((button) =>
                button.textContent?.includes("No effect"),
            );
            const blur = target.querySelector('[data-testid="background-blur-10"]');

            expect(noEffect?.parentElement?.classList).toContain("grid-cols-3");
            expect(blur?.parentElement?.classList).toContain("grid-cols-3");
            expect(noEffect?.parentElement?.className).toBe(blur?.parentElement?.className);
        });

        it("starts every section on the same left edge", () => {
            render(BackgroundSettingsPanel, {});

            expect(target.querySelector(".px-1")).toBeNull();
            expect(target.querySelectorAll('[role="group"] .k-menu-title').length).toBeGreaterThan(0);
        });

        it("sizes its glyphs at 18 px by attribute, not by font size", () => {
            render(BackgroundSettingsPanel, {});
            const glyphs = [...target.querySelectorAll("svg")];

            expect(glyphs.length).toBeGreaterThan(0);
            for (const glyph of glyphs) {
                expect(glyph.getAttribute("width")).toBe("18");
                expect(glyph.getAttribute("height")).toBe("18");
                expect(glyph.getAttribute("font-size")).toBeNull();
            }
        });

        it("draws the selection check of a tile at 18 px", () => {
            render(SelectionCheckOverlay, {});
            const check = target.querySelector("svg");

            expect(check?.getAttribute("width")).toBe("18");
            expect(check?.getAttribute("font-size")).toBeNull();
        });
    });
});

describe("the dock's placement of the popover", () => {
    const dock = readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), "../../../../src/front/Konclui/Shell/components/Dock.svelte"),
        "utf8",
    );
    const rule = /\.dock :global\(\[data-testid="media-settings-panel"\]\) \{([^}]*)\}/.exec(dock)?.[1] ?? "";

    it("caps the popover's height at the space above the dock, from the stack height the dock publishes", () => {
        expect(rule).toMatch(
            /max-height: min\(560px, calc\(100dvh - var\(--konclui-dock-stack-height, 76px\) - 84px\)\);/,
        );
    });

    it("lays the popover over the camera tiles, at the office menu's width", () => {
        expect(rule).toMatch(/z-index: 50;/);
        expect(rule).toMatch(/width: min\(264px, calc\(100vw - 16px\)\);/);
    });
});
