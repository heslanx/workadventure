// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/unbound-method -- expect() on vi.fn() members of module mocks */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount, type Component } from "svelte";
import { get, type Readable, type Writable } from "svelte/store";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { playOnSelectedOutput } from "../../../WebRtc/AudioOutputManager";
import type * as UplinkCapModule from "../../../WebRtc/UplinkCap";
import { requestUplinkCapClear, uplinkCapStore } from "../../../WebRtc/UplinkCap";
import { bandwidthConstrainedPreferenceStore } from "../../../Stores/BandwidthConstrainedPreferenceStore";
import {
    cameraListStore,
    microphoneListStore,
    requestedCameraDeviceIdStore,
    requestedMicrophoneDeviceIdStore,
    videoQualityStore,
} from "../../../Stores/MediaStore";
import {
    browserNoiseSuppressionSupportedStore,
    microphoneAutoGainControlStore,
    microphoneBrowserNoiseSuppressionStore,
    microphoneEchoCancellationStore,
    noiseSuppressionEnabledStore,
    noiseSuppressionEngineStore,
    noiseSuppressionProviderStore,
    voiceIsolationSupportedStore,
} from "../../../Stores/NoiseSuppressionStore";
import { allowPictureInPictureStore, volumeProximityDiscussionStore } from "../../../Stores/PeerStore";
import { screenShareQualityStore } from "../../../Stores/ScreenSharingStore";
import { FEATURES_KEY, parseFeatures } from "../domain/effectSwitches";
import { pauseTileAnimations } from "../stores/gameCommands";
import { closePreferences } from "../stores/preferencesStore";
import MediaPane from "./MediaPane.svelte";
import MiniPane from "./MiniPane.svelte";
import NotificationsPane from "./NotificationsPane.svelte";
import PerformancePane from "./PerformancePane.svelte";
import SoundsPane from "./SoundsPane.svelte";

/** The module mocks below make these stores writable; their real types only expose their own setters. */
function writableMock<T>(store: Readable<T>): Writable<T> {
    return store as unknown as Writable<T>;
}

// One section per kind of storage: a saved setting (localUserStore), an upstream store, and the effect switches in
// localStorage. Each test presses a switch and checks the write went through the API upstream's own screen uses.

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy(() => keys.join("."), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
// The saved values stay readable after a write, as the panes read them back.
const initialSaved = {
    notification: false,
    askSites: false,
    ignoreFollow: false,
    noAnimations: false,
    cameraHidden: false,
    microphoneHidden: false,
    lowerMusic: false,
    blockAudio: false,
    bubbleSound: "ding",
    chatSounds: true,
};
const saved = vi.hoisted(() => ({
    notification: false,
    askSites: false,
    ignoreFollow: false,
    noAnimations: false,
    cameraHidden: false,
    microphoneHidden: false,
    lowerMusic: false,
    blockAudio: false,
    bubbleSound: "ding",
    chatSounds: true,
}));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: {
        getNotification: vi.fn(() => saved.notification),
        setNotification: vi.fn((value: boolean) => {
            saved.notification = value;
        }),
        getForceCowebsiteTrigger: vi.fn(() => saved.askSites),
        setForceCowebsiteTrigger: vi.fn((value: boolean) => {
            saved.askSites = value;
        }),
        getIgnoreFollowRequests: vi.fn(() => saved.ignoreFollow),
        setIgnoreFollowRequests: vi.fn((value: boolean) => {
            saved.ignoreFollow = value;
        }),
        getDisableAnimations: vi.fn(() => saved.noAnimations),
        setDisableAnimations: vi.fn((value: boolean) => {
            saved.noAnimations = value;
        }),
        getCameraPrivacySettings: vi.fn(() => saved.cameraHidden),
        setCameraPrivacySettings: vi.fn((value: boolean) => {
            saved.cameraHidden = value;
        }),
        getMicrophonePrivacySettings: vi.fn(() => saved.microphoneHidden),
        setMicrophonePrivacySettings: vi.fn((value: boolean) => {
            saved.microphoneHidden = value;
        }),
        getDecreaseAudioPlayerVolumeWhileTalking: vi.fn(() => saved.lowerMusic),
        setDecreaseAudioPlayerVolumeWhileTalking: vi.fn((value: boolean) => {
            saved.lowerMusic = value;
        }),
        getBlockAudio: vi.fn(() => saved.blockAudio),
        setBlockAudio: vi.fn((value: boolean) => {
            saved.blockAudio = value;
        }),
        getBubbleSound: vi.fn(() => saved.bubbleSound),
        setBubbleSound: vi.fn((value: string) => {
            saved.bubbleSound = value;
        }),
        getChatSounds: vi.fn(() => saved.chatSounds),
        setChatSounds: vi.fn((value: boolean) => {
            saved.chatSounds = value;
        }),
        getAudioPlayerVolume: vi.fn(() => 1),
        setAudioPlayerVolume: vi.fn(),
        setAudioPlayerMuted: vi.fn(),
        setVolumeProximityDiscussion: vi.fn(),
        setPreferredVideoInputDevice: vi.fn(),
        setPreferredAudioInputDevice: vi.fn(),
    },
}));
vi.mock("../../../Connection/ConnectionManager", () => ({ connectionManager: { currentRoom: undefined } }));
vi.mock("../../../Connection/Room", () => ({
    Room: { DEFAULT_CAMERA_PRIVACY_SETTINGS: false, DEFAULT_MICROPHONE_PRIVACY_SETTINGS: false },
}));
// The stores stay real; the request to take the cap off by hand is a spy, as the detector that answers it is not here.
vi.mock("../../../WebRtc/UplinkCap", async (importOriginal) => ({
    ...(await importOriginal<typeof UplinkCapModule>()),
    requestUplinkCapClear: vi.fn(),
}));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Stores/BrowserNotificationStore", () => ({ browserNotificationStore: { refresh: vi.fn() } }));
vi.mock("../../../Stores/PeerStore", async () => {
    const { writable } = await import("svelte/store");
    const allow = writable(true);
    return {
        volumeProximityDiscussionStore: { subscribe: writable(1).subscribe, set: vi.fn() },
        allowPictureInPictureStore: { subscribe: allow.subscribe, set: vi.fn(allow.set) },
        askPictureInPictureActivatingStore: writable(false),
        pictureInPictureSupportedStore: writable(true),
    };
});
vi.mock("../../../Stores/StreamableCollectionStore", async () => {
    const { writable } = await import("svelte/store");
    return { isInRemoteConversation: writable(false) };
});
// The media and sound panes' upstream stores: each setter is a spy, so a test sees which store a control reached.
vi.mock("../../../Stores/AudioOutputStore", async () => {
    const { writable } = await import("svelte/store");
    return { speakerSelectedStore: writable<string | undefined>(undefined), speakerSelectionSupported: false };
});
vi.mock("../../../Stores/BandwidthConstrainedPreferenceStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        bandwidthConstrainedPreferenceStore: { ...writable("balanced"), setPreference: vi.fn() },
    };
});
vi.mock("../../../Stores/DisplayVideoQualityStore", async () => {
    const { writable } = await import("svelte/store");
    return { displayVideoQualityStore: writable(false) };
});
vi.mock("../../../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    const devices = (deviceId: string, label: string) => [{ deviceId, label } as MediaDeviceInfo];
    return {
        cameraListStore: writable(devices("camera-1", "Front camera")),
        microphoneListStore: writable(devices("microphone-1", "Desk microphone")),
        speakerListStore: writable<MediaDeviceInfo[]>([]),
        requestedCameraDeviceIdStore: { ...writable<string | undefined>(undefined), set: vi.fn() },
        requestedMicrophoneDeviceIdStore: { ...writable<string | undefined>(undefined), set: vi.fn() },
        requestedCameraState: { ...writable(false), enableWebcam: vi.fn(), disableWebcam: vi.fn() },
        requestedMicrophoneState: { ...writable(false), enableMicrophone: vi.fn(), disableMicrophone: vi.fn() },
        usedCameraDeviceIdStore: writable<string | undefined>(undefined),
        usedMicrophoneDeviceIdStore: writable<string | undefined>(undefined),
        silentStore: writable(false),
        videoQualityStore: { ...writable("recommended"), setQuality: vi.fn() },
    };
});
vi.mock("../../../Stores/NoiseSuppressionStore", async () => {
    const { derived, writable } = await import("svelte/store");
    const toggle = (on: boolean) => ({ ...writable(on), setEnabled: vi.fn() });
    const enabled = { ...writable(false), setEnabled: vi.fn() };
    const provider = { ...writable("workadventure"), setProvider: vi.fn() };
    const voiceIsolationSupported = writable(false);
    return {
        browserNoiseSuppressionSupportedStore: writable(false),
        voiceIsolationSupportedStore: voiceIsolationSupported,
        microphoneAutoGainControlStore: toggle(false),
        microphoneBrowserNoiseSuppressionStore: toggle(false),
        microphoneEchoCancellationStore: toggle(false),
        noiseSuppressionEnabledStore: enabled,
        noiseSuppressionProviderStore: provider,
        effectiveNoiseSuppressionProviderStore: derived(provider, (value) => value),
        noiseSuppressionEngineStore: { ...writable("deepfilternet"), setEngine: vi.fn() },
        noiseSuppressionStateStore: writable({ status: "ready" }),
    };
});
vi.mock("../../../Stores/ScreenSharingStore", async () => {
    const { writable } = await import("svelte/store");
    return { screenShareQualityStore: { ...writable("recommended"), setQuality: vi.fn() } };
});
vi.mock("../../../Stores/AudioManagerStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        audioManagerFileStore: { unloadAudio: vi.fn() },
        audioManagerVisibilityStore: { set: vi.fn() },
        audioManagerVolumeStore: {
            ...writable({ muted: false }),
            setDecreaseWhileTalking: vi.fn(),
            setVolume: vi.fn(),
            setMuted: vi.fn(),
        },
        bubbleSoundStore: { set: vi.fn() },
    };
});
vi.mock("../../../Stores/BackgroundTransformStore", () => ({ backgroundConfigStore: {} }));
vi.mock("../../../WebRtc/AudioOutputManager", () => ({
    playSpeakerTestSound: vi.fn(() => Promise.resolve()),
    playOnSelectedOutput: vi.fn(() => Promise.resolve()),
}));
// The camera test and background picker draw upstream's live camera; the wiring under test is in the pane itself.
vi.mock("./CameraPreview.svelte", () => ({ default: () => undefined }));
vi.mock("./CameraBackground.svelte", () => ({ default: () => undefined }));
vi.mock("../stores/preferencesStore", () => ({ closePreferences: vi.fn() }));
vi.mock("../stores/gameCommands", () => ({ pauseTileAnimations: vi.fn() }));

describe("the preference sections", () => {
    const target = document.createElement("div");
    let pane: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mounted = pane;
        pane = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        localStorage.clear();
        Object.assign(saved, initialSaved);
        writableMock(cameraListStore).set([{ deviceId: "camera-1", label: "Front camera" } as MediaDeviceInfo]);
        writableMock(microphoneListStore).set([
            { deviceId: "microphone-1", label: "Desk microphone" } as MediaDeviceInfo,
        ]);
        writableMock(noiseSuppressionEnabledStore).set(false);
        writableMock(voiceIsolationSupportedStore).set(false);
        browserNoiseSuppressionSupportedStore.set(false);
        writableMock(noiseSuppressionProviderStore).set("workadventure");
        uplinkCapStore.set(false);
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    function show(component: Component): void {
        document.body.append(target);
        pane = mount(component, { target });
        flushSync();
    }

    /** The switch whose title is the text of `key`. */
    function switchFor(key: string): HTMLButtonElement {
        const title = [...target.querySelectorAll("b")].find((element) => element.textContent === key);
        const button = target.querySelector<HTMLButtonElement>(`[role="switch"][aria-labelledby="${title?.id}"]`);
        if (!button) throw new Error(`no switch titled ${key}`);
        return button;
    }

    /** The element of `selector` labelled by the title whose text is the text of `key`. */
    function labelledBy<T extends HTMLElement>(selector: string, key: string): T {
        const title = [...target.querySelectorAll("b")].find((element) => element.textContent === key);
        const element = target.querySelector<T>(`${selector}[aria-labelledby="${title?.id}"]`);
        if (!element) throw new Error(`no ${selector} titled ${key}`);
        return element;
    }

    /** Presses the option whose label is the text of `option` in the choice titled `key`. */
    function choose(key: string, option: string): void {
        const radio = [
            ...labelledBy("[role=radiogroup]", key).querySelectorAll<HTMLButtonElement>("[role=radio]"),
        ].find((element) => element.textContent === option);
        if (!radio) throw new Error(`no option ${option} in ${key}`);
        press(radio);
    }

    function pick(key: string, value: string): void {
        const select = labelledBy<HTMLSelectElement>("select", key);
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        flushSync();
    }

    function slide(key: string, value: number): void {
        const slider = labelledBy<HTMLInputElement>("input", key);
        slider.value = String(value);
        slider.dispatchEvent(new Event("change", { bubbles: true }));
        flushSync();
    }

    function press(button: HTMLButtonElement): void {
        button.click();
        flushSync();
    }

    it("saves a localUserStore setting the way upstream's settings do", () => {
        show(NotificationsPane);
        const askSites = switchFor("konclui.preferences.notifications.askSites");
        expect(askSites.getAttribute("aria-checked")).toBe("false");

        press(askSites);

        expect(localUserStore.setForceCowebsiteTrigger).toHaveBeenCalledWith(true);
        expect(askSites.getAttribute("aria-checked")).toBe("true");
        expect(localUserStore.setIgnoreFollowRequests).not.toHaveBeenCalled();
    });

    it("gives every switch its own name, unlike upstream's two cowebsiteTrigger-toggle ids", () => {
        show(NotificationsPane);

        const names = [...target.querySelectorAll('[role="switch"]')].map((element) =>
            element.getAttribute("aria-labelledby"),
        );
        expect(new Set(names).size).toBe(names.length);
    });

    it("keeps the notifications switch focusable and says why where the browser has none", () => {
        show(NotificationsPane);
        const browser = switchFor("konclui.preferences.notifications.browser");

        press(browser);

        expect(browser.getAttribute("aria-disabled")).toBe("true");
        expect(browser.getAttribute("aria-checked")).toBe("false");
        expect(target.textContent).toContain("konclui.preferences.notifications.browserUnsupported");
        expect(localUserStore.setNotification).not.toHaveBeenCalled();
    });

    it("shows the browser's refusal in the switch's hint", async () => {
        const permission = { value: "default" };
        vi.stubGlobal("Notification", {
            get permission() {
                return permission.value;
            },
            requestPermission: vi.fn(() => {
                permission.value = "denied";
                return Promise.resolve("denied");
            }),
        });
        show(NotificationsPane);
        const browser = switchFor("konclui.preferences.notifications.browser");
        expect(target.textContent).not.toContain("browserBlocked");

        press(browser);
        await vi.waitFor(() => {
            flushSync();
            expect(target.textContent).toContain("konclui.preferences.notifications.browserBlocked");
        });

        expect(browser.getAttribute("aria-checked")).toBe("false");
        expect(localUserStore.setNotification).toHaveBeenCalledWith(false);
    });

    it("keeps the mini mode's open-now row, with the reason it cannot open outside a conversation", () => {
        show(MiniPane);
        const row = [...target.querySelectorAll<HTMLButtonElement>(".k-pref-row")].find((element) =>
            element.textContent?.includes("konclui.preferences.mini.openNow"),
        );

        row?.click();
        flushSync();

        expect(row?.getAttribute("aria-disabled")).toBe("true");
        expect(row?.textContent).toContain("konclui.preferences.mini.openNowUnavailable");
        expect(closePreferences).not.toHaveBeenCalled();
    });

    it("writes the mini mode through upstream's store, which saves it", () => {
        show(MiniPane);
        const automatic = switchFor("konclui.preferences.mini.automatic");
        expect(automatic.getAttribute("aria-checked")).toBe("true");

        press(automatic);

        expect(allowPictureInPictureStore.set).toHaveBeenCalledWith(false);
        expect(get(allowPictureInPictureStore)).toBe(false);
        expect(automatic.getAttribute("aria-checked")).toBe("false");
    });

    it("switches an effect through the switches store, which saves it in localStorage for the effects", () => {
        show(PerformancePane);
        const water = switchFor("konclui.preferences.performance.water");
        expect(water.getAttribute("aria-checked")).toBe("true");

        press(water);

        expect(parseFeatures(localStorage.getItem(FEATURES_KEY)).water).toBe(false);
        expect(water.getAttribute("aria-checked")).toBe("false");
    });

    it("chooses an effects level as a radio group and shows a mix of switches as none of them", () => {
        show(PerformancePane);
        const radios = () => [...target.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
        expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);

        press(radios()[0]);
        expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

        press(switchFor("konclui.preferences.performance.water"));
        expect(radios().every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
        expect(target.textContent).toContain("konclui.preferences.performance.custom");
    });

    it("turns the map animations off in the saved setting and in the running map", () => {
        show(PerformancePane);

        const animations = switchFor("konclui.preferences.performance.animations");
        expect(animations.getAttribute("aria-checked")).toBe("true");

        press(animations);

        expect(localUserStore.setDisableAnimations).toHaveBeenCalledWith(true);
        expect(pauseTileAnimations).toHaveBeenCalledWith(true);
        expect(animations.getAttribute("aria-checked")).toBe("false");
    });

    it("leaves out the vignette, which nothing in this client draws", () => {
        show(PerformancePane);

        expect(target.textContent).not.toContain("vignette");
    });

    const media = "konclui.preferences.media";
    const sounds = "konclui.preferences.sounds";

    it("sends the video quality and the screen quality each to its own store", () => {
        show(MediaPane);

        choose(`${media}.videoQuality`, `${media}.qualityHigh`);
        expect(videoQualityStore.setQuality).toHaveBeenCalledWith("high");
        expect(screenShareQualityStore.setQuality).not.toHaveBeenCalled();

        choose(`${media}.screenQuality`, `${media}.qualityLow`);
        expect(screenShareQualityStore.setQuality).toHaveBeenCalledWith("low");
        expect(videoQualityStore.setQuality).toHaveBeenCalledTimes(1);
    });

    it("says the camera quality is lowered for now while the uplink cap is on, and keeps the saved choice selected", () => {
        show(MediaPane);
        const selected = () =>
            [...labelledBy("[role=radiogroup]", `${media}.videoQuality`).querySelectorAll("[role=radio]")]
                .filter((radio) => radio.getAttribute("aria-checked") === "true")
                .map((radio) => radio.textContent);
        expect(target.textContent).toContain(`${media}.videoQualityHint`);

        uplinkCapStore.set(true);
        flushSync();

        expect(target.textContent).toContain(`${media}.videoQualityCapped`);
        expect(target.textContent).not.toContain(`${media}.videoQualityHint`);
        expect(selected()).toEqual([`${media}.qualityRecommended`]);

        uplinkCapStore.set(false);
        flushSync();

        expect(target.textContent).toContain(`${media}.videoQualityHint`);
        expect(target.textContent).not.toContain(`${media}.videoQualityCapped`);
    });

    it("takes the uplink cap off when the selected camera quality is chosen again under it, and saves nothing", () => {
        uplinkCapStore.set(true);
        show(MediaPane);

        choose(`${media}.videoQuality`, `${media}.qualityRecommended`);

        expect(requestUplinkCapClear).toHaveBeenCalledOnce();
        expect(videoQualityStore.setQuality).not.toHaveBeenCalled();
    });

    it("saves another camera quality under the cap as it always did, and leaves the cap to the detector", () => {
        uplinkCapStore.set(true);
        show(MediaPane);

        choose(`${media}.videoQuality`, `${media}.qualityHigh`);

        expect(videoQualityStore.setQuality).toHaveBeenCalledExactlyOnceWith("high");
        expect(requestUplinkCapClear).not.toHaveBeenCalled();
    });

    it("does nothing when the selected camera quality is chosen again and the camera is not capped", () => {
        show(MediaPane);

        choose(`${media}.videoQuality`, `${media}.qualityRecommended`);

        expect(requestUplinkCapClear).not.toHaveBeenCalled();
        expect(videoQualityStore.setQuality).not.toHaveBeenCalled();
    });

    it("stops asking for the cap off once the cap is gone, and starts when it is back", () => {
        show(MediaPane);
        uplinkCapStore.set(true);
        flushSync();
        uplinkCapStore.set(false);
        flushSync();

        choose(`${media}.videoQuality`, `${media}.qualityRecommended`);
        expect(requestUplinkCapClear).not.toHaveBeenCalled();

        uplinkCapStore.set(true);
        flushSync();
        choose(`${media}.videoQuality`, `${media}.qualityRecommended`);
        expect(requestUplinkCapClear).toHaveBeenCalledOnce();
    });

    it("leaves the screen quality out of it: the cap is on the camera only", () => {
        uplinkCapStore.set(true);
        show(MediaPane);

        choose(`${media}.screenQuality`, `${media}.qualityRecommended`);

        expect(requestUplinkCapClear).not.toHaveBeenCalled();
        expect(screenShareQualityStore.setQuality).not.toHaveBeenCalled();
    });

    describe("the button that takes the uplink cap off", () => {
        /** The buttons of the pane that carry the text of `key`: the radios and the switches are never it. */
        const named = (key: string) =>
            [...target.querySelectorAll<HTMLButtonElement>("button:not([role])")].filter(
                (button) => button.textContent?.trim() === key,
            );
        const tryNow = () => named(`${media}.videoQualityTryNow`);
        const selectedCameraQuality = () =>
            [...labelledBy("[role=radiogroup]", `${media}.videoQuality`).querySelectorAll<HTMLElement>("[role=radio]")]
                .filter((radio) => radio.getAttribute("aria-checked") === "true")
                .at(0);

        it("is offered with the camera quality while the cap is on, and goes with it", () => {
            show(MediaPane);
            expect(tryNow()).toEqual([]);

            uplinkCapStore.set(true);
            flushSync();
            expect(tryNow()).toHaveLength(1);

            uplinkCapStore.set(false);
            flushSync();
            expect(tryNow()).toEqual([]);
        });

        it("is offered when the pane opens under a cap", () => {
            uplinkCapStore.set(true);
            show(MediaPane);

            expect(tryNow()).toHaveLength(1);
        });

        it("is in the row of the camera quality, under its note and before its choices", () => {
            uplinkCapStore.set(true);
            show(MediaPane);

            const [button] = tryNow();
            const group = labelledBy("[role=radiogroup]", `${media}.videoQuality`);
            const note = [...target.querySelectorAll("small")].find(
                (small) => small.id === group.getAttribute("aria-describedby"),
            );
            expect(button.closest(".k-pref-item")?.contains(group)).toBe(true);
            expect(note?.textContent).toBe(`${media}.videoQualityCapped`);
            expect(note?.compareDocumentPosition(button)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
            expect(button.compareDocumentPosition(group)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        });

        it("takes the cap off by the same request as choosing the selected quality again, and saves nothing", () => {
            uplinkCapStore.set(true);
            show(MediaPane);

            press(tryNow()[0]);

            expect(requestUplinkCapClear).toHaveBeenCalledOnce();
            expect(videoQualityStore.setQuality).not.toHaveBeenCalled();
        });

        it("keeps choosing the selected quality again as a way out beside it", () => {
            uplinkCapStore.set(true);
            show(MediaPane);

            choose(`${media}.videoQuality`, `${media}.qualityRecommended`);

            expect(requestUplinkCapClear).toHaveBeenCalledOnce();
            expect(tryNow()).toHaveLength(1);
        });

        it("is not offered with the screen quality, nor with the bandwidth: the cap is on the camera only", () => {
            uplinkCapStore.set(true);
            show(MediaPane);

            for (const key of [`${media}.screenQuality`, `${media}.bandwidth`]) {
                const row = labelledBy("[role=radiogroup]", key).closest(".k-pref-item");
                expect(row?.querySelector("button:not([role])")).toBeNull();
            }
            expect(tryNow()).toHaveLength(1);
        });

        it("leaves the focus on the selected camera quality when it takes the cap off, and goes", () => {
            // The detector clears the cap as it hears the request; here the request does it.
            vi.mocked(requestUplinkCapClear).mockImplementationOnce(() => uplinkCapStore.set(false));
            uplinkCapStore.set(true);
            show(MediaPane);
            tryNow()[0].focus();
            expect(document.activeElement).toBe(tryNow()[0]);

            press(tryNow()[0]);

            expect(requestUplinkCapClear).toHaveBeenCalledOnce();
            expect(tryNow()).toEqual([]);
            expect(document.activeElement).not.toBe(document.body);
            expect(document.activeElement).toBe(selectedCameraQuality());
            expect(document.activeElement?.getAttribute("tabindex")).toBe("0");
        });

        it("keeps the note where it is and announces its new text: the camera quality note is one element", () => {
            show(MediaPane);
            const group = labelledBy("[role=radiogroup]", `${media}.videoQuality`);
            const noteOf = () =>
                [...target.querySelectorAll("small")].find(
                    (small) => small.id === group.getAttribute("aria-describedby"),
                );
            const note = noteOf();
            expect(note?.textContent).toBe(`${media}.videoQualityHint`);
            expect(note?.getAttribute("aria-live")).toBe("polite");

            uplinkCapStore.set(true);
            flushSync();
            expect(noteOf()).toBe(note);
            expect(note?.textContent).toBe(`${media}.videoQualityCapped`);

            uplinkCapStore.set(false);
            flushSync();
            expect(noteOf()).toBe(note);
            expect(note?.textContent).toBe(`${media}.videoQualityHint`);
        });
    });

    it("sends the bandwidth preference to its store", () => {
        show(MediaPane);

        choose(`${media}.bandwidth`, `${media}.smoothness`);

        expect(bandwidthConstrainedPreferenceStore.setPreference).toHaveBeenCalledWith("maintain-framerate");
    });

    it("sends each microphone processing switch to its own store", () => {
        browserNoiseSuppressionSupportedStore.set(true);
        show(MediaPane);
        const stores = {
            noise: noiseSuppressionEnabledStore,
            autoGain: microphoneAutoGainControlStore,
            echo: microphoneEchoCancellationStore,
            browserNoise: microphoneBrowserNoiseSuppressionStore,
        };

        for (const [key, store] of Object.entries(stores)) {
            vi.clearAllMocks();

            press(switchFor(`${media}.${key}`));

            expect(store.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
            for (const other of Object.values(stores).filter((candidate) => candidate !== store)) {
                expect(other.setEnabled).not.toHaveBeenCalled();
            }
        }
    });

    it("sends the noise suppression mode and engine to their stores", () => {
        writableMock(noiseSuppressionEnabledStore).set(true);
        writableMock(voiceIsolationSupportedStore).set(true);
        show(MediaPane);

        pick(`${media}.noiseEngine`, "dtln");
        choose(`${media}.noiseMode`, `${media}.noiseVoiceIsolation`);

        expect(noiseSuppressionEngineStore.setEngine).toHaveBeenCalledWith("dtln");
        expect(noiseSuppressionProviderStore.setProvider).toHaveBeenCalledWith("voiceIsolation");
    });

    it("saves the camera and the microphone kept on while hidden each as its own setting", () => {
        show(MediaPane);
        const camera = switchFor(`${media}.cameraHidden`);
        const microphone = switchFor(`${media}.microphoneHidden`);

        press(camera);
        expect(localUserStore.setCameraPrivacySettings).toHaveBeenCalledWith(true);
        expect(localUserStore.setMicrophonePrivacySettings).not.toHaveBeenCalled();
        expect(camera.getAttribute("aria-checked")).toBe("true");
        expect(microphone.getAttribute("aria-checked")).toBe("false");

        press(microphone);
        expect(localUserStore.setMicrophonePrivacySettings).toHaveBeenCalledWith(true);
        expect(localUserStore.setCameraPrivacySettings).toHaveBeenCalledTimes(1);
        expect(microphone.getAttribute("aria-checked")).toBe("true");
    });

    it("chooses the camera and the microphone each through its own device store", () => {
        show(MediaPane);

        pick(`${media}.camera`, "camera-1");
        expect(requestedCameraDeviceIdStore.set).toHaveBeenCalledWith("camera-1");
        expect(localUserStore.setPreferredVideoInputDevice).toHaveBeenCalledWith("camera-1");
        expect(requestedMicrophoneDeviceIdStore.set).not.toHaveBeenCalled();

        pick(`${media}.microphone`, "microphone-1");
        expect(requestedMicrophoneDeviceIdStore.set).toHaveBeenCalledWith("microphone-1");
        expect(localUserStore.setPreferredAudioInputDevice).toHaveBeenCalledWith("microphone-1");
        expect(requestedCameraDeviceIdStore.set).toHaveBeenCalledTimes(1);
    });

    /** The values of the options of the list titled `key`. */
    function optionValues(key: string): string[] {
        return [...labelledBy<HTMLSelectElement>("select", key).options].map((option) => option.value);
    }

    // With access denied the browser lists one entry per kind with no id and no label.
    const placeholder = { deviceId: "", label: "" } as MediaDeviceInfo;

    it("mounts with the blank placeholders a browser lists while camera and microphone are blocked", () => {
        writableMock(cameraListStore).set([placeholder]);
        writableMock(microphoneListStore).set([placeholder]);

        expect(() => show(MediaPane)).not.toThrow();

        expect(optionValues(`${media}.camera`)).toEqual([""]);
        expect(optionValues(`${media}.microphone`)).toEqual([""]);
        expect(target.textContent?.split(`${media}.listAfterPermission`)).toHaveLength(3);
    });

    it("lists the off option and the real camera, never the placeholder beside it", () => {
        writableMock(cameraListStore).set([
            placeholder,
            { deviceId: "camera-1", label: "Front camera" } as MediaDeviceInfo,
        ]);

        show(MediaPane);

        expect(optionValues(`${media}.camera`)).toEqual(["", "camera-1"]);
        expect(target.textContent).toContain("Front camera");
    });

    it("saves each sound switch as its own setting and shows it back", () => {
        show(SoundsPane);
        const lower = switchFor(`${sounds}.lowerMusic`);
        const block = switchFor(`${sounds}.blockAudio`);
        const chat = switchFor(`${sounds}.chatSounds`);
        expect(chat.getAttribute("aria-checked")).toBe("true");

        press(lower);
        expect(localUserStore.setDecreaseAudioPlayerVolumeWhileTalking).toHaveBeenCalledWith(true);
        expect(localUserStore.setBlockAudio).not.toHaveBeenCalled();
        expect(lower.getAttribute("aria-checked")).toBe("true");

        press(block);
        expect(localUserStore.setBlockAudio).toHaveBeenCalledWith(true);
        expect(block.getAttribute("aria-checked")).toBe("true");

        press(chat);
        expect(localUserStore.setChatSounds).toHaveBeenCalledWith(false);
        expect(chat.getAttribute("aria-checked")).toBe("false");
        expect(localUserStore.setDecreaseAudioPlayerVolumeWhileTalking).toHaveBeenCalledTimes(1);
    });

    it("saves the bubble sound and previews the one chosen now, not the one shown before", () => {
        show(SoundsPane);

        pick(`${sounds}.bubble`, "wobble");
        const preview = target.querySelector<HTMLButtonElement>(`[aria-label="${sounds}.playBubble"]`);
        preview?.click();

        expect(localUserStore.setBubbleSound).toHaveBeenCalledWith("wobble");
        expect(playOnSelectedOutput).toHaveBeenCalledOnce();
        expect(vi.mocked(playOnSelectedOutput).mock.calls[0][0].src).toContain("webrtc-in-wobble.mp3");
    });

    it("sets the voices volume and the music volume each in its own place", () => {
        show(SoundsPane);

        slide(`${sounds}.voices`, 0.3);
        expect(localUserStore.setVolumeProximityDiscussion).toHaveBeenCalledWith(0.3);
        expect(volumeProximityDiscussionStore.set).toHaveBeenCalledWith(0.3);
        expect(localUserStore.setAudioPlayerVolume).not.toHaveBeenCalled();

        slide(`${sounds}.music`, 0.4);
        expect(localUserStore.setAudioPlayerVolume).toHaveBeenCalledWith(0.4);
        expect(localUserStore.setVolumeProximityDiscussion).toHaveBeenCalledTimes(1);
    });
});
