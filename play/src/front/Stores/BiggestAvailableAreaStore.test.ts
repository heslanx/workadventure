// @vitest-environment jsdom
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import { createBiggestAvailableAreaStore } from "./BiggestAvailableAreaStore";

function setElementSize(element: HTMLElement, width: number, height: number): void {
    Object.defineProperty(element, "offsetWidth", { configurable: true, value: width });
    Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
}

describe("BiggestAvailableAreaStore", () => {
    beforeEach(() => {
        document.body.innerHTML = "";

        const game = document.createElement("div");
        game.id = "game";
        setElementSize(game, 100, 100);
        document.body.append(game);
    });

    it("uses registered blocker bounds when recomputing the biggest available area", () => {
        const store = createBiggestAvailableAreaStore();
        const blocker = document.createElement("div");
        document.body.append(blocker);

        store.registerBlocker(blocker);
        store.updateBlockerBox(blocker, {
            xStart: 0,
            yStart: 0,
            xEnd: 60,
            yEnd: 100,
        });

        store.recompute();

        expect(get(store)).toEqual({
            xStart: 60,
            yStart: 0,
            xEnd: 100,
            yEnd: 100,
        });
    });

    it("reads blocker bounds relative to a game container that is not at the window origin", () => {
        const game = document.querySelector<HTMLElement>("#game");
        if (!game) throw new Error("no game container");
        game.getBoundingClientRect = () => new DOMRect(40, 10, 100, 100);
        const store = createBiggestAvailableAreaStore();
        const besideTheGame = document.createElement("div");
        const overTheGame = document.createElement("div");
        document.body.append(besideTheGame, overTheGame);
        store.registerBlocker(besideTheGame);
        store.registerBlocker(overTheGame);
        store.updateBlockerBox(besideTheGame, { xStart: 0, yStart: 0, xEnd: 40, yEnd: 110 });
        store.updateBlockerBox(overTheGame, { xStart: 110, yStart: 10, xEnd: 140, yEnd: 110 });

        store.recompute();

        expect(get(store)).toEqual({ xStart: 0, yStart: 0, xEnd: 70, yEnd: 100 });
    });

    it("removes blocker bounds after unregistering the blocker", () => {
        const store = createBiggestAvailableAreaStore();
        const blocker = document.createElement("div");
        document.body.append(blocker);

        const unregisterBlocker = store.registerBlocker(blocker);
        store.updateBlockerBox(blocker, {
            xStart: 0,
            yStart: 0,
            xEnd: 60,
            yEnd: 100,
        });
        unregisterBlocker();

        store.recompute();

        expect(get(store)).toEqual({
            xStart: 0,
            yStart: 0,
            xEnd: 100,
            yEnd: 100,
        });
    });

    it("coalesces multiple recompute requests into one pending recompute", () => {
        const store = createBiggestAvailableAreaStore();

        store.requestRecompute();
        store.requestRecompute();

        expect(store.consumePendingRecompute()).toBe(true);
        expect(store.consumePendingRecompute()).toBe(false);
    });
});
