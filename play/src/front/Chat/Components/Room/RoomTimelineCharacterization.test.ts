import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import { readable, writable } from "svelte/store";
import type {
    ChatMessage,
    ChatPollItem,
    ChatQuestionItem,
    ChatReadMarker,
    ChatTimelineItem,
} from "../../Connection/ChatConnection";
import { roomTimelineFocusStore } from "../../Stores/RoomSidePanelStore";
import { loadLocaleAsync } from "../../../../i18n/i18n-util.async";
import { setLocale } from "../../../../i18n/i18n-svelte";
import RoomTimeline from "./RoomTimeline.svelte";

const rows = vi.hoisted(() => ({
    reads: new Map<string, number>(),
    props: new Map<string, { showHeader: unknown; showTime: unknown; readReceipts: unknown }>(),
    stops: [] as (() => void)[],
}));

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
vi.mock("../../../Phaser/Game/UI/UIWebsiteManager", () => ({ uiWebsiteManager: {} }));
vi.mock("./MessageInputBar.svelte", () => ({ default: () => ({}) }));
vi.mock("./ChatMessageBanner.svelte", () => ({ default: () => ({}) }));
vi.mock("./TypingUsers.svelte", () => ({ default: () => ({}) }));
vi.mock("./EnteredZoneBanner.svelte", () => ({ default: () => ({}) }));
vi.mock("./PollCard.svelte", () => ({ default: () => ({}) }));
vi.mock("./QuestionCard.svelte", () => ({ default: () => ({}) }));
vi.mock("./MessageSystem.svelte", () => ({ default: () => ({}) }));
// Each message row records the props it is handed, and how many times it is handed them again.
vi.mock("./Message.svelte", async () => {
    const { toStore } = await import("svelte/store");
    return {
        default: (_anchor: unknown, props: { message: ChatMessage } & Record<string, unknown>) => {
            const rowProps = toStore(() => {
                const id = props.message.id;
                rows.reads.set(id, (rows.reads.get(id) ?? 0) + 1);
                rows.props.set(id, {
                    showHeader: props.showHeader,
                    showTime: props.showTime,
                    readReceipts: props.readReceipts,
                });
                return Object.keys(props).map((name) => props[name]);
            });
            rows.stops.push(rowProps.subscribe(() => {}));
            return {};
        },
    };
});

const MY_CHAT_ID = "@me:test";
const ROOM_ID = "!pinned:test";

type Sender = { chatId: string; spaceUserId: string };
const alice: Sender = { chatId: "@alice:test", spaceUserId: "space-alice" };
const bob: Sender = { chatId: "@bob:test", spaceUserId: "space-bob" };
const me: Sender = { chatId: MY_CHAT_ID, spaceUserId: "space-me" };

function message(id: string, sender: Sender, date: Date): ChatMessage {
    return {
        id,
        sender: { ...sender, username: sender.chatId },
        date,
        type: "text",
        isMyMessage: sender === me,
    } as unknown as ChatMessage;
}

function item(chatMessage: ChatMessage): ChatTimelineItem {
    return { kind: "message", id: chatMessage.id, date: chatMessage.date, message: chatMessage };
}

/** Local time, so the day boundaries do not depend on the machine's time zone. */
function at(day: number, hours: number, minutes: number): Date {
    return new Date(2026, 0, day, hours, minutes);
}

function others(count: number, from = 0): ChatTimelineItem[] {
    return Array.from({ length: count }, (_, i) =>
        item(message(`m${from + i}`, i % 2 === 0 ? alice : bob, at(5, 8, from + i))),
    );
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
    let resolve = () => {};
    let reject: (error: Error) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function fakeRoom(
    options: {
        items?: ChatTimelineItem[];
        hasPrevious?: boolean;
        readMarker?: ChatReadMarker;
        readReceipts?: ReturnType<typeof writable<unknown>>;
    } = {},
) {
    const timelineItems = writable<readonly ChatTimelineItem[]>(options.items ?? []);
    const initializationState = writable<"idle" | "loading" | "ready" | "error">("ready");
    const hasPreviousMessage = writable(options.hasPrevious ?? false);
    const room = {
        id: ROOM_ID,
        name: readable("Pinned room"),
        type: readable("multiple"),
        conversationKind: "room",
        parentRoom: undefined,
        avatarFallbackColor: readable("#3366cc"),
        typingMembers: readable([]),
        timelineItems,
        initializationState,
        initializationError: readable(undefined),
        threads: undefined,
        readReceipts: options.readReceipts ?? readable(undefined),
        hasPreviousMessage,
        hasUnreadMessages: readable(false),
        unreadNotificationCount: readable(0),
        isEncrypted: readable(false),
        isChatEnabled: readable(true),
        intentionallyClosed: readable(false),
        pictureStore: readable(undefined),
        membersForMessageAvatars: readable([]),
        ensureInitialized: vi.fn(() => Promise.resolve()),
        ensureTimelineInitialized: vi.fn(() => Promise.resolve()),
        loadMorePreviousMessages: vi.fn(() => Promise.resolve()),
        ensureTimelineEventVisible: vi.fn<(eventId: string) => Promise<boolean>>(() => Promise.resolve(false)),
        setTimelineAsRead: vi.fn(),
        getReadMarker: () => options.readMarker,
    };
    return { room, timelineItems, initializationState, hasPreviousMessage };
}

/** The scrolling list: jsdom has no layout, so its sizes come from here. */
const list = { scrollHeight: 1000, clientHeight: 300 };
const scrollTops = new WeakMap<Element, number>();
const scrollCalls: { top: number | undefined; behavior: ScrollBehavior | undefined }[] = [];
const scrolledIntoView: string[] = [];
let visibility: DocumentVisibilityState = "visible";

function isList(element: Element): boolean {
    return element.classList.contains("overflow-auto");
}

function defineGetter(name: string, get: (this: Element) => number, set?: (this: Element, value: number) => void) {
    Object.defineProperty(Element.prototype, name, { get, set, configurable: true });
}

async function settle(): Promise<void> {
    flushSync();
    await tick();
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
    flushSync();
}

async function wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
    await settle();
}

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;

function render(room: ReturnType<typeof fakeRoom>["room"]): void {
    component = mount(RoomTimeline, { target, props: { room: room as never, compactHeader: true } });
}

function listElement(): HTMLElement {
    const element = target.querySelector<HTMLElement>(".overflow-auto");
    if (!element) throw new Error("no message list");
    return element;
}

function eventIds(): (string | null)[] {
    return [...target.querySelectorAll("ul > li")].map((row) => row.getAttribute("data-event-id"));
}

function separatorLabels(): (string | undefined)[] {
    return [...target.querySelectorAll("ul > li:not([data-event-id])")].map((row) => row.textContent?.trim());
}

function jumpButton(): HTMLElement | null {
    return target.querySelector<HTMLElement>("[data-testid='jumpToLatestMessages']");
}

/** The user scrolls by hand: a wheel gesture, then the scroll event it produces. */
function userScrollsTo(top: number): void {
    const element = listElement();
    element.scrollTop = top;
    element.dispatchEvent(new Event("wheel"));
    element.dispatchEvent(new Event("scroll"));
}

function userScrollsToTop(): void {
    userScrollsTo(0);
}

const ROW_HEIGHT = 50;

/** Rows of ROW_HEIGHT stacked in DOM order and moved up by the list's scrollTop; the list itself sits at 0. */
function layOutRows(): void {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const siblings = this.tagName === "LI" ? [...(this.parentElement?.children ?? [])] : [];
        const scroller = this.closest(".overflow-auto");
        const top = siblings.length > 0 && scroller ? siblings.indexOf(this) * ROW_HEIGHT - scroller.scrollTop : 0;
        const height = siblings.length > 0 ? ROW_HEIGHT : 0;
        return { x: 0, y: top, top, left: 0, right: 0, width: 0, height, bottom: top + height, toJSON: () => ({}) };
    });
}

function rowTop(eventId: string): number {
    const row = target.querySelector(`li[data-event-id='${eventId}']`);
    if (!row) throw new Error(`no row ${eventId}`);
    return row.getBoundingClientRect().top;
}

beforeAll(async () => {
    await loadLocaleAsync("en-US");
    setLocale("en-US");
});

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe(): void {}
            unobserve(): void {}
            disconnect(): void {}
        },
    );
    defineGetter("scrollHeight", function () {
        return isList(this) ? list.scrollHeight : 0;
    });
    defineGetter("clientHeight", function () {
        return isList(this) ? list.clientHeight : 0;
    });
    defineGetter(
        "scrollTop",
        function () {
            return scrollTops.get(this) ?? 0;
        },
        function (value) {
            const max = isList(this) ? list.scrollHeight - list.clientHeight : 0;
            scrollTops.set(this, Math.max(0, Math.min(value, max)));
        },
    );
    Object.defineProperty(Element.prototype, "scroll", {
        value(this: Element, options: ScrollToOptions) {
            scrollCalls.push({ top: options.top, behavior: options.behavior });
            this.scrollTop = options.top ?? 0;
        },
        configurable: true,
        writable: true,
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
        value(this: HTMLElement) {
            scrolledIntoView.push(this.dataset.eventId ?? "");
        },
        configurable: true,
        writable: true,
    });
    Object.defineProperty(document, "visibilityState", { get: () => visibility, configurable: true });
    list.scrollHeight = 1000;
    list.clientHeight = 300;
    scrollCalls.splice(0);
    scrolledIntoView.splice(0);
    visibility = "visible";
    localStorage.setItem("matrixUserId", MY_CHAT_ID);
    target = document.createElement("div");
    document.body.append(target);
});

afterEach(async () => {
    const mounted = component;
    component = undefined;
    if (mounted) await unmount(mounted);
    rows.stops.splice(0).forEach((stop) => stop());
    rows.reads.clear();
    rows.props.clear();
    roomTimelineFocusStore.set(undefined);
    localStorage.clear();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("RoomTimeline characterization", () => {
    it("groups a sender's run under one header and one time, and starts a new run after 5 minutes or at a new day", async () => {
        const { room } = fakeRoom({
            items: [
                item(message("a1", alice, at(5, 8, 0))),
                item(message("a2", alice, at(5, 8, 4))),
                item(message("a3", alice, at(5, 8, 10))),
                item(message("b1", bob, at(5, 8, 11))),
                item(message("b2", bob, at(5, 23, 58))),
                item(message("b3", bob, at(6, 0, 1))),
            ],
        });
        render(room);
        await settle();

        expect(eventIds()).toEqual([null, "a1", "a2", "a3", "b1", "b2", null, "b3"]);
        const shown = Object.fromEntries(rows.props);
        expect(shown).toEqual({
            a1: { showHeader: true, showTime: false },
            a2: { showHeader: false, showTime: true },
            a3: { showHeader: true, showTime: true },
            b1: { showHeader: true, showTime: true },
            b2: { showHeader: true, showTime: true },
            b3: { showHeader: true, showTime: true },
        });
    });

    it("ends a sender's run at a poll, a question or a system row: the message before it shows its time, the one after its header", async () => {
        const { room } = fakeRoom({
            items: [
                item(message("a1", alice, at(5, 8, 0))),
                {
                    kind: "poll",
                    id: "p1",
                    date: at(5, 8, 1),
                    poll: { id: "p1", sender: alice } as unknown as ChatPollItem,
                },
                item(message("a2", alice, at(5, 8, 2))),
                {
                    kind: "question",
                    id: "q1",
                    date: at(5, 8, 3),
                    question: { id: "q1", sender: alice } as unknown as ChatQuestionItem,
                },
                item(message("a3", alice, at(5, 8, 4))),
                { kind: "system", id: "s1", date: at(5, 8, 5), message: message("s1", alice, at(5, 8, 5)) },
                item(message("a4", alice, at(5, 8, 6))),
                item(message("a5", alice, at(5, 8, 7))),
            ],
        });
        render(room);
        await settle();

        expect(eventIds()).toEqual([null, "a1", "p1", "a2", "q1", "a3", "s1", "a4", "a5"]);
        expect(Object.fromEntries(rows.props)).toEqual({
            a1: { showHeader: true, showTime: true },
            a2: { showHeader: true, showTime: true },
            a3: { showHeader: true, showTime: true },
            a4: { showHeader: true, showTime: false },
            a5: { showHeader: false, showTime: true },
        });
    });

    it("labels the day separators Today, Yesterday, and an older day by its weekday, day and month, all in the chat's language", async () => {
        await loadLocaleAsync("fr-FR");
        setLocale("fr-FR");
        onTestFinished(() => setLocale("en-US"));
        vi.setSystemTime(at(7, 12, 0));
        const { room } = fakeRoom({
            items: [
                item(message("a1", alice, at(2, 9, 0))),
                item(message("a2", alice, at(6, 9, 0))),
                item(message("a3", alice, at(7, 9, 0))),
            ],
        });
        render(room);
        await settle();

        // RT-10 (fixed): an older day follows the chat's language too, not the runtime's ("Fri, Jan 2" in en-US).
        const olderDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
        expect(separatorLabels()).toEqual([olderDay.format(at(2, 9, 0)), "Hier", "Aujourd'hui"]);
    });

    it("RT-05 (pinned): computes the day labels when the timeline changes, not when the day does", async () => {
        vi.setSystemTime(at(7, 23, 59));
        const { room, timelineItems } = fakeRoom({ items: [item(message("a1", alice, at(7, 23, 58)))] });
        render(room);
        await settle();
        expect(separatorLabels()).toEqual(["Today"]);

        vi.setSystemTime(at(8, 0, 1));
        await wait(10);
        expect(separatorLabels()).toEqual(["Today"]);

        timelineItems.update((items) => [...items, item(message("b1", bob, at(8, 0, 1)))]);
        await settle();
        expect(separatorLabels()).toEqual(["Yesterday", "Today"]);
    });

    it("opens by initializing the timeline, then fetches older pages while the list does not overflow, five at most", async () => {
        list.scrollHeight = 300;
        const initialized = deferred();
        const { room } = fakeRoom({ items: [], hasPrevious: true });
        room.ensureTimelineInitialized.mockReturnValue(initialized.promise);
        render(room);
        await settle();

        expect(target.querySelector("[data-testid='roomTimelineLoading']")).not.toBeNull();
        expect(room.loadMorePreviousMessages).not.toHaveBeenCalled();

        initialized.resolve();
        await wait(10);

        expect(room.ensureTimelineInitialized).toHaveBeenCalledTimes(1);
        expect(room.loadMorePreviousMessages).toHaveBeenCalledTimes(5);
        expect(target.querySelector("[data-testid='roomTimelineLoading']")).toBeNull();
        expect(target.textContent).toContain("No message sent yet!");
        expect(scrollCalls).toEqual([{ top: 300, behavior: "auto" }]);
    });

    it("fetches up to three more pages to reach the read marker, then opens on the New messages line instead of the bottom", async () => {
        const marker = item(message("old1", me, at(5, 7, 0)));
        const { room, timelineItems } = fakeRoom({
            items: others(4, 10),
            hasPrevious: true,
            readMarker: { eventId: "old1" },
        });
        let pages = 0;
        room.loadMorePreviousMessages.mockImplementation(() => {
            pages += 1;
            // The second page carries the marker and one unread message from Bob.
            if (pages === 2) {
                timelineItems.update((items) => [marker, item(message("old2", bob, at(5, 7, 30))), ...items]);
            }
            return Promise.resolve();
        });
        render(room);
        await wait(10);

        expect(room.loadMorePreviousMessages).toHaveBeenCalledTimes(2);
        const divider = target.querySelector("[data-testid='unreadMessagesDivider']");
        expect(divider?.closest("li")?.getAttribute("data-event-id")).toBe("old2");
        expect(scrollCalls).toEqual([]);
        expect(listElement().scrollTop).toBe(0);
    });

    it("shows the load error when a history page fails, and its retry runs the whole open again", async () => {
        const { room } = fakeRoom({ items: [], hasPrevious: true });
        room.loadMorePreviousMessages.mockRejectedValueOnce(new Error("network"));
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        render(room);
        await wait(10);

        expect(target.textContent).toContain("Couldn't load the messages");
        const retry = target.querySelector<HTMLButtonElement>("[data-testid='retryLoadingMessagesButton']");
        expect(retry).not.toBeNull();

        retry?.click();
        await wait(10);

        expect(room.ensureTimelineInitialized).toHaveBeenCalledTimes(2);
        expect(room.loadMorePreviousMessages).toHaveBeenCalledTimes(2);
        expect(target.querySelector("[data-testid='retryLoadingMessagesButton']")).toBeNull();
        expect(target.textContent).toContain("No message sent yet!");
        consoleError.mockRestore();
    });

    it("follows new messages at the bottom, counts the others' messages while the user reads history, and jumps back for the user's own", async () => {
        const { room, timelineItems } = fakeRoom({ items: others(3) });
        render(room);
        await wait(10);
        scrollCalls.splice(0);

        timelineItems.update((items) => [...items, ...others(1, 3)]);
        await settle();
        expect(scrollCalls).toEqual([{ top: 1000, behavior: "smooth" }]);

        userScrollsToTop();
        await settle();
        scrollCalls.splice(0);
        timelineItems.update((items) => [...items, ...others(2, 4)]);
        await settle();

        expect(scrollCalls).toEqual([]);
        expect(jumpButton()?.textContent).toContain("2 new messages");

        timelineItems.update((items) => [...items, item(message("mine", me, at(5, 8, 30)))]);
        await settle();

        expect(scrollCalls).toEqual([{ top: 1000, behavior: "smooth" }]);
        expect(jumpButton()).toBeNull();
    });

    it("marks the room read when it opens and on each new last message, also while the user reads history, but not while the tab is hidden", async () => {
        const { room, timelineItems } = fakeRoom({ items: others(3) });
        render(room);
        await wait(10);
        expect(room.setTimelineAsRead).toHaveBeenCalledTimes(1);

        timelineItems.update((items) => [...items, ...others(1, 3)]);
        await settle();
        expect(room.setTimelineAsRead).toHaveBeenCalledTimes(2);

        // RT-02 (pinned): the 2 messages the jump button counts as new are reported read.
        userScrollsToTop();
        timelineItems.update((items) => [...items, ...others(2, 4)]);
        await settle();
        expect(jumpButton()?.textContent).toContain("2 new messages");
        expect(room.setTimelineAsRead).toHaveBeenCalledTimes(3);

        visibility = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
        timelineItems.update((items) => [...items, ...others(1, 6)]);
        await settle();
        expect(room.setTimelineAsRead).toHaveBeenCalledTimes(3);

        visibility = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
        await settle();
        expect(room.setTimelineAsRead).toHaveBeenCalledTimes(4);
    });

    it("RT-01 (fixed): a read receipt update hands its props again to the user's own message rows only", async () => {
        const readReceipts = writable<unknown>({ version: 1 });
        const items = others(18);
        items.splice(5, 0, item(message("mine1", me, at(5, 9, 0))));
        items.push(item(message("mine2", me, at(5, 9, 30))));
        const { room } = fakeRoom({ items, readReceipts });
        render(room);
        await wait(10);
        const before = new Map(rows.reads);

        readReceipts.set({ version: 2 });
        await settle();

        const updated = [...rows.reads].filter(([id, reads]) => reads !== before.get(id)).map(([id]) => id);
        expect(rows.reads.size).toBe(20);
        expect(updated).toEqual(["mine1", "mine2"]);
        expect(rows.props.get("mine1")?.readReceipts).toEqual({ version: 2 });
        expect(rows.props.get("m0")?.readReceipts).toBeUndefined();
    });

    it("fetches one older page 100 ms after the user scrolls near the top, and never a second one while it is pending", async () => {
        const { room } = fakeRoom({ items: others(5), hasPrevious: true });
        render(room);
        await wait(10);
        expect(room.loadMorePreviousMessages).toHaveBeenCalledTimes(1);
        const page = deferred();
        room.loadMorePreviousMessages.mockReturnValue(page.promise);

        userScrollsToTop();
        listElement().dispatchEvent(new Event("scroll"));
        await wait(50);
        expect(room.loadMorePreviousMessages).toHaveBeenCalledTimes(1);
        await wait(100);
        expect(room.loadMorePreviousMessages).toHaveBeenCalledTimes(2);

        listElement().dispatchEvent(new Event("scroll"));
        await wait(150);
        expect(room.loadMorePreviousMessages).toHaveBeenCalledTimes(2);

        page.resolve();
        await settle();
        listElement().dispatchEvent(new Event("scroll"));
        await wait(150);
        expect(room.loadMorePreviousMessages).toHaveBeenCalledTimes(3);
    });

    it("keeps the message the user is reading in place when older messages are prepended, and does not move it again when the page ends", async () => {
        layOutRows();
        const { room, timelineItems } = fakeRoom({ items: others(10), hasPrevious: true });
        render(room);
        await wait(10);
        const page = deferred();
        room.loadMorePreviousMessages.mockReturnValue(page.promise);
        const pagesBefore = room.loadMorePreviousMessages.mock.calls.length;

        // Not at 0: a fetch from the very top also shows the loader row, which would shift the rows by itself.
        userScrollsTo(10);
        await wait(150);
        expect(room.loadMorePreviousMessages).toHaveBeenCalledTimes(pagesBefore + 1);
        const readingTop = rowTop("m0");

        timelineItems.update((items) => [
            item(message("o0", alice, at(5, 7, 0))),
            item(message("o1", bob, at(5, 7, 1))),
            item(message("o2", alice, at(5, 7, 2))),
            ...items,
        ]);
        await settle();
        expect(listElement().scrollTop).toBe(10 + 3 * ROW_HEIGHT);
        expect(rowTop("m0")).toBe(readingTop);

        page.resolve();
        await settle();
        expect(listElement().scrollTop).toBe(10 + 3 * ROW_HEIGHT);
        expect(rowTop("m0")).toBe(readingTop);
    });

    it("scrolls a focus request's message into view and highlights it, and asks the room for a message it has not loaded", async () => {
        roomTimelineFocusStore.set({ roomId: ROOM_ID, eventId: "m1", sequence: 1 });
        const { room, timelineItems } = fakeRoom({ items: others(4) });
        room.ensureTimelineEventVisible.mockImplementation((eventId: string) => {
            timelineItems.update((items) => [item(message(eventId, bob, at(5, 7, 0))), ...items]);
            return Promise.resolve(true);
        });
        render(room);
        await wait(10);

        // RT-03 (fixed): the request pending at open is focused once.
        expect(scrolledIntoView).toEqual(["m1"]);
        expect(scrollCalls).toEqual([]);
        expect(target.querySelector("li[data-event-id='m1']")?.classList.contains("highlight-message")).toBe(true);

        roomTimelineFocusStore.set({ roomId: "!other:test", eventId: "m2", sequence: 2 });
        await wait(10);
        expect(scrolledIntoView).toEqual(["m1"]);

        roomTimelineFocusStore.set({ roomId: ROOM_ID, eventId: "older", sequence: 3 });
        await wait(10);
        expect(room.ensureTimelineEventVisible).toHaveBeenCalledWith("older");
        expect(scrolledIntoView).toEqual(["m1", "older"]);
    });
});
