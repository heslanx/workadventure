// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/unbound-method -- expect() on vi.fn() members of module mocks */
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { localUserStore } from "../../../Connection/LocalUserStore";
import {
    audioManagerFileStore,
    audioManagerVisibilityStore,
    audioManagerVolumeStore,
    bubbleSoundStore,
} from "../../../Stores/AudioManagerStore";
import { speakerSelectedStore } from "../../../Stores/AudioOutputStore";
import { backgroundConfigStore } from "../../../Stores/BackgroundTransformStore";
import {
    requestedCameraDeviceIdStore,
    requestedCameraState,
    requestedMicrophoneDeviceIdStore,
    requestedMicrophoneState,
} from "../../../Stores/MediaStore";
import { playOnSelectedOutput } from "../../../WebRtc/AudioOutputManager";
import { NO_DEVICE, STARTING_DEVICE } from "../domain/mediaChoices";
import {
    cameraWhenHidden,
    microphoneWhenHidden,
    selectCamera,
    selectMicrophone,
    selectSpeaker,
    setCameraBackground,
} from "./mediaSettings";
import {
    BUBBLE_PREVIEW_VOLUME,
    blockMapAudio,
    bubbleSound,
    chatSounds,
    lowerMusicWhileTalking,
    previewBubbleSound,
    setMusicVolume,
} from "./soundSettings";

// The writes that pair a saved setting with a live store, or go through a store alone: each must reach the same
// API upstream's own screens call, or the other screen and the next visit disagree with the dialog.

// The live stores the media writes read: on or off, and a silent zone.
const { cameraOn, microphoneOn, silent } = vi.hoisted(() => ({
    cameraOn: { value: true },
    microphoneOn: { value: true },
    silent: { value: false },
}));

// What the saved settings hold: the fake local store below reads and writes it, as the real one reads and writes
// the browser's storage. A setting that was never saved is absent.
interface SavedState {
    values: Record<string, boolean | string>;
    room: { defaultCameraPrivacySettings: boolean; defaultMicrophonePrivacySettings: boolean } | undefined;
}
const saved = vi.hoisted((): SavedState => ({ values: {}, room: undefined }));

/** A store that holds what `box` holds now, enough for `get()`. */
function readableOf<T>(box: { value: T }) {
    return {
        subscribe: (run: (value: T) => void) => {
            run(box.value);
            return () => undefined;
        },
    };
}

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: {
        setPreferredVideoInputDevice: vi.fn(),
        setPreferredAudioInputDevice: vi.fn(),
        setSpeakerDeviceId: vi.fn(),
        setDecreaseAudioPlayerVolumeWhileTalking: (on: boolean) => (saved.values.lowerMusic = on),
        setAudioPlayerVolume: vi.fn(),
        setAudioPlayerMuted: vi.fn(),
        getDecreaseAudioPlayerVolumeWhileTalking: () => saved.values.lowerMusic ?? false,
        setBlockAudio: (on: boolean) => (saved.values.blockAudio = on),
        getBlockAudio: () => saved.values.blockAudio ?? false,
        setBubbleSound: (sound: string) => (saved.values.bubbleSound = sound),
        getBubbleSound: () => saved.values.bubbleSound ?? "ding",
        setChatSounds: (on: boolean) => (saved.values.chatSounds = on),
        getChatSounds: () => saved.values.chatSounds ?? true,
        setCameraPrivacySettings: (on: boolean) => (saved.values.cameraWhenHidden = on),
        getCameraPrivacySettings: (fallback: boolean) => saved.values.cameraWhenHidden ?? fallback,
        setMicrophonePrivacySettings: (on: boolean) => (saved.values.microphoneWhenHidden = on),
        getMicrophonePrivacySettings: (fallback: boolean) => saved.values.microphoneWhenHidden ?? fallback,
    },
}));
vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: {
        get currentRoom() {
            return saved.room;
        },
    },
}));
vi.mock("../../../Connection/Room", () => ({
    Room: { DEFAULT_CAMERA_PRIVACY_SETTINGS: false, DEFAULT_MICROPHONE_PRIVACY_SETTINGS: false },
}));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Stores/AudioOutputStore", () => ({ speakerSelectedStore: { set: vi.fn() } }));
vi.mock("../../../Stores/BackgroundTransformStore", () => ({
    backgroundConfigStore: { setMode: vi.fn(), setBlurAmount: vi.fn(), setBackgroundImage: vi.fn() },
}));
vi.mock("../../../Stores/DisplayVideoQualityStore", () => ({ displayVideoQualityStore: {} }));
vi.mock("../../../Stores/MediaStore", () => ({
    requestedCameraDeviceIdStore: { set: vi.fn() },
    requestedCameraState: { ...readableOf(cameraOn), enableWebcam: vi.fn(), disableWebcam: vi.fn() },
    requestedMicrophoneDeviceIdStore: { set: vi.fn() },
    requestedMicrophoneState: {
        ...readableOf(microphoneOn),
        enableMicrophone: vi.fn(),
        disableMicrophone: vi.fn(),
    },
    silentStore: readableOf(silent),
}));
vi.mock("../../../WebRtc/AudioOutputManager", () => ({
    playSpeakerTestSound: vi.fn(),
    playOnSelectedOutput: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../Stores/AudioManagerStore", () => ({
    audioManagerFileStore: { unloadAudio: vi.fn() },
    audioManagerVisibilityStore: { set: vi.fn() },
    audioManagerVolumeStore: { setDecreaseWhileTalking: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn() },
    bubbleSoundStore: { set: vi.fn() },
}));
vi.mock("../../../Stores/PeerStore", () => ({ volumeProximityDiscussionStore: {} }));

describe("the settings the dialog writes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cameraOn.value = true;
        microphoneOn.value = true;
        silent.value = false;
        saved.values = {};
        saved.room = undefined;
    });

    it("lowers the music in the saved setting and in the playing music, and reports it", () => {
        lowerMusicWhileTalking.set(true);

        expect(get(lowerMusicWhileTalking)).toBe(true);
        expect(audioManagerVolumeStore.setDecreaseWhileTalking).toHaveBeenCalledWith(true);
        expect(analyticsClient.trackAdminEvent).toHaveBeenCalledWith("settings.decrease_audio_volume.changed", {
            value: "true",
        });
    });

    it("blocks the map's audio by unloading what plays and saving the choice", () => {
        blockMapAudio.set(true);

        expect(get(blockMapAudio)).toBe(true);
        expect(audioManagerFileStore.unloadAudio).toHaveBeenCalled();
        expect(audioManagerVisibilityStore.set).toHaveBeenCalledWith("disabledBySettings");
    });

    it("unblocks the map's audio without touching what plays", () => {
        blockMapAudio.set(true);
        vi.clearAllMocks();

        blockMapAudio.set(false);

        expect(get(blockMapAudio)).toBe(false);
        expect(audioManagerFileStore.unloadAudio).not.toHaveBeenCalled();
    });

    it("saves the bubble sound and plays the new one from the live store", () => {
        bubbleSound.set("wobble");

        expect(get(bubbleSound)).toBe("wobble");
        expect(bubbleSoundStore.set).toHaveBeenCalledWith("wobble");
    });

    it("saves the chat sounds", () => {
        chatSounds.set(false);

        expect(get(chatSounds)).toBe(false);
    });

    it("shows what another screen saved the next time the setting is read", () => {
        expect(get(bubbleSound)).toBe("ding");

        saved.values.bubbleSound = "wobble";

        expect(get(bubbleSound)).toBe("wobble");
    });

    it("keeps the camera on when hidden, saves it and reports it", () => {
        cameraWhenHidden.set(true);

        expect(get(cameraWhenHidden)).toBe(true);
        expect(analyticsClient.trackAdminEvent).toHaveBeenCalledWith("settings.camera.changed", { value: "true" });
    });

    it("keeps the microphone on when hidden, saves it and reports it", () => {
        microphoneWhenHidden.set(true);

        expect(get(microphoneWhenHidden)).toBe(true);
        expect(analyticsClient.trackAdminEvent).toHaveBeenCalledWith("settings.microphone.changed", { value: "true" });
    });

    it("starts from the room's default, which is known only after the module loads, until a choice is saved", () => {
        saved.room = { defaultCameraPrivacySettings: true, defaultMicrophonePrivacySettings: true };
        expect(get(cameraWhenHidden)).toBe(true);
        expect(get(microphoneWhenHidden)).toBe(true);

        cameraWhenHidden.set(false);
        microphoneWhenHidden.set(false);

        expect(get(cameraWhenHidden)).toBe(false);
        expect(get(microphoneWhenHidden)).toBe(false);
    });

    it("unmutes the music when its volume moves, as the music player does", () => {
        setMusicVolume(0.4);

        expect(audioManagerVolumeStore.setVolume).toHaveBeenCalledWith(0.4);
        expect(localUserStore.setAudioPlayerVolume).toHaveBeenCalledWith(0.4);
        expect(audioManagerVolumeStore.setMuted).toHaveBeenCalledWith(false);
        expect(localUserStore.setAudioPlayerMuted).toHaveBeenCalledWith(false);
    });

    it("turns the camera off with the no-camera choice, and back on by choosing one", () => {
        selectCamera(NO_DEVICE);
        expect(requestedCameraState.disableWebcam).toHaveBeenCalled();
        expect(requestedCameraDeviceIdStore.set).not.toHaveBeenCalled();

        cameraOn.value = false;
        selectCamera("cam-2");
        expect(requestedCameraDeviceIdStore.set).toHaveBeenCalledWith("cam-2");
        expect(localUserStore.setPreferredVideoInputDevice).toHaveBeenCalledWith("cam-2");
        expect(requestedCameraState.enableWebcam).toHaveBeenCalled();
    });

    it("chooses a microphone, saves it, reports it, and turns a microphone that was off back on", () => {
        microphoneOn.value = false;
        selectMicrophone("mic-2");

        expect(requestedMicrophoneDeviceIdStore.set).toHaveBeenCalledWith("mic-2");
        expect(localUserStore.setPreferredAudioInputDevice).toHaveBeenCalledWith("mic-2");
        expect(requestedMicrophoneState.enableMicrophone).toHaveBeenCalled();
        expect(analyticsClient.trackAdminEvent).toHaveBeenCalledWith("settings.microphone.selected");

        selectMicrophone(NO_DEVICE);
        expect(requestedMicrophoneState.disableMicrophone).toHaveBeenCalled();
    });

    it("reports a chosen camera with upstream's analytics event", () => {
        selectCamera("cam-2");

        expect(analyticsClient.trackAdminEvent).toHaveBeenCalledWith("settings.camera.selected");
    });

    it("saves the device but turns nothing on in a silent zone, as upstream's own controls", () => {
        silent.value = true;
        cameraOn.value = false;
        microphoneOn.value = false;

        selectCamera("cam-2");
        selectMicrophone("mic-2");

        expect(requestedCameraDeviceIdStore.set).toHaveBeenCalledWith("cam-2");
        expect(requestedMicrophoneDeviceIdStore.set).toHaveBeenCalledWith("mic-2");
        expect(requestedCameraState.enableWebcam).not.toHaveBeenCalled();
        expect(requestedMicrophoneState.enableMicrophone).not.toHaveBeenCalled();
    });

    it("ignores the starting placeholder of a device list", () => {
        selectCamera(STARTING_DEVICE);
        selectMicrophone(STARTING_DEVICE);

        expect(requestedCameraDeviceIdStore.set).not.toHaveBeenCalled();
        expect(requestedMicrophoneDeviceIdStore.set).not.toHaveBeenCalled();
        expect(requestedCameraState.disableWebcam).not.toHaveBeenCalled();
    });

    it("chooses a speaker in the saved setting and the live store", () => {
        selectSpeaker("out-2");

        expect(localUserStore.setSpeakerDeviceId).toHaveBeenCalledWith("out-2");
        expect(speakerSelectedStore.set).toHaveBeenCalledWith("out-2");
    });

    it("previews the bubble sound quietly, on the chosen speaker", () => {
        previewBubbleSound("wobble");

        const [audio] = vi.mocked(playOnSelectedOutput).mock.calls[0];
        expect(audio.volume).toBe(BUBBLE_PREVIEW_VOLUME);
        expect(BUBBLE_PREVIEW_VOLUME).toBe(0.2);
        expect(audio.src).toContain("/resources/objects/webrtc-in-wobble.mp3");
    });

    it("applies a background choice with upstream's own calls", () => {
        setCameraBackground("blur:25");
        expect(backgroundConfigStore.setMode).toHaveBeenCalledWith("blur");
        expect(backgroundConfigStore.setBlurAmount).toHaveBeenCalledWith(25);

        setCameraBackground("image:./static/images/background/office.jpg");
        expect(backgroundConfigStore.setBackgroundImage).toHaveBeenCalledWith("./static/images/background/office.jpg");

        setCameraBackground("blur:7");
        expect(backgroundConfigStore.setMode).toHaveBeenLastCalledWith("none");
    });
});
