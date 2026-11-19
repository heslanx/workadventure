// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import type { Readable } from "svelte/store";
import { loadLocale } from "../../../../src/i18n/i18n-util.sync";
import { setLocale } from "../../../../src/i18n/i18n-svelte";
import {
    cameraAccessIssueStore,
    cameraButtonHelpContextStore,
    microphoneAccessIssueStore,
    microphoneButtonHelpContextStore,
    requestedCameraState,
    requestedMicrophoneState,
} from "../../../../src/front/Stores/MediaStore";
import MediaSettingsPanel from "../../../../src/front/Components/ActionBar/MediaSettingsList/MediaSettingsPanel.svelte";

// Link seam: the Phaser game. Without it, importing MediaStore first reaches GameScene through OnboardingStore,
// and GameScene's stores read MediaStore's exports before MediaStore has finished loading.
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => undefined },
}));

// The browser's permission state per device. MediaStatusStore queries it once, when MediaStore's module graph loads,
// then follows its change events, so it must exist before the imports.
const browserPermissions = vi.hoisted(() => {
    class FakePermissionStatus extends EventTarget {
        state: PermissionState = "prompt";

        change(state: PermissionState): void {
            this.state = state;
            this.dispatchEvent(new Event("change"));
        }
    }
    const statuses = { camera: new FakePermissionStatus(), microphone: new FakePermissionStatus() };
    Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query: ({ name }: { name: "camera" | "microphone" }) => Promise.resolve(statuses[name]) },
    });
    return statuses;
});

// Subscribes until the test ends, as the mounted action-bar tooltip does, and returns every value the store gave. The
// browser permission state under the help contexts follows the browser only while something subscribes to it, and
// get() subscribes only for the read. The wait lets the browser answer the query that a first subscriber starts.
async function valuesUntilTestEnds<T>(store: Readable<T>): Promise<T[]> {
    const values: T[] = [];
    onTestFinished(store.subscribe((value) => values.push(value)));
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
    return values;
}

describe("MediaSettingsPanel", () => {
    let target: HTMLElement;
    let panel: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        loadLocale("en-US");
        setLocale("en-US");
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(async () => {
        const mounted = panel;
        panel = undefined;
        if (mounted) {
            await unmount(mounted);
        }
        target.remove();
        cameraAccessIssueStore.set(null);
        microphoneAccessIssueStore.set(null);
        requestedCameraState.enableWebcam();
        requestedMicrophoneState.enableMicrophone();
        browserPermissions.camera.change("prompt");
        browserPermissions.microphone.change("prompt");
        localStorage.clear();
    });

    function renderedText(): string {
        panel = mount(MediaSettingsPanel, { target });
        flushSync();
        return target.textContent ?? "";
    }

    // The office menu's standard (docs/konclui-migration/ui-contracts.md, "Menus and controls over the map"): the
    // classes of libs/tailwind/style/konclui.css carry the measured values, and the browser measures the result.
    describe("on the menu standard", () => {
        function renderedPanel(): HTMLElement {
            renderedText();
            const scroller = target.firstElementChild;
            if (!(scroller instanceof HTMLElement)) throw new Error("The panel rendered no scroller");
            return scroller;
        }

        it("scrolls in the standard scroller, with room below the last row and no gap around the dividers", () => {
            const scroller = renderedPanel();

            expect(scroller.classList).toContain("k-scroll-y");
            expect(scroller.classList).toContain("min-h-0");
            expect(scroller.classList).toContain("pb-1.5");
            expect(scroller.classList).not.toContain("scrollable-content");
            expect(scroller.className).not.toMatch(/\bgap-/);
        });

        it("names each section as a group under its title, and separates them with the standard divider", () => {
            const scroller = renderedPanel();
            const groups = [...scroller.querySelectorAll(':scope > [role="group"]')];

            expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(
                expect.arrayContaining(["Camera", "Microphone"]),
            );
            for (const group of groups) {
                const title = group.querySelector(".k-menu-title");
                expect(title?.textContent?.trim()).toBe(group.getAttribute("aria-label"));
                expect(title?.getAttribute("aria-hidden")).toBe("true");
            }
            expect(groups[0].nextElementSibling?.matches("hr.k-divider")).toBe(true);
            expect(scroller.querySelector(".uppercase, .text-xxs, .bg-white\\/10")).toBeNull();
        });

        it("says why the camera shows nothing in a left-aligned note, and offers to turn it on without the danger colour", () => {
            requestedCameraState.disableWebcam();
            const scroller = renderedPanel();
            const message = scroller.querySelector('[role="group"][aria-label="Camera"] p');
            const turnOn = [...scroller.querySelectorAll("button")].find(
                (button) => button.textContent?.trim() === "Turn on your camera",
            );

            expect(message?.parentElement?.classList).toContain("text-start");
            expect(message?.parentElement?.classList).toContain("px-3");
            expect(scroller.querySelector(".italic, .text-center")).toBeNull();
            expect(turnOn?.classList).toContain("btn-secondary");
            expect(scroller.querySelector(".btn-danger")).toBeNull();
        });

        it("draws the microphone settings action as a dock-sized control whose glyph the control sizes", () => {
            const scroller = renderedPanel();
            const gear = scroller.querySelector('[data-testid="microphone-settings-button"]');

            expect(gear?.classList).toContain("k-control");
            expect(gear?.getAttribute("aria-label")).toBe(gear?.getAttribute("title"));
            expect(gear?.firstElementChild?.tagName.toLowerCase()).toBe("svg");
            expect(gear?.firstElementChild?.getAttribute("font-size")).toBeNull();
            expect(gear?.className).not.toContain("text-white/50");
        });
    });

    it("says that another application holds the camera when the camera was turned off for that reason", () => {
        requestedCameraState.disableWebcam();
        cameraAccessIssueStore.set("device_in_use");

        const text = renderedText();

        expect(text).toContain("Camera in use");
        expect(text).toContain(
            "Your camera is being used by another application. Close that application, then try again.",
        );
        expect(text).not.toContain("Microphone in use");
    });

    it("says that another application holds the microphone when the microphone was turned off for that reason", () => {
        requestedMicrophoneState.disableMicrophone();
        microphoneAccessIssueStore.set("device_in_use");

        const text = renderedText();

        expect(text).toContain("Microphone in use");
        expect(text).toContain(
            "Your microphone is being used by another application. Close that application, then try again.",
        );
        expect(text).not.toContain("Camera in use");
    });

    it.each([
        ["camera", "device_in_use"],
        ["camera", "no_device"],
        ["camera", null],
        ["microphone", "device_in_use"],
        ["microphone", "no_device"],
        ["microphone", null],
    ] as const)(
        "panel precedence (fixed): with the browser's %s permission denied and a stored issue of %s, the panel and the help context both say access is blocked",
        (device, issue) => {
            if (device === "camera") {
                requestedCameraState.disableWebcam();
            } else {
                requestedMicrophoneState.disableMicrophone();
            }
            const [accessIssueStore, helpContextStore, blockedTitle] =
                device === "camera"
                    ? ([cameraAccessIssueStore, cameraButtonHelpContextStore, "Camera access blocked"] as const)
                    : ([
                          microphoneAccessIssueStore,
                          microphoneButtonHelpContextStore,
                          "Microphone access blocked",
                      ] as const);
            accessIssueStore.set(issue);
            browserPermissions[device].change("denied");

            const text = renderedText();

            expect(text).toContain(blockedTitle);
            expect(get(helpContextStore)).toBe("permission");
        },
    );

    it.each(["camera", "microphone"] as const)(
        "MD-12 (fixed): with a stored permission_denied and the browser's %s permission granted since, neither the panel nor the help context says access is blocked",
        async (device) => {
            if (device === "camera") {
                requestedCameraState.disableWebcam();
            } else {
                requestedMicrophoneState.disableMicrophone();
            }
            const [accessIssueStore, helpContextStore, blockedTitle] =
                device === "camera"
                    ? ([cameraAccessIssueStore, cameraButtonHelpContextStore, "Camera access blocked"] as const)
                    : ([
                          microphoneAccessIssueStore,
                          microphoneButtonHelpContextStore,
                          "Microphone access blocked",
                      ] as const);
            const helpContexts = await valuesUntilTestEnds(helpContextStore);
            accessIssueStore.set("permission_denied");
            browserPermissions[device].change("granted");

            const text = renderedText();

            expect(text).not.toContain(blockedTitle);
            expect(helpContexts.at(-1)).toBe(null);
        },
    );
});
