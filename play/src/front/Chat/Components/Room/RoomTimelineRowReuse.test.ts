import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import { readable, writable } from "svelte/store";
import type { ChatMessage, ChatTimelineItem } from "../../Connection/ChatConnection";
import RoomTimeline from "./RoomTimeline.svelte";

const messageRows = vi.hoisted(() => ({ propReads: new Map<string, number>(), stops: [] as (() => void)[] }));

vi.mock("../../../Phaser/Game/GameManager", async () => {
    const { readable: r } = await import("svelte/store");
    return {
        gameManager: {
            chatConnection: { shouldRetrySendingEvents: r(false) },
            chatConnectionStore: r(undefined),
            getCurrentGameScene: () => ({
                room: { isChatEnabled: true },
                proximityChatRoomManager: { roomsStore: r([]) },
            }),
        },
    };
});
// Module-load singleton reached through the GameScene import cycle.
vi.mock("../../../Phaser/Game/UI/UIWebsiteManager", () => ({ uiWebsiteManager: {} }));
// Composer and banners sit outside the message list.
vi.mock("./MessageInputBar.svelte", () => ({ default: () => ({}) }));
vi.mock("./ChatMessageBanner.svelte", () => ({ default: () => ({}) }));
vi.mock("./TypingUsers.svelte", () => ({ default: () => ({}) }));
vi.mock("./EnteredZoneBanner.svelte", () => ({ default: () => ({}) }));
// Stands in for each message row: counts every time the row hands its props to the message again.
vi.mock("./Message.svelte", async () => {
    const { toStore } = await import("svelte/store");
    return {
        default: (_anchor: unknown, props: { message: ChatMessage; showHeader: boolean; showTime: boolean }) => {
            const rowProps = toStore(() => {
                const id = props.message.id;
                messageRows.propReads.set(id, (messageRows.propReads.get(id) ?? 0) + 1);
                return [id, props.showHeader, props.showTime];
            });
            messageRows.stops.push(rowProps.subscribe(() => {}));
            return {};
        },
    };
});

// A fixed past day, so the day separator never depends on today's date.
const BASE = Date.UTC(2026, 0, 5, 8, 0, 0);

function fakeMessage(i: number): ChatMessage {
    // One sender per message: appending never regroups the rows already shown.
    return {
        id: `m${i}`,
        sender: { chatId: `@user${i}:test`, spaceUserId: `space-user-${i}`, username: `User ${i}` },
        date: new Date(BASE + i * 45_000),
        type: "text",
    } as unknown as ChatMessage;
}

// Like the proximity store: every change rebuilds every item object around the same messages.
function toItems(messages: readonly ChatMessage[]): ChatTimelineItem[] {
    return messages.map((message) => ({ kind: "message", id: message.id, date: message.date, message }));
}

function fakeRoom(timelineItems: ReturnType<typeof writable<readonly ChatTimelineItem[]>>) {
    return {
        id: "!reuse:test",
        name: readable("Reuse room"),
        type: readable("multiple"),
        conversationKind: "room",
        parentRoom: undefined,
        avatarFallbackColor: readable("#3366cc"),
        typingMembers: readable([]),
        timelineItems,
        initializationState: readable("ready"),
        initializationError: readable(undefined),
        threads: undefined,
        readReceipts: readable(undefined),
        hasPreviousMessage: readable(false),
        hasUnreadMessages: readable(false),
        unreadNotificationCount: readable(0),
        isEncrypted: readable(false),
        isChatEnabled: readable(true),
        intentionallyClosed: readable(false),
        pictureStore: readable(undefined),
        membersForMessageAvatars: readable([]),
        ensureInitialized: () => Promise.resolve(),
        ensureTimelineInitialized: () => Promise.resolve(),
        loadMorePreviousMessages: () => Promise.resolve(),
        setTimelineAsRead: () => {},
        getReadMarker: () => undefined,
    };
}

async function settle(): Promise<void> {
    flushSync();
    await tick();
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
    flushSync();
}

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe(): void {}
            unobserve(): void {}
            disconnect(): void {}
        },
    );
    // jsdom implements neither Element.scroll nor Element.scrollTo.
    for (const method of ["scroll", "scrollTo"]) {
        Object.defineProperty(Element.prototype, method, { value: () => {}, configurable: true, writable: true });
    }
});

afterEach(async () => {
    const mounted = component;
    component = undefined;
    if (mounted) await unmount(mounted);
    messageRows.stops.splice(0).forEach((stop) => stop());
    messageRows.propReads.clear();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

describe("RoomTimeline row reuse", () => {
    it("does not update the rows already shown when one message is appended", async () => {
        const messages = Array.from({ length: 5 }, (_, i) => fakeMessage(i));
        const timelineItems = writable<readonly ChatTimelineItem[]>(toItems(messages));
        const target = document.createElement("div");
        document.body.append(target);
        component = mount(RoomTimeline, {
            target,
            props: { room: fakeRoom(timelineItems) as never, compactHeader: true },
        });
        await settle();
        const rowsBefore = [...target.querySelectorAll("li[data-event-id]")];
        const readsBefore = new Map(messageRows.propReads);

        timelineItems.set(toItems([...messages, fakeMessage(5)]));
        await settle();

        const rowsAfter = [...target.querySelectorAll("li[data-event-id]")];
        expect(rowsBefore.map((row) => row.getAttribute("data-event-id"))).toEqual(["m0", "m1", "m2", "m3", "m4"]);
        rowsBefore.forEach((row, index) => expect(rowsAfter[index]).toBe(row));
        expect(rowsAfter.map((row) => row.getAttribute("data-event-id"))).toEqual(["m0", "m1", "m2", "m3", "m4", "m5"]);
        expect(messageRows.propReads.get("m5")).toBeGreaterThan(0);
        for (const id of ["m0", "m1", "m2", "m3", "m4"]) {
            expect(messageRows.propReads.get(id), `row ${id} was updated`).toBe(readsBefore.get(id));
        }
    });
});
