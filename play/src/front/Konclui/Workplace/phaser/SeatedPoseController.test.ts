import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { SeatedPoseController, type SeatedPoseScene, type SeatedPoseUpdate } from "./SeatedPoseController";

class TestSprite {
    public y = 0;
    public width = 32;
    public height = 32;
    public isCropped = false;
    public crop: number[] | undefined;
    public anims = {
        currentAnim: { key: "body-down-idle" },
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

class TestImage {
    public depth = 0;
    public origin: number[] | undefined;
    public destroyed = false;

    constructor(
        public x: number,
        public y: number,
        public key: string,
    ) {}

    public setOrigin(x: number, y: number): this {
        this.origin = [x, y];
        return this;
    }

    public setDepth(depth: number): this {
        this.depth = depth;
        return this;
    }

    public destroy(): void {
        this.destroyed = true;
    }
}

function character(direction = "down") {
    const body = new TestSprite();
    body.anims.currentAnim = { key: `body-${direction}-idle` };
    const hair = new TestSprite();
    return {
        depth: 400,
        sprites: new Map<string, TestSprite>([
            ["body", body],
            ["hair", hair],
        ]),
    };
}

function scene(): SeatedPoseScene & {
    dirty: number;
    images: TestImage[];
    textures: { keys: Set<string>; exists(key: string): boolean };
    load: {
        queue: Array<[string, string]>;
        events: EventEmitter;
        image(key: string, source: string): void;
        once(event: string, callback: () => void): void;
        on(event: string, callback: (file: { key: string }) => void): void;
        off(event: string, callback: (() => void) | ((file: { key: string }) => void)): void;
        start(): void;
    };
} {
    const value = {
        dirty: 0,
        images: [] as TestImage[],
        markDirty() {
            value.dirty += 1;
        },
        anims: { exists: () => true },
        add: {
            image(x: number, y: number, key: string) {
                const image = new TestImage(x, y, key);
                value.images.push(image);
                return image;
            },
        },
        textures: {
            keys: new Set<string>(),
            exists(key: string) {
                return value.textures.keys.has(key);
            },
        },
        load: {
            queue: [] as Array<[string, string]>,
            events: new EventEmitter(),
            image(key: string, source: string) {
                value.load.queue.push([key, source]);
            },
            once(event: string, callback: () => void) {
                value.load.events.once(event, callback);
            },
            on(event: string, callback: (file: { key: string }) => void) {
                value.load.events.on(event, callback);
            },
            off(event: string, callback: (() => void) | ((file: { key: string }) => void)) {
                value.load.events.off(event, callback);
            },
            start() {},
        },
    };
    return value;
}

function update(
    controller: SeatedPoseController,
    game: ReturnType<typeof scene>,
    currentPlayer: ReturnType<typeof character>,
    currentSeat: unknown,
    remoteCharacters = new Map<number, ReturnType<typeof character>>(),
    remotePlayers = new Map<number, { variables: ReadonlyMap<string, unknown> }>(),
): void {
    const context: SeatedPoseUpdate = {
        scene: game,
        baseUrl: "http://localhost:8090/~/escritorio-sede/office.wam",
        currentPlayer,
        currentSeat,
        remoteCharacters,
        remotePlayers,
    };
    controller.update(context);
}

describe("SeatedPoseController", () => {
    it.each([
        { direction: "down", height: 32 },
        { direction: "left", height: 32 },
        { direction: "right", height: 32 },
        { direction: "up", height: 22 },
    ])("applies the idle frame and default crop for $direction", ({ direction, height }) => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();

        update(controller, game, player, { v: 1, direction });

        for (const [texture, sprite] of player.sprites) {
            expect(sprite.anims.currentAnim?.key).toBe(`${texture}-${direction}-idle`);
            expect(sprite.crop).toEqual([0, 0, 32, height]);
            expect(sprite.y).toBe(-3);
        }
    });

    it("clears the pose when the public variable clears or changes to a malformed value", () => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();
        update(controller, game, player, { v: 1, direction: "down", dy: 4, crop: 3 });

        update(controller, game, player, null);
        for (const sprite of player.sprites.values()) {
            expect(sprite.crop).toBeUndefined();
            expect(sprite.y).toBe(0);
        }

        update(controller, game, player, { v: 1, direction: "down" });
        update(controller, game, player, { v: 1, direction: "north" });

        for (const sprite of player.sprites.values()) {
            expect(sprite.crop).toBeUndefined();
            expect(sprite.y).toBe(0);
        }
    });

    it("restores the pose while walking and reapplies it after the walk stops", () => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();
        const body = player.sprites.get("body");
        update(controller, game, player, { v: 1, direction: "right" });
        if (!body) throw new Error("body sprite missing");
        body.anims.currentAnim = { key: "body-right-walk" };

        update(controller, game, player, { v: 1, direction: "right" });
        expect(body.crop).toBeUndefined();
        expect(body.y).toBe(0);

        body.anims.currentAnim = { key: "body-right-idle" };
        update(controller, game, player, { v: 1, direction: "right" });
        expect(body.crop).toEqual([0, 0, 32, 32]);
        expect(body.y).toBe(-3);
    });

    it("poses remote characters from their public officeSeat variable", () => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();
        const remote = character();
        const remoteCharacters = new Map([[7, remote]]);
        const remotePlayers = new Map([[7, { variables: new Map([["officeSeat", { v: 1, direction: "left" }]]) }]]);

        update(controller, game, player, null, remoteCharacters, remotePlayers);

        expect(remote.sprites.get("body")?.anims.currentAnim?.key).toBe("body-left-idle");
        expect(remote.sprites.get("body")?.y).toBe(-3);
        update(controller, game, player, null, new Map(), new Map());
        expect(remote.sprites.get("body")?.crop).toBeUndefined();
        expect(remote.sprites.get("body")?.y).toBe(0);
    });

    it("loads a same-origin map-storage front layer and removes it on reset", () => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();
        const front = { src: "/map-storage/room/entities/chair.png", x: 100, y: 200 };
        update(controller, game, player, { v: 1, direction: "up", front });

        const entry = game.load.queue[0];
        if (!entry) throw new Error("front image was not queued");
        const [key, source] = entry;
        expect(key).toBe("kseat:http://localhost:8090/map-storage/room/entities/chair.png");
        expect(source).toBe("http://localhost:8090/map-storage/room/entities/chair.png");
        game.textures.keys.add(key);
        game.load.events.emit(`filecomplete-image-${key}`);
        expect(game.images[0]).toMatchObject({ x: 100, y: 200, key, depth: 400.5, origin: [0, 0] });

        controller.reset(game);

        expect(game.images[0].destroyed).toBe(true);
        expect(player.sprites.get("body")?.crop).toBeUndefined();
        expect(player.sprites.get("body")?.y).toBe(0);
    });

    it.each(["stand", "reset", "leave"])("releases pending front loads when the owner must %s", (action) => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();
        const remote = character();
        const pose = { v: 1, direction: "up", front: { src: "/map-storage/chair.png", x: 0, y: 0 } };
        update(
            controller,
            game,
            player,
            null,
            new Map([[7, remote]]),
            new Map([[7, { variables: new Map([["officeSeat", pose]]) }]]),
        );
        const key = game.load.queue[0][0];
        expect(game.load.events.listenerCount(`filecomplete-image-${key}`)).toBe(1);
        expect(game.load.events.listenerCount("loaderror")).toBe(1);

        if (action === "reset") controller.reset(game);
        else if (action === "leave") update(controller, game, player, null);
        else update(controller, game, player, null, new Map([[7, remote]]), new Map());

        expect(game.load.events.eventNames()).toEqual([]);
        game.load.events.emit(`filecomplete-image-${key}`);
        expect(game.images).toHaveLength(0);
    });

    it("does not retain subscriptions over repeated failed seating loads", () => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();
        const pose = { v: 1, direction: "up", front: { src: "/map-storage/missing.png", x: 0, y: 0 } };
        for (let attempt = 0; attempt < 20; attempt += 1) {
            update(controller, game, player, pose);
            game.load.events.emit("loaderror", { key: game.load.queue.at(-1)?.[0] });
            expect(game.load.events.eventNames()).toEqual([]);
            update(controller, game, player, null);
        }
        expect(game.images).toHaveLength(0);
    });

    it("cleans up an image processing failure when the loader queue completes", () => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();
        const pose = { v: 1, direction: "up", front: { src: "/map-storage/corrupt.png", x: 0, y: 0 } };
        update(controller, game, player, pose);

        game.load.events.emit("complete");
        update(controller, game, player, pose);

        expect(game.load.events.eventNames()).toEqual([]);
        expect(game.load.queue).toHaveLength(1);
        expect(game.images).toHaveLength(0);
    });

    it("keeps another owner's shared texture load when a seated user leaves", () => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();
        const remote = character();
        const pose = { v: 1, direction: "up", front: { src: "/map-storage/shared.png", x: 0, y: 0 } };
        update(
            controller,
            game,
            player,
            pose,
            new Map([[7, remote]]),
            new Map([[7, { variables: new Map([["officeSeat", pose]]) }]]),
        );
        const key = game.load.queue[0][0];
        expect(game.load.events.listenerCount(`filecomplete-image-${key}`)).toBe(2);

        update(controller, game, player, pose);
        expect(game.load.events.listenerCount(`filecomplete-image-${key}`)).toBe(1);
        game.load.events.emit(`filecomplete-image-${key}`);

        expect(game.images).toHaveLength(1);
        expect(game.load.events.eventNames()).toEqual([]);
    });

    it("removes only the failed texture subscriptions while a different texture loads", () => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();
        const remote = character();
        const pose = { v: 1, direction: "up", front: { src: "/map-storage/first.png", x: 0, y: 0 } };
        const other = { ...pose, front: { ...pose.front, src: "/map-storage/second.png" } };
        update(
            controller,
            game,
            player,
            pose,
            new Map([[7, remote]]),
            new Map([[7, { variables: new Map([["officeSeat", other]]) }]]),
        );
        const first = game.load.queue[0][0];
        const second = game.load.queue[1][0];

        game.load.events.emit("loaderror", { key: first });
        expect(game.load.events.listenerCount(`filecomplete-image-${first}`)).toBe(0);
        expect(game.load.events.listenerCount(`filecomplete-image-${second}`)).toBe(1);
        game.load.events.emit(`filecomplete-image-${second}`);

        expect(game.images).toHaveLength(1);
        expect(game.images[0].key).toBe(second);
        expect(game.load.events.eventNames()).toEqual([]);
    });

    it("rejects cross-origin front images while keeping the seated pose", () => {
        const controller = new SeatedPoseController();
        const game = scene();
        const player = character();

        update(controller, game, player, {
            v: 1,
            direction: "up",
            front: { src: "https://example.com/map-storage/chair.png", x: 0, y: 0 },
        });

        expect(game.load.queue).toHaveLength(0);
        expect(game.images).toHaveLength(0);
        expect(player.sprites.get("body")?.crop).toEqual([0, 0, 32, 22]);
    });
});
