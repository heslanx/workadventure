import { afterEach, describe, expect, it } from "vitest";
import { get, writable } from "svelte/store";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import { peoplePillStore } from "./peoplePillStore";
import { publishPresence } from "./presenceStore";

function worldOf(count: number): GameScene {
    return { worldUserCounter: writable(count) } as unknown as GameScene;
}

describe("the people pill store", () => {
    afterEach(() => {
        gameSceneStore.set(undefined);
        publishPresence(undefined);
    });

    it("is unknown, with no avatars, before the world has synchronised", () => {
        gameSceneStore.set(worldOf(0));

        expect(get(peoplePillStore)).toEqual({ summary: { kind: "unknown" }, nearest: [] });
    });

    it("has the headcount but no near count until the scene has read its surroundings", () => {
        gameSceneStore.set(worldOf(12));

        expect(get(peoplePillStore).summary).toEqual({ kind: "others", online: 12, nearCount: undefined });
    });

    it("puts the headcount and the near count together, with the nearest people as avatars", () => {
        gameSceneStore.set(worldOf(12));
        publishPresence({ nearest: [{ id: 4, name: "Ana Ribeiro" }], nearCount: 3, place: undefined });

        expect(get(peoplePillStore)).toEqual({
            summary: { kind: "others", online: 12, nearCount: 3 },
            nearest: [{ id: 4, name: "Ana Ribeiro" }],
        });
    });

    it("is alone when the world holds only the current user", () => {
        gameSceneStore.set(worldOf(1));
        publishPresence({ nearest: [], nearCount: 0, place: undefined });

        expect(get(peoplePillStore).summary).toEqual({ kind: "alone" });
    });
});
