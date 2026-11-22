// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { compile } from "svelte/compiler";
import type { Writable } from "svelte/store";
import type { Room } from "../../../Connection/Room";

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
import { gameViewportBounds } from "../../../ExternalModule/ClientExtensionPoints";
import type { ViewportBounds } from "../../../Stores/CoWebsiteLayout";
import { navChat } from "../../../Chat/Stores/ChatStore";
import { closeSidePanel } from "../stores/sidePanelStore";
import Frame from "./Frame.svelte";

const errorScreen = errorScreenStore as unknown as Writable<object | undefined>;

class NoResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", NoResizeObserver);

const OPTED_OUT = { konclui: { shell: false } };

function office(metadata: unknown = undefined): Room {
    return {
        id: "office",
        metadata,
        isChatOnlineListEnabled: true,
        isChatDisconnectedListEnabled: false,
    } as unknown as Room;
}

// jsdom does no layout, so the map's cell is modelled on the frame's grid: a 6 px gutter, the rail's 60 px, and the side
// panel's 296 px (its own gutter is inside that column) when the frame carries `panel-open`.
const WINDOW = { width: 1440, height: 900 };
function cellOf(viewport: HTMLElement): DOMRect {
    const panelOpen = viewport.parentElement?.classList.contains("panel-open") === true;
    const left = 60 + (panelOpen ? 296 : 0);
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

describe("the office frame around the game", () => {
    const target = document.createElement("div");
    let frame: ReturnType<typeof mount> | undefined;
    let published: Array<ViewportBounds | undefined> = [];
    let stopRecording: (() => void) | undefined;

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
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
            return this.classList.contains("viewport") ? cellOf(this) : new DOMRect();
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
    const finalBounds = { left: 356, top: 6, width: 1078, height: 888 };

    it("is not laid out while the room is known and no scene exists: the entry screens fill the window", () => {
        const element = drawFrame(office());

        expect(element.classList.contains("konclui")).toBe(false);
        expect(published).toEqual([undefined]);
    });

    it("lays the frame out, with the side panel's column, when the scene is created, before the chrome is drawn", () => {
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
    // out, with the panel's column, and go with the chrome. jsdom does no layout: this pins the classes and their order.
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
        const { css } = compile(source, {
            generate: "client",
            css: "external",
            filename: "Frame.svelte",
            cssHash: () => hash,
        });
        const style = document.createElement("style");
        style.textContent = css?.code ?? "";
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
        injectFrameStyle(element.querySelector<HTMLElement>(".viewport") ?? element);
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
        injectFrameStyle(element.querySelector<HTMLElement>(".viewport") ?? element);
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
        injectFrameStyle(element.querySelector<HTMLElement>(".viewport") ?? element);
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
});
