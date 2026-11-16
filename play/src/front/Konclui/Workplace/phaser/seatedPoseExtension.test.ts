import { describe, expect, it } from "vitest";
import type { MessageUserJoined } from "../../../Connection/ConnexionModels";
import type { RemotePlayer } from "../../../Phaser/Entity/RemotePlayer";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import type { Player } from "../../../Phaser/Player/Player";
import type { SceneFrameContext } from "../../../ExternalModule/ClientExtensionPoints";
import { createSeatedPoseExtension } from "./seatedPoseExtension";

class TestSprite {
    public y = 0;
    public width = 32;
    public height = 32;
    public isCropped = false;
    public crop: number[] | undefined;
    public anims = {
        currentAnim: { key: "body-down-idle" } as { key: string } | undefined,
        play: (key: string) => {
            this.anims.currentAnim = { key };
        },
    };

    public setCrop(x?: number, y?: number, width?: number, height?: number): this {
        this.isCropped = x !== undefined;
        this.crop = x !== undefined ? [x, y ?? 0, width ?? 0, height ?? 0] : undefined;
        return this;
    }
}

class TestCharacter {
    public readonly depth = 400;
    public readonly body = new TestSprite();
    public readonly sprites = new Map<string, TestSprite>([["body", this.body]]);
}

const game = { markDirty: () => undefined, anims: { exists: () => true } } as unknown as GameScene;

interface FrameOptions {
    currentPlayer?: TestCharacter;
    playerVariables?: Record<string, unknown>;
    remote?: Map<number, { character: TestCharacter; variables: Record<string, unknown> }>;
}

function frameContext({ currentPlayer, playerVariables = {}, remote = new Map() }: FrameOptions): SceneFrameContext {
    const remoteCharacters = new Map([...remote].map(([id, { character }]) => [id, character]));
    const remotePlayers = new Map(
        [...remote].map(([id, { variables }]) => [id, { variables: new Map(Object.entries(variables)) }]),
    );
    return {
        scene: game,
        time: 0,
        delta: 16,
        baseUrl: "http://localhost:8090/~/escritorio-sede/office.wam",
        currentPlayer: currentPlayer as unknown as Player | undefined,
        remoteCharacters: remoteCharacters as unknown as ReadonlyMap<number, RemotePlayer>,
        remotePlayers: remotePlayers as unknown as ReadonlyMap<number, MessageUserJoined>,
        getPlayerVariable: (key) => playerVariables[key],
    };
}

describe("seated pose extension", () => {
    it("poses the current player from their own officeSeat variable on each frame", () => {
        const extension = createSeatedPoseExtension();
        const player = new TestCharacter();

        extension.onFrame?.(
            frameContext({ currentPlayer: player, playerVariables: { officeSeat: { v: 1, direction: "up" } } }),
        );

        expect(player.body.anims.currentAnim?.key).toBe("body-up-idle");
        expect(player.body.crop).toEqual([0, 0, 32, 22]);
        expect(player.body.y).toBe(-3);
    });

    it("ignores the other variables of the current player", () => {
        const extension = createSeatedPoseExtension();
        const player = new TestCharacter();

        extension.onFrame?.(
            frameContext({ currentPlayer: player, playerVariables: { seat: { v: 1, direction: "up" } } }),
        );

        expect(player.body.crop).toBeUndefined();
        expect(player.body.y).toBe(0);
    });

    it("poses a remote player from the officeSeat variable they published", () => {
        const extension = createSeatedPoseExtension();
        const player = new TestCharacter();
        const other = new TestCharacter();
        const remote = new Map([[7, { character: other, variables: { officeSeat: { v: 1, direction: "left" } } }]]);

        extension.onFrame?.(frameContext({ currentPlayer: player, remote }));

        expect(other.body.anims.currentAnim?.key).toBe("body-left-idle");
        expect(other.body.y).toBe(-3);
        expect(player.body.y).toBe(0);
    });

    it("stands the characters up again once the seat variable clears", () => {
        const extension = createSeatedPoseExtension();
        const player = new TestCharacter();
        extension.onFrame?.(
            frameContext({ currentPlayer: player, playerVariables: { officeSeat: { v: 1, direction: "down" } } }),
        );

        extension.onFrame?.(frameContext({ currentPlayer: player }));

        expect(player.body.crop).toBeUndefined();
        expect(player.body.y).toBe(0);
    });

    it("leaves every character alone until the scene has created the current player", () => {
        const extension = createSeatedPoseExtension();
        const other = new TestCharacter();
        const remote = new Map([[7, { character: other, variables: { officeSeat: { v: 1, direction: "left" } } }]]);

        extension.onFrame?.(frameContext({ currentPlayer: undefined, remote }));

        expect(other.body.crop).toBeUndefined();
        expect(other.body.y).toBe(0);
    });

    it("gives the poses back when the scene shuts down", () => {
        const extension = createSeatedPoseExtension();
        const player = new TestCharacter();
        const other = new TestCharacter();
        const remote = new Map([[7, { character: other, variables: { officeSeat: { v: 1, direction: "left" } } }]]);
        extension.onFrame?.(
            frameContext({
                currentPlayer: player,
                playerVariables: { officeSeat: { v: 1, direction: "down" } },
                remote,
            }),
        );

        extension.onShutdown?.(game);

        for (const character of [player, other]) {
            expect(character.body.crop).toBeUndefined();
            expect(character.body.y).toBe(0);
        }
    });
});
