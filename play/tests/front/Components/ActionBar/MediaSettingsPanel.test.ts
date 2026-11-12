import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { loadLocale } from "../../../../src/i18n/i18n-util.sync";
import { setLocale } from "../../../../src/i18n/i18n-svelte";
import {
    cameraAccessIssueStore,
    microphoneAccessIssueStore,
    requestedCameraState,
    requestedMicrophoneState,
} from "../../../../src/front/Stores/MediaStore";
import MediaSettingsPanel from "../../../../src/front/Components/ActionBar/MediaSettingsList/MediaSettingsPanel.svelte";

// Link seam: the Phaser game. Without it, importing MediaStore first reaches GameScene through OnboardingStore,
// and GameScene's stores read MediaStore's exports before MediaStore has finished loading.
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => undefined },
}));

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
});
