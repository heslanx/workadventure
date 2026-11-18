import { afterEach, describe, expect, it } from "vitest";
import { get, writable, type Writable } from "svelte/store";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import { onlineCountStore } from "./onlineCountStore";

function sceneWith(counter: Writable<number>): GameScene {
    return { worldUserCounter: counter } as unknown as GameScene;
}

describe("the online count store", () => {
    afterEach(() => {
        gameSceneStore.set(undefined);
    });

    it("is 0 while there is no scene, which the pill reads as unknown", () => {
        expect(get(onlineCountStore)).toBe(0);
    });

    it("follows the scene's world headcount", () => {
        const counter = writable(0);
        gameSceneStore.set(sceneWith(counter));
        const heard: number[] = [];
        const unsubscribe = onlineCountStore.subscribe((count) => heard.push(count));

        counter.set(12);
        counter.set(13);
        unsubscribe();

        expect(heard).toEqual([0, 12, 13]);
    });

    it("follows the next scene and stops listening to the previous one", () => {
        const first = writable(5);
        const second = writable(40);
        gameSceneStore.set(sceneWith(first));
        const heard: number[] = [];
        const unsubscribe = onlineCountStore.subscribe((count) => heard.push(count));

        gameSceneStore.set(sceneWith(second));
        first.set(6);
        unsubscribe();

        expect(heard).toEqual([5, 40]);
    });

    it("goes back to 0 when the scene goes", () => {
        gameSceneStore.set(sceneWith(writable(9)));
        const heard: number[] = [];
        const unsubscribe = onlineCountStore.subscribe((count) => heard.push(count));

        gameSceneStore.set(undefined);
        unsubscribe();

        expect(heard).toEqual([9, 0]);
    });
});
