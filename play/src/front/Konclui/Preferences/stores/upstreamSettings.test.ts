// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/unbound-method -- expect() on vi.fn() members of module mocks */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { audioManagerVolumeStore } from "../../../Stores/AudioManagerStore";
import { speakerSelectedStore } from "../../../Stores/AudioOutputStore";
import { backgroundConfigStore } from "../../../Stores/BackgroundTransformStore";
import { bandwidthConstrainedPreferenceStore } from "../../../Stores/BandwidthConstrainedPreferenceStore";
import {
    requestedCameraDeviceIdStore,
    requestedCameraState,
    requestedMicrophoneDeviceIdStore,
    requestedMicrophoneState,
    videoQualityStore,
} from "../../../Stores/MediaStore";
import { noiseSuppressionEnabledStore } from "../../../Stores/NoiseSuppressionStore";
import { screenShareQualityStore } from "../../../Stores/ScreenSharingStore";
import { playOnSelectedOutput } from "../../../WebRtc/AudioOutputManager";
import { NO_DEVICE, STARTING_DEVICE } from "../domain/mediaChoices";
import {
    selectCamera,
    selectMicrophone,
    selectSpeaker,
    setBandwidthPreference,
    setCameraBackground,
    setNoiseSuppression,
    setScreenShareQuality,
    setVideoQuality,
} from "./mediaSettings";
import { BUBBLE_PREVIEW_VOLUME, previewBubbleSound, setLowerMusicWhileTalking, setMusicVolume } from "./soundSettings";

// The writes that pair a saved setting with a live store, or go through a store alone: each must reach the same
// API upstream's own screens call, or the other screen and the next visit disagree with the dialog.

// The live stores the media writes read: on or off, and a silent zone.
const { cameraOn, microphoneOn, silent } = vi.hoisted(() => ({
    cameraOn: { value: true },
    microphoneOn: { value: true },
    silent: { value: false },
}));

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
        setDecreaseAudioPlayerVolumeWhileTalking: vi.fn(),
        setAudioPlayerVolume: vi.fn(),
        setAudioPlayerMuted: vi.fn(),
    },
}));
vi.mock("../../../Connection/ConnectionManager", () => ({ connectionManager: { currentRoom: null } }));
vi.mock("../../../Connection/Room", () => ({ Room: {} }));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Stores/AudioOutputStore", () => ({ speakerSelectedStore: { set: vi.fn() } }));
vi.mock("../../../Stores/BackgroundTransformStore", () => ({
    backgroundConfigStore: { setMode: vi.fn(), setBlurAmount: vi.fn(), setBackgroundImage: vi.fn() },
}));
vi.mock("../../../Stores/BandwidthConstrainedPreferenceStore", () => ({
    bandwidthConstrainedPreferenceStore: { setPreference: vi.fn() },
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
    videoQualityStore: { setQuality: vi.fn() },
}));
vi.mock("../../../Stores/NoiseSuppressionStore", () => ({
    microphoneAutoGainControlStore: {},
    microphoneBrowserNoiseSuppressionStore: {},
    microphoneEchoCancellationStore: {},
    noiseSuppressionEnabledStore: { setEnabled: vi.fn() },
    noiseSuppressionEngineStore: {},
    noiseSuppressionProviderStore: {},
}));
vi.mock("../../../Stores/ScreenSharingStore", () => ({ screenShareQualityStore: { setQuality: vi.fn() } }));
vi.mock("../../../WebRtc/AudioOutputManager", () => ({
    playSpeakerTestSound: vi.fn(),
    playOnSelectedOutput: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../Stores/AudioManagerStore", () => ({
    audioManagerFileStore: {},
    audioManagerVisibilityStore: {},
    audioManagerVolumeStore: { setDecreaseWhileTalking: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn() },
    bubbleSoundStore: {},
}));
vi.mock("../../../Stores/PeerStore", () => ({ volumeProximityDiscussionStore: {} }));

describe("the settings the dialog writes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cameraOn.value = true;
        microphoneOn.value = true;
        silent.value = false;
    });

    it("lowers the music both in the saved setting and in the playing music", () => {
        setLowerMusicWhileTalking(true);

        expect(localUserStore.setDecreaseAudioPlayerVolumeWhileTalking).toHaveBeenCalledWith(true);
        expect(audioManagerVolumeStore.setDecreaseWhileTalking).toHaveBeenCalledWith(true);
    });

    it("unmutes the music when its volume moves, as the music player does", () => {
        setMusicVolume(0.4);

        expect(audioManagerVolumeStore.setVolume).toHaveBeenCalledWith(0.4);
        expect(localUserStore.setAudioPlayerVolume).toHaveBeenCalledWith(0.4);
        expect(audioManagerVolumeStore.setMuted).toHaveBeenCalledWith(false);
        expect(localUserStore.setAudioPlayerMuted).toHaveBeenCalledWith(false);
    });

    it("turns the noise reduction on through its store, which saves it", () => {
        setNoiseSuppression(true);

        expect(noiseSuppressionEnabledStore.setEnabled).toHaveBeenCalledWith(true);
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

    it("sets the video, screen and slow-connection choices through upstream's stores", () => {
        setVideoQuality("low");
        setScreenShareQuality("high");
        setBandwidthPreference("maintain-framerate");

        expect(videoQualityStore.setQuality).toHaveBeenCalledWith("low");
        expect(screenShareQualityStore.setQuality).toHaveBeenCalledWith("high");
        expect(bandwidthConstrainedPreferenceStore.setPreference).toHaveBeenCalledWith("maintain-framerate");
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
