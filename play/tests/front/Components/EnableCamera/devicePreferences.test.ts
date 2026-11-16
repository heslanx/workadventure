import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

const mocks = vi.hoisted(() => ({
    localUser: {
        preferredVideo: undefined as string | undefined,
        preferredAudio: undefined as string | undefined,
        speaker: null as string | null,
        requestedCamera: true,
        requestedMicrophone: true,
    },
    batch: [] as string[],
}));

vi.mock("../../../../src/front/Connection/LocalUserStore", () => ({
    localUserStore: {
        getPreferredVideoInputDevice: () => mocks.localUser.preferredVideo,
        getPreferredAudioInputDevice: () => mocks.localUser.preferredAudio,
        setPreferredVideoInputDevice: (deviceId?: string) => (mocks.localUser.preferredVideo = deviceId),
        setPreferredAudioInputDevice: (deviceId?: string) => (mocks.localUser.preferredAudio = deviceId),
        getSpeakerDeviceId: () => mocks.localUser.speaker,
        setSpeakerDeviceId: (deviceId: string) => (mocks.localUser.speaker = deviceId),
    },
}));

vi.mock("../../../../src/front/Stores/MediaStore", () => {
    const requested = (key: "requestedCamera" | "requestedMicrophone") => {
        const store = writable(mocks.localUser[key]);
        return {
            subscribe: store.subscribe,
            on: () => {
                store.set(true);
                mocks.localUser[key] = true;
            },
            off: () => {
                store.set(false);
                mocks.localUser[key] = false;
            },
        };
    };
    const camera = requested("requestedCamera");
    const microphone = requested("requestedMicrophone");
    return {
        batchGetUserMediaStore: {
            startBatch: () => mocks.batch.push("start"),
            commitChanges: () => mocks.batch.push("commit"),
        },
        requestedCameraState: { subscribe: camera.subscribe, enableWebcam: camera.on, disableWebcam: camera.off },
        requestedMicrophoneState: {
            subscribe: microphone.subscribe,
            enableMicrophone: microphone.on,
            disableMicrophone: microphone.off,
        },
        requestedCameraDeviceIdStore: writable<string | undefined>(undefined),
        requestedMicrophoneDeviceIdStore: writable<string | undefined>(undefined),
        speakerSelectedStore: writable<string | undefined>(undefined),
    };
});

import {
    readDevicePreferences,
    restoreDevicePreferences,
} from "../../../../src/front/Components/EnableCamera/devicePreferences";
import {
    requestedCameraDeviceIdStore,
    requestedCameraState,
    requestedMicrophoneDeviceIdStore,
    requestedMicrophoneState,
    speakerSelectedStore,
} from "../../../../src/front/Stores/MediaStore";

describe("device preferences of the camera page", () => {
    beforeEach(() => {
        mocks.batch.length = 0;
        mocks.localUser.preferredVideo = "cam-a";
        mocks.localUser.preferredAudio = "mic-a";
        mocks.localUser.speaker = "speaker-a";
        requestedCameraState.enableWebcam();
        requestedMicrophoneState.disableMicrophone();
        requestedCameraDeviceIdStore.set("cam-a");
        requestedMicrophoneDeviceIdStore.set("mic-a");
        speakerSelectedStore.set("speaker-a");
    });

    it("puts back what the page changed as the user picked devices", () => {
        const before = readDevicePreferences();

        // The page turns both on at once, then the user picks other devices.
        requestedCameraState.disableWebcam();
        requestedMicrophoneState.enableMicrophone();
        requestedCameraDeviceIdStore.set("cam-b");
        requestedMicrophoneDeviceIdStore.set("mic-b");
        mocks.localUser.preferredVideo = "cam-b";
        mocks.localUser.preferredAudio = "";
        mocks.localUser.speaker = "speaker-b";
        speakerSelectedStore.set("speaker-b");

        restoreDevicePreferences(before);

        expect(get(requestedCameraState)).toBe(true);
        expect(get(requestedMicrophoneState)).toBe(false);
        expect(get(requestedCameraDeviceIdStore)).toBe("cam-a");
        expect(get(requestedMicrophoneDeviceIdStore)).toBe("mic-a");
        expect(mocks.localUser).toMatchObject({
            preferredVideo: "cam-a",
            preferredAudio: "mic-a",
            speaker: "speaker-a",
        });
        expect(get(speakerSelectedStore)).toBe("speaker-a");
    });

    it("forgets a device that was never saved, so the camera page is not marked as done", () => {
        mocks.localUser.preferredVideo = undefined;
        mocks.localUser.preferredAudio = undefined;
        const before = readDevicePreferences();

        mocks.localUser.preferredVideo = "cam-b";
        mocks.localUser.preferredAudio = "mic-b";
        restoreDevicePreferences(before);

        expect(mocks.localUser.preferredVideo).toBeUndefined();
        expect(mocks.localUser.preferredAudio).toBeUndefined();
    });

    it("restores in one batch of media requests", () => {
        restoreDevicePreferences(readDevicePreferences());

        expect(mocks.batch).toEqual(["start", "commit"]);
    });
});
