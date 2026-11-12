import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { GameScene } from "../../../src/front/Phaser/Game/GameScene";
import type { LocalStreamStoreValue } from "../../../src/front/Stores/MediaStore";

// Link seam: the Phaser game. Without it, importing MediaStore first reaches GameScene through OnboardingStore,
// and GameScene's stores read MediaStore's exports before MediaStore has finished loading.
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => undefined },
}));

class FakeTrack {
    public enabled = true;
    public readyState: MediaStreamTrackState = "live";
    public readonly stop = vi.fn(() => {
        this.readyState = "ended";
    });

    constructor(
        public readonly kind: "audio" | "video",
        public readonly id: string,
        private readonly deviceId: string,
    ) {}

    getSettings(): MediaTrackSettings {
        return { deviceId: this.deviceId };
    }

    getCapabilities(): MediaTrackCapabilities {
        return {};
    }
}

type Answer = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

function exactDeviceId(constraint: boolean | MediaTrackConstraints | undefined): string | undefined {
    if (typeof constraint !== "object") return undefined;
    const deviceId = constraint.deviceId;
    return typeof deviceId === "object" && !Array.isArray(deviceId) ? (deviceId.exact as string) : undefined;
}

function fakeBrowser() {
    const tracks: FakeTrack[] = [];
    const answers: Answer[] = [];
    const deviceChangeListeners: Array<() => void> = [];
    let devices: MediaDeviceInfo[] = [];

    const open = (constraints: MediaStreamConstraints): MediaStream => {
        const opened: FakeTrack[] = [];
        if (constraints.video) {
            opened.push(new FakeTrack("video", `video-${tracks.length}`, exactDeviceId(constraints.video) ?? "cam-1"));
            tracks.push(opened[opened.length - 1]);
        }
        if (constraints.audio) {
            opened.push(new FakeTrack("audio", `audio-${tracks.length}`, exactDeviceId(constraints.audio) ?? "mic-1"));
            tracks.push(opened[opened.length - 1]);
        }
        return new MediaStream(opened as unknown as MediaStreamTrack[]);
    };

    const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
        const answer = answers.shift();
        return answer ? answer(constraints) : Promise.resolve(open(constraints));
    });

    const mediaDevices = {
        getUserMedia,
        enumerateDevices: vi.fn(() => Promise.resolve([...devices])),
        getSupportedConstraints: () => ({ deviceId: true }) as MediaTrackSupportedConstraints,
        addEventListener: (type: string, listener: () => void) => {
            if (type === "devicechange") deviceChangeListeners.push(listener);
        },
        removeEventListener: () => undefined,
    };

    return {
        mediaDevices,
        getUserMedia,
        tracks,
        failNext(error: Error) {
            answers.push(() => Promise.reject(error));
        },
        holdNext(): () => void {
            let release: () => void = () => undefined;
            answers.push(
                (constraints) =>
                    new Promise<MediaStream>((resolve) => {
                        release = () => resolve(open(constraints));
                    }),
            );
            return () => release();
        },
        setDevices(list: Array<[MediaDeviceKind, string]>) {
            devices = list.map(
                ([kind, deviceId]) => ({ kind, deviceId, groupId: "", label: deviceId }) as MediaDeviceInfo,
            );
        },
        changeDevices(list: Array<[MediaDeviceKind, string]>) {
            this.setDevices(list);
            deviceChangeListeners.forEach((listener) => listener());
        },
    };
}

function namedError(name: string, extra: Record<string, unknown> = {}): Error {
    return Object.assign(new Error(name), { name }, extra);
}

async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);
}

async function loadMediaStore() {
    vi.resetModules();
    const media = await import("../../../src/front/Stores/MediaStore");
    const myMedia = await import("../../../src/front/Stores/MyMediaStore");
    const group = await import("../../../src/front/Stores/CurrentPlayerGroupStore");
    const gameScene = await import("../../../src/front/Stores/GameSceneStore");
    const seen: LocalStreamStoreValue[] = [];
    const unsubscribe = media.rawLocalStreamStore.subscribe((value) => seen.push(value));
    return { ...media, ...myMedia, ...group, ...gameScene, seen, unsubscribe };
}

type Loaded = Awaited<ReturnType<typeof loadMediaStore>>;

function tracksOf(value: LocalStreamStoreValue): Array<{ kind: string; id: string }> {
    if (value.type !== "success" || value.stream === undefined) return [];
    return value.stream.getTracks().map((track) => ({ kind: track.kind, id: track.id }));
}

function current(m: Loaded): Array<{ kind: string; id: string }> {
    return tracksOf(get(m.rawLocalStreamStore));
}

function requested(browser: ReturnType<typeof fakeBrowser>, call: number): { video: boolean; audio: boolean } {
    const constraints = browser.getUserMedia.mock.calls[call][0];
    return { video: constraints.video !== false, audio: constraints.audio !== false };
}

async function enterRoom(m: Loaded): Promise<void> {
    m.batchGetUserMediaStore.startBatch();
    m.myCameraStore.set(true);
    m.myMicrophoneStore.set(true);
    m.batchGetUserMediaStore.commitChanges();
    await settle();
}

// The first import transforms MediaStore's whole module graph, which takes 15-20 s on one and a half cores.
describe("MediaStore getUserMedia chain", { timeout: 60_000 }, () => {
    let browser: ReturnType<typeof fakeBrowser>;
    let m: Loaded | undefined;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        localStorage.clear();
        localStorage.setItem("noiseSuppressionEnabled", "false");
        vi.spyOn(document, "hasFocus").mockReturnValue(true);
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        browser = fakeBrowser();
        browser.setDevices([
            ["videoinput", "cam-1"],
            ["audioinput", "mic-1"],
        ]);
        Object.defineProperty(navigator, "mediaDevices", { value: browser.mediaDevices, configurable: true });
    });

    afterEach(async () => {
        // The modules of earlier tests stay loaded and still listen to window focus: they must ask for nothing.
        if (m) {
            m.myCameraStore.set(false);
            m.myMicrophoneStore.set(false);
            await settle();
            m.unsubscribe();
        }
        m = undefined;
        Reflect.deleteProperty(navigator, "mediaDevices");
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("asks once for both devices when the room turns them on in a batch, and not again for changes that keep the constraints", async () => {
        m = await loadMediaStore();
        expect(browser.getUserMedia).not.toHaveBeenCalled();

        await enterRoom(m);
        expect(browser.getUserMedia).toHaveBeenCalledTimes(1);
        expect(browser.getUserMedia.mock.calls[0][0].video).toMatchObject({
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
        });
        expect(requested(browser, 0)).toEqual({ video: true, audio: true });
        expect(current(m)).toEqual([
            { kind: "video", id: "video-0" },
            { kind: "audio", id: "audio-1" },
        ]);

        m.mouseIsHoveringCameraButton.set(true);
        m.mouseIsHoveringCameraButton.set(false);
        m.inJitsiStore.set(false);
        m.frameRateStore.set(undefined);
        m.batchGetUserMediaStore.startBatch();
        m.batchGetUserMediaStore.commitChanges();
        await settle();
        expect(browser.getUserMedia).toHaveBeenCalledTimes(1);
    });

    it("MD-02 (pinned): without the batch, the same two changes open the camera twice, the first time for nothing", async () => {
        m = await loadMediaStore();
        m.myCameraStore.set(true);
        m.myMicrophoneStore.set(true);
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 0)).toEqual({ video: true, audio: false });
        expect(requested(browser, 1)).toEqual({ video: true, audio: true });
        expect(browser.tracks[0].stop).toHaveBeenCalledTimes(1);
        expect(current(m)).toEqual([
            { kind: "video", id: "video-1" },
            { kind: "audio", id: "audio-2" },
        ]);
    });

    it("turning the camera off stops only its track, and turning it on asks for the camera alone", async () => {
        m = await loadMediaStore();
        await enterRoom(m);
        const [video, audio] = browser.tracks;

        m.requestedCameraState.disableWebcam();
        await settle();
        expect(browser.getUserMedia).toHaveBeenCalledTimes(1);
        expect(video.stop).toHaveBeenCalledTimes(1);
        expect(audio.stop).not.toHaveBeenCalled();
        expect(current(m)).toEqual([{ kind: "audio", id: "audio-1" }]);

        m.requestedCameraState.enableWebcam();
        await settle();
        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 1)).toEqual({ video: true, audio: false });
        expect(audio.stop).not.toHaveBeenCalled();
        expect(current(m)).toEqual([
            { kind: "audio", id: "audio-1" },
            { kind: "video", id: "video-2" },
        ]);
    });

    it("keeps a muted microphone open and disabled while our audio is streamed, and unmutes it without asking again", async () => {
        m = await loadMediaStore();
        const streamed = writable(true);
        m.gameSceneStore.set({
            spaceRegistry: {
                isLiveStreamingStore: streamed,
                isLiveStreamingAudioStore: streamed,
                shouldPublishScreenShareStore: writable(false),
            },
        } as unknown as GameScene);
        await enterRoom(m);
        const audio = browser.tracks[1];

        m.requestedMicrophoneState.disableMicrophone();
        await settle();
        expect(audio.stop).not.toHaveBeenCalled();
        expect(audio.enabled).toBe(false);
        expect(current(m)).toEqual([{ kind: "video", id: "video-0" }]);

        m.requestedMicrophoneState.enableMicrophone();
        await settle();
        expect(browser.getUserMedia).toHaveBeenCalledTimes(1);
        expect(audio.enabled).toBe(true);
        expect(current(m)).toEqual([
            { kind: "video", id: "video-0" },
            { kind: "audio", id: "audio-1" },
        ]);

        streamed.set(false);
        m.requestedMicrophoneState.disableMicrophone();
        await settle();
        expect(audio.stop).toHaveBeenCalledTimes(1);
        m.requestedMicrophoneState.enableMicrophone();
        await settle();
        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 1)).toEqual({ video: false, audio: true });
    });

    it("MD-03 (pinned): a camera the user denies turns the camera off, asks again for the microphone alone, and that retry erases the denial", async () => {
        m = await loadMediaStore();
        browser.failNext(namedError("NotAllowedError"));
        await enterRoom(m);

        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 0)).toEqual({ video: true, audio: true });
        expect(requested(browser, 1)).toEqual({ video: false, audio: true });
        expect(get(m.requestedCameraState)).toBe(false);
        expect(get(m.requestedMicrophoneState)).toBe(true);
        expect(get(m.cameraAccessIssueStore)).toBe(null);
        expect(get(m.microphoneAccessIssueStore)).toBe(null);
        expect(current(m)).toEqual([{ kind: "audio", id: "audio-0" }]);
    });

    it("MD-01 (pinned): a chosen camera the browser cannot open also drops the chosen microphone", async () => {
        m = await loadMediaStore();
        m.requestedCameraDeviceIdStore.set("cam-gone");
        m.requestedMicrophoneDeviceIdStore.set("mic-headset");
        browser.failNext(namedError("OverconstrainedError", { constraint: "deviceId" }));
        await enterRoom(m);

        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        const [first, second] = browser.getUserMedia.mock.calls.map(([constraints]) => constraints);
        expect([exactDeviceId(first.video), exactDeviceId(first.audio)]).toEqual(["cam-gone", "mic-headset"]);
        expect([exactDeviceId(second.video), exactDeviceId(second.audio)]).toEqual([undefined, undefined]);
        expect(get(m.requestedMicrophoneDeviceIdStore)).toBe(undefined);
        expect(current(m)).toEqual([
            { kind: "video", id: "video-0" },
            { kind: "audio", id: "audio-1" },
        ]);
    });

    it("away mode releases the camera and keeps the microphone, and coming back asks for the camera alone", async () => {
        m = await loadMediaStore();
        await enterRoom(m);
        const [video, audio] = browser.tracks;

        window.dispatchEvent(new Event("blur"));
        await settle();
        expect(video.stop).toHaveBeenCalledTimes(1);
        expect(audio.stop).not.toHaveBeenCalled();
        expect(browser.getUserMedia).toHaveBeenCalledTimes(1);
        expect(current(m)).toEqual([{ kind: "audio", id: "audio-1" }]);

        window.dispatchEvent(new Event("focus"));
        await settle();
        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 1)).toEqual({ video: true, audio: false });
    });

    it("energy saving releases the camera and the microphone after 10 s idle outside a conversation, and a conversation asks for both at once", async () => {
        m = await loadMediaStore();
        await enterRoom(m);
        const [video, audio] = browser.tracks;

        await vi.advanceTimersByTimeAsync(9_000);
        expect(video.stop).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1_500);
        await settle();
        expect(video.stop).toHaveBeenCalledTimes(1);
        expect(audio.stop).toHaveBeenCalledTimes(1);
        expect(browser.getUserMedia).toHaveBeenCalledTimes(1);

        m.currentPlayerGroupIdStore.set(7);
        await settle();
        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 1)).toEqual({ video: true, audio: true });
    });

    it("MD-02 (pinned): a change during a pending request throws away its whole stream, then reopens the microphone it still wanted", async () => {
        m = await loadMediaStore();
        const release = browser.holdNext();
        await enterRoom(m);
        expect(browser.getUserMedia).toHaveBeenCalledTimes(1);

        m.requestedCameraState.disableWebcam();
        await settle();
        release();
        await settle();

        const [firstVideo, firstAudio] = browser.tracks;
        expect(firstVideo.stop).toHaveBeenCalledTimes(1);
        expect(firstAudio.stop).toHaveBeenCalledTimes(1);
        expect(m.seen.some((value) => tracksOf(value).some((track) => track.id === firstAudio.id))).toBe(false);
        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 1)).toEqual({ video: false, audio: true });
        expect(current(m)).toEqual([{ kind: "audio", id: "audio-2" }]);
    });

    it("lists the devices once the first stream exists and on each device change, and asks again for a default microphone that was unplugged", async () => {
        m = await loadMediaStore();
        expect(browser.mediaDevices.enumerateDevices).not.toHaveBeenCalled();
        await enterRoom(m);
        expect(browser.mediaDevices.enumerateDevices).toHaveBeenCalledTimes(1);
        expect(get(m.devicesNotLoaded)).toBe(false);
        expect(get(m.microphoneListStore)?.map((device) => device.deviceId)).toEqual(["mic-1"]);

        browser.changeDevices([
            ["videoinput", "cam-1"],
            ["audioinput", "mic-2"],
        ]);
        await settle();
        expect(browser.mediaDevices.enumerateDevices).toHaveBeenCalledTimes(2);
        expect(get(m.lastNewMediaDeviceDetectedStore).map((device) => device.deviceId)).toEqual(["mic-2"]);
        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 1)).toEqual({ video: false, audio: true });
        expect(browser.tracks[1].stop).toHaveBeenCalledTimes(1);
        expect(current(m)).toEqual([
            { kind: "video", id: "video-0" },
            { kind: "audio", id: "audio-2" },
        ]);
    });
});
