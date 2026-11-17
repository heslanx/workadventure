import { get } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import type { NoiseSuppressionEngine, NoiseSuppressionProvider } from "../../../Connection/LocalUserStore";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { connectionManager } from "../../../Connection/ConnectionManager";
import { Room } from "../../../Connection/Room";
import { speakerSelectedStore } from "../../../Stores/AudioOutputStore";
import { backgroundConfigStore } from "../../../Stores/BackgroundTransformStore";
import { bandwidthConstrainedPreferenceStore } from "../../../Stores/BandwidthConstrainedPreferenceStore";
import { displayVideoQualityStore } from "../../../Stores/DisplayVideoQualityStore";
import {
    requestedCameraDeviceIdStore,
    requestedCameraState,
    requestedMicrophoneDeviceIdStore,
    requestedMicrophoneState,
    silentStore,
    videoQualityStore,
} from "../../../Stores/MediaStore";
import {
    microphoneAutoGainControlStore,
    microphoneBrowserNoiseSuppressionStore,
    microphoneEchoCancellationStore,
    noiseSuppressionEnabledStore,
    noiseSuppressionEngineStore,
    noiseSuppressionProviderStore,
} from "../../../Stores/NoiseSuppressionStore";
import { screenShareQualityStore } from "../../../Stores/ScreenSharingStore";
import { playSpeakerTestSound } from "../../../WebRtc/AudioOutputManager";
import {
    BLUR_AMOUNTS,
    NO_DEVICE,
    STARTING_DEVICE,
    type BandwidthPreference,
    type QualityName,
} from "../domain/mediaChoices";

// The camera, microphone and speaker settings, written the way upstream's own screens write them
// (MediaSettingsPanel.svelte, SettingsSubMenu.svelte, BackgroundSettingsPanel.svelte).

/**
 * Chooses a camera, or turns the camera off with `NO_DEVICE`; choosing one turns a camera that was off back on,
 * except in a silent zone, where upstream's own camera controls keep it off too.
 */
export function selectCamera(deviceId: string): void {
    if (deviceId === STARTING_DEVICE) return;
    if (deviceId === NO_DEVICE) {
        requestedCameraState.disableWebcam();
        return;
    }
    analyticsClient.trackAdminEvent("settings.camera.selected");
    requestedCameraDeviceIdStore.set(deviceId);
    localUserStore.setPreferredVideoInputDevice(deviceId);
    if (!get(requestedCameraState) && !get(silentStore)) requestedCameraState.enableWebcam();
}

/** Chooses a microphone, or turns the microphone off with `NO_DEVICE`; as the camera, never on in a silent zone. */
export function selectMicrophone(deviceId: string): void {
    if (deviceId === STARTING_DEVICE) return;
    if (deviceId === NO_DEVICE) {
        requestedMicrophoneState.disableMicrophone();
        return;
    }
    analyticsClient.trackAdminEvent("settings.microphone.selected");
    requestedMicrophoneDeviceIdStore.set(deviceId);
    localUserStore.setPreferredAudioInputDevice(deviceId);
    if (!get(requestedMicrophoneState) && !get(silentStore)) requestedMicrophoneState.enableMicrophone();
}

export function selectSpeaker(deviceId: string): void {
    analyticsClient.trackAdminEvent("settings.speaker.selected");
    localUserStore.setSpeakerDeviceId(deviceId);
    speakerSelectedStore.set(deviceId);
}

export function testSpeaker(): void {
    playSpeakerTestSound().catch((error: unknown) => console.error("[konclui] preferences: speaker test", error));
}

export function setVideoQuality(quality: QualityName): void {
    videoQualityStore.setQuality(quality);
}

export function setScreenShareQuality(quality: QualityName): void {
    screenShareQualityStore.setQuality(quality);
}

export function setBandwidthPreference(preference: BandwidthPreference): void {
    bandwidthConstrainedPreferenceStore.setPreference(preference);
}

export function setNoiseSuppression(on: boolean): void {
    noiseSuppressionEnabledStore.setEnabled(on);
}

export function setNoiseSuppressionProvider(provider: NoiseSuppressionProvider): void {
    noiseSuppressionProviderStore.setProvider(provider);
}

export function setNoiseSuppressionEngine(engine: NoiseSuppressionEngine): void {
    noiseSuppressionEngineStore.setEngine(engine);
}

export function setAutoGainControl(on: boolean): void {
    microphoneAutoGainControlStore.setEnabled(on);
}

export function setEchoCancellation(on: boolean): void {
    microphoneEchoCancellationStore.setEnabled(on);
}

export function setBrowserNoiseSuppression(on: boolean): void {
    microphoneBrowserNoiseSuppressionStore.setEnabled(on);
}

/** Whether the camera stays on in another tab or window; the room sets the default. */
export function cameraWhenHidden(): boolean {
    return localUserStore.getCameraPrivacySettings(
        connectionManager.currentRoom?.defaultCameraPrivacySettings ?? Room.DEFAULT_CAMERA_PRIVACY_SETTINGS,
    );
}

export function setCameraWhenHidden(on: boolean): void {
    analyticsClient.trackAdminEvent("settings.camera.changed", { value: on ? "true" : "false" });
    localUserStore.setCameraPrivacySettings(on);
}

/** Whether the microphone stays on in another tab or window; the room sets the default. */
export function microphoneWhenHidden(): boolean {
    return localUserStore.getMicrophonePrivacySettings(
        connectionManager.currentRoom?.defaultMicrophonePrivacySettings ?? Room.DEFAULT_MICROPHONE_PRIVACY_SETTINGS,
    );
}

export function setMicrophoneWhenHidden(on: boolean): void {
    analyticsClient.trackAdminEvent("settings.microphone.changed", { value: on ? "true" : "false" });
    localUserStore.setMicrophonePrivacySettings(on);
}

export function setVideoQualityStats(on: boolean): void {
    localUserStore.setDisplayVideoQualityStats(on);
    displayVideoQualityStore.set(on);
}

/** Applies a background choice as `backgroundChoice` names it: `none`, `blur:<amount>` or `image:<url>`. */
export function setCameraBackground(choice: string): void {
    if (choice.startsWith("image:")) {
        backgroundConfigStore.setBackgroundImage(choice.slice("image:".length));
        return;
    }
    const amount = Number(choice.slice("blur:".length));
    if (choice.startsWith("blur:") && (BLUR_AMOUNTS as readonly number[]).includes(amount)) {
        backgroundConfigStore.setMode("blur");
        backgroundConfigStore.setBlurAmount(amount);
        return;
    }
    backgroundConfigStore.setMode("none");
}
