import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable, type Writable } from "svelte/store";
import type { ProximityChatRoom } from "../../../Chat/Connection/Proximity/ProximityChatRoom";
import type { ProximityChatRoomManager } from "../../../Chat/Connection/Proximity/ProximityChatRoomManager";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import type { ConversationRoomKind } from "../domain/conversation";

// The media store reaches the devices; the conversation only needs to know whether the user is in a silent zone.
const silent = vi.hoisted(() => ({ store: undefined as Writable<boolean> | undefined }));
vi.mock("../../../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    silent.store = writable(false);
    return { silentStore: silent.store };
});
vi.mock("@sentry/svelte", () => ({ captureException: vi.fn() }));

import { callChipStore, conversationStore } from "./conversationStore";

interface FakeRoom {
    readonly room: ProximityChatRoom;
    readonly kind: Writable<ConversationRoomKind>;
    readonly isJoined: Writable<boolean>;
    readonly participants: Writable<{ spaceUserId: string }[]>;
}

/** A proximity room as the conversation reads it: four stores and the space the user is in. */
function fakeRoom(kind: ConversationRoomKind, others: string[], name = ""): FakeRoom {
    const kindStore = writable(kind);
    const joined = writable(true);
    const participants = writable([{ spaceUserId: "me" }, ...others.map((spaceUserId) => ({ spaceUserId }))]);
    const room = {
        kind: kindStore,
        isJoined: joined,
        name: writable(name),
        currentMeetingParticipantsStore: participants,
        getCurrentSpace: () => ({ mySpaceUserId: "me" }),
    } as unknown as ProximityChatRoom;
    return { room, kind: kindStore, isJoined: joined, participants };
}

function sceneWith(manager: Promise<ProximityChatRoomManager>): GameScene {
    return { proximityChatRoomManagerReady: manager } as unknown as GameScene;
}

/** A manager that is not ready yet, and the function that makes it ready. */
function pendingManager(): {
    manager: Promise<ProximityChatRoomManager>;
    ready: (m: ProximityChatRoomManager) => void;
} {
    let ready: (manager: ProximityChatRoomManager) => void = () => undefined;
    const manager = new Promise<ProximityChatRoomManager>((resolve) => {
        ready = resolve;
    });
    return { manager, ready };
}

function managerOf(rooms: Writable<ProximityChatRoom[]>): ProximityChatRoomManager {
    return { roomsStore: rooms } as unknown as ProximityChatRoomManager;
}

/** Lets the promise chains of the store settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("the conversation store", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        gameSceneStore.set(undefined);
        silent.store?.set(false);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("is nothing until the scene has built its room manager, then follows the rooms", async () => {
        const bubble = fakeRoom("default", ["a", "b"]);
        const { manager, ready } = pendingManager();
        gameSceneStore.set(sceneWith(manager));
        const heard: unknown[] = [];
        const unsubscribe = conversationStore.subscribe((conversation) => heard.push(conversation));
        await settle();
        expect(heard.at(-1)).toBeUndefined();

        ready(managerOf(writable([bubble.room])));
        await settle();
        unsubscribe();

        expect(heard.at(-1)).toEqual({ kind: "bubble", count: 2 });
    });

    it("follows people joining and leaving the bubble", async () => {
        const bubble = fakeRoom("default", ["a"]);
        gameSceneStore.set(sceneWith(Promise.resolve(managerOf(writable([bubble.room])))));
        const unsubscribe = conversationStore.subscribe(() => undefined);
        await settle();
        expect(get(conversationStore)).toEqual({ kind: "bubble", count: 1 });

        bubble.participants.set([{ spaceUserId: "me" }, { spaceUserId: "a" }, { spaceUserId: "b" }]);
        expect(get(conversationStore)).toEqual({ kind: "bubble", count: 2 });

        bubble.participants.set([{ spaceUserId: "me" }]);
        expect(get(conversationStore)).toBeUndefined();
        unsubscribe();
    });

    it("follows a room the manager creates later and one the user leaves", async () => {
        const rooms = writable<ProximityChatRoom[]>([]);
        gameSceneStore.set(sceneWith(Promise.resolve(managerOf(rooms))));
        const unsubscribe = conversationStore.subscribe(() => undefined);
        await settle();
        expect(get(conversationStore)).toBeUndefined();

        const meeting = fakeRoom("meeting", ["a", "b"], "Sala 01");
        rooms.set([meeting.room]);
        expect(get(conversationStore)).toEqual({ kind: "room", count: 2, placeName: "Sala 01" });

        meeting.isJoined.set(false);
        expect(get(conversationStore)).toBeUndefined();
        unsubscribe();
    });

    it("follows a room whose kind changes after the join, so a megaphone never reads as a conversation", async () => {
        const room = fakeRoom("meeting", ["a", "b"], "Palco");
        gameSceneStore.set(sceneWith(Promise.resolve(managerOf(writable([room.room])))));
        const unsubscribe = conversationStore.subscribe(() => undefined);
        await settle();
        expect(get(conversationStore)).toEqual({ kind: "room", count: 2, placeName: "Palco" });

        room.kind.set("speaker");

        expect(get(conversationStore)).toBeUndefined();
        unsubscribe();
    });

    it("is nothing in a silent zone, whatever the rooms hold", async () => {
        const bubble = fakeRoom("default", ["a"]);
        gameSceneStore.set(sceneWith(Promise.resolve(managerOf(writable([bubble.room])))));
        const unsubscribe = conversationStore.subscribe(() => undefined);
        await settle();

        silent.store?.set(true);
        expect(get(conversationStore)).toBeUndefined();

        silent.store?.set(false);
        expect(get(conversationStore)).toEqual({ kind: "bubble", count: 1 });
        unsubscribe();
    });

    it("drops the work of a scene that was replaced while its manager was pending", async () => {
        const staleBubble = fakeRoom("default", ["a", "b", "c"]);
        const first = pendingManager();
        gameSceneStore.set(sceneWith(first.manager));
        const heard: unknown[] = [];
        const unsubscribe = conversationStore.subscribe((conversation) => heard.push(conversation));
        gameSceneStore.set(sceneWith(Promise.resolve(managerOf(writable([])))));
        await settle();

        first.ready(managerOf(writable([staleBubble.room])));
        await settle();
        unsubscribe();

        expect(heard.every((conversation) => conversation === undefined)).toBe(true);
    });

    it("stops listening to the rooms of a scene that was replaced", async () => {
        const oldBubble = fakeRoom("default", ["a"]);
        gameSceneStore.set(sceneWith(Promise.resolve(managerOf(writable([oldBubble.room])))));
        const unsubscribe = conversationStore.subscribe(() => undefined);
        await settle();
        expect(get(conversationStore)).toEqual({ kind: "bubble", count: 1 });

        gameSceneStore.set(sceneWith(Promise.resolve(managerOf(writable([])))));
        await settle();
        oldBubble.participants.set([{ spaceUserId: "me" }, { spaceUserId: "a" }, { spaceUserId: "b" }]);

        expect(get(conversationStore)).toBeUndefined();
        unsubscribe();
    });

    it("reports a manager that never comes, and stays empty", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        gameSceneStore.set(sceneWith(Promise.reject(new Error("scene closed"))));
        const unsubscribe = conversationStore.subscribe(() => undefined);

        await settle();

        expect(error).toHaveBeenCalledWith(expect.stringContaining("[konclui] presence"), expect.any(Error));
        expect(get(conversationStore)).toBeUndefined();
        unsubscribe();
    });
});

describe("the call chip store", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        gameSceneStore.set(undefined);
        vi.useRealTimers();
    });

    it("shows a bubble's count once for people who join one after the other", async () => {
        const bubble = fakeRoom("default", ["a"]);
        gameSceneStore.set(sceneWith(Promise.resolve(managerOf(writable([bubble.room])))));
        const heard: unknown[] = [];
        const unsubscribe = callChipStore.subscribe((conversation) => heard.push(conversation));
        await settle();

        bubble.participants.set([{ spaceUserId: "me" }, { spaceUserId: "a" }, { spaceUserId: "b" }]);
        vi.advanceTimersByTime(300);
        bubble.participants.set([
            { spaceUserId: "me" },
            { spaceUserId: "a" },
            { spaceUserId: "b" },
            { spaceUserId: "c" },
        ]);
        await vi.advanceTimersByTimeAsync(2000);
        unsubscribe();

        expect(heard.filter((conversation) => conversation !== undefined)).toEqual([
            { kind: "bubble", count: 1 },
            { kind: "bubble", count: 3 },
        ]);
    });

    it("takes the chip away at once when the conversation ends", async () => {
        const bubble = fakeRoom("default", ["a"]);
        gameSceneStore.set(sceneWith(Promise.resolve(managerOf(writable([bubble.room])))));
        const unsubscribe = callChipStore.subscribe(() => undefined);
        await settle();
        expect(get(callChipStore)).toEqual({ kind: "bubble", count: 1 });

        bubble.participants.set([{ spaceUserId: "me" }]);

        expect(get(callChipStore)).toBeUndefined();
        unsubscribe();
    });
});
