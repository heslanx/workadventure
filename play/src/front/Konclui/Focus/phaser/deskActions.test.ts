import { afterEach, describe, expect, it, vi } from "vitest";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { deskActions } from "./deskActions";

// The scene is the one upstream method this adapter calls; the store that holds it is real.
vi.mock("../../../Stores/GameSceneStore", async () => {
    const { writable } = await import("svelte/store");
    return { gameSceneStore: writable(undefined) };
});

function sceneWith(walkToPersonalDesk: () => Promise<void>): GameScene {
    return { walkToPersonalDesk } as unknown as GameScene;
}

describe("the desk actions", () => {
    afterEach(() => {
        gameSceneStore.set(undefined);
    });

    it("walks to the personal desk through the running scene", async () => {
        const walk = vi.fn().mockResolvedValue(undefined);
        gameSceneStore.set(sceneWith(walk));

        await deskActions.walkToDesk();

        expect(walk).toHaveBeenCalledTimes(1);
    });

    it("passes the failure of the walk on, so the dock can report it", async () => {
        gameSceneStore.set(sceneWith(() => Promise.reject(new Error("No path found"))));

        await expect(deskActions.walkToDesk()).rejects.toThrow("No path found");
    });

    it("reports a missing scene instead of doing nothing", async () => {
        await expect(deskActions.walkToDesk()).rejects.toThrow("no game scene");
    });
});
