// W4 measurement harness (eight-user performance program, H05). NOT a product test.
// Copied into the remote test tree as play/tests/front/Chat/W4TimelineMeasure.test.ts, run once, then removed.
// jsdom has no layout engine: the numbers are DOM node counts and script time only, not style/layout/paint cost.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import { get, readable, writable } from "svelte/store";
import { MapStore } from "@workadventure/store-utils";
import type { ChatMessage, ChatTimelineItem } from "../../../src/front/Chat/Connection/ChatConnection";
import { createProximityTimelineItemsStore } from "../../../src/front/Chat/Connection/Proximity/ProximityTimelineItemsStore";
import {
    countIncomingMessagesAfter,
    findFirstUnreadKey,
    isReadMarkerLoaded,
} from "../../../src/front/Chat/Components/Room/RoomTimelineNewMessages";

const observed = { count: 0 };
class CountingResizeObserver {
    observe(): void {
        observed.count++;
    }
    unobserve(): void {}
    disconnect(): void {}
}
globalThis.ResizeObserver = CountingResizeObserver as unknown as typeof ResizeObserver;
// jsdom implements neither Element.scroll nor Element.scrollTo (run 3 failed on scrollToMessageListBottom).
Element.prototype.scroll ??= function scroll(): void {};
Element.prototype.scrollTo ??= function scrollTo(): void {};

vi.mock("../../../src/front/Phaser/Game/GameManager", async () => {
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
// Run 1 failed on this module-load singleton (iframeListener undefined through the GameScene import cycle).
vi.mock("../../../src/front/Phaser/Game/UI/UIWebsiteManager", () => ({ uiWebsiteManager: {} }));
// Composer and banners are outside the message list under measurement; they are replaced by empty components.
vi.mock("../../../src/front/Chat/Components/Room/MessageInputBar.svelte", () => ({ default: () => ({}) }));
vi.mock("../../../src/front/Chat/Components/Room/ChatMessageBanner.svelte", () => ({ default: () => ({}) }));
vi.mock("../../../src/front/Chat/Components/Room/TypingUsers.svelte", () => ({ default: () => ({}) }));
vi.mock("../../../src/front/Chat/Components/Room/EnteredZoneBanner.svelte", () => ({ default: () => ({}) }));

const SIZES = [20, 500, 2000];
const BASE = Date.UTC(2026, 10, 11, 8, 0, 0);

function fakeMessage(i: number): ChatMessage {
    const user = i % 8;
    return {
        id: `m${i}`,
        sender: {
            chatId: `@user${user}:test`,
            availabilityStatus: readable(1),
            username: `User ${user}`,
            pictureStore: undefined,
            roomName: undefined,
            playUri: undefined,
            color: "#3366cc",
            spaceUserId: `space-user-${user}`,
        },
        content: readable({ body: `Message number ${i} from user ${user} in the room`, url: undefined }),
        isMyMessage: user === 0,
        isQuotedMessage: false,
        date: new Date(BASE + i * 45_000),
        quotedMessage: undefined,
        type: "text",
        reactions: new MapStore(),
        remove: () => Promise.resolve(),
        edit: () => Promise.resolve(),
        isDeleted: readable(false),
        isModified: readable(false),
        canEdit: readable(false),
        addReaction: () => Promise.resolve(),
        canReact: readable(false),
        canDelete: readable(false),
    } as unknown as ChatMessage;
}

function toItem(message: ChatMessage): ChatTimelineItem {
    return { kind: "message", id: message.id, date: message.date, message };
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function report(label: string, data: Record<string, unknown>): void {
    console.log(`W4RESULT ${JSON.stringify({ label, ...data })}`);
}

async function settle(): Promise<void> {
    flushSync();
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
}

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => {
    const current = mounted;
    mounted = undefined;
    if (current) await unmount(current);
    document.body.replaceChildren();
});

describe("W4 H05 measurement: projection (script time only)", () => {
    it.each(SIZES)("projection cost with %i loaded messages", (size) => {
        const messages = writable<readonly ChatMessage[]>(Array.from({ length: size }, (_, i) => fakeMessage(i)));
        const timeline = createProximityTimelineItemsStore(messages);
        let latest: readonly ChatTimelineItem[] = [];
        const unsubscribe = timeline.subscribe((value) => (latest = value));

        const appendMs: number[] = [];
        for (let round = 0; round < 30; round++) {
            const next = fakeMessage(size + round);
            const start = performance.now();
            messages.update((current) => [...current, next]);
            appendMs.push(performance.now() - start);
        }
        expect(latest.length).toBe(size + 30);
        expect(latest[latest.length - 1].id).toBe(`m${size + 29}`);

        const keyed = latest.map((timelineItem) => ({ key: `message-${timelineItem.id}`, timelineItem }));
        const marker = { eventId: `m${Math.floor(size / 2)}` };
        const helperMs: number[] = [];
        for (let round = 0; round < 50; round++) {
            const start = performance.now();
            findFirstUnreadKey(keyed, marker, "@user0:test");
            countIncomingMessagesAfter(keyed, keyed[0].key, "@user0:test");
            isReadMarkerLoaded(keyed, marker);
            helperMs.push(performance.now() - start);
        }
        unsubscribe();
        report("projection", {
            size,
            proximityStoreAppendMedianMs: Number(median(appendMs).toFixed(4)),
            proximityStoreAppendMaxMs: Number(Math.max(...appendMs).toFixed(4)),
            appendSamples: appendMs.length,
            unreadHelpersMedianMs: Number(median(helperMs).toFixed(4)),
            helperSamples: helperMs.length,
        });
    });
});

describe("W4 H05 measurement: real Message.svelte per item (jsdom, no layout)", () => {
    it.each(SIZES)("mounts %i real Message components", async (size) => {
        const { default: Message } = await import("../../../src/front/Chat/Components/Room/Message.svelte");
        const list = document.createElement("ul");
        document.body.append(list);
        const instances: ReturnType<typeof mount>[] = [];
        const start = performance.now();
        for (let i = 0; i < size; i++) {
            const li = document.createElement("li");
            list.append(li);
            instances.push(mount(Message, { target: li, props: { message: fakeMessage(i), showHeader: i % 3 === 0 } }));
        }
        await settle();
        const mountMs = performance.now() - start;
        const nodes = list.querySelectorAll("*").length;
        const unmountStart = performance.now();
        for (const instance of instances) await unmount(instance);
        const unmountMs = performance.now() - unmountStart;
        report("message-components", {
            size,
            elementNodes: nodes,
            elementNodesPerMessage: Number((nodes / size).toFixed(2)),
            mountMs: Number(mountMs.toFixed(1)),
            unmountMs: Number(unmountMs.toFixed(1)),
        });
        expect(nodes).toBeGreaterThan(size);
    }, 600_000);
});

describe("W4 H05 measurement: real RoomTimeline.svelte (jsdom, no layout)", () => {
    it.each(SIZES)("mounts the real timeline with %i loaded items", async (size) => {
        const { default: RoomTimeline } = await import("../../../src/front/Chat/Components/Room/RoomTimeline.svelte");
        observed.count = 0;
        const timelineItems = writable<readonly ChatTimelineItem[]>(
            Array.from({ length: size }, (_, i) => toItem(fakeMessage(i))),
        );
        let loadMoreCalls = 0;
        const room = {
            id: "!w4:test",
            name: readable("W4 room"),
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
            loadMorePreviousMessages: () => {
                loadMoreCalls++;
                return Promise.resolve();
            },
            setTimelineAsRead: () => {},
            getReadMarker: () => undefined,
        };
        const target = document.createElement("div");
        document.body.append(target);

        const start = performance.now();
        mounted = mount(RoomTimeline, {
            target,
            props: { room: room as never, compactHeader: true },
        });
        await settle();
        const mountMs = performance.now() - start;
        const items = target.querySelectorAll("li[data-event-id]").length;
        const nodes = target.querySelectorAll("*").length;
        const observedAfterMount = observed.count;

        const appendMs: number[] = [];
        for (let round = 0; round < 10; round++) {
            const next = toItem(fakeMessage(size + round));
            const appendStart = performance.now();
            timelineItems.update((current) => [...current, next]);
            flushSync();
            appendMs.push(performance.now() - appendStart);
        }
        await settle();
        const itemsAfterAppend = target.querySelectorAll("li[data-event-id]").length;

        const page = Array.from({ length: 20 }, (_, i) => toItem(fakeMessage(-1 - i))).reverse();
        const prependStart = performance.now();
        timelineItems.update((current) => [...page, ...current]);
        flushSync();
        const prependMs = performance.now() - prependStart;
        await settle();
        const itemsAfterPrepend = target.querySelectorAll("li[data-event-id]").length;
        const nodesAfterPrepend = target.querySelectorAll("*").length;

        const unmountStart = performance.now();
        const current = mounted;
        mounted = undefined;
        await unmount(current);
        const unmountMs = performance.now() - unmountStart;

        report("room-timeline", {
            size,
            listItems: items,
            elementNodes: nodes,
            observedElementsAfterMount: observedAfterMount,
            observedElementsEnd: observed.count,
            mountMs: Number(mountMs.toFixed(1)),
            appendOneMedianMs: Number(median(appendMs).toFixed(2)),
            appendOneMaxMs: Number(Math.max(...appendMs).toFixed(2)),
            appendSamples: appendMs.length,
            itemsAfterAppend,
            prepend20Ms: Number(prependMs.toFixed(1)),
            itemsAfterPrepend,
            nodesAfterPrepend,
            unmountMs: Number(unmountMs.toFixed(1)),
            loadMoreCalls,
            loaded: get(timelineItems).length,
        });
        expect(itemsAfterPrepend).toBe(get(timelineItems).length);
    }, 600_000);
});
