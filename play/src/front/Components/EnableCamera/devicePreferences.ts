import { get } from "svelte/store";
import { localUserStore } from "../../Connection/LocalUserStore";
import {
    batchGetUserMediaStore,
    requestedCameraDeviceIdStore,
    requestedCameraState,
    requestedMicrophoneDeviceIdStore,
    requestedMicrophoneState,
    speakerSelectedStore,
} from "../../Stores/MediaStore";

/**
 * What the camera page changes as soon as the user picks a device (it does not wait for the "Save" button), so
 * leaving the page without saving has to put it back.
 */
export interface DevicePreferences {
    cameraRequested: boolean;
    microphoneRequested: boolean;
    requestedCameraDeviceId: string | undefined;
    requestedMicrophoneDeviceId: string | undefined;
    // undefined: never saved. A saved preferred device is what marks the camera page as done.
    preferredVideoInputDevice: string | undefined;
    preferredAudioInputDevice: string | undefined;
    speakerDeviceId: string | null;
    speakerSelected: string | undefined;
}

export function readDevicePreferences(): DevicePreferences {
    return {
        cameraRequested: get(requestedCameraState),
        microphoneRequested: get(requestedMicrophoneState),
        requestedCameraDeviceId: get(requestedCameraDeviceIdStore),
        requestedMicrophoneDeviceId: get(requestedMicrophoneDeviceIdStore),
        preferredVideoInputDevice: localUserStore.getPreferredVideoInputDevice(),
        preferredAudioInputDevice: localUserStore.getPreferredAudioInputDevice(),
        speakerDeviceId: localUserStore.getSpeakerDeviceId(),
        speakerSelected: get(speakerSelectedStore),
    };
}

export function restoreDevicePreferences(preferences: DevicePreferences): void {
    // One media request for the whole restore, as the page does when it opens.
    batchGetUserMediaStore.startBatch();
    if (preferences.cameraRequested) {
        requestedCameraState.enableWebcam();
    } else {
        requestedCameraState.disableWebcam();
    }
    if (preferences.microphoneRequested) {
        requestedMicrophoneState.enableMicrophone();
    } else {
        requestedMicrophoneState.disableMicrophone();
    }
    requestedCameraDeviceIdStore.set(preferences.requestedCameraDeviceId);
    requestedMicrophoneDeviceIdStore.set(preferences.requestedMicrophoneDeviceId);
    localUserStore.setPreferredVideoInputDevice(preferences.preferredVideoInputDevice);
    localUserStore.setPreferredAudioInputDevice(preferences.preferredAudioInputDevice);
    // LocalUserStore cannot clear the speaker: a speaker never chosen before keeps the choice made on the page.
    if (preferences.speakerDeviceId !== null) {
        localUserStore.setSpeakerDeviceId(preferences.speakerDeviceId);
    }
    speakerSelectedStore.set(preferences.speakerSelected);
    batchGetUserMediaStore.commitChanges();
}
