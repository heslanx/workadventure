import { get, writable } from "svelte/store";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceInterface } from "../SpaceInterface";

// watchRaiseHandState only touches stores; mock the Phaser- and UI-heavy modules BindMuteEvents pulls in.
vi.mock("../../Stores/NotificationStore", () => ({ notificationPlayingStore: { playNotification: vi.fn() } }));
vi.mock("../../Stores/MediaStore", async () => {
    const { writable: w } = await import("svelte/store");
    return {
        isSpeakerStore: w(false),
        requestedCameraState: Object.assign(w(false), { disableWebcam: vi.fn() }),
        requestedMicrophoneState: Object.assign(w(false), { disableMicrophone: vi.fn() }),
    };
});
vi.mock("../../Stores/MegaphoneStore", async () => {
    const { writable: w } = await import("svelte/store");
    return { currentLiveStreamingSpaceStore: w(undefined), givenFloorSpaceStore: w(undefined) };
});
// Every translation function returns its own path ("notification.cameraMuted"), so a test can tell which text was used.
vi.mock("../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const translator = (path: string[]): unknown =>
        new Proxy(() => path.join("."), { get: (_target, property) => translator([...path, String(property)]) });
    const LL = readable(translator([]));
    return { default: LL, LL };
});
vi.mock("../../Components/ActionBar/MenuIcons/megaphoneActions", () => ({ stopMegaphoneLive: vi.fn() }));
vi.mock("../../Stores/ChatStore", () => ({ chatZoneLiveStore: { set: vi.fn() } }));
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../Stores/PopupStore", () => ({ popupStore: { addPopup: vi.fn(), removePopup: vi.fn() } }));
vi.mock("../../Components/PopUp/MuteDialogPopup.svelte", () => ({ default: {} }));

import { requestedHandRaiseState } from "../../Stores/RaiseHandStore";
import { notificationPlayingStore } from "../../Stores/NotificationStore";
import { requestedCameraState, requestedMicrophoneState } from "../../Stores/MediaStore";
import { popupStore } from "../../Stores/PopupStore";
import { bindMuteEventsToSpace, watchRaiseHandState } from "./BindMuteEvents";

const ME = "me";

function fakeSpace(name: string) {
    const store = writable({
        raisedHands: [] as { spaceUserId: string }[],
        floorHolders: [] as { spaceUserId: string }[],
    });
    const space = {
        mySpaceUserId: ME,
        getName: () => name,
        state: { store },
        startStreaming: vi.fn(),
        stopStreaming: vi.fn(),
    } as unknown as SpaceInterface;
    return { space, store };
}

describe("watchRaiseHandState", () => {
    afterEach(() => {
        requestedHandRaiseState.lowerAll();
    });

    it("only lowers the hand of the space where a moderator lowered it", () => {
        const bubble = fakeSpace("bubble");
        const zone = fakeSpace("zone");
        const unsubscribers = [watchRaiseHandState(bubble.space), watchRaiseHandState(zone.space)];

        requestedHandRaiseState.raise("bubble");
        requestedHandRaiseState.raise("zone");
        zone.store.set({ raisedHands: [{ spaceUserId: ME }], floorHolders: [] });
        bubble.store.set({ raisedHands: [{ spaceUserId: ME }], floorHolders: [] });

        // The zone's host lowers the hand.
        zone.store.set({ raisedHands: [], floorHolders: [] });

        expect([...get(requestedHandRaiseState)]).toEqual(["bubble"]);
        unsubscribers.forEach((unsubscribe) => unsubscribe());
    });

    it("only lowers the hand of the space where the floor was given", () => {
        const bubble = fakeSpace("bubble");
        const zone = fakeSpace("zone");
        const unsubscribers = [watchRaiseHandState(bubble.space), watchRaiseHandState(zone.space)];

        requestedHandRaiseState.raise("bubble");
        requestedHandRaiseState.raise("zone");
        zone.store.set({ raisedHands: [{ spaceUserId: ME }], floorHolders: [] });

        zone.store.set({ raisedHands: [], floorHolders: [{ spaceUserId: ME }] });

        expect([...get(requestedHandRaiseState)]).toEqual(["bubble"]);
        unsubscribers.forEach((unsubscribe) => unsubscribe());
    });
});

describe("bindMuteEventsToSpace", () => {
    function fakeEventSpace() {
        const publicEvents = new Map<string, Subject<unknown>>();
        const privateEvents = new Map<string, Subject<unknown>>();
        const subjectOf = (events: Map<string, Subject<unknown>>, key: string) => {
            const existing = events.get(key);
            if (existing) {
                return existing;
            }
            const created = new Subject<unknown>();
            events.set(key, created);
            return created;
        };
        const space = {
            mySpaceUserId: ME,
            getName: () => "bubble",
            usersStore: writable(new Map()),
            observeUserLeft: new Subject(),
            onLeaveSpace: new Subject(),
            observePublicEvent: (key: string) => subjectOf(publicEvents, key),
            observePrivateEvent: (key: string) => subjectOf(privateEvents, key),
        } as unknown as SpaceInterface;
        return {
            space,
            emitPublic: (key: string) =>
                subjectOf(publicEvents, key).next({ spaceName: "bubble", sender: "moderator" }),
            emitPrivate: (key: string, payload: unknown) => subjectOf(privateEvents, key).next(payload),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("tells the others, in the past tense, that a moderator muted everybody's microphone", () => {
        const { space, emitPublic } = fakeEventSpace();
        bindMuteEventsToSpace(space);

        emitPublic("muteAudioForEverybody");

        expect(notificationPlayingStore.playNotification).toHaveBeenCalledExactlyOnceWith(
            "notification.microphoneMutedForEverybody",
            "microphone-off.png",
        );
        expect(requestedMicrophoneState.disableMicrophone).toHaveBeenCalledOnce();
    });

    it("tells the others, in the past tense, that a moderator turned off everybody's camera", () => {
        const { space, emitPublic } = fakeEventSpace();
        bindMuteEventsToSpace(space);

        emitPublic("muteVideoForEverybody");

        expect(notificationPlayingStore.playNotification).toHaveBeenCalledExactlyOnceWith(
            "notification.cameraMutedForEverybody",
            "camera-off.png",
        );
        expect(requestedCameraState.disableWebcam).toHaveBeenCalledOnce();
    });

    it("asks through the dialog alone when somebody only asks to mute the microphone", () => {
        const { space, emitPrivate } = fakeEventSpace();
        bindMuteEventsToSpace(space);

        emitPrivate("muteAudio", { muteAudio: { force: false }, sender: { spaceUserId: "asker" } });

        expect(popupStore.addPopup).toHaveBeenCalledOnce();
        expect(notificationPlayingStore.playNotification).not.toHaveBeenCalled();
        expect(requestedMicrophoneState.disableMicrophone).not.toHaveBeenCalled();
    });

    it("still says a moderator muted the microphone when the mute is forced", () => {
        const { space, emitPrivate } = fakeEventSpace();
        bindMuteEventsToSpace(space);

        emitPrivate("muteAudio", { muteAudio: { force: true }, sender: { spaceUserId: "moderator" } });

        expect(notificationPlayingStore.playNotification).toHaveBeenCalledExactlyOnceWith(
            "notification.microphoneMuted",
            "microphone-off.png",
        );
        expect(requestedMicrophoneState.disableMicrophone).toHaveBeenCalledOnce();
    });
});
