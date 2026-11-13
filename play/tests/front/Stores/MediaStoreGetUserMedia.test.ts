import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
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

class FakePermissionStatus extends EventTarget {
    state: PermissionState = "prompt";

    change(state: PermissionState): void {
        this.state = state;
        this.dispatchEvent(new Event("change"));
    }
}

// The browser's permission state per device. MediaStatusStore queries it when MediaStore's module graph loads, so a
// test installs it before loadMediaStore.
function fakePermissions(): Record<"camera" | "microphone", FakePermissionStatus> {
    const statuses = { camera: new FakePermissionStatus(), microphone: new FakePermissionStatus() };
    Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query: ({ name }: { name: "camera" | "microphone" }) => Promise.resolve(statuses[name]) },
    });
    return statuses;
}

// Subscribes until the test ends, as the mounted action-bar tooltip does, and returns every value the store gave. The
// browser permission state under the help contexts follows the browser only while something subscribes to it, and
// get() subscribes only for the read.
function valuesUntilTestEnds<T>(store: Readable<T>): T[] {
    const values: T[] = [];
    onTestFinished(store.subscribe((value) => values.push(value)));
    return values;
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

// What differs between the camera and the microphone in a row that runs for either: the stores, the first request,
// where the microphone fails alone and the camera then opens the stream that reads the first device list, what it
// takes for MediaStore to see "granted" for every device that request asks for, and the request the user makes for a
// device that a failure turned off. The camera's first request asks for the microphone too.
function deviceUnderTest(m: Loaded, device: "camera" | "microphone") {
    if (device === "camera") {
        return {
            issueStore: m.cameraAccessIssueStore,
            accessDeniedStore: m.cameraAccessDeniedStore,
            helpContextStore: m.cameraButtonHelpContextStore,
            requestedState: m.requestedCameraState,
            askForTheFirstTime: () => enterRoom(m),
            // The row's help context keeps the camera's permission state following the browser. The microphone's
            // needs a subscription of its own (see valuesUntilTestEnds).
            haveMediaStoreSeeGrantedForFirstRequest: (permissions: ReturnType<typeof fakePermissions>) => {
                valuesUntilTestEnds(m.microphoneButtonHelpContextStore);
                permissions.camera.change("granted");
                permissions.microphone.change("granted");
            },
            askAgain: async () => {
                m.requestedCameraState.enableWebcam();
                await settle();
            },
        };
    }
    return {
        issueStore: m.microphoneAccessIssueStore,
        accessDeniedStore: m.microphoneAccessDeniedStore,
        helpContextStore: m.microphoneButtonHelpContextStore,
        requestedState: m.requestedMicrophoneState,
        askForTheFirstTime: async () => {
            m.myMicrophoneStore.set(true);
            await settle();
            m.myCameraStore.set(true);
            await settle();
        },
        haveMediaStoreSeeGrantedForFirstRequest: (permissions: ReturnType<typeof fakePermissions>) => {
            permissions.microphone.change("granted");
        },
        askAgain: async () => {
            m.requestedMicrophoneState.enableMicrophone();
            await settle();
        },
    };
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
        Reflect.deleteProperty(navigator, "permissions");
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

    it("MD-03 (fixed): a camera the user denies turns the camera off, asks again for the microphone alone, and keeps the denial until the camera is asked for again", async () => {
        m = await loadMediaStore();
        browser.failNext(namedError("NotAllowedError"));
        await enterRoom(m);

        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 0)).toEqual({ video: true, audio: true });
        expect(requested(browser, 1)).toEqual({ video: false, audio: true });
        expect(get(m.requestedCameraState)).toBe(false);
        expect(get(m.requestedMicrophoneState)).toBe(true);
        expect(get(m.cameraAccessIssueStore)).toBe("permission_denied");
        expect(get(m.cameraButtonHelpContextStore)).toBe("permission");
        expect(get(m.microphoneAccessIssueStore)).toBe(null);
        expect(current(m)).toEqual([{ kind: "audio", id: "audio-0" }]);

        m.requestedCameraState.enableWebcam();
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(3);
        expect(requested(browser, 2)).toEqual({ video: true, audio: false });
        expect(get(m.cameraAccessIssueStore)).toBe(null);
        expect(get(m.cameraButtonHelpContextStore)).toBe(null);
        expect(current(m)).toEqual([
            { kind: "audio", id: "audio-0" },
            { kind: "video", id: "video-1" },
        ]);
    });

    it("MD-03 (fixed): a microphone the user denies turns the microphone off and keeps the denial while the camera is asked for, until the microphone is asked for again", async () => {
        m = await loadMediaStore();
        browser.failNext(namedError("NotAllowedError"));
        m.myMicrophoneStore.set(true);
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(1);
        expect(requested(browser, 0)).toEqual({ video: false, audio: true });
        expect(get(m.requestedMicrophoneState)).toBe(false);
        expect(get(m.microphoneAccessIssueStore)).toBe("permission_denied");
        expect(get(m.microphoneButtonHelpContextStore)).toBe("permission");

        m.myCameraStore.set(true);
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 1)).toEqual({ video: true, audio: false });
        expect(get(m.microphoneAccessIssueStore)).toBe("permission_denied");

        m.requestedMicrophoneState.enableMicrophone();
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(3);
        expect(requested(browser, 2)).toEqual({ video: false, audio: true });
        expect(get(m.microphoneAccessIssueStore)).toBe(null);
        expect(current(m)).toEqual([
            { kind: "video", id: "video-0" },
            { kind: "audio", id: "audio-1" },
        ]);
    });

    it("a camera the browser cannot find (NotFoundError) turns the camera off, records no_device, and asks again for the microphone alone", async () => {
        browser.setDevices([["audioinput", "mic-1"]]);
        m = await loadMediaStore();
        browser.failNext(namedError("NotFoundError"));
        await enterRoom(m);

        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 0)).toEqual({ video: true, audio: true });
        expect(requested(browser, 1)).toEqual({ video: false, audio: true });
        expect(m.seen.flatMap((value) => (value.type === "error" ? [value.error.name] : []))).toEqual([
            "NotFoundError",
        ]);
        expect(get(m.requestedCameraState)).toBe(false);
        expect(get(m.requestedMicrophoneState)).toBe(true);
        expect(get(m.cameraAccessIssueStore)).toBe("no_device");
        expect(get(m.cameraButtonHelpContextStore)).toBe("no_device");
        expect(get(m.microphoneAccessIssueStore)).toBe(null);
        expect(get(m.microphoneButtonHelpContextStore)).toBe(null);
        expect(current(m)).toEqual([{ kind: "audio", id: "audio-0" }]);
    });

    it("MD-10 (fixed): a camera the browser could not find (NotFoundError) clears no_device when a camera is plugged in, not when a microphone is, and leaves the camera off", async () => {
        browser.setDevices([["audioinput", "mic-1"]]);
        m = await loadMediaStore();
        browser.failNext(namedError("NotFoundError"));
        await enterRoom(m);

        expect(get(m.cameraAccessIssueStore)).toBe("no_device");
        expect(get(m.cameraButtonHelpContextStore)).toBe("no_device");

        browser.changeDevices([
            ["audioinput", "mic-1"],
            ["audioinput", "mic-2"],
        ]);
        await settle();
        expect(get(m.cameraAccessIssueStore)).toBe("no_device");

        browser.changeDevices([
            ["videoinput", "cam-1"],
            ["audioinput", "mic-1"],
            ["audioinput", "mic-2"],
        ]);
        await settle();

        expect(get(m.lastNewMediaDeviceDetectedStore).map((device) => device.deviceId)).toEqual(["cam-1"]);
        expect(get(m.cameraListStore)?.map((device) => device.deviceId)).toEqual(["cam-1"]);
        expect(get(m.cameraAccessIssueStore)).toBe(null);
        expect(get(m.cameraButtonHelpContextStore)).toBe(null);
        expect(get(m.requestedCameraState)).toBe(false);
        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);

        m.requestedCameraState.enableWebcam();
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(3);
        expect(requested(browser, 2)).toEqual({ video: true, audio: false });
        expect(get(m.cameraAccessIssueStore)).toBe(null);
        expect(get(m.cameraButtonHelpContextStore)).toBe(null);
    });

    it("MD-10 (fixed): a microphone the browser could not find (NotFoundError) clears no_device when a microphone is plugged in, not when a camera is, and leaves the microphone off", async () => {
        browser.setDevices([["videoinput", "cam-1"]]);
        m = await loadMediaStore();
        browser.failNext(namedError("NotFoundError"));
        m.myMicrophoneStore.set(true);
        await settle();

        expect(get(m.requestedMicrophoneState)).toBe(false);
        expect(get(m.microphoneAccessIssueStore)).toBe("no_device");
        expect(get(m.microphoneButtonHelpContextStore)).toBe("no_device");

        m.myCameraStore.set(true);
        await settle();
        browser.changeDevices([
            ["videoinput", "cam-1"],
            ["videoinput", "cam-2"],
        ]);
        await settle();
        expect(get(m.microphoneAccessIssueStore)).toBe("no_device");

        browser.changeDevices([
            ["videoinput", "cam-1"],
            ["videoinput", "cam-2"],
            ["audioinput", "mic-1"],
        ]);
        await settle();

        expect(get(m.lastNewMediaDeviceDetectedStore).map((device) => device.deviceId)).toEqual(["mic-1"]);
        expect(get(m.microphoneListStore)?.map((device) => device.deviceId)).toEqual(["mic-1"]);
        expect(get(m.microphoneAccessIssueStore)).toBe(null);
        expect(get(m.microphoneButtonHelpContextStore)).toBe(null);
        expect(get(m.requestedMicrophoneState)).toBe(false);
        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);

        m.requestedMicrophoneState.enableMicrophone();
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(3);
        expect(requested(browser, 2)).toEqual({ video: false, audio: true });
        expect(get(m.microphoneAccessIssueStore)).toBe(null);
        expect(get(m.microphoneButtonHelpContextStore)).toBe(null);
    });

    it.each([
        ["camera", "videoinput"],
        ["microphone", "audioinput"],
    ] as const)(
        "MD-10 (fixed): a %s the browser could not find (NotFoundError) before any device list was read clears no_device when the first list holds one, and stays off",
        async (device, kind) => {
            browser.setDevices([]);
            m = await loadMediaStore();
            const [turnOn, issue, helpContext] =
                device === "camera"
                    ? ([m.myCameraStore, m.cameraAccessIssueStore, m.cameraButtonHelpContextStore] as const)
                    : ([
                          m.myMicrophoneStore,
                          m.microphoneAccessIssueStore,
                          m.microphoneButtonHelpContextStore,
                      ] as const);
            browser.failNext(namedError("NotFoundError"));
            turnOn.set(true);
            await settle();

            expect(get(issue)).toBe("no_device");
            expect(browser.mediaDevices.enumerateDevices).not.toHaveBeenCalled();

            browser.changeDevices([[kind, `${device}-1`]]);
            await settle();

            expect(browser.mediaDevices.enumerateDevices).toHaveBeenCalledTimes(1);
            expect(get(m.lastNewMediaDeviceDetectedStore)).toEqual([]);
            expect(get(issue)).toBe(null);
            expect(get(helpContext)).toBe(null);
            expect(browser.getUserMedia).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        ["camera", "NotAllowedError", "permission_denied", "permission"],
        ["camera", "NotReadableError", "device_in_use", "device_in_use"],
        ["microphone", "NotAllowedError", "permission_denied", "permission"],
        ["microphone", "NotReadableError", "device_in_use", "device_in_use"],
    ] as const)(
        "MD-10 (fixed): a %s plugged in after a %s keeps %s: it grants no permission and frees no held device",
        async (device, errorName, issue, helpContext) => {
            m = await loadMediaStore();
            browser.failNext(namedError(errorName));
            if (device === "camera") {
                await enterRoom(m);
            } else {
                // The microphone fails alone, then the camera opens the stream that reads the first device list.
                m.myMicrophoneStore.set(true);
                await settle();
                m.myCameraStore.set(true);
                await settle();
            }
            const [issueStore, helpContextStore] =
                device === "camera"
                    ? ([m.cameraAccessIssueStore, m.cameraButtonHelpContextStore] as const)
                    : ([m.microphoneAccessIssueStore, m.microphoneButtonHelpContextStore] as const);
            const plugged: [MediaDeviceKind, string] =
                device === "camera" ? ["videoinput", "cam-2"] : ["audioinput", "mic-2"];
            expect(get(issueStore)).toBe(issue);

            browser.changeDevices([["videoinput", "cam-1"], ["audioinput", "mic-1"], plugged]);
            await settle();

            expect(get(m.lastNewMediaDeviceDetectedStore).map(({ deviceId }) => deviceId)).toEqual([plugged[1]]);
            expect(get(issueStore)).toBe(issue);
            expect(get(helpContextStore)).toBe(helpContext);
        },
    );

    it("MD-10 (fixed): a camera plugged in after a NotFoundError, then unplugged, leaves no access issue, and the help context falls back to no_device through the empty camera list", async () => {
        browser.setDevices([["audioinput", "mic-1"]]);
        m = await loadMediaStore();
        browser.failNext(namedError("NotFoundError"));
        await enterRoom(m);
        expect(get(m.cameraAccessIssueStore)).toBe("no_device");

        browser.changeDevices([
            ["videoinput", "cam-1"],
            ["audioinput", "mic-1"],
        ]);
        await settle();
        expect(get(m.cameraAccessIssueStore)).toBe(null);
        expect(get(m.cameraButtonHelpContextStore)).toBe(null);

        browser.changeDevices([["audioinput", "mic-1"]]);
        await settle();

        expect(get(m.cameraListStore)).toEqual([]);
        expect(get(m.cameraAccessIssueStore)).toBe(null);
        expect(get(m.cameraButtonHelpContextStore)).toBe("no_device");
        expect(get(m.requestedCameraState)).toBe(false);
        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
    });

    it.each<["camera" | "microphone", string, "permission" | "no_device" | null, Array<[MediaDeviceKind, string]>]>([
        ["camera", "no camera listed", "no_device", [["audioinput", "mic-1"]]],
        [
            "camera",
            "a camera listed",
            null,
            [
                ["videoinput", "cam-1"],
                ["audioinput", "mic-1"],
            ],
        ],
        ["microphone", "no microphone listed", "no_device", [["videoinput", "cam-1"]]],
        [
            "microphone",
            "a microphone listed",
            null,
            [
                ["videoinput", "cam-1"],
                ["audioinput", "mic-1"],
            ],
        ],
    ])(
        "MD-12 (fixed): a %s the user denied, then allowed in the browser, with %s, keeps the denial, stays off, and the help context falls back to the device list: %s",
        async (device, _listed, helpContext, devices) => {
            const permissions = fakePermissions();
            browser.setDevices(devices);
            m = await loadMediaStore();
            const { issueStore, helpContextStore, requestedState, askForTheFirstTime } = deviceUnderTest(m, device);
            const helpContexts = valuesUntilTestEnds(helpContextStore);
            browser.failNext(namedError("NotAllowedError"));
            await askForTheFirstTime();
            permissions[device].change("denied");
            expect(get(issueStore)).toBe("permission_denied");
            expect(helpContexts.at(-1)).toBe("permission");
            const requests = browser.getUserMedia.mock.calls.length;

            permissions[device].change("granted");

            expect(get(issueStore)).toBe("permission_denied");
            expect(helpContexts.at(-1)).toBe(helpContext);
            expect(get(requestedState)).toBe(false);
            expect(browser.getUserMedia).toHaveBeenCalledTimes(requests);
        },
    );

    it.each(["camera", "microphone"] as const)(
        "MD-12: a %s request the browser denies while it reports every device the request asks for as granted records the denial, turns the device off, and the help context says permission, as the panel's rule does, until the device is asked for again",
        async (device) => {
            const permissions = fakePermissions();
            m = await loadMediaStore();
            const {
                issueStore,
                accessDeniedStore,
                helpContextStore,
                requestedState,
                askForTheFirstTime,
                haveMediaStoreSeeGrantedForFirstRequest,
                askAgain,
            } = deviceUnderTest(m, device);
            const helpContexts = valuesUntilTestEnds(helpContextStore);
            const accessDenied = valuesUntilTestEnds(accessDeniedStore);
            haveMediaStoreSeeGrantedForFirstRequest(permissions);
            await settle();
            browser.failNext(namedError("NotAllowedError"));
            await askForTheFirstTime();

            expect(get(issueStore)).toBe("permission_denied");
            expect(get(requestedState)).toBe(false);
            expect(helpContexts.at(-1)).toBe("permission");
            expect(accessDenied.at(-1)).toBe(true);

            await askAgain();

            expect(helpContexts.at(-1)).toBe(null);
            expect(accessDenied.at(-1)).toBe(false);
        },
    );

    it.each(["camera", "microphone"] as const)(
        "MD-12 (fixed): a %s denied while the browser reported granted, then denied again while it reports prompt, falls back to the device list once the browser reports granted",
        async (device) => {
            const permissions = fakePermissions();
            m = await loadMediaStore();
            const {
                issueStore,
                helpContextStore,
                askForTheFirstTime,
                haveMediaStoreSeeGrantedForFirstRequest,
                askAgain,
            } = deviceUnderTest(m, device);
            const helpContexts = valuesUntilTestEnds(helpContextStore);
            haveMediaStoreSeeGrantedForFirstRequest(permissions);
            await settle();
            browser.failNext(namedError("NotAllowedError"));
            await askForTheFirstTime();
            expect(helpContexts.at(-1)).toBe("permission");
            permissions[device].change("prompt");
            browser.failNext(namedError("NotAllowedError"));
            await askAgain();
            expect(get(issueStore)).toBe("permission_denied");
            expect(helpContexts.at(-1)).toBe("permission");

            permissions[device].change("granted");

            expect(get(issueStore)).toBe("permission_denied");
            expect(helpContexts.at(-1)).toBe(null);
        },
    );

    it.each(["camera", "microphone"] as const)(
        "MD-12 (fixed): a %s denied while the browser reported granted is shown as blocked only until it is asked for again: when that request fails with NotReadableError, the help context says device_in_use",
        async (device) => {
            const permissions = fakePermissions();
            m = await loadMediaStore();
            const {
                accessDeniedStore,
                helpContextStore,
                askForTheFirstTime,
                haveMediaStoreSeeGrantedForFirstRequest,
                askAgain,
            } = deviceUnderTest(m, device);
            const helpContexts = valuesUntilTestEnds(helpContextStore);
            const accessDenied = valuesUntilTestEnds(accessDeniedStore);
            haveMediaStoreSeeGrantedForFirstRequest(permissions);
            await settle();
            browser.failNext(namedError("NotAllowedError"));
            await askForTheFirstTime();
            expect(accessDenied.at(-1)).toBe(true);
            browser.failNext(namedError("NotReadableError"));
            await askAgain();

            expect(accessDenied.at(-1)).toBe(false);
            expect(helpContexts.at(-1)).toBe("device_in_use");
        },
    );

    it("MD-12 (fixed): one request for both devices that the browser denies while it reports the camera as granted and the microphone as prompt, then a denied retry for the microphone alone, records the denial against the camera, turns the camera off, and says access is blocked for the microphone, not for the camera", async () => {
        const permissions = fakePermissions();
        m = await loadMediaStore();
        const cameraHelpContexts = valuesUntilTestEnds(m.cameraButtonHelpContextStore);
        const cameraAccessDenied = valuesUntilTestEnds(m.cameraAccessDeniedStore);
        const microphoneHelpContexts = valuesUntilTestEnds(m.microphoneButtonHelpContextStore);
        const microphoneAccessDenied = valuesUntilTestEnds(m.microphoneAccessDeniedStore);
        permissions.camera.change("granted");
        await settle();
        browser.failNext(namedError("NotAllowedError"));
        browser.failNext(namedError("NotAllowedError"));
        await enterRoom(m);

        expect(get(m.cameraAccessIssueStore)).toBe("permission_denied");
        expect(get(m.requestedCameraState)).toBe(false);
        expect(cameraHelpContexts.at(-1)).toBe(null);
        expect(cameraAccessDenied.at(-1)).toBe(false);
        expect(get(m.microphoneAccessIssueStore)).toBe("permission_denied");
        expect(microphoneAccessDenied.at(-1)).toBe(true);
        expect(microphoneHelpContexts.at(-1)).toBe("permission");
    });

    it("MD-12 (fixed): a request for the camera alone that the browser denies while it reports the camera as granted and the microphone as prompt says access is blocked for the camera, not for the microphone", async () => {
        const permissions = fakePermissions();
        m = await loadMediaStore();
        const cameraHelpContexts = valuesUntilTestEnds(m.cameraButtonHelpContextStore);
        const cameraAccessDenied = valuesUntilTestEnds(m.cameraAccessDeniedStore);
        const microphoneAccessDenied = valuesUntilTestEnds(m.microphoneAccessDeniedStore);
        permissions.camera.change("granted");
        await settle();
        browser.failNext(namedError("NotAllowedError"));
        m.myCameraStore.set(true);
        await settle();

        expect(get(m.cameraAccessIssueStore)).toBe("permission_denied");
        expect(cameraAccessDenied.at(-1)).toBe(true);
        expect(cameraHelpContexts.at(-1)).toBe("permission");
        expect(microphoneAccessDenied.at(-1)).toBe(false);
    });

    it("MD-09 (fixed): a camera the browser cannot read (NotReadableError, taken by another application) turns the camera off, keeps the microphone, and records device_in_use until the camera is asked for again", async () => {
        m = await loadMediaStore();
        browser.failNext(namedError("NotReadableError"));
        await enterRoom(m);

        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 0)).toEqual({ video: true, audio: true });
        expect(requested(browser, 1)).toEqual({ video: false, audio: true });
        expect(m.seen.flatMap((value) => (value.type === "error" ? [value.error.name] : []))).toEqual([
            "NotReadableError",
        ]);
        expect(get(m.requestedCameraState)).toBe(false);
        expect(get(m.requestedMicrophoneState)).toBe(true);
        expect(get(m.cameraAccessIssueStore)).toBe("device_in_use");
        expect(get(m.cameraButtonHelpContextStore)).toBe("device_in_use");
        expect(get(m.microphoneAccessIssueStore)).toBe(null);
        expect(get(m.microphoneButtonHelpContextStore)).toBe(null);
        expect(current(m)).toEqual([{ kind: "audio", id: "audio-0" }]);

        m.requestedCameraState.enableWebcam();
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(3);
        expect(requested(browser, 2)).toEqual({ video: true, audio: false });
        expect(get(m.cameraAccessIssueStore)).toBe(null);
        expect(get(m.cameraButtonHelpContextStore)).toBe(null);
        expect(current(m)).toEqual([
            { kind: "audio", id: "audio-0" },
            { kind: "video", id: "video-1" },
        ]);
    });

    it("MD-09 (fixed): a microphone the browser cannot read (NotReadableError) turns the microphone off and records device_in_use while the camera is asked for, until the microphone is asked for again", async () => {
        m = await loadMediaStore();
        browser.failNext(namedError("NotReadableError"));
        m.myMicrophoneStore.set(true);
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(1);
        expect(requested(browser, 0)).toEqual({ video: false, audio: true });
        expect(get(m.requestedMicrophoneState)).toBe(false);
        expect(get(m.microphoneAccessIssueStore)).toBe("device_in_use");
        expect(get(m.microphoneButtonHelpContextStore)).toBe("device_in_use");

        m.myCameraStore.set(true);
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(2);
        expect(requested(browser, 1)).toEqual({ video: true, audio: false });
        expect(get(m.microphoneAccessIssueStore)).toBe("device_in_use");
        expect(get(m.microphoneButtonHelpContextStore)).toBe("device_in_use");
        expect(get(m.cameraAccessIssueStore)).toBe(null);

        m.requestedMicrophoneState.enableMicrophone();
        await settle();

        expect(browser.getUserMedia).toHaveBeenCalledTimes(3);
        expect(requested(browser, 2)).toEqual({ video: false, audio: true });
        expect(get(m.microphoneAccessIssueStore)).toBe(null);
        expect(get(m.microphoneButtonHelpContextStore)).toBe(null);
        expect(current(m)).toEqual([
            { kind: "video", id: "video-0" },
            { kind: "audio", id: "audio-1" },
        ]);
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
