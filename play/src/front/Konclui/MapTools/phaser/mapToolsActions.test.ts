import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameScene } from "../../../Phaser/Game/GameScene";

const sendButtonActionBarTriggered = vi.fn();
const scene = writable<GameScene | undefined>(undefined);

vi.mock("../../../Api/IframeListener", () => ({ iframeListener: { sendButtonActionBarTriggered } }));
vi.mock("../../../Stores/GameSceneStore", () => ({ gameSceneStore: scene }));

const { mapToolsActions } = await import("./mapToolsActions");

describe("the map tools' actions", () => {
    beforeEach(() => {
        scene.set(undefined);
        sendButtonActionBarTriggered.mockReset();
    });

    it("takes the user to their desk by pressing the office script's own button", () => {
        mapToolsActions.goToDesk();

        expect(sendButtonActionBarTriggered).toHaveBeenCalledExactlyOnceWith("minha-mesa");
    });

    it("brings the view back to the avatar through upstream's camera, the call its own 'show my location' makes", () => {
        const resumePlayerFollow = vi.fn();
        scene.set({ getCameraManager: () => ({ resumePlayerFollow }) } as unknown as GameScene);

        mapToolsActions.centerOnPlayer();

        expect(resumePlayerFollow).toHaveBeenCalledTimes(1);
    });

    it("says so when there is no scene to centre the view in, and does not pretend to", () => {
        expect(() => mapToolsActions.centerOnPlayer()).toThrow("no game scene");
    });
});
