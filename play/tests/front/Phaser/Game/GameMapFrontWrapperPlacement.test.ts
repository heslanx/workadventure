// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GameMapFrontWrapper } from "../../../../src/front/Phaser/Game/GameMap/GameMapFrontWrapper";
import { PathTileType } from "../../../../src/front/Utils/PathfindingManager";

const TILE_SIZE = 32;

/**
 * Builds a wrapper around a one-row collision grid, bypassing the Phaser tilemap the real constructor needs.
 * Only the members read by isSpaceAvailable are provided.
 */
function createWrapperWithGrid(row: number[]): GameMapFrontWrapper {
    const wrapper = Object.create(GameMapFrontWrapper.prototype) as GameMapFrontWrapper;
    Object.assign(wrapper, {
        collisionGrid: [row],
        collisionGridDirty: false,
        gameMap: { getTileDimensions: () => ({ width: TILE_SIZE, height: TILE_SIZE }) },
        scene: {
            getRemotePlayersRepository: () => ({ getPlayers: () => new Map() }),
            CurrentPlayer: { getPosition: () => ({ x: -1000, y: -1000 }) },
        },
    });
    return wrapper;
}

describe("GameMapFrontWrapper.isSpaceAvailable", () => {
    it("lets the map editor place on walkable, meeting-room and personal-desk tiles", () => {
        const wrapper = createWrapperWithGrid([
            PathTileType.Walkable,
            PathTileType.MeetingRoom,
            PathTileType.PersonalDesk,
        ]);

        const available = [0, 1, 2].map((column) => wrapper.isSpaceAvailable(column * TILE_SIZE, 0));

        expect(available).toEqual([true, true, true]);
    });

    it("keeps blocking collider, exit and start tiles", () => {
        const wrapper = createWrapperWithGrid([PathTileType.Collider, PathTileType.Exit, PathTileType.Start]);

        const available = [0, 1, 2].map((column) => wrapper.isSpaceAvailable(column * TILE_SIZE, 0));

        expect(available).toEqual([false, false, false]);
    });
});
