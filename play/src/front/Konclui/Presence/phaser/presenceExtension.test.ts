import { describe, expect, it, vi } from "vitest";
import type { SceneFrameContext } from "../../../ExternalModule/ClientExtensionPoints";
import type { RemotePlayer } from "../../../Phaser/Entity/RemotePlayer";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import type { Player } from "../../../Phaser/Player/Player";
import type { AreaLike } from "../domain/place";
import type { PresenceReading } from "../domain/presence";
import { createPresenceExtension } from "./presenceExtension";

const room: AreaLike = { name: "Sala 01", x: 1600, y: 900, width: 100, height: 100 };
const wing: AreaLike = { name: "Ala oeste", x: 600, y: 900, width: 512, height: 352 };

interface Stranger {
    userId: number;
    playerName: string;
    x: number;
    y: number;
}

interface FrameOptions {
    time?: number;
    /** `null` is a scene that has not created its player yet. */
    player?: { x: number; y: number } | null;
    strangers?: Stranger[];
    /** `null` is a map with no area data. */
    areas?: AreaLike[] | null;
}

function frame({ time = 0, player = { x: 700, y: 1000 }, strangers = [], areas = [room, wing] }: FrameOptions = {}) {
    const areaMap = areas === null ? undefined : new Map(areas.map((area, index) => [`area-${index}`, area]));
    const scene = { getGameMapFrontWrapper: () => ({ getAreas: () => areaMap }) } as unknown as GameScene;
    const context: SceneFrameContext = {
        scene,
        time,
        delta: 16,
        baseUrl: "http://localhost:8090/~/escritorio-sede/office.wam",
        currentPlayer: (player ?? undefined) as unknown as Player | undefined,
        remoteCharacters: new Map(strangers.map((stranger) => [stranger.userId, stranger])) as unknown as ReadonlyMap<
            number,
            RemotePlayer
        >,
        remotePlayers: new Map(),
        getPlayerVariable: () => undefined,
    };
    return context;
}

function setup() {
    const publish = vi.fn<(reading: PresenceReading | undefined) => void>();
    return { extension: createPresenceExtension(publish), publish };
}

describe("the presence extension", () => {
    it("reads who is near and where the player stands in one reading", () => {
        const { extension, publish } = setup();

        extension.onFrame?.(
            frame({
                strangers: [
                    { userId: 12, playerName: "Ana Ribeiro", x: 760, y: 1000 },
                    { userId: 13, playerName: "Far Away", x: 1650, y: 950 },
                ],
            }),
        );

        expect(publish).toHaveBeenCalledWith({
            nearest: [
                { id: 12, name: "Ana Ribeiro" },
                { id: 13, name: "Far Away" },
            ],
            nearCount: 1,
            place: { kind: "area", name: "Ala oeste" },
        });
    });

    it("finds the place at the player's feet, 16 px below the position the scene reports", () => {
        const { extension, publish } = setup();

        // The position is 5 px above the room's top edge: the feet are inside the room.
        extension.onFrame?.(frame({ player: { x: 1650, y: room.y - 5 } }));

        expect(publish.mock.lastCall?.[0]?.place).toEqual({ kind: "area", name: "Sala 01" });
    });

    it("says no place when the map has no areas", () => {
        const { extension, publish } = setup();

        extension.onFrame?.(frame({ areas: null }));

        expect(publish.mock.lastCall?.[0]?.place).toBeUndefined();
    });

    it("reads at most once every 250 ms of frame time", () => {
        const { extension, publish } = setup();

        extension.onFrame?.(frame({ time: 1000 }));
        extension.onFrame?.(frame({ time: 1100 }));
        extension.onFrame?.(frame({ time: 1249 }));
        expect(publish).toHaveBeenCalledTimes(1);

        extension.onFrame?.(frame({ time: 1250 }));
        expect(publish).toHaveBeenCalledTimes(2);
    });

    it("sees someone who walks in between two readings at the next one", () => {
        const { extension, publish } = setup();
        extension.onFrame?.(frame({ time: 0 }));

        extension.onFrame?.(frame({ time: 300, strangers: [{ userId: 3, playerName: "Late", x: 720, y: 1000 }] }));

        expect(publish.mock.lastCall?.[0]?.nearest).toEqual([{ id: 3, name: "Late" }]);
    });

    it("reads nothing until the scene has created the current player", () => {
        const { extension, publish } = setup();

        extension.onFrame?.(frame({ player: null }));

        expect(publish).not.toHaveBeenCalled();
    });

    it("clears the reading when the scene shuts down and reads again at once in the next one", () => {
        const { extension, publish } = setup();
        extension.onFrame?.(frame({ time: 1000 }));

        extension.onShutdown?.({} as GameScene);
        expect(publish).toHaveBeenLastCalledWith(undefined);

        extension.onFrame?.(frame({ time: 1010 }));
        expect(publish).toHaveBeenCalledTimes(3);
        expect(publish.mock.lastCall?.[0]).toBeDefined();
    });

    it("is one extension, named for error reports", () => {
        expect(setup().extension.id).toBe("konclui.presence");
    });
});
