// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet, flushSync, mount, tick, unmount } from "svelte";
import { compile } from "svelte/compiler";
import { get, type Writable } from "svelte/store";
import type { Room } from "../../../Connection/Room";
import type { CoWebsite } from "../../../WebRtc/CoWebsite/CoWebsite";

// The shell with its real side panel, people panel and stores. What reaches the scene, the chat and the rest of the
// page is replaced: the game manager and the chat sidebar, the office menu and the two chips over the map.
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
vi.mock("../../Presence/components/PeoplePill.svelte", () => ({ default: () => undefined }));
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
import { chatVisibilityStore } from "../../../Stores/ChatStore";
import { menuIconVisiblilityStore, warningBannerStore } from "../../../Stores/MenuStore";
import { gameViewportBounds, gameViewportCoveredStart } from "../../../ExternalModule/ClientExtensionPoints";
import type { ViewportBounds } from "../../../Stores/CoWebsiteLayout";
import { coWebsites } from "../../../Stores/CoWebsiteStore";
import { biggestAvailableAreaStore } from "../../../Stores/BiggestAvailableAreaStore";
import { navChat } from "../../../Chat/Stores/ChatStore";
import { closeSidePanel, showPeople } from "../stores/sidePanelStore";
import Frame from "./Frame.svelte";

const errorScreen = errorScreenStore as unknown as Writable<object | undefined>;

// jsdom does no layout, so the browser's ResizeObserver is replaced by one that reports only when a test says the layout
// changed (`fireResize`), the way the browser reports it after a frame.
class ControlledResizeObserver {
    static live = new Set<ControlledResizeObserver>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        ControlledResizeObserver.live.add(this);
    }
    unobserve(): void {}
    disconnect(): void {
        ControlledResizeObserver.live.delete(this);
    }
    report(): void {
        this.callback([], this);
    }
}
vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
const fireResize = () => [...ControlledResizeObserver.live].forEach((observer) => observer.report());

const OPTED_OUT = { konclui: { shell: false } };

function office(metadata: unknown = undefined): Room {
    return {
        id: "office",
        metadata,
        isChatOnlineListEnabled: true,
        isChatDisconnectedListEnabled: false,
    } as unknown as Room;
}

// jsdom does no layout, so the map's cell is modelled on the frame's grid as the stylesheet declares it: a 6 px gutter, and
// the width of every fixed column before the map's own (the rail's 60 px, and the side panel's 296 px where the panel has a
// column). The frame's compiled style is in the document (see drawFrame), so a column added to the grid moves the cell.
const WINDOW = { width: 1440, height: 900 };
function fixedColumnsOf(frame: HTMLElement): number {
    const style = getComputedStyle(frame);
    const columns = style.gridTemplateColumns.match(/minmax\([^)]*\)|var\([^)]*\)|\S+/g);
    if (!columns) throw new Error("the frame's style is not in the document: its grid has no columns");
    return columns
        .filter((column) => !column.startsWith("minmax("))
        .map((column) => /^var\((--[\w-]+)\)$/.exec(column)?.[1])
        .reduce((sum, property) => sum + parseFloat(property ? style.getPropertyValue(property) : "NaN"), 0);
}
function cellOf(viewport: HTMLElement): DOMRect {
    const frame = viewport.parentElement;
    if (!frame) throw new Error("the viewport has no frame");
    const left = fixedColumnsOf(frame);
    const top = 6;
    return {
        left,
        top,
        width: WINDOW.width - left - 6,
        height: WINDOW.height - 2 * top,
        right: WINDOW.width - 6,
        bottom: WINDOW.height - top,
        x: left,
        y: top,
        toJSON: () => ({}),
    };
}

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Frame.svelte"), "utf8");
// The frame's style, compiled once for the hash of the mounted component.
const compiledStyles = new Map<string, string>();

describe("the office frame around the game", () => {
    const target = document.createElement("div");
    let frame: ReturnType<typeof mount> | undefined;
    let published: Array<ViewportBounds | undefined> = [];
    let stopRecording: (() => void) | undefined;
    // The width the browser would give the box under the card: 296 where the card floats, 0 where it does not.
    let reserveWidth = 296;

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
        warningBannerStore.set(false);
        chatVisibilityStore.set(false);
        navChat.switchToChat();
        closeSidePanel();
        Object.defineProperty(window, "innerWidth", { configurable: true, value: WINDOW.width });
        reserveWidth = 296;
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
            if (this.classList.contains("viewport")) return cellOf(this);
            // The strip under the card is drawn only where the card floats, which is a media query jsdom does not run.
            if (this.classList.contains("panel-reserve")) return new DOMRect(60, 6, reserveWidth, 888);
            return new DOMRect();
        });
        document.body.append(target);
        // The bounds the frame hands to the game, as they are set: the first entry is the store's value at the start.
        published = [];
        stopRecording = gameViewportBounds.subscribe((bounds) => published.push(bounds));
    });

    afterEach(async () => {
        stopRecording?.();
        const mounted = frame;
        frame = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        coWebsites.removeAll();
        gameViewportCoveredStart.set(0);
        vi.restoreAllMocks();
    });

    function drawFrame(room: Room, markup = "<div></div>"): HTMLElement {
        managed.room = room;
        currentRoomStore.set(room);
        frame = mount(Frame, {
            target,
            props: { children: createRawSnippet(() => ({ render: () => markup })) },
        });
        flushSync();
        const element = target.querySelector<HTMLElement>(".office-frame");
        if (!element) throw new Error("no frame");
        injectFrameStyle(element);
        return element;
    }

    const createScene = () => {
        menuIconVisiblilityStore.set(true);
        flushSync();
    };
    const revealShell = () => {
        gameSceneIsLoadedStore.set(true);
        flushSync();
    };
    // The map's whole cell, beside the rail, whether the side panel is open or not: the panel floats over it.
    const finalBounds = { left: 60, top: 6, width: 1374, height: 888 };

    it("is not laid out while the room is known and no scene exists: the entry screens fill the window", () => {
        const element = drawFrame(office());

        expect(element.classList.contains("konclui")).toBe(false);
        expect(published).toEqual([undefined]);
    });

    it("lays the frame out, with the side panel open, when the scene is created, before the chrome is drawn", () => {
        const element = drawFrame(office());

        createScene();

        expect(element.classList.contains("konclui")).toBe(true);
        expect(element.classList.contains("panel-open")).toBe(true);
        expect(element.dataset.testid).toBeUndefined();
        expect(target.querySelector("nav.rail")).toBeNull();
    });

    it("hands the game its final area once, before the chrome is drawn, and does not touch it as the shell is revealed", () => {
        const element = drawFrame(office());

        createScene();
        expect(published).toEqual([undefined, finalBounds]);

        revealShell();
        expect(element.dataset.testid).toBe("konclui-shell");
        expect(published).toEqual([undefined, finalBounds]);
    });

    it("keeps the area through a loader that comes back for another map", () => {
        drawFrame(office());
        createScene();
        revealShell();

        loaderVisibleStore.set(true);
        gameSceneIsLoadedStore.set(false);
        flushSync();
        gameSceneIsLoadedStore.set(true);
        loaderVisibleStore.set(false);
        flushSync();

        expect(published).toEqual([undefined, finalBounds]);
    });

    // The game element moves from the window into the frame at the flip that lays the frame out. Chrome counts that
    // move unless the element is not visible, so the class that holds it must come in the very update that lays the frame
    // out, with the panel open, and go with the chrome. jsdom does no layout: this pins the classes and their order.
    it("holds the game element in the same update that lays the frame out, and releases it with the chrome", () => {
        const element = drawFrame(office());
        expect(element.classList.contains("settling")).toBe(false);

        createScene();
        expect(element.classList.contains("konclui")).toBe(true);
        expect(element.classList.contains("panel-open")).toBe(true);
        expect(element.classList.contains("settling")).toBe(true);

        revealShell();
        expect(element.classList.contains("konclui")).toBe(true);
        expect(element.classList.contains("settling")).toBe(false);
    });

    it("holds the game element again behind the loader of another map", () => {
        const element = drawFrame(office());
        createScene();
        revealShell();

        loaderVisibleStore.set(true);
        gameSceneIsLoadedStore.set(false);
        flushSync();
        expect(element.classList.contains("settling")).toBe(true);

        gameSceneIsLoadedStore.set(true);
        loaderVisibleStore.set(false);
        flushSync();
        expect(element.classList.contains("settling")).toBe(false);
    });

    const viewportOf = () => target.querySelector<HTMLElement>(".viewport");
    const mainLandmarks = () => target.querySelectorAll("main, [role='main']");

    it("names the game area as the main landmark while the shell is drawn, and as nothing otherwise", () => {
        drawFrame(office());
        createScene();
        expect(viewportOf()?.getAttribute("role")).toBeNull();

        revealShell();
        expect(viewportOf()?.getAttribute("role")).toBe("main");
        expect(viewportOf()?.getAttribute("aria-label")).toBe("konclui.office");

        errorScreen.set({ type: "error" });
        flushSync();
        expect(viewportOf()?.getAttribute("role")).toBeNull();
        expect(viewportOf()?.hasAttribute("aria-label")).toBe(false);
    });

    // One main landmark in every state of the office. Upstream's <main> is the warning banner (WarningBanner.svelte, from
    // MainLayout) and the error screens; the frame is the main unless one of them is drawn.
    it("has exactly one main landmark in the office without a banner: the game area", () => {
        drawFrame(office(), '<div id="game"><canvas></canvas></div>');
        createScene();
        revealShell();

        expect(mainLandmarks()).toHaveLength(1);
        expect(mainLandmarks()[0]).toBe(viewportOf());
    });

    it("has exactly one main landmark while the warning banner shows: the banner's, and the game area is a region", () => {
        drawFrame(office(), '<div id="game"><canvas></canvas></div>');
        createScene();
        revealShell();

        // The banner's own markup is drawn by MainLayout inside the game area, as its <main>, with its store on.
        warningBannerStore.set(true);
        viewportOf()?.append(Object.assign(document.createElement("main"), { textContent: "warning banner" }));
        flushSync();

        expect(mainLandmarks()).toHaveLength(1);
        expect(mainLandmarks()[0]).toBe(target.querySelector("main"));
        expect(viewportOf()?.getAttribute("role")).toBe("region");
        expect(viewportOf()?.getAttribute("aria-label")).toBe("konclui.office");
    });

    it("hands the main landmark back to the game area when the banner is closed", () => {
        drawFrame(office());
        createScene();
        revealShell();

        warningBannerStore.set(true);
        flushSync();
        expect(viewportOf()?.getAttribute("role")).toBe("region");

        warningBannerStore.set(false);
        flushSync();
        expect(viewportOf()?.getAttribute("role")).toBe("main");
    });

    // Source pin: the cascade of a compiled Svelte style is not resolved by jsdom, so these hold the text of the rules.
    // They do not show that a rule wins over another or that Chrome treats the move as exempt: the browser run does.
    // The cascade, as Chrome resolves it for the properties that matter here: the frame's own style, compiled with the
    // hash of the mounted component, is put in the document and jsdom resolves `visibility` (which is inherited) and
    // `position`. jsdom does no layout, so whether Chrome counts the move is for the browser run; this pins what is
    // visible, and what stands on the window, at each step of the reload path.
    const gameArea =
        '<div id="main-container"><div id="game"><canvas></canvas><div data-phaser-dom><span></span></div>' +
        '<div class="bg-contrast"><div class="absolute h-dvh" data-loader><img /></div></div></div></div>';

    function injectFrameStyle(element: HTMLElement): void {
        const hash =
            /svelte-\w+/.exec(element.className)?.[0] ??
            /svelte-\w+/.exec(element.firstElementChild?.className ?? "")?.[0];
        if (!hash) throw new Error("the frame carries no style hash");
        let code = compiledStyles.get(hash);
        if (code === undefined) {
            const { css } = compile(source, {
                generate: "client",
                css: "external",
                filename: "Frame.svelte",
                cssHash: () => hash,
            });
            code = css?.code ?? "";
            compiledStyles.set(hash, code);
        }
        const style = document.createElement("style");
        style.textContent = code;
        document.head.append(style);
    }

    const visibilityOf = (selector: string) => {
        const element = target.querySelector(selector);
        if (!element) throw new Error(`no ${selector}`);
        return getComputedStyle(element).visibility;
    };
    const positionOf = (selector: string) => {
        const element = target.querySelector(selector);
        if (!element) throw new Error(`no ${selector}`);
        return getComputedStyle(element).position;
    };
    const held = ["#game", "canvas", "[data-phaser-dom]", "[data-phaser-dom] span", ".viewport", "#main-container"];

    afterEach(() => {
        document.head.querySelectorAll("style").forEach((style) => style.remove());
    });

    it("holds the map's box and all it holds, and only the loading screen shows, while the frame settles on a reload", () => {
        // A returning user: no entry screen. The scene loads behind the loading screen, then it is created.
        const element = drawFrame(office(), gameArea);
        loaderVisibleStore.set(true);
        flushSync();
        expect(element.classList.contains("konclui")).toBe(false);
        expect(held.map(visibilityOf)).toEqual(held.map(() => "visible"));
        expect(positionOf("[data-loader]")).not.toBe("fixed");

        createScene();

        expect(element.classList.contains("konclui")).toBe(true);
        expect(element.classList.contains("settling")).toBe(true);
        expect(held.map(visibilityOf)).toEqual(held.map(() => "hidden"));
        expect(visibilityOf("[data-loader]")).toBe("visible");
        expect(visibilityOf("[data-loader] img")).toBe("visible");
        expect(positionOf("[data-loader]")).toBe("fixed");

        // The room is joined and the loader is released: everything shows at once, with the chrome, and the loading
        // screen, which fades out in place, is still on the window.
        gameSceneIsLoadedStore.set(true);
        loaderVisibleStore.set(false);
        flushSync();

        expect(element.classList.contains("settling")).toBe(false);
        expect(held.map(visibilityOf)).toEqual(held.map(() => "visible"));
        expect(positionOf("[data-loader]")).toBe("fixed");
    });

    it("shows the whole window to an entry screen: nothing is held and the loading screen is not pinned", () => {
        const element = drawFrame(office(), gameArea);
        loginSceneVisibleStore.set(true);
        createScene();

        expect(element.classList.contains("konclui")).toBe(false);
        expect(held.map(visibilityOf)).toEqual(held.map(() => "visible"));
        expect(positionOf("[data-loader]")).not.toBe("fixed");
    });

    // The first visit: the entry screens own the window first, the scene is created behind them, and the frame is laid
    // out only when they end. The move into the frame must then be held in the update that ends them, and the loading
    // screen, which is up while the map loads, must stand on the window from that same update.
    it("walks the first visit in order: entry screen over the window, then frame held and loader pinned, then chrome", () => {
        const element = drawFrame(office(), gameArea);
        const state = () => ({
            framed: element.classList.contains("konclui"),
            settling: element.classList.contains("settling"),
            chrome: element.dataset.testid === "konclui-shell",
            held: held.map(visibilityOf),
            loader: { visibility: visibilityOf("[data-loader]"), position: positionOf("[data-loader]") },
        });
        const everyBox = (visibility: string) => held.map(() => visibility);

        loginSceneVisibleStore.set(true);
        createScene();
        expect(state()).toMatchObject({ framed: false, settling: false, chrome: false, held: everyBox("visible") });
        expect(state().loader.position).not.toBe("fixed");
        expect(published).toEqual([undefined]);

        // The entry screen ends and the loader is up: one update lays the frame out, holds the box, pins the loader.
        loaderVisibleStore.set(true);
        loginSceneVisibleStore.set(false);
        flushSync();
        expect(state()).toMatchObject({
            framed: true,
            settling: true,
            chrome: false,
            held: everyBox("hidden"),
            loader: { visibility: "visible", position: "fixed" },
        });
        expect(published).toEqual([undefined, finalBounds]);

        gameSceneIsLoadedStore.set(true);
        loaderVisibleStore.set(false);
        flushSync();
        expect(state()).toMatchObject({
            framed: true,
            settling: false,
            chrome: true,
            held: everyBox("visible"),
            loader: { visibility: "visible", position: "fixed" },
        });
        expect(published).toEqual([undefined, finalBounds]);
    });

    it("walks the reload path in order: window, then frame held, then chrome", () => {
        const element = drawFrame(office());
        const state = () => ({
            framed: element.classList.contains("konclui"),
            settling: element.classList.contains("settling"),
            chrome: element.dataset.testid === "konclui-shell",
        });

        // The room is known, no entry screen is going to show, the loader is up: the window is still the map's.
        loaderVisibleStore.set(true);
        flushSync();
        expect(state()).toMatchObject({ framed: false, settling: false, chrome: false });
        expect(published).toEqual([undefined]);

        createScene();
        expect(state()).toMatchObject({ framed: true, settling: true, chrome: false });
        expect(published).toEqual([undefined, finalBounds]);

        gameSceneIsLoadedStore.set(true);
        flushSync();
        // The scene is loaded but the loader is still up: still held, nothing drawn, the area untouched.
        expect(state()).toMatchObject({ framed: true, settling: true, chrome: false });

        loaderVisibleStore.set(false);
        flushSync();
        expect(state()).toMatchObject({ framed: true, settling: false, chrome: true });
        expect(published).toEqual([undefined, finalBounds]);
    });

    it("keeps the map in its own column when the rail and the panel are not drawn yet", () => {
        const rule = /\.konclui \.viewport\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";

        expect(/grid-column:\s*([^;]+);/.exec(rule)?.[1].trim()).toBe("-2 / -1");
    });

    it("releases the area when an entry screen takes the window, and lays it out again after it", () => {
        drawFrame(office());
        createScene();

        loginSceneVisibleStore.set(true);
        flushSync();
        expect(published).toEqual([undefined, finalBounds, undefined]);

        loginSceneVisibleStore.set(false);
        flushSync();
        expect(published).toEqual([undefined, finalBounds, undefined, finalBounds]);
    });

    it("never lays out the frame for a room that opts out of the shell", () => {
        const element = drawFrame(office(OPTED_OUT));

        createScene();
        revealShell();

        expect(element.classList.contains("konclui")).toBe(false);
        expect(element.classList.contains("settling")).toBe(false);
        expect(published).toEqual([undefined]);
    });

    // The side panel floats over the map: the map's cell, and so the canvas and its zoom, are the same with the panel open
    // and closed. The grid is read from the style the frame declares, so a third column that comes back moves the cell.
    describe("with the side panel over the map", () => {
        const gridOf = (element: HTMLElement) => getComputedStyle(element).gridTemplateColumns;
        const ready = () => {
            const element = drawFrame(office());
            createScene();
            revealShell();
            return element;
        };

        it("hands the game the same area with the panel open, closed and open again", () => {
            const element = ready();
            expect(element.classList.contains("panel-open")).toBe(true);
            expect(published).toEqual([undefined, finalBounds]);

            closeSidePanel();
            flushSync();
            fireResize();
            expect(element.classList.contains("panel-open")).toBe(false);
            expect(published).toEqual([undefined, finalBounds]);

            showPeople();
            flushSync();
            fireResize();
            expect(element.classList.contains("panel-open")).toBe(true);
            expect(published).toEqual([undefined, finalBounds]);
        });

        it("lays out the same two grid columns with the panel open and closed", () => {
            const element = ready();
            const open = gridOf(element);

            closeSidePanel();
            flushSync();

            expect(element.classList.contains("panel-open")).toBe(false);
            expect(gridOf(element)).toBe(open);
            expect(open).toBe("var(--rail-width) minmax(0, 1fr)");
        });

        const coWebsite = {
            getId: () => "page",
            getUrl: () => new URL("https://page.example"),
            getWidthPercent: () => 0,
        };

        it("gives the panel its column back beside a co-website, which splits the area it floats over otherwise", () => {
            const element = ready();
            expect(element.classList.contains("shares-map")).toBe(false);

            coWebsites.add(coWebsite as unknown as CoWebsite);
            flushSync();
            fireResize();

            expect(element.classList.contains("shares-map")).toBe(true);
            expect(gridOf(element)).toBe("var(--rail-width) var(--panel-width) minmax(0, 1fr)");
            expect(published.at(-1)).toEqual({ left: 356, top: 6, width: 1078, height: 888 });

            coWebsites.remove(coWebsite as unknown as CoWebsite);
            flushSync();
            fireResize();

            expect(element.classList.contains("shares-map")).toBe(false);
            expect(published.at(-1)).toEqual(finalBounds);
        });
    });

    // The strip of the map under the card is the camera's blocker and the width the HUD leaves free.
    describe("with the strip under the card", () => {
        const reserveOf = () => target.querySelector<HTMLElement>("[data-konclui-panel-reserve]");
        const ready = () => {
            const element = drawFrame(office());
            createScene();
            revealShell();
            return element;
        };

        it("draws the strip as a box of its own, outside the card, with nothing that animates it", () => {
            ready();

            const reserve = reserveOf();
            expect(reserve).not.toBeNull();
            expect(reserve?.closest("aside")).toBeNull();
            expect(reserve?.classList.contains("k-enter")).toBe(false);
            expect(reserve?.getAttribute("aria-hidden")).toBe("true");
            const card = target.querySelector("aside.side-panel");
            // The card arrives through the transition on it, and a blocker hears nothing of that (see the strip's comment).
            expect(card?.classList.contains("k-enter")).toBe(false);
            expect(card?.contains(reserve)).toBe(false);
        });

        it("mounts the strip with the panel's state and takes it away when the panel closes", () => {
            ready();
            expect(reserveOf()).not.toBeNull();

            closeSidePanel();
            flushSync();
            expect(reserveOf()).toBeNull();

            showPeople();
            flushSync();
            expect(reserveOf()).not.toBeNull();
        });

        it("registers the strip as the camera's blocker, and not the card, and gives it back when the panel closes", () => {
            const unregister = vi.fn();
            const register = vi.spyOn(biggestAvailableAreaStore, "registerBlocker").mockReturnValue(unregister);
            ready();

            expect(register).toHaveBeenCalledTimes(1);
            expect(register.mock.calls[0][0]).toBe(reserveOf());
            expect(register.mock.calls[0][0]).not.toBe(target.querySelector("aside"));
            expect(unregister).not.toHaveBeenCalled();

            closeSidePanel();
            flushSync();
            expect(unregister).toHaveBeenCalledTimes(1);
        });

        it("tells the game how wide the strip is, as the browser laid it out, and 0 when there is none", () => {
            ready();
            expect(get(gameViewportCoveredStart)).toBe(296);

            // A phone, or a co-website beside the panel: the box is not drawn, so it measures nothing.
            reserveWidth = 0;
            fireResize();
            expect(get(gameViewportCoveredStart)).toBe(0);

            reserveWidth = 296;
            fireResize();
            expect(get(gameViewportCoveredStart)).toBe(296);

            closeSidePanel();
            flushSync();
            expect(get(gameViewportCoveredStart)).toBe(0);
        });

        it("clears the strip when the frame is taken down", async () => {
            ready();
            expect(get(gameViewportCoveredStart)).toBe(296);

            const mounted = frame;
            frame = undefined;
            if (mounted) await unmount(mounted);

            expect(get(gameViewportCoveredStart)).toBe(0);
        });
    });

    // The card leaves through its own transition and is in the page for the length of its exit. What the game is told
    // follows the panel's state, which changes as the exit starts and not as the card is removed, so that the map and
    // the card move together. `Element.animate` is jsdom's missing piece: it is lent one whose animations wait.
    describe("through the card's exit", () => {
        class FakeAnimation {
            currentTime = 0;
            onfinish: (() => void) | null = null;
            cancelled = false;
            effect: unknown = {};

            constructor(readonly options: { duration: number }) {}

            cancel(): void {
                this.cancelled = true;
            }

            finish(): void {
                this.onfinish?.();
            }
        }
        let animations: FakeAnimation[];

        beforeEach(() => {
            animations = [];
            Object.defineProperty(Element.prototype, "animate", {
                configurable: true,
                writable: true,
                value(_keyframes: unknown, options: { duration: number }) {
                    const animation = new FakeAnimation(options);
                    animations.push(animation);
                    // Svelte starts a run with a dummy animation as long as the delay (0) and waits for it to end.
                    if (!options.duration) queueMicrotask(() => !animation.cancelled && animation.finish());
                    return animation;
                },
            });
            Object.defineProperty(window, "matchMedia", {
                configurable: true,
                writable: true,
                value: (query: string) => ({ matches: false, media: query }),
            });
        });

        afterEach(() => {
            Reflect.deleteProperty(Element.prototype, "animate");
            Reflect.deleteProperty(window, "matchMedia");
        });

        const moving = () => animations.filter((animation) => animation.options.duration > 0 && !animation.cancelled);
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
        const cardOf = () => target.querySelector<HTMLElement>("aside.side-panel");
        const ready = async () => {
            drawFrame(office());
            createScene();
            revealShell();
            await settle();
            await finishMoving();
        };

        it("hands the game the same area while the card is open, while it leaves, once it has gone and when it is back", async () => {
            await ready();
            expect(cardOf()).not.toBeNull();
            expect(published).toEqual([undefined, finalBounds]);

            closeSidePanel();
            flushSync();
            await settle();
            fireResize();
            // The card is still there, leaving: the cell that the map has is the one it had with the card open.
            expect(cardOf()).not.toBeNull();
            expect(moving()).toHaveLength(1);
            expect(published).toEqual([undefined, finalBounds]);

            await finishMoving();
            fireResize();
            expect(cardOf()).toBeNull();
            expect(published).toEqual([undefined, finalBounds]);

            showPeople();
            flushSync();
            await settle();
            fireResize();
            expect(cardOf()).not.toBeNull();
            expect(published).toEqual([undefined, finalBounds]);
        });

        it("keeps the grid's two columns while the card leaves, as it had them with the card open", async () => {
            const element = drawFrame(office());
            createScene();
            revealShell();
            await settle();
            await finishMoving();
            const columns = getComputedStyle(element).gridTemplateColumns;

            closeSidePanel();
            flushSync();

            expect(cardOf()).not.toBeNull();
            expect(getComputedStyle(element).gridTemplateColumns).toBe(columns);
        });

        it("takes the strip from the camera as the exit starts, with the card still in the page, and gives it back as the card opens", async () => {
            const unregister = vi.fn();
            const register = vi.spyOn(biggestAvailableAreaStore, "registerBlocker").mockReturnValue(unregister);
            await ready();
            expect(register).toHaveBeenCalledTimes(1);
            expect(get(gameViewportCoveredStart)).toBe(296);

            closeSidePanel();
            flushSync();

            expect(cardOf()).not.toBeNull();
            expect(unregister).toHaveBeenCalledTimes(1);
            expect(get(gameViewportCoveredStart)).toBe(0);

            // Reopened while the card is still leaving: the strip is back in the update that starts the entrance.
            showPeople();
            flushSync();

            expect(cardOf()).not.toBeNull();
            expect(register).toHaveBeenCalledTimes(2);
            expect(register.mock.calls[1][0]).toBe(target.querySelector("[data-konclui-panel-reserve]"));
            expect(get(gameViewportCoveredStart)).toBe(296);
        });
    });
});
