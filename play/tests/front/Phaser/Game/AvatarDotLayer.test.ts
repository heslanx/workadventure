// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvatarDetailLevel } from "../../../../src/front/Phaser/Game/AvatarDetail";
import { DETAIL_RECOMPUTE_INTERVAL_MS, DETAIL_ZOOM_SETTLE_MS } from "../../../../src/front/Phaser/Game/AvatarDetail";
import {
    AVATAR_DOT_TEXTURE,
    AvatarDotLayer,
    createAvatarDotBlitter,
    type DotBob,
} from "../../../../src/front/Phaser/Game/AvatarDotLayer";

class FakeAvatar {
    public detail: AvatarDetailLevel = "full";
    public userId?: number;
    /** Left out, the avatar is drawn the moment it is asked to be full; given, it is drawn when it has sprites. */
    public sprites?: { size: number };
    public readonly asked: AvatarDetailLevel[] = [];
    constructor(
        public readonly id: number,
        public x: number,
        public y: number,
    ) {}
    public setDetail(detail: AvatarDetailLevel): void {
        this.detail = detail;
        this.asked.push(detail);
    }
}

class FakeBob implements DotBob {
    public visible = true;
    public destroyed = false;
    public writes = 0;
    private position: { x: number; y: number };
    constructor(
        x: number,
        y: number,
        public readonly frame?: number,
    ) {
        this.position = { x, y };
    }
    get x() {
        return this.position.x;
    }
    set x(value: number) {
        this.writes++;
        this.position.x = value;
    }
    get y() {
        return this.position.y;
    }
    set y(value: number) {
        this.writes++;
        this.position.y = value;
    }
    public setVisible(visible: boolean): void {
        this.visible = visible;
    }
    public destroy(): void {
        this.destroyed = true;
    }
}

const BUDGET = 3;

/** Avatars on a line from the player at x = 0: avatar n stands at x = 100 n. */
function createLayer(count: number) {
    const avatars = Array.from({ length: count }, (_, index) => new FakeAvatar(index + 1, 100 * (index + 1), 0));
    const culled = new Set<FakeAvatar>();
    const pinned: FakeAvatar[] = [];
    const player = { x: 0, y: 0 };
    // Whether the local player exists yet.
    const present = { value: true };
    // Where the pointer is in the world, as the scene reads it; undefined while it is not over the game.
    const pointer: { at: { x: number; y: number; radius: number } | undefined } = { at: undefined };
    const bobs: FakeBob[] = [];
    const layer = new AvatarDotLayer<FakeAvatar>(
        {
            avatars: () => avatars,
            isCulled: (avatar) => culled.has(avatar),
            pinned: () => pinned,
            origin: () => (present.value ? player : undefined),
            pointer: () => pointer.at,
        },
        {
            create: (x, y, frame) => {
                const bob = new FakeBob(x, y, frame);
                bobs.push(bob);
                return bob;
            },
            destroy: () => {},
        },
        BUDGET,
    );
    const details = () => avatars.map((avatar) => avatar.detail);
    const liveBobs = () => bobs.filter((bob) => !bob.destroyed);
    /** The pointer moves to this world position, or off the game. */
    const movePointer = (x?: number, y?: number) => {
        pointer.at = x === undefined || y === undefined ? undefined : { x, y, radius: 12 };
        layer.pointerMoved();
    };
    return { layer, avatars, culled, pinned, player, present, pointer, movePointer, bobs, liveBobs, details };
}

describe("AvatarDotLayer", () => {
    it("draws the avatars over the budget as dots where they stand, and the nearest in full", () => {
        const { layer, details, liveBobs } = createLayer(5);

        expect(layer.update(0)).toBe(true);

        expect(details()).toEqual(["full", "full", "full", "dot", "dot"]);
        // A dot is 16 px wide, centred on its avatar.
        expect(liveBobs().map((bob) => [bob.x, bob.y, bob.visible])).toEqual([
            [392, -8, true],
            [492, -8, true],
        ]);
    });

    it("hides the dot of a culled avatar, and shows it again where the avatar is when it comes back", () => {
        const { layer, avatars, culled, liveBobs } = createLayer(5);
        layer.update(0);

        culled.add(avatars[4]);
        avatars[4].x = 900;
        layer.update(16);
        const hidden = liveBobs().map((bob) => [bob.x, bob.visible]);
        culled.delete(avatars[4]);
        layer.update(32);

        expect(hidden).toEqual([
            [392, true],
            [492, false],
        ]);
        expect(liveBobs().map((bob) => [bob.x, bob.visible])).toEqual([
            [392, true],
            [892, true],
        ]);
    });

    it("moves the dots with their avatars at each update, and changes no detail between recomputes", () => {
        const { layer, avatars, player, liveBobs, details } = createLayer(5);
        layer.update(0);

        // The player walks next to the dots, but the next recompute is not due yet.
        player.x = 500;
        avatars[3].x = 410;
        const moved = layer.update(DETAIL_RECOMPUTE_INTERVAL_MS - 1);

        expect(moved).toBe(true);
        expect(liveBobs()[0].x).toBe(402);
        expect(details()).toEqual(["full", "full", "full", "dot", "dot"]);
        expect(layer.update(DETAIL_RECOMPUTE_INTERVAL_MS - 1)).toBe(false);
    });

    it("recomputes every interval, so the dots near a walking player become full", () => {
        const { layer, player, details, liveBobs } = createLayer(5);
        layer.update(0);

        player.x = 500;
        layer.update(DETAIL_RECOMPUTE_INTERVAL_MS);

        expect(details()).toEqual(["dot", "dot", "full", "full", "full"]);
        expect(liveBobs()).toHaveLength(2);
    });

    it("recomputes once the zoom has settled, not at each zoom step", () => {
        const { layer, player, details } = createLayer(5);
        layer.update(0);
        player.x = 500;

        // A zoom gesture: a step after every frame for 64 ms, then nothing. It settles before the periodic recompute.
        const during: AvatarDetailLevel[][] = [];
        for (let time = 16; time <= 64; time += 16) {
            layer.update(time);
            during.push(details());
            layer.requestRecompute(DETAIL_ZOOM_SETTLE_MS);
        }
        layer.update(64 + DETAIL_ZOOM_SETTLE_MS - 1);
        const beforeSettle = details();
        layer.update(64 + DETAIL_ZOOM_SETTLE_MS);

        expect(during.every((step) => step.join() === "full,full,full,dot,dot")).toBe(true);
        expect(beforeSettle).toEqual(["full", "full", "full", "dot", "dot"]);
        expect(details()).toEqual(["dot", "dot", "full", "full", "full"]);
    });

    it("recomputes at the first update after a join or a leave", () => {
        const { layer, avatars, details } = createLayer(5);
        layer.update(0);

        const leaving = avatars.shift()!;
        layer.forget(leaving);
        layer.update(16);

        expect(details()).toEqual(["full", "full", "full", "dot"]);
    });

    it("forgets the dot of an avatar that left", () => {
        const { layer, avatars, bobs } = createLayer(5);
        layer.update(0);

        layer.forget(avatars[4]);
        avatars.pop();

        expect(bobs[1].destroyed).toBe(true);
        expect(layer.dotCount).toBe(1);
    });

    it("keeps pinned avatars full", () => {
        const { layer, avatars, pinned, details } = createLayer(5);
        pinned.push(avatars[4]);

        layer.update(0);

        expect(details()).toEqual(["full", "full", "dot", "dot", "full"]);
    });

    it("draws a dot in full while the pointer is on it, and makes it a dot again when the pointer leaves", () => {
        const { layer, details, movePointer } = createLayer(5);
        layer.update(0);

        movePointer(505, 4);
        layer.update(16);
        const hovered = details();
        // The pointer stays on the avatar now drawn in full.
        movePointer(498, 0);
        layer.update(32);
        const stillHovered = details();
        movePointer(0, 300);
        layer.update(48);
        const left = details();
        movePointer(505, 4);
        layer.update(64);
        movePointer();
        layer.update(80);

        expect(hovered).toEqual(["full", "full", "dot", "dot", "full"]);
        expect(stillHovered).toEqual(hovered);
        expect(left).toEqual(["full", "full", "full", "dot", "dot"]);
        // Off the game, the pointer hovers nothing.
        expect(details()).toEqual(["full", "full", "full", "dot", "dot"]);
    });

    it("keeps an avatar full under a pointer that does not move, when the budget would make it a dot", () => {
        const { layer, player, details, movePointer } = createLayer(5);
        layer.update(0);
        // The pointer comes onto avatar 1, drawn in full, and stays there.
        movePointer(100, 0);
        layer.update(16);

        // The player walks away from avatar 1: the next recompute gives its slot to the avatars near the player.
        player.x = 500;
        layer.update(16 + DETAIL_RECOMPUTE_INTERVAL_MS);

        expect(details()).toEqual(["full", "dot", "dot", "full", "full"]);
    });

    it("draws in full a dot that comes under a pointer that does not move, at the next recompute", () => {
        const { layer, avatars, pointer, details } = createLayer(5);
        layer.update(0);

        // The camera moved under the pointer, or avatar 4 walked under it: no pointer move was reported.
        pointer.at = { x: avatars[3].x, y: avatars[3].y, radius: 12 };
        layer.update(16);
        const betweenRecomputes = details();
        layer.update(DETAIL_RECOMPUTE_INTERVAL_MS);

        expect(betweenRecomputes).toEqual(["full", "full", "full", "dot", "dot"]);
        expect(details()).toEqual(["full", "full", "dot", "full", "dot"]);
    });

    it("does not promote a dot the pointer misses, or the dot of a culled avatar", () => {
        const { layer, avatars, culled, details, movePointer } = createLayer(5);
        layer.update(0);

        movePointer(520, 0);
        layer.update(16);
        const missed = details();
        culled.add(avatars[4]);
        movePointer(500, 0);
        layer.update(32);

        expect(missed).toEqual(["full", "full", "full", "dot", "dot"]);
        expect(details()).toEqual(["full", "full", "full", "dot", "dot"]);
    });

    it("gives a dot the colour of its user, among the eight of the atlas", () => {
        const { layer, avatars, liveBobs } = createLayer(5);
        avatars[3].userId = 3;
        avatars[4].userId = -1;

        layer.update(0);

        expect(liveBobs().map((bob) => bob.frame)).toEqual([3, 7]);
        const { layer: other, avatars: others, liveBobs: otherBobs } = createLayer(5);
        others[3].userId = 2 ** 32 + 5;
        others[4].userId = undefined;
        other.update(0);
        expect(otherBobs().map((bob) => bob.frame)).toEqual([5, 0]);
    });

    it("puts a dot on the pixel of its avatar, and writes nothing for a move under a pixel", () => {
        const { layer, avatars, liveBobs } = createLayer(5);
        avatars[3].x = 400.4;
        avatars[3].y = 10.6;
        layer.update(0);
        const [dot] = liveBobs();
        const created = [dot.x, dot.y];
        dot.writes = 0;

        // The avatar moves within the same pixel.
        avatars[3].x = 400.2;
        avatars[3].y = 10.9;
        const sameFrame = layer.update(16);
        const writesWithinPixel = dot.writes;
        avatars[3].x = 400.6;
        const next = layer.update(32);

        expect(created).toEqual([392, 3]);
        expect([sameFrame, writesWithinPixel]).toEqual([false, 0]);
        expect([next, dot.writes, dot.x, dot.y]).toEqual([true, 1, 393, 3]);
    });

    it("moves only the axis that changed", () => {
        const { layer, avatars, liveBobs } = createLayer(5);
        layer.update(0);
        const [dot] = liveBobs();
        dot.writes = 0;

        avatars[3].x += 5;
        layer.update(16);
        const horizontal = dot.writes;
        avatars[3].x += 5;
        avatars[3].y += 5;
        layer.update(32);

        expect([horizontal, dot.writes - horizontal]).toEqual([1, 2]);
    });

    it("exposes the full avatars only once a recompute has run, and the set the budget chose after it", () => {
        const { layer, avatars, present, details } = createLayer(5);
        // The player does not exist yet: nothing is chosen, and every avatar is drawn in full.
        present.value = false;
        layer.update(0);
        expect(layer.fullDetailPlayers).toBeUndefined();
        expect(details()).toEqual(["full", "full", "full", "full", "full"]);
        present.value = true;
        layer.requestRecompute();

        layer.update(16);

        expect([...(layer.fullDetailPlayers ?? [])]).toEqual(avatars.slice(0, BUDGET));
        layer.destroy();
        expect(layer.fullDetailPlayers).toBeUndefined();
    });

    it("keeps the dot of an avatar made full until its sprites are back, and drops it the frame they are", () => {
        const { layer, avatars, player, liveBobs } = createLayer(5);
        avatars[3].sprites = { size: 0 };
        layer.update(0);
        expect(liveBobs()).toHaveLength(2);

        // The avatar is promoted, but its sprites are rebuilt some frames later, in a turn of the build queue.
        player.x = 500;
        layer.update(DETAIL_RECOMPUTE_INTERVAL_MS);
        const waiting = liveBobs().map((bob) => bob.visible);
        const asked = [...avatars[3].asked];
        avatars[3].x = 420;
        layer.update(DETAIL_RECOMPUTE_INTERVAL_MS + 16);
        const followed = liveBobs().find((bob) => bob.x === 412)?.visible;
        avatars[3].sprites.size = 2;
        const back = layer.update(DETAIL_RECOMPUTE_INTERVAL_MS + 32);

        expect(asked).toEqual(["dot", "full"]);
        expect(waiting).toEqual([true, true, true]);
        expect(followed).toBe(true);
        expect(back).toBe(true);
        // The dots of the two avatars it took the place of remain.
        expect(liveBobs()).toHaveLength(2);
        expect(layer.dotCount).toBe(2);
    });

    it("draws a promoted avatar as a dot or with sprites at every frame, however the sprites come back", () => {
        const { layer, avatars, player, liveBobs } = createLayer(8);
        for (const avatar of avatars) avatar.sprites = { size: 0 };
        layer.update(0);
        // Every avatar was built as a dot, then the dots of the first ones are promoted all at once.
        for (const avatar of avatars.slice(0, BUDGET)) avatar.sprites = { size: 2 };
        player.x = 800;
        layer.update(DETAIL_RECOMPUTE_INTERVAL_MS);
        const promoted = avatars.slice(-BUDGET);
        const undrawn: string[] = [];

        for (let frame = 1; frame <= promoted.length + 1; frame++) {
            // The queue gives the sprites back one avatar a frame.
            if (frame <= promoted.length) promoted[frame - 1].sprites = { size: 2 };
            layer.update(DETAIL_RECOMPUTE_INTERVAL_MS + 16 * frame);
            for (const avatar of promoted) {
                const hasDot = liveBobs().some((bob) => bob.x === Math.round(avatar.x) - 8 && bob.visible);
                if (!hasDot && avatar.sprites?.size === 0) undrawn.push(`${avatar.id}@${frame}`);
            }
        }

        expect(undrawn).toEqual([]);
        expect(promoted.every((avatar) => avatar.detail === "full")).toBe(true);
        expect(liveBobs().filter((bob) => bob.visible).length).toBe(8 - BUDGET);
    });

    it("keeps the dot of an avatar made full and then a dot again before its sprites came back", () => {
        const { layer, avatars, player, liveBobs } = createLayer(5);
        avatars[3].sprites = { size: 0 };
        layer.update(0);
        player.x = 500;
        layer.update(DETAIL_RECOMPUTE_INTERVAL_MS);
        player.x = 0;

        layer.update(2 * DETAIL_RECOMPUTE_INTERVAL_MS);
        avatars[3].sprites.size = 2;
        layer.update(2 * DETAIL_RECOMPUTE_INTERVAL_MS + 16);

        expect(avatars[3].asked).toEqual(["dot", "full", "dot"]);
        expect(liveBobs()).toHaveLength(2);
        expect(layer.dotCount).toBe(2);
    });

    it("forgets the dot of an avatar that leaves while it waits for its sprites", () => {
        const { layer, avatars, player, bobs, liveBobs } = createLayer(5);
        avatars[3].sprites = { size: 0 };
        layer.update(0);
        player.x = 500;
        layer.update(DETAIL_RECOMPUTE_INTERVAL_MS);

        const [waitingBob] = bobs;
        layer.forget(avatars[3]);
        avatars[3].sprites.size = 2;
        layer.update(DETAIL_RECOMPUTE_INTERVAL_MS + 16);

        expect(waitingBob.destroyed).toBe(true);
        expect(liveBobs()).toHaveLength(2);
        expect(layer.dotCount).toBe(2);
    });
});

describe("createAvatarDotBlitter", () => {
    const fills = new Map<string, string>();
    const atlasSize = { width: 0, height: 0 };

    beforeEach(() => {
        fills.clear();
        // The canvas of a headless test has no 2D context: this one remembers the colour of each pixel it is given.
        vi.spyOn(Phaser.Display.Canvas.CanvasPool, "create").mockImplementation(((
            _parent: unknown,
            width = 1,
            height = 1,
        ) => {
            atlasSize.width = width;
            atlasSize.height = height;
            const context = {
                fillStyle: "",
                getImageData: () => ({ data: new Uint8ClampedArray(0) }),
                fillRect(x: number, y: number, w: number, h: number) {
                    expect([w, h]).toEqual([1, 1]);
                    fills.set(`${x},${y}`, this.fillStyle);
                },
            };
            return { width, height, getContext: () => context };
        }) as unknown as typeof Phaser.Display.Canvas.CanvasPool.create);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function createScene() {
        const game = { events: new Phaser.Events.EventEmitter(), config: {}, renderer: { gl: undefined } };
        const textures = new Phaser.Textures.TextureManager(game as unknown as Phaser.Game);
        const blitter = { setDepth: vi.fn(() => blitter) };
        const add = vi.fn((_x: number, _y: number, _texture: string) => blitter);
        return { scene: { textures, add: { blitter: add } } as unknown as Phaser.Scene, textures, add };
    }

    it("makes a texture of eight dots, one frame each, and a blitter that draws it", () => {
        const { scene, textures, add } = createScene();

        createAvatarDotBlitter(scene);

        const texture = textures.get(AVATAR_DOT_TEXTURE);
        expect([atlasSize.width, atlasSize.height]).toEqual([8 * 16, 16]);
        for (let frame = 0; frame < 8; frame++) {
            const cut = texture.get(frame);
            expect([cut.name, cut.cutX, cut.cutY, cut.width, cut.height]).toEqual([frame, frame * 16, 0, 16, 16]);
        }
        expect(texture.has("8")).toBe(false);
        expect(add).toHaveBeenCalledWith(0, 0, AVATAR_DOT_TEXTURE);
    });

    it("draws each dot in its colour with an outline, on pixels of binary alpha, and keeps the corners clear", () => {
        const { scene } = createScene();

        createAvatarDotBlitter(scene);

        const colours = ["#fff4db", "#ffbaa4", "#f7d76d", "#adce93", "#83d6ce", "#91bde7", "#c1ace9", "#f0abcd"];
        colours.forEach((colour, frame) => {
            const left = frame * 16;
            expect(fills.get(`${left + 8},8`)).toBe(colour);
            expect(fills.get(`${left + 8},0`)).toBe("#1b2a41");
            expect(fills.get(`${left},0`)).toBeUndefined();
            expect(fills.get(`${left + 15},15`)).toBeUndefined();
        });
        // Only opaque pixels were drawn: a 1x1 fillRect of a flat colour, with no anti-aliased edge.
        expect([...fills.values()].every((colour) => /^#[0-9a-f]{6}$/.test(colour))).toBe(true);
    });

    it("makes the texture once for the game, whatever the number of scenes", () => {
        const { scene, textures } = createScene();

        createAvatarDotBlitter(scene);
        const first = textures.get(AVATAR_DOT_TEXTURE);
        createAvatarDotBlitter(scene);

        expect(textures.get(AVATAR_DOT_TEXTURE)).toBe(first);
        expect(textures.getTextureKeys().filter((key) => key === AVATAR_DOT_TEXTURE)).toHaveLength(1);
    });
});
