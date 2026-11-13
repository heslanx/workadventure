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
        "MD-12 (pinned): with a stored permission_denied and the browser's %s permission granted since, the panel no longer says access is blocked but the help context still says permission",
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
            expect(helpContexts.at(-1)).toBe("permission");
        },
    );
});
