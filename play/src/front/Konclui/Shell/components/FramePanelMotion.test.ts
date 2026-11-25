// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet, flushSync, mount, tick, unmount } from "svelte";
import { get, type Writable } from "svelte/store";
import type { Room } from "../../../Connection/Room";

// The shell with its real side panel, people panel and pill, and how the card comes and goes: through its own
// transition, which keeps the card and what is in it in the page for the length of its exit. What reaches the scene, the
// chat and the rest of the page is replaced: the game manager and the chat sidebar, the office menu and the place chip.
// jsdom has no `Element.animate`, which a Svelte transition needs: it is lent one whose animations wait for the test.
const managed = vi.hoisted((): { room: Room | undefined } => ({ room: undefined }));

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => ({ room: managed.room }) },
}));
vi.mock("../../../Phaser/Game/GameScene", () => ({}));
vi.mock("../../../Chat/Connection/Matrix/getMatrixSecurity", () => ({ getMatrixSecurity: vi.fn() }));
vi.mock("../../../Stores/PwaInstallStore", async () => {
    const { writable } = await import("svelte/store");
    return { pwaInstallSceneVisibleStore: writable(false) };
});
vi.mock("../../../Stores/ErrorScreenStore", async () => {
    const { writable } = await import("svelte/store");
    return { errorScreenStore: writable(undefined) };
});
vi.mock("../../../Chat/ChatSidebar.svelte", () => ({ default: () => undefined }));
vi.mock("../../OfficeMenu/components/OfficeMenu.svelte", () => ({ default: () => undefined }));
vi.mock("../../Presence/components/PlaceChip.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    const LL = readable(path([]));
    return { LL, default: LL, locale: readable("en-US") };
});

import { currentRoomStore } from "../../../Stores/CurrentRoomStore";
import { gameSceneIsLoadedStore } from "../../../Stores/GameSceneStore";
import { loaderVisibleStore } from "../../../Stores/LoaderStore";
import { loginSceneVisibleStore } from "../../../Stores/LoginSceneStore";
import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../../../Stores/SelectCompanionStore";
import { enableCameraSceneVisibilityStore } from "../../../Stores/MediaStore";
import { pwaInstallSceneVisibleStore } from "../../../Stores/PwaInstallStore";
import { errorStore } from "../../../Stores/ErrorStore";
import { errorScreenStore } from "../../../Stores/ErrorScreenStore";
import { mapDeletedPromptStore } from "../../../Stores/MapDeletedPromptStore";
import { chatInputFocusStore, chatVisibilityStore } from "../../../Stores/ChatStore";
import { menuIconVisiblilityStore } from "../../../Stores/MenuStore";
import { navChat } from "../../../Chat/Stores/ChatStore";
import { clearSearchFocusRequest, setPeopleQuery } from "../../Presence/stores/peopleSearchStore";
import { rosterListOpenStore } from "../../Presence/stores/worldRoster";
import { closeSidePanel, showPeople, toggleChat, togglePeople } from "../stores/sidePanelStore";
import Frame from "./Frame.svelte";

const errorScreen = errorScreenStore as unknown as Writable<object | undefined>;

class NoResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", NoResizeObserver);

const PANEL_ID = "konclui-side-panel";

/** What `Element.animate` returns in a browser, as far as Svelte's transition reads it. */
class FakeAnimation {
    currentTime = 0;
    onfinish: (() => void) | null = null;
    cancelled = false;
    effect: unknown = {};

    constructor(
        readonly target: Element,
        readonly keyframes: Array<Record<string, string>>,
        readonly options: { duration: number },
    ) {}

    cancel(): void {
        this.cancelled = true;
    }

    finish(): void {
        this.onfinish?.();
    }
}

function office(): Room {
    return {
        id: "office",
        metadata: undefined,
        isChatOnlineListEnabled: true,
        isChatDisconnectedListEnabled: false,
    } as unknown as Room;
}

const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

describe("the shell's side panel and its motion", () => {
    const target = document.createElement("div");
    let frame: ReturnType<typeof mount> | undefined;
    let animations: FakeAnimation[];
    let reduceMotion = false;
    let hover = false;

    beforeEach(() => {
        currentRoomStore.set(undefined);
        gameSceneIsLoadedStore.set(false);
        menuIconVisiblilityStore.set(false);
        loaderVisibleStore.set(false);
        loginSceneVisibleStore.set(false);
        selectCharacterSceneVisibleStore.set(false);
        selectCompanionSceneVisibleStore.set(false);
        enableCameraSceneVisibilityStore.hideEnableCameraScene();
        pwaInstallSceneVisibleStore.set(false);
        errorStore.clearClosableMessages();
        errorScreen.set(undefined);
        mapDeletedPromptStore.set(false);
        chatVisibilityStore.set(false);
        navChat.switchToChat();
        closeSidePanel();
        setPeopleQuery("");
        clearSearchFocusRequest();
        chatInputFocusStore.set(false);
        setWidth(1024);

        animations = [];
        reduceMotion = false;
        hover = false;
        Object.defineProperty(Element.prototype, "animate", {
            configurable: true,
            writable: true,
            value(this: Element, keyframes: Array<Record<string, string>>, options: { duration: number }) {
                const animation = new FakeAnimation(this, keyframes, options);
                animations.push(animation);
                // Svelte starts a run with a dummy animation as long as the delay (0) and waits for it to end.
                if (!options.duration) queueMicrotask(() => !animation.cancelled && animation.finish());
                return animation;
            },
        });
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            writable: true,
            value: (query: string) => ({
                matches: query.includes("reduce") ? reduceMotion : query === "(hover: hover)" ? hover : false,
                media: query,
            }),
        });
    });

    afterEach(async () => {
        const mounted = frame;
        frame = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        Reflect.deleteProperty(Element.prototype, "animate");
        Reflect.deleteProperty(window, "matchMedia");
        closeSidePanel();
    });

    const moving = () => animations.filter((animation) => animation.options.duration > 0 && !animation.cancelled);
    const durations = () => moving().map((animation) => animation.options.duration);
    // Svelte starts a transition a microtask after the flush, and the dummy animation ends in another.
    const settle = async () => {
        await tick();
        await tick();
        await tick();
        await tick();
    };
    const finishMoving = async () => {
        for (const animation of moving()) animation.finish();
        await settle();
    };
    /** Time passes in what is playing, as the browser's clock would make it: a reversal starts from where the run is. */
    const elapse = (ms: number) => {
        for (const animation of moving()) animation.currentTime = ms;
    };
    /** Plays what is playing to its end, and forgets it: what the test looks at next is what it does next. */
    const quiet = async () => {
        await settle();
        await finishMoving();
        animations.length = 0;
    };

    // The order of the room's entry: the frame is laid out when the scene is created, and a wide window opens the people
    // of the room then, before the chrome is drawn. The chrome appears when the scene is loaded, with the panel open.
    function drawShell() {
        const room = office();
        managed.room = room;
        currentRoomStore.set(room);
        document.body.append(target);
        frame = mount(Frame, {
            target,
            props: { children: createRawSnippet(() => ({ render: () => "<div></div>" })) },
        });
        flushSync();
        menuIconVisiblilityStore.set(true);
        flushSync();
        gameSceneIsLoadedStore.set(true);
        flushSync();
    }

    /** The shell is drawn with the panel closed and nothing running: the wide window opens the people on entry. */
    async function drawClosedShell() {
        drawShell();
        closeSidePanel();
        flushSync();
        await quiet();
    }

    /** The shell is drawn with the panel closed, and the people panel is then opened and has arrived. */
    async function drawOpenShell() {
        await drawClosedShell();
        showPeople();
        flushSync();
        await quiet();
    }

    const card = () => target.querySelector<HTMLElement>("aside.side-panel");
    const searchField = () => target.querySelector<HTMLInputElement>('input[type="search"]');
    const content = () => target.querySelector<HTMLElement>("aside .content");
    const reserve = () => target.querySelector<HTMLElement>("[data-konclui-panel-reserve]");
    const railButton = (name: string) => {
        const button = target.querySelector<HTMLButtonElement>(`nav.rail button[aria-label="${name}"]`);
        if (!button) throw new Error(`no ${name} button in the rail`);
        return button;
    };
    const peopleButton = () => railButton("konclui.people");
    const chatButton = () => railButton("konclui.chat");
    const pillButton = () => {
        const button = target.querySelector<HTMLButtonElement>(".people-slot button");
        if (!button) throw new Error("no people pill");
        return button;
    };
    const press = (element: Element, init: KeyboardEventInit) => {
        const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
        element.dispatchEvent(event);
        flushSync();
        return event;
    };
    const flush = async () => {
        flushSync();
        await settle();
    };

    describe("its entrance", () => {
        it("arrives by its transition, on the surface spring over 290 ms, and by no class of its own", async () => {
            await drawClosedShell();

            togglePeople();
            await flush();

            expect(card()).not.toBeNull();
            expect(card()?.classList.contains("k-enter")).toBe(false);
            expect(durations()).toEqual([290]);
            expect(moving()[0].target).toBe(card());
        });

        it("plays nothing when the shell appears with the panel already open, as the room's entry does", async () => {
            drawShell();
            await settle();

            // A wide window opens the people of the room as the frame is laid out.
            expect(card()).not.toBeNull();
            expect(moving()).toHaveLength(0);
            expect(animations).toHaveLength(0);
        });

        it("takes the card away at once, with no exit, when the shell goes while the panel is open", async () => {
            drawShell();
            await settle();
            expect(card()).not.toBeNull();

            loaderVisibleStore.set(true);
            flushSync();

            expect(card()).toBeNull();
            expect(animations).toHaveLength(0);
        });

        it("rises on a phone and comes from the rail on a wide window, from the variables of the stylesheet", async () => {
            // The variables are the stylesheet's (pinned in KoncluiEntrance.test.ts); the transition reads them from the
            // card as the run starts. jsdom resolves no media query, so this checks what it reads and not what the page has.
            await drawClosedShell();
            document.documentElement.style.setProperty("--k-enter-x", "-24px");
            document.documentElement.style.setProperty("--k-enter-y", "0px");

            togglePeople();
            await flush();

            const keyframes = moving()[0].keyframes;
            expect(keyframes[0]).toMatchObject({ transform: "translate(-24px, 0px) scale(0.98)" });
            expect(keyframes.at(-1)).toMatchObject({ transform: "translate(0px, 0px) scale(1)" });
            document.documentElement.style.removeProperty("--k-enter-x");
            document.documentElement.style.removeProperty("--k-enter-y");
        });
    });

    describe("its exit", () => {
        it("keeps the card in the page for 200 ms, out of reach, and removes it when the exit has played", async () => {
            await drawOpenShell();
            expect(card()).not.toBeNull();

            closeSidePanel();
            await flush();

            expect(card()).not.toBeNull();
            // jsdom has no `inert`, but Svelte sets the property: it is what a browser hit-tests with.
            expect(card()?.inert).toBe(true);
            expect(durations()).toEqual([200]);
            await finishMoving();
            expect(card()).toBeNull();
        });

        it("keeps what the card holds, and the roster watch that it asks for, until the exit has played", async () => {
            await drawOpenShell();
            expect(searchField()).not.toBeNull();
            expect(get(rosterListOpenStore)).toBe(true);

            closeSidePanel();
            await flush();

            // The card does not slide away blank: the people panel is in it as it was, and still asked for.
            expect(searchField()).not.toBeNull();
            expect(card()?.contains(searchField())).toBe(true);
            expect(get(rosterListOpenStore)).toBe(true);

            await finishMoving();
            expect(searchField()).toBeNull();
            expect(get(rosterListOpenStore)).toBe(false);
        });

        it("keeps the label it had as it left, though the panel says closed: a chat does not become the people", async () => {
            await drawClosedShell();
            toggleChat();
            await flush();
            await finishMoving();
            expect(card()?.getAttribute("aria-label")).toBe("konclui.chat");

            toggleChat();
            await flush();

            expect(card()).not.toBeNull();
            expect(card()?.getAttribute("aria-label")).toBe("konclui.chat");
        });

        it("leaves at once, with no animation, for a viewer who reduces motion", async () => {
            await drawOpenShell();
            reduceMotion = true;

            closeSidePanel();
            flushSync();

            expect(card()).toBeNull();
            expect(moving()).toHaveLength(0);
        });

        it("arrives at once, with no animation, for a viewer who reduces motion", async () => {
            await drawClosedShell();
            reduceMotion = true;

            togglePeople();
            flushSync();

            expect(card()).not.toBeNull();
            expect(moving()).toHaveLength(0);
        });

        it("is the same card, with the same people panel, when the panel is opened again during the exit", async () => {
            await drawOpenShell();
            const before = card();
            const field = searchField();
            closeSidePanel();
            await flush();
            expect(card()?.inert).toBe(true);
            const exit = moving()[0];
            elapse(40);

            showPeople();
            await flush();

            expect(card()).toBe(before);
            expect(searchField()).toBe(field);
            expect(card()?.inert).toBeFalsy();
            // The exit that was running is cancelled and the entrance goes on from where it was.
            expect(exit.cancelled).toBe(true);
            expect(moving()).toHaveLength(1);
            expect(moving()[0].options.duration).toBeLessThan(290);
            await finishMoving();
            expect(card()).toBe(before);
        });

        it("takes the other view in the same card when the panel is opened again as the chat during the exit", async () => {
            await drawOpenShell();
            const before = card();
            closeSidePanel();
            await flush();
            elapse(40);

            toggleChat();
            await flush();

            expect(card()).toBe(before);
            expect(card()?.getAttribute("aria-label")).toBe("konclui.chat");
            expect(searchField()).toBeNull();
            expect(card()?.inert).toBeFalsy();
        });
    });

    describe("rapid toggles", () => {
        it("end open when the panel is opened, closed and opened again before anything has played", async () => {
            await drawClosedShell();

            togglePeople();
            await flush();
            const first = card();
            elapse(30);
            togglePeople();
            await flush();
            elapse(30);
            togglePeople();
            await flush();

            expect(card()).toBe(first);
            expect(card()?.inert).toBeFalsy();
            expect(target.querySelector(".office-frame")?.classList.contains("panel-open")).toBe(true);
            expect(reserve()).not.toBeNull();
            expect(peopleButton().getAttribute("aria-pressed")).toBe("true");
            await finishMoving();
            expect(card()).toBe(first);
            expect(searchField()).not.toBeNull();
        });

        it("end closed when the panel is closed, opened and closed again during the exit", async () => {
            await drawOpenShell();

            togglePeople();
            await flush();
            elapse(30);
            togglePeople();
            await flush();
            elapse(30);
            togglePeople();
            await flush();
            expect(card()).not.toBeNull();
            expect(card()?.inert).toBe(true);
            await finishMoving();

            expect(card()).toBeNull();
            expect(reserve()).toBeNull();
            expect(peopleButton().getAttribute("aria-pressed")).toBe("false");
            expect(get(rosterListOpenStore)).toBe(false);
        });

        it("end where the last toggle left them, after any number, with one card at most", async () => {
            await drawClosedShell();

            const toggleOnce = async () => {
                togglePeople();
                flushSync();
                await tick();
                elapse(20);
            };
            // Seven toggles, each started when the one before has begun to play: an odd number, so it ends open.
            await Array.from({ length: 7 }).reduce<Promise<void>>((done) => done.then(toggleOnce), Promise.resolve());
            await settle();
            await finishMoving();

            expect(target.querySelectorAll("aside.side-panel")).toHaveLength(1);
            expect(card()?.inert).toBeFalsy();
            expect(searchField()).not.toBeNull();
        });

        it("keep the strip under the card in step with the state, whatever the card is doing", async () => {
            await drawClosedShell();
            expect(reserve()).toBeNull();

            togglePeople();
            flushSync();
            expect(reserve()).not.toBeNull();

            togglePeople();
            flushSync();
            expect(reserve()).toBeNull();
            expect(card()).not.toBeNull();

            togglePeople();
            flushSync();
            expect(reserve()).not.toBeNull();
        });
    });

    describe("what its content does when the card swaps between its views", () => {
        it("fades in, over 150 ms and on opacity alone, with no movement of the card", async () => {
            await drawOpenShell();
            const before = card();

            toggleChat();
            await flush();

            expect(card()).toBe(before);
            expect(moving()).toHaveLength(1);
            const fade = moving()[0];
            expect(fade.options.duration).toBe(150);
            expect(fade.target).toBe(content());
            expect(fade.target).not.toBe(card());
            for (const keyframe of fade.keyframes) {
                expect(Object.keys(keyframe).filter((property) => property !== "offset")).toEqual(["opacity"]);
            }
            // The card itself runs nothing: it does not move for a swap.
            expect(moving().filter((animation) => animation.target === card())).toHaveLength(0);
        });

        it("does not fade when the card opens: the card's own entrance is the only motion", async () => {
            await drawClosedShell();

            togglePeople();
            await flush();

            expect(moving().map((animation) => animation.target)).toEqual([card()]);
        });

        it("swaps at once, with no animation, for a viewer who reduces motion", async () => {
            await drawOpenShell();
            reduceMotion = true;

            toggleChat();
            await flush();

            expect(moving()).toHaveLength(0);
            expect(searchField()).toBeNull();
        });

        it("swaps in jsdom, where there is no Element.animate, without an animation or an error", async () => {
            await drawOpenShell();
            Reflect.deleteProperty(Element.prototype, "animate");

            toggleChat();
            await flush();

            expect(searchField()).toBeNull();
            expect(card()).not.toBeNull();
        });
    });

    describe("what points at the card", () => {
        it("is the card's id for the rail's two buttons and the pill while the panel is open, and nothing otherwise", async () => {
            await drawClosedShell();
            const buttons = () => [peopleButton(), chatButton(), pillButton()];
            expect(buttons().map((button) => button.getAttribute("aria-controls"))).toEqual([null, null, null]);

            togglePeople();
            await flush();
            expect(buttons().map((button) => button.getAttribute("aria-controls"))).toEqual([
                PANEL_ID,
                PANEL_ID,
                PANEL_ID,
            ]);
            expect(document.getElementById(PANEL_ID)).toBe(card());
            elapse(30);

            togglePeople();
            await flush();
            // The card is still in the page, leaving: nothing points at it now, as nothing is open.
            expect(card()).not.toBeNull();
            expect(buttons().map((button) => button.getAttribute("aria-controls"))).toEqual([null, null, null]);

            await finishMoving();
            expect(document.getElementById(PANEL_ID)).toBeNull();
            expect(buttons().map((button) => button.getAttribute("aria-controls"))).toEqual([null, null, null]);
        });

        it("is there again as soon as the panel is opened during the exit", async () => {
            await drawOpenShell();
            closeSidePanel();
            await flush();

            showPeople();
            await flush();

            expect(peopleButton().getAttribute("aria-controls")).toBe(PANEL_ID);
            expect(document.getElementById(PANEL_ID)).toBe(card());
        });
    });

    describe("the focus and the keys", () => {
        it("goes to the rail's button as the panel closes from its field, while the card is still in the page", async () => {
            await drawClosedShell();
            searchPeopleFromRail();
            await flush();
            await finishMoving();
            expect(document.activeElement).toBe(searchField());

            press(searchField() as HTMLInputElement, { key: "Escape" });
            await settle();

            expect(card()).not.toBeNull();
            expect(document.activeElement).toBe(peopleButton());
        });

        it("goes to the pill on a phone, where the card leaves as a sheet", async () => {
            setWidth(375);
            await drawClosedShell();
            togglePeople();
            await flush();
            await finishMoving();
            const collapse = target.querySelector<HTMLButtonElement>(".people-panel header button");
            collapse?.focus();
            expect(document.activeElement).toBe(collapse);

            collapse?.click();
            await flush();

            expect(card()).not.toBeNull();
            expect(document.activeElement).toBe(pillButton());
        });

        it("does not take the focus when the panel closes while the user plays", async () => {
            await drawOpenShell();
            (document.activeElement as HTMLElement | null)?.blur();

            closeSidePanel();
            await flush();

            expect(document.activeElement).toBe(document.body);
        });

        it("lets the game's keys through as the panel closes, not after the exit: the field has lost the focus", async () => {
            await drawClosedShell();
            searchPeopleFromRail();
            await flush();
            await finishMoving();
            expect(document.activeElement).toBe(searchField());
            expect(get(chatInputFocusStore)).toBe(true);
            // Whether the browser sends the field a `blur` when `inert` takes its focus is not known here. The one other
            // thing that would blur it is the focus the close hands to the rail's button, which is made a no-op: the keys
            // can then be freed only by the close itself.
            peopleButton().focus = () => undefined;

            closeSidePanel();
            await flush();

            // The people panel is still in the card, so its own cleanup has not run: the close does it.
            expect(get(rosterListOpenStore)).toBe(true);
            expect(get(chatInputFocusStore)).toBe(false);
        });

        it("leaves the game's keys as they are when the panel closes with the focus elsewhere", async () => {
            await drawOpenShell();
            chatInputFocusStore.set(true);
            (document.activeElement as HTMLElement | null)?.blur();

            closeSidePanel();
            await flush();

            // Another field of the page holds them: only a close that took the focus from the card gives them back.
            expect(get(chatInputFocusStore)).toBe(true);
        });

        it("keeps Escape working: it closes the panel, and during the exit it asks nothing of the closed one", async () => {
            await drawClosedShell();
            searchPeopleFromRail();
            await flush();
            await finishMoving();

            const closing = press(searchField() as HTMLInputElement, { key: "Escape" });
            await settle();
            expect(closing.defaultPrevented).toBe(true);
            expect(card()).not.toBeNull();

            const again = press(document.body, { key: "Escape" });
            expect(again.defaultPrevented).toBe(false);
            await finishMoving();
            expect(card()).toBeNull();
        });

        it("keeps Ctrl+K working during the exit: it opens the same card again and takes the focus to the field", async () => {
            await drawClosedShell();
            searchPeopleFromRail();
            await flush();
            await finishMoving();
            const before = card();
            const field = searchField();
            closeSidePanel();
            await flush();
            expect(card()?.inert).toBe(true);

            const event = press(document.body, { key: "k", ctrlKey: true });
            await flush();

            expect(event.defaultPrevented).toBe(true);
            expect(card()).toBe(before);
            expect(searchField()).toBe(field);
            expect(card()?.inert).toBeFalsy();
            expect(document.activeElement).toBe(field);

            // And Escape from the field closes it again, as it does for a card that has not been through an exit.
            press(searchField() as HTMLInputElement, { key: "Escape" });
            await settle();
            await finishMoving();
            expect(card()).toBeNull();
        });

        function searchPeopleFromRail() {
            railButton("konclui.peopleList.searchLabel").click();
            flushSync();
        }
    });

    describe("when the window crosses 768 px", () => {
        const resize = async (width: number) => {
            setWidth(width);
            window.dispatchEvent(new Event("resize"));
            await flush();
        };

        it("keeps the card that is open as it is: the same card, nothing replays", async () => {
            await drawOpenShell();
            const before = card();
            const field = searchField();

            await resize(500);
            await resize(1024);

            expect(card()).toBe(before);
            expect(searchField()).toBe(field);
            expect(card()?.inert).toBeFalsy();
            expect(animations).toHaveLength(0);
        });

        it("lets an exit that is playing end through the crossing, and removes the card once", async () => {
            await drawOpenShell();
            closeSidePanel();
            await flush();
            expect(durations()).toEqual([200]);

            await resize(500);

            expect(card()).not.toBeNull();
            expect(durations()).toEqual([200]);
            await finishMoving();
            expect(card()).toBeNull();
            expect(target.querySelectorAll("aside")).toHaveLength(0);
        });
    });

    describe("the rail", () => {
        it("gives every button the press, and one pill that follows the pointer, where there is a hover", async () => {
            hover = true;
            await drawClosedShell();

            const rail = target.querySelector("nav.rail");
            const buttons = [...(rail?.querySelectorAll("button") ?? [])];
            expect(buttons).toHaveLength(5);
            expect(buttons.every((button) => button.classList.contains("k-press"))).toBe(true);
            expect(rail?.classList.contains("k-glide")).toBe(true);
            expect(rail?.classList.contains("k-glide-on")).toBe(true);
            expect(rail?.querySelectorAll(".k-glide-pill")).toHaveLength(1);
            expect(rail?.querySelector(".k-glide-pill")?.getAttribute("aria-hidden")).toBe("true");
        });

        it("moves the pill to the button the pointer is over, and takes it away as the pointer leaves", async () => {
            hover = true;
            await drawClosedShell();
            const pill = target.querySelector(".k-glide-pill");

            chatButton().dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
            expect(pill?.classList.contains("is-shown")).toBe(true);

            target.querySelector("nav.rail")?.dispatchEvent(new PointerEvent("pointerleave"));
            expect(pill?.classList.contains("is-shown")).toBe(false);
        });

        it("has no pill where there is no hover, and the buttons keep their own fill", async () => {
            hover = false;
            await drawClosedShell();

            const rail = target.querySelector("nav.rail");
            expect(rail?.querySelector(".k-glide-pill")).toBeNull();
            expect(rail?.classList.contains("k-glide-on")).toBe(false);
        });

        it("keeps the pressed button pressed whatever the pill does", async () => {
            hover = true;
            await drawOpenShell();

            chatButton().dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));

            expect(peopleButton().getAttribute("aria-pressed")).toBe("true");
            expect(chatButton().getAttribute("aria-pressed")).toBe("false");
        });
    });
});
