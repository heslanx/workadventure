// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { loadLocale } from "../../i18n/i18n-util.sync";
import { setLocale } from "../../i18n/i18n-svelte";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { chatSidebarWidthStore } from "./ChatSidebarWidthStore";
import ChatSidebar from "./ChatSidebar.svelte";

const chatProps = vi.hoisted(() => ({ current: undefined as { sideBarWidth: number } | undefined }));
// The sidebar draws its own close button only when both hold: the action bar is hidden and a discussion is open.
const closeButtonConditions = await vi.hoisted(async () => {
    const { writable } = await import("svelte/store");
    return { actionBarHidden: writable(false), selectedRoom: writable<object | undefined>(undefined) };
});

// The conversation list and timeline are out of scope: the stand-in keeps the props the sidebar hands to the chat.
vi.mock("./Components/Chat.svelte", () => ({
    default: (_anchor: unknown, props: { sideBarWidth: number }) => {
        chatProps.current = props;
        return {};
    },
}));
// The real stores reach the game scene, the Matrix client and the analytics client.
vi.mock("./ChatSidebarWidthStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        chatSidebarWidthStore: writable(335),
        hideActionBarStoreBecauseOfChatBar: closeButtonConditions.actionBarHidden,
    };
});
vi.mock("./Stores/SelectRoomStore", () => ({ selectedRoomStore: closeButtonConditions.selectedRoom }));
// The blocker observes the element for the Woka positioning: jsdom has neither of its observers.
vi.mock("../Utils/screenBlocker", () => ({ blocker: () => undefined }));

class FakeResizeObserver implements ResizeObserver {
    static readonly active = new Set<FakeResizeObserver>();

    private readonly targets = new Set<Element>();

    constructor(private readonly callback: ResizeObserverCallback) {}

    observe(target: Element): void {
        this.targets.add(target);
        FakeResizeObserver.active.add(this);
    }

    unobserve(target: Element): void {
        this.targets.delete(target);
        if (this.targets.size === 0) FakeResizeObserver.active.delete(this);
    }

    disconnect(): void {
        this.targets.clear();
        FakeResizeObserver.active.delete(this);
    }

    /** Reports every observed element at this border-box width, or with no border box as older browsers do. */
    notify(borderBoxWidth: number | undefined): void {
        const entries = [...this.targets].map((target) => {
            const entry: Partial<ResizeObserverEntry> =
                borderBoxWidth === undefined
                    ? { target }
                    : { target, borderBoxSize: [{ inlineSize: borderBoxWidth, blockSize: 0 }] };
            // The sidebar reads nothing else from an entry.
            return entry as ResizeObserverEntry;
        });
        this.callback(entries, this);
    }
}

const STORED_WIDTH = 700;

let target: HTMLElement;
let component: ReturnType<typeof mount> | undefined;
let hostWidth = 0;
let layoutRead: MockInstance<() => number>;

function setViewportWidth(width: number) {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: width });
}

function mountSidebar(props: { embedded?: boolean }) {
    const mounted = mount(ChatSidebar, { target, props, intro: false });
    component = mounted;
    flushSync();
    return mounted;
}

function requireElement<T extends Element>(selector: string): T {
    const element = target.querySelector<T>(selector);
    if (element === null) {
        throw new Error(`Nothing matches ${selector}`);
    }
    return element;
}

function widthGivenToChat(): number {
    if (chatProps.current === undefined) {
        throw new Error("The chat was not rendered");
    }
    return chatProps.current.sideBarWidth;
}

// The layout read keeps its previous answer: only the observer knows the new width.
function resizeHost(width: number) {
    FakeResizeObserver.active.forEach((observer) => observer.notify(width));
    flushSync();
}

function resizeHostWithoutBorderBox(width: number) {
    hostWidth = width;
    FakeResizeObserver.active.forEach((observer) => observer.notify(undefined));
    flushSync();
}

describe("ChatSidebar", () => {
    beforeEach(() => {
        loadLocale("en-US");
        setLocale("en-US");
        target = document.createElement("div");
        document.body.appendChild(target);
        chatProps.current = undefined;
        hostWidth = 0;
        chatVisibilityStore.set(true);
        chatSidebarWidthStore.set(STORED_WIDTH);
        closeButtonConditions.actionBarHidden.set(false);
        closeButtonConditions.selectedRoom.set(undefined);
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
        // jsdom lays nothing out: the host panel is as wide as the test says.
        layoutRead = vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => hostWidth);
    });

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent, { outro: false });
        target.remove();
        chatVisibilityStore.set(false);
        FakeResizeObserver.active.clear();
        Reflect.deleteProperty(document.documentElement, "clientWidth");
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe("embedded in a host panel", () => {
        it("gives the chat the width the host panel measures, not the stored sidebar width", () => {
            hostWidth = 480;

            mountSidebar({ embedded: true });

            expect(widthGivenToChat()).toBe(480);
        });

        it("leaves the width to the host: no inline width on the panel", () => {
            hostWidth = 480;

            mountSidebar({ embedded: true });

            expect(requireElement<HTMLElement>('[data-testid="chat"]').style.width).toBe("");
        });

        it("follows the host panel when the host resizes it", () => {
            hostWidth = 480;
            mountSidebar({ embedded: true });

            resizeHost(620);

            expect(widthGivenToChat()).toBe(620);
        });

        it("takes the new width from the observer, without measuring the layout a second time", () => {
            hostWidth = 480;
            mountSidebar({ embedded: true });
            layoutRead.mockClear();

            resizeHost(620);

            expect(layoutRead).not.toHaveBeenCalled();
        });

        it("measures the host panel itself where the browser reports no border box", () => {
            hostWidth = 480;
            mountSidebar({ embedded: true });

            resizeHostWithoutBorderBox(620);

            expect(widthGivenToChat()).toBe(620);
        });

        it("stops observing the host panel once it is unmounted", async () => {
            const sidebar = mountSidebar({ embedded: true });
            expect(FakeResizeObserver.active.size).toBeGreaterThan(0);

            component = undefined;
            await unmount(sidebar, { outro: false });

            expect(FakeResizeObserver.active.size).toBe(0);
        });

        it("has no standalone resize handle", () => {
            mountSidebar({ embedded: true });

            expect(target.querySelector('[role="separator"]')).toBeNull();
        });

        it("keeps the stored width untouched, even when the window becomes narrower than it", () => {
            const setWidth = vi.spyOn(chatSidebarWidthStore, "set");
            hostWidth = 480;
            setViewportWidth(500);
            mountSidebar({ embedded: true });

            window.dispatchEvent(new Event("resize"));
            flushSync();

            expect(setWidth).not.toHaveBeenCalled();
            expect(get(chatSidebarWidthStore)).toBe(STORED_WIDTH);
            expect(widthGivenToChat()).toBe(480);
        });

        it("draws no close button over the header: the host closes its own panel", () => {
            mountSidebar({ embedded: true });

            expect(target.querySelector('[data-testid="closeChatButton"]')).toBeNull();
        });

        it("draws no close button in a discussion either, while the action bar is shown", () => {
            closeButtonConditions.selectedRoom.set({});

            mountSidebar({ embedded: true });

            expect(target.querySelector('[data-testid="closeChatButton"]')).toBeNull();
        });
    });

    describe("in a discussion while the action bar is hidden", () => {
        beforeEach(() => {
            closeButtonConditions.actionBarHidden.set(true);
            closeButtonConditions.selectedRoom.set({});
        });

        it("offers a close button named for assistive technology that stays in the tab order", () => {
            mountSidebar({ embedded: true });

            const closeButton = requireElement<HTMLButtonElement>('[data-testid="closeChatButton"]');
            closeButton.focus();

            expect(closeButton.getAttribute("aria-label")).toBe("Close chat");
            expect(closeButton.tabIndex).toBe(0);
            expect(closeButton.disabled).toBe(false);
            expect(document.activeElement).toBe(closeButton);
        });

        it("hides the chat when the close button is pressed", () => {
            mountSidebar({ embedded: true });

            requireElement<HTMLButtonElement>('[data-testid="closeChatButton"]').click();
            flushSync();

            expect(get(chatVisibilityStore)).toBe(false);
            expect(target.querySelector('[data-testid="chat"]')).toBeNull();
        });
    });

    describe("standalone, with no host panel", () => {
        it("sizes itself from the stored width", () => {
            mountSidebar({});

            const section = requireElement<HTMLElement>('[data-testid="chat"]');
            expect(section.style.width).toBe("700px");
            expect(section.style.maxWidth).toBe("700px");
            expect(widthGivenToChat()).toBe(STORED_WIDTH);
        });

        it("shows a vertical resize handle that reports the current width", () => {
            mountSidebar({});

            const handle = requireElement<HTMLElement>('[role="separator"]');
            expect(handle.getAttribute("aria-orientation")).toBe("vertical");
            expect(handle.getAttribute("aria-valuenow")).toBe("700");
            expect(handle.tabIndex).toBe(0);
        });

        it("grows by 20 px per ArrowRight on the handle and stores the new width", () => {
            mountSidebar({});
            const handle = requireElement<HTMLElement>('[role="separator"]');

            handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
            flushSync();

            expect(requireElement<HTMLElement>('[data-testid="chat"]').style.width).toBe("720px");
            expect(get(chatSidebarWidthStore)).toBe(720);
        });

        it("shrinks to the window when the window becomes narrower than the sidebar, and stores that width", () => {
            setViewportWidth(500);
            mountSidebar({});

            window.dispatchEvent(new Event("resize"));
            flushSync();

            expect(requireElement<HTMLElement>('[data-testid="chat"]').style.width).toBe("500px");
            expect(get(chatSidebarWidthStore)).toBe(500);
        });

        it("shows no close button while no discussion is open", () => {
            closeButtonConditions.actionBarHidden.set(true);
            mountSidebar({});

            expect(target.querySelector('[data-testid="closeChatButton"]')).toBeNull();
        });
    });
});
