// @vitest-environment jsdom
import * as Phaser from "phaser";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { RemotePlayerCulling } from "../../../../src/front/Phaser/Game/RemotePlayerCulling";
import type { CullingView } from "../../../../src/front/Phaser/Game/RemotePlayerCulling";

// Real Phaser game objects on a stub scene, so that "drawn" and "updated" are what Phaser's renderer and update list
// read: a container is drawn when it will render, its sprites when they will render too, and the update list advances
// the animation of the sprites that are active.
function createScene(): Phaser.Scene {
    // A frame with a cut area: without one, Phaser clears the image's "has a texture" render flag and draws nothing.
    const frame = {
        realWidth: 32,
        realHeight: 32,
        width: 32,
        height: 32,
        cutWidth: 32,
        cutHeight: 32,
        customPivot: false,
        pivotX: 0,
        pivotY: 0,
    };
    const sys = {
        events: new Phaser.Events.EventEmitter(),
        queueDepthSort: () => {},
        textures: { get: () => ({ key: "t", get: () => frame }) },
        updateList: { add: () => {}, remove: () => {} },
        input: { enable: () => {}, disable: () => {} },
        game: { renderer: undefined },
        renderer: undefined,
    };
    return { sys, events: sys.events } as unknown as Phaser.Scene;
}

const scene = createScene();
// What the renderer gives a game object to know whether it is filtered out: a camera that filters nothing.
const camera = { id: 1 } as Phaser.Cameras.Scene2D.Camera;

class FakeCompanion extends Phaser.GameObjects.Container {
    public readonly sprites = new Map<string, Phaser.GameObjects.Image>();

    public addSprite(name: string): void {
        const sprite = new Phaser.GameObjects.Image(scene, 0, 0, "t");
        this.add(sprite);
        this.sprites.set(name, sprite);
    }
}

// A remote player as the culling sees it: a container whose sprites are its woka layers, an optional companion, a
// position that announces its moves, and a name tag that it hides when it is culled.
class FakeAvatar extends Phaser.GameObjects.Container {
    public readonly sprites = new Map<string, Phaser.GameObjects.Image>();
    public readonly moved$ = new Subject<{ x: number; y: number }>();
    public companion: FakeCompanion | undefined;
    public nameTagHidden = false;

    constructor(x: number, y: number, layers = 5) {
        super(scene, x, y);
        for (let layer = 0; layer < layers; layer++) {
            this.addLayer(`layer-${layer}`);
        }
    }

    public addLayer(name: string): void {
        const sprite = new Phaser.GameObjects.Image(scene, 0, 0, "t");
        this.add(sprite);
        this.sprites.set(name, sprite);
    }

    public walkTo(x: number, y: number): void {
        this.setPosition(x, y);
        this.moved$.next({ x, y });
    }

    public setCulled(culled: boolean): void {
        this.nameTagHidden = culled;
    }
}

/** An avatar that cannot hide its name tag: its tag follows every move. */
function withoutNameTagHook(avatar: FakeAvatar): FakeAvatar {
    (avatar as { setCulled?: unknown }).setCulled = undefined;
    return avatar;
}

/** A companion with one sprite, as a built one has. */
function withCompanion(avatar: FakeAvatar): FakeCompanion {
    const companion = new FakeCompanion(scene, avatar.x + 14, avatar.y + 4);
    companion.addSprite("cat");
    avatar.companion = companion;
    return companion;
}

function view(x: number, y: number, width: number, height: number): CullingView {
    return { x, y, right: x + width, bottom: y + height };
}

/** Whether Phaser's WebGL container renderer submits the object: the container and then each child must render. */
function isDrawn(avatar: FakeAvatar): boolean {
    return avatar.willRender(camera);
}

function isUpdated(avatar: FakeAvatar): boolean {
    return avatar.active && [...avatar.sprites.values()].every((sprite) => sprite.active);
}

describe("RemotePlayerCulling", () => {
    // A 400x300 view at the map origin: its margin is the smallest one, 64 px, so the rectangle that stays drawn is
    // x from -64 to 464 and y from -64 to 364.
    const VIEW = view(0, 0, 400, 300);

    it("stops drawing and updating an avatar outside the view and keeps one inside it", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const inside = new FakeAvatar(200, 150);
        const outside = new FakeAvatar(2_000, 150);
        culling.track(inside);
        culling.track(outside);

        const toggled = culling.update(VIEW);

        expect(toggled).toBe(true);
        expect([isDrawn(inside), isUpdated(inside)]).toEqual([true, true]);
        expect([isDrawn(outside), isUpdated(outside)]).toEqual([false, false]);
        expect(culling.isCulled(outside)).toBe(true);
        expect(culling.isCulled(inside)).toBe(false);
    });

    it("keeps an avatar that is within the margin of the view, and culls one just beyond it", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const withinMargin = new FakeAvatar(464, 150);
        const beyondMargin = new FakeAvatar(465, 150);
        culling.track(withinMargin);
        culling.track(beyondMargin);

        culling.update(VIEW);

        expect(isDrawn(withinMargin)).toBe(true);
        expect(isDrawn(beyondMargin)).toBe(false);
    });

    it("widens the margin to 5% of the larger side of a large view, where names are larger in world pixels", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        // A 4000 px wide view: the margin is 200 px.
        const withinMargin = new FakeAvatar(4_200, 100);
        const beyondMargin = new FakeAvatar(4_201, 100);
        culling.track(withinMargin);
        culling.track(beyondMargin);

        culling.update(view(0, 0, 4_000, 2_000));

        expect(isDrawn(withinMargin)).toBe(true);
        expect(isDrawn(beyondMargin)).toBe(false);
    });

    it("draws an avatar again when the camera moves to it, and culls it again when the camera leaves", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const far = new FakeAvatar(2_000, 150);
        culling.track(far);
        culling.update(VIEW);

        const cameraArrives = culling.update(view(1_800, 0, 400, 300));
        const drawnAtArrival = [isDrawn(far), isUpdated(far)];
        const cameraLeaves = culling.update(VIEW);

        expect(cameraArrives).toBe(true);
        expect(drawnAtArrival).toEqual([true, true]);
        expect(cameraLeaves).toBe(true);
        expect([isDrawn(far), isUpdated(far)]).toEqual([false, false]);
    });

    it("follows an avatar that walks out of the view and back into it", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const walker = new FakeAvatar(200, 150);
        culling.track(walker);
        culling.update(VIEW);

        walker.walkTo(900, 150);
        const walkedOut = culling.update(VIEW);
        const drawnAfterWalkingOut = isDrawn(walker);
        walker.walkTo(300, 150);
        const walkedIn = culling.update(VIEW);

        expect(walkedOut).toBe(true);
        expect(drawnAfterWalkingOut).toBe(false);
        expect(walkedIn).toBe(true);
        expect([isDrawn(walker), isUpdated(walker)]).toEqual([true, true]);
    });

    it("does nothing while the view, the kept avatars and the positions stay as they were", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const inside = new FakeAvatar(200, 150);
        const outside = new FakeAvatar(2_000, 150);
        culling.track(inside);
        culling.track(outside);
        culling.update(VIEW);
        const setVisible = vi.spyOn(inside, "setVisible");
        const setActive = vi.spyOn(outside, "setActive");

        const toggled = culling.update(view(0, 0, 400, 300));

        expect(toggled).toBe(false);
        expect(setVisible).not.toHaveBeenCalled();
        expect(setActive).not.toHaveBeenCalled();
    });

    it("looks only at the avatars that moved when the view did not", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const stays = new FakeAvatar(2_000, 150);
        const walker = new FakeAvatar(2_000, 150);
        culling.track(stays);
        culling.track(walker);
        culling.update(VIEW);
        const staysChecked = vi.spyOn(stays, "setVisible");

        walker.walkTo(200, 150);
        culling.update(VIEW);

        expect(isDrawn(walker)).toBe(true);
        expect(staysChecked).not.toHaveBeenCalled();
    });

    it("hides the companion of a culled avatar with it, and shows it with the avatar", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(2_000, 150);
        const companion = withCompanion(avatar);
        culling.track(avatar);

        culling.update(VIEW);
        const whileCulled = [companion.willRender(camera), companion.active, companion.sprites.get("cat")?.active];
        culling.update(view(1_800, 0, 400, 300));

        expect(whileCulled).toEqual([false, false, false]);
        expect([companion.willRender(camera), companion.active, companion.sprites.get("cat")?.active]).toEqual([
            true,
            true,
            true,
        ]);
    });

    it("keeps an avatar drawn wherever it is while it is kept, and culls it once it is not", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const followed = new FakeAvatar(2_000, 150);
        const other = new FakeAvatar(2_000, 150);
        culling.track(followed);
        culling.track(other);

        culling.update(VIEW, [followed]);
        const whileKept = [isDrawn(followed), isDrawn(other)];
        const toggled = culling.update(VIEW, []);

        expect(whileKept).toEqual([true, false]);
        expect(toggled).toBe(true);
        expect(isDrawn(followed)).toBe(false);
    });

    it("does not cull an avatar that becomes kept after it was culled", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(2_000, 150);
        culling.track(avatar);
        culling.update(VIEW);

        const toggled = culling.update(VIEW, [avatar]);

        expect(toggled).toBe(true);
        expect([isDrawn(avatar), isUpdated(avatar)]).toEqual([true, true]);
    });

    it("culls what a culled avatar builds after it was culled, at the next update, even if it never moves", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(2_000, 150, 0);
        culling.track(avatar);
        culling.update(VIEW);

        // The avatar was built after it was culled: its new sprites and its companion start active and visible.
        avatar.addLayer("body");
        const companion = withCompanion(avatar);
        const builtActive = [avatar.sprites.get("body")?.active, companion.willRender(camera)];
        const toggled = culling.update(VIEW);

        expect(builtActive).toEqual([true, true]);
        expect(toggled).toBe(false);
        expect([avatar.sprites.get("body")?.active, companion.willRender(camera), companion.active]).toEqual([
            false,
            false,
            false,
        ]);
    });

    it("culls what a culled avatar builds in a frame where the camera scrolls and the avatar moves", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(2_000, 150, 0);
        culling.track(avatar);
        culling.update(VIEW);

        avatar.addLayer("body");
        const companion = withCompanion(avatar);
        avatar.walkTo(2_100, 150);
        const toggled = culling.update(view(10, 0, 400, 300));

        expect(toggled).toBe(false);
        expect([avatar.sprites.get("body")?.active, companion.willRender(camera), companion.active]).toEqual([
            false,
            false,
            false,
        ]);
    });

    it("culls the sprite that a culled companion gets after it was built, and draws it again with the avatar", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(2_000, 150);
        const companion = new FakeCompanion(scene, avatar.x + 14, avatar.y + 4);
        avatar.companion = companion;
        culling.track(avatar);
        culling.update(VIEW);

        // The companion's picture arrives after the companion was created.
        companion.addSprite("cat");
        culling.update(VIEW);
        const whileCulled = [companion.sprites.get("cat")?.active, companion.willRender(camera)];
        culling.update(view(1_800, 0, 400, 300));

        expect(whileCulled).toEqual([false, false]);
        expect([companion.sprites.get("cat")?.active, companion.willRender(camera)]).toEqual([true, true]);
    });

    it("hides the name tag of a culled avatar, and shows it with the avatar", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(2_000, 150);
        culling.track(avatar);

        culling.update(VIEW);
        const whileCulled = avatar.nameTagHidden;
        culling.update(view(1_800, 0, 400, 300));

        expect(whileCulled).toBe(true);
        expect(avatar.nameTagHidden).toBe(false);
    });

    it("tells a culled avatar again when it builds more, so that the name tag it built is hidden", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(2_000, 150, 0);
        culling.track(avatar);
        culling.update(VIEW);
        const setCulled = vi.spyOn(avatar, "setCulled");

        culling.update(VIEW);
        const callsWhileNothingIsBuilt = setCulled.mock.calls.length;
        avatar.addLayer("body");
        culling.update(VIEW);

        expect(callsWhileNothingIsBuilt).toBe(0);
        expect(setCulled.mock.calls).toEqual([[true]]);
    });

    it("does not tell an avatar that stays drawn that it is culled", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(200, 150);
        const setCulled = vi.spyOn(avatar, "setCulled");
        culling.track(avatar);

        culling.update(VIEW);
        avatar.addLayer("body");
        culling.update(VIEW);

        expect(setCulled).not.toHaveBeenCalled();
    });

    it("says that a move of a culled avatar is hidden, as long as its name tag stops following it", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const inside = new FakeAvatar(200, 150);
        const outside = new FakeAvatar(2_000, 150);
        const outsideWithoutHook = withoutNameTagHook(new FakeAvatar(2_000, 150));
        [inside, outside, outsideWithoutHook].forEach((avatar) => culling.track(avatar));

        const beforeUpdate = culling.isMoveHidden(outside);
        culling.update(VIEW);

        expect(beforeUpdate).toBe(false);
        expect(culling.isMoveHidden(inside)).toBe(false);
        expect(culling.isMoveHidden(outside)).toBe(true);
        expect(culling.isMoveHidden(outsideWithoutHook)).toBe(false);
    });

    it("stops saying that a move is hidden when the avatar is drawn again", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(2_000, 150);
        culling.track(avatar);
        culling.update(VIEW);

        culling.update(view(1_800, 0, 400, 300));

        expect(culling.isMoveHidden(avatar)).toBe(false);
    });

    it("stops watching an avatar that is untracked, and an avatar that is cleared", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const untracked = new FakeAvatar(200, 150);
        const cleared = new FakeAvatar(200, 150);
        culling.track(untracked);
        culling.track(cleared);

        culling.untrack(untracked);
        culling.clear();

        expect(untracked.moved$.observed).toBe(false);
        expect(cleared.moved$.observed).toBe(false);
        expect(culling.isCulled(untracked)).toBe(false);
    });

    it("forgets that an untracked avatar was culled", () => {
        const culling = new RemotePlayerCulling<FakeAvatar>();
        const avatar = new FakeAvatar(2_000, 150);
        culling.track(avatar);
        culling.update(VIEW);

        culling.untrack(avatar);

        expect(culling.isCulled(avatar)).toBe(false);
    });
});

// The measurement behind the engine plan's item 3.2 (client frame, cull the avatars that are off screen). Rerun with
// `npm test -- --run tests/front/Phaser/Game/RemotePlayerCulling.test.ts`; the numbers are in the assertions.
describe("RemotePlayerCulling with 1000 avatars spread over the Konclui office", () => {
    // The office map is 86 x 56 tiles of 32 px. The avatars stand on a 40 x 25 grid, one cell of 68.8 x 71.68 px each,
    // at the centre of its cell: a crowd spread evenly over the map.
    const MAP_WIDTH = 2_752;
    const MAP_HEIGHT = 1_792;
    const COLUMNS = 40;
    const ROWS = 25;
    const LAYERS = 5;

    // A 1451 x 855 camera, scrolled to (600, 400). Its margin is 5% of 1451 = 72.55 px, so the avatars that stay drawn
    // are those with x in [527.45, 2123.55] and y in [327.45, 1327.55]. Column i is at x = 34.4 + 68.8 i, which is in
    // range for i = 8..30 (23 columns); row j is at y = 35.84 + 71.68 j, in range for j = 5..18 (14 rows).
    const CAMERA = view(600, 400, 1_451, 855);
    const AVATARS_NEAR_THE_CAMERA = 23 * 14;

    function crowd(): FakeAvatar[] {
        const avatars: FakeAvatar[] = [];
        for (let column = 0; column < COLUMNS; column++) {
            for (let row = 0; row < ROWS; row++) {
                avatars.push(
                    new FakeAvatar(((column + 0.5) * MAP_WIDTH) / COLUMNS, ((row + 0.5) * MAP_HEIGHT) / ROWS, LAYERS),
                );
            }
        }
        return avatars;
    }

    /**
     * What the frame holds: the avatars that are updated, the woka layers that the renderer submits as quads, and the
     * name tags that are shown (and so follow their avatar's moves).
     */
    function measure(avatars: FakeAvatar[]): { activeAvatars: number; drawnQuads: number; nameTags: number } {
        return {
            nameTags: avatars.filter((avatar) => !avatar.nameTagHidden).length,
            activeAvatars: avatars.filter((avatar) => avatar.active && avatar.willRender(camera)).length,
            drawnQuads: avatars
                .filter((avatar) => avatar.willRender(camera))
                .reduce((quads, avatar) => quads + avatar.list.filter((layer) => layer.willRender(camera)).length, 0),
        };
    }

    it("draws and updates every avatar before the culling: 1000 avatars, 5000 quads, 1000 name tags", () => {
        const avatars = crowd();

        expect(measure(avatars)).toEqual({ activeAvatars: 1_000, drawnQuads: 5_000, nameTags: 1_000 });
    });

    it("draws and updates only the avatars near the camera after it: 322 avatars, 1610 quads, 322 name tags", () => {
        const avatars = crowd();
        const culling = new RemotePlayerCulling<FakeAvatar>();
        avatars.forEach((avatar) => culling.track(avatar));

        culling.update(CAMERA);

        expect(AVATARS_NEAR_THE_CAMERA).toBe(322);
        expect(measure(avatars)).toEqual({ activeAvatars: 322, drawnQuads: 1_610, nameTags: 322 });
    });
});
