import { describe, expect, it } from "vitest";
import type { GlassFace } from "./mirror";
import {
    mirrorAlpha,
    mirrorFace,
    mirrorFlips,
    mirrorFoot,
    mirrorFrame,
    mirroredFrameName,
    mirrorsPiece,
} from "./mirror";

describe("the glass mirror", () => {
    it("shows a figure from its other side: down and up swap and turn over, left and right stay", () => {
        expect(mirrorFrame(1)).toEqual({ frame: 10, flip: true }); // walking down, the mirror shows the back
        expect(mirrorFrame(9)).toEqual({ frame: 0, flip: true }); // walking up into the glass: the face
        expect(mirrorFrame("11")).toEqual({ frame: 2, flip: true });
        expect(mirrorFrame(4)).toEqual({ frame: 4, flip: false }); // facing left: still left
        expect(mirrorFrame(7)).toEqual({ frame: 7, flip: false });
        expect(mirrorFrame("idle-0")).toEqual({ frame: "idle-0", flip: false });
    });

    it("picks the nearest glass face in front within reach, puts the feet as far up it, fainter the farther", () => {
        const faces: GlassFace[] = [
            [0, 100, 560],
            [0, 100, 620],
            [200, 300, 560],
        ];
        expect(mirrorFace(50, 600, faces)).toBe(faces[0]);
        expect(mirrorFace(50, 640, faces), "the nearer of two faces").toBe(faces[1]);
        expect(mirrorFace(50, 560, faces), "on the foot line: not in front").toBeNull();
        expect(mirrorFace(50, 710, faces), "beyond reach").toBeNull();
        expect(mirrorFace(150, 600, faces), "beside the faces").toBeNull();
        expect(mirrorFace(50, 640, faces, undefined, 1), "only the first `count` faces are looked at").toBe(faces[0]);
        expect(mirrorFace(50, 640, faces, undefined, 0), "none of them").toBeNull();
        expect(mirrorFoot(580, 560)).toBe(540); // 20 px in front: 20 px up the glass (faceFoot - 20)
        expect(mirrorFoot(600, 560)).toBe(520); // 40 px in front: 40 px up the glass (faceFoot - 40)
        expect(mirrorFoot(620, 560)).toBe(500); // 60 px in front: 60 px up the glass (faceFoot - 60)
        expect(mirrorFoot(580, 560), "closer is lower down, farther is higher up").toBeGreaterThan(
            mirrorFoot(600, 560),
        );
        expect(mirrorAlpha(0)).toBe(0);
        expect(mirrorAlpha(-5)).toBe(0);
        expect(mirrorAlpha(4)).toBe(0.556); // close: strongest
        expect(mirrorAlpha(12)).toBe(0.526);
        expect(mirrorAlpha(20)).toBe(0.473);
        expect(mirrorAlpha(40)).toBe(0.28); // mid-distance: visibly softer
        expect(mirrorAlpha(60)).toBe(0.088); // far: faint
        expect(mirrorAlpha(12)).toBeGreaterThan(mirrorAlpha(20));
        expect(mirrorAlpha(20)).toBeGreaterThan(mirrorAlpha(40));
        expect(mirrorAlpha(40)).toBeGreaterThan(mirrorAlpha(60));
        expect(mirrorAlpha(80), "at reach the reflection fades away completely").toBe(0);
        expect(mirrorAlpha(90), "beyond reach it remains 0").toBe(0);
    });

    it("reflects what stands on the floor, not what sits on a desk, lies flat or hangs on a wall", () => {
        expect(mirrorsPiece({ name: "Figueira-lira", tags: ["Plantas"] })).toBe(true);
        expect(mirrorsPiece({ name: "Figueira-lira" }), "a piece with no tags").toBe(false);
        expect(mirrorsPiece({ name: "Mesa", tags: ["Mesas", "Plantas"] }), "any one tag").toBe(true);
        expect(mirrorsPiece({ name: "Roseira", tags: ["Exterior e jardim"] })).toBe(true);
        expect(mirrorsPiece({ name: "Totem com o K", tags: ["Peças da marca"] })).toBe(true);
        expect(mirrorsPiece({ name: "Babosa (aloe vera) (sobre móvel)", tags: ["Plantas"] })).toBe(false);
        expect(mirrorsPiece({ name: "Quadro: Koru acenando", tags: ["Peças da marca"] })).toBe(false);
        expect(mirrorsPiece({ name: "Computador iMac", tags: ["Tecnologia e telas"] })).toBe(false);
        expect(mirrorsPiece({})).toBe(false);
    });

    it("keeps every avatar layer (hat, glasses, clothes, body) rigidly together at any distance", () => {
        const faceFoot = 1596;
        const layer = (key: string) => ({
            type: "Sprite",
            visible: true,
            texture: { key },
            frame: { name: "9" },
            originX: 0.5,
            originY: 0.5,
            displayHeight: 32,
            x: 0,
            y: 0,
        });
        const layers = [layer("body"), layer("hat"), layer("glasses"), layer("clothes")];

        let prevFeet: number | null = null;
        for (const d of [10, 30, 50, 70]) {
            const foot = faceFoot + d;
            const mirrorFeet = mirrorFoot(foot, faceFoot);
            const layerTops = layers.map((l) => {
                const below = (1 - l.originY) * l.displayHeight;
                const y = mirrorFeet - below + l.y;
                return Math.round(y - l.originY * l.displayHeight);
            });
            expect(new Set(layerTops).size, `all layers must align at distance ${d}`).toBe(1);
            expect(layerTops[0]).toBe(mirrorFeet - 32);
            if (prevFeet !== null) {
                expect(mirrorFeet, "farther reflection moves higher up the glass").toBeLessThan(prevFeet);
            }
            prevFeet = mirrorFeet;
        }
        // At d = 50 (with paneTop = 1536), the head is above the pane top (1514 < 1536) while the feet are inside it
        const d50Feet = mirrorFoot(faceFoot + 50, faceFoot);
        expect(d50Feet - 32 < 1536 && d50Feet > 1536, "distant avatar: head above pane top, feet inside pane").toBe(
            true,
        );
    });
});

describe("the mirrored frame, read without making an object", () => {
    it.each([...Array.from({ length: 14 }, (_, i) => i), "5", "idle-0", 2.5, -1, "", "x"])(
        "gives for %s what mirrorFrame gives",
        (frame) => {
            const { frame: shown, flip } = mirrorFrame(frame);

            expect(mirroredFrameName(frame)).toBe(shown);
            expect(mirrorFlips(frame)).toBe(flip);
        },
    );
});
