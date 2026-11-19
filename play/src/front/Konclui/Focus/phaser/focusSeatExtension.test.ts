import { describe, expect, it, vi } from "vitest";
import type { SceneFrameContext } from "../../../ExternalModule/ClientExtensionPoints";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { createFocusSeatExtension } from "./focusSeatExtension";

const BASE_URL = "https://office.example/_/global/map";

/** A frame in which the player's `officeSeat` variable is `seat`. */
function frame(seat: unknown, { player = true }: { player?: boolean } = {}): SceneFrameContext {
    return {
        currentPlayer: player ? {} : undefined,
        baseUrl: BASE_URL,
        getPlayerVariable: (key: string) => (key === "officeSeat" ? seat : undefined),
    } as unknown as SceneFrameContext;
}

const SEATED = { v: 1, direction: "up" };

describe("the focus seat extension", () => {
    it("reports that the player sits when the officeSeat variable is a seat pose", () => {
        const publish = vi.fn();
        const extension = createFocusSeatExtension(publish);

        extension.onFrame?.(frame(SEATED));

        expect(publish).toHaveBeenCalledExactlyOnceWith(true);
    });

    it("reports that the player stands when the variable is not set, or is not a pose", () => {
        const publish = vi.fn();
        const extension = createFocusSeatExtension(publish);

        extension.onFrame?.(frame(undefined));
        extension.onFrame?.(frame({ v: 2, direction: "up" }));

        expect(publish.mock.calls).toEqual([[false], [false]]);
    });

    it("follows the player from sitting to standing", () => {
        const publish = vi.fn();
        const extension = createFocusSeatExtension(publish);

        extension.onFrame?.(frame(SEATED));
        extension.onFrame?.(frame(undefined));

        expect(publish.mock.calls).toEqual([[true], [false]]);
    });

    it("reads again only when the variable is another object, so a still frame costs no parse", () => {
        const publish = vi.fn();
        const extension = createFocusSeatExtension(publish);
        const pose = { ...SEATED };

        for (let index = 0; index < 100; index++) extension.onFrame?.(frame(pose));

        expect(publish).toHaveBeenCalledTimes(1);
    });

    it("waits for the scene to create the current player", () => {
        const publish = vi.fn();
        const extension = createFocusSeatExtension(publish);

        extension.onFrame?.(frame(SEATED, { player: false }));

        expect(publish).not.toHaveBeenCalled();
    });

    it("reports standing when the scene shuts down, and reads the next scene from scratch", () => {
        const publish = vi.fn();
        const extension = createFocusSeatExtension(publish);
        const pose = { ...SEATED };
        extension.onFrame?.(frame(pose));

        extension.onShutdown?.({} as GameScene);
        extension.onFrame?.(frame(pose));

        expect(publish.mock.calls).toEqual([[true], [false], [true]]);
    });
});
