import { describe, expect, it } from "vitest";
import type { AvatarDetailLevel } from "../../../../src/front/Phaser/Game/AvatarDetail";
import { DETAIL_RECOMPUTE_INTERVAL_MS, DETAIL_ZOOM_SETTLE_MS } from "../../../../src/front/Phaser/Game/AvatarDetail";
import { AvatarDotLayer, type DotBob } from "../../../../src/front/Phaser/Game/AvatarDotLayer";

class FakeAvatar {
    public detail: AvatarDetailLevel = "full";
    constructor(
        public readonly id: number,
        public x: number,
        public y: number,
    ) {}
    public setDetail(detail: AvatarDetailLevel): void {
        this.detail = detail;
    }
}

class FakeBob implements DotBob {
    public visible = true;
    public destroyed = false;
    constructor(
        public x: number,
        public y: number,
    ) {}
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
    // Where the pointer is in the world, as the scene reads it; undefined while it is not over the game.
    const pointer: { at: { x: number; y: number; radius: number } | undefined } = { at: undefined };
    const bobs: FakeBob[] = [];
    const layer = new AvatarDotLayer<FakeAvatar>(
        {
            avatars: () => avatars,
            isCulled: (avatar) => culled.has(avatar),
            pinned: () => pinned,
            origin: () => player,
            pointer: () => pointer.at,
        },
        {
            create: (x, y) => {
                const bob = new FakeBob(x, y);
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
    return { layer, avatars, culled, pinned, player, pointer, movePointer, bobs, liveBobs, details };
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
});
