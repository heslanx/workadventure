import { describe, expect, it } from "vitest";
import {
    bakePieces,
    buildCasts,
    channelCounts,
    missingBakeHooks,
    REQUIRED_BAKE_HOOKS,
    type BakeHooks,
    type BakeSource,
} from "../shader-lab/castBake";
import { compositeStamps, missingStampHooks, planStamps, type StampHooks } from "../shader-lab/stamps";
import { bakeCast, newCastBuffer } from "../../play/src/front/Konclui/Ambience/domain/shadeBake";
import { classifyPiece } from "../../play/src/front/Konclui/Ambience/domain/casterKind";
import { casterLampsFrom } from "../../play/src/front/Konclui/Ambience/domain/lamps";
import { keyLightAt, newKeyLight } from "../../play/src/front/Konclui/Ambience/domain/keyLight";
import { hasPaintedShadow, lengthScale, silhouetteOf } from "../../play/src/front/Konclui/Ambience/domain/shadeShapes";

/** A w x h picture with an opaque rectangle [x0, y0, x1, y1) and, optionally, six half-transparent pixels under it. */
function picture(w: number, h: number, box: [number, number, number, number], soft = false): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) data[(y * w + x) * 4 + 3] = 255;
    if (soft) for (let x = box[0]; x < box[0] + 8 && box[3] < h; x++) data[(box[3] * w + x) * 4 + 3] = 60;
    return { width: w, height: h, data, colorSpace: "srgb" };
}

const REAL: BakeHooks = {
    bakeCast,
    newCastBuffer,
    silhouetteOf,
    hasPaintedShadow,
    lengthScale,
    classifyPiece,
    casterLampsFrom,
    newKeyLight,
    keyLightAt,
    SHADOW_FLOOR_PX: 3,
    SHADOW_CAP_PX: 22,
};

function source(overrides: Partial<BakeSource["manifest"]> = {}): BakeSource {
    return {
        placements: [
            { key: "a/box.png", x: 20, y: 20, name: "Caixa", depthOffset: 0, tags: [] },
            { key: "a/soft.png", x: 60, y: 20, name: "Vaso", depthOffset: 0, tags: [] },
            { key: "a/rug.png", x: 10, y: 60, name: "Tapete de lã", depthOffset: 0, tags: [] },
            { key: "a/gone.png", x: 90, y: 20, name: "Perdido", depthOffset: 0, tags: [] },
        ],
        sprites: new Map<string, ImageData | null>([
            ["a/box.png", picture(16, 24, [2, 2, 14, 22])],
            ["a/soft.png", picture(16, 24, [2, 2, 14, 20], true)],
            ["a/rug.png", picture(40, 20, [0, 0, 40, 20])],
            ["a/gone.png", null],
        ]),
        manifest: { map: [128, 96], lights: {}, spaces: [], ...overrides },
        maskPixels: new Uint8ClampedArray(128 * 96 * 4),
    };
}

describe("shader lab: the cast bake's inputs", () => {
    it("names every runtime export it needs, and none when they are all there", () => {
        expect(missingBakeHooks({})).toEqual([...REQUIRED_BAKE_HOOKS]);
        expect(missingBakeHooks(REAL)).toEqual([]);
        expect(missingBakeHooks({ ...REAL, bakeCast: undefined })).toEqual(["bakeCast"]);
    });

    it("classifies by the manifest's kinds first, then by the runtime's rules, and counts the kinds", () => {
        const plain = bakePieces(source(), REAL);
        const listed = bakePieces(source({ kinds: { "a/box.png": "hang" } }), REAL);

        expect(plain.kinds).toEqual({ stand: 3, top: 0, hang: 0, floor: 1 });
        expect(plain.classifiedFrom).toMatch(/classifyPiece/);
        expect(listed.kinds).toEqual({ stand: 2, top: 0, hang: 1, floor: 1 });
        expect(listed.classifiedFrom).toBe("manifest.kinds");
        expect(listed.pieces[0].kind).toBe("hang");
    });

    it("finds a painted shadow in the manifest's list and in the picture itself, and counts unreadable pictures", () => {
        const fromPicture = bakePieces(source(), REAL);
        const fromManifest = bakePieces(source({ painted: ["a/box.png"] }), REAL);

        expect(fromPicture.pieces.map((p) => p.painted)).toEqual([false, true, false, false]);
        expect(fromManifest.pieces.map((p) => p.painted)).toEqual([true, true, false, false]);
        expect(fromPicture.unreadable).toBe(1);
        expect(fromPicture.pieces[3].silhouette).toBeNull();
    });

    it("refuses to bake without the runtime's functions", () => {
        expect(() => buildCasts(source(), {}, 15.5)).toThrow(/needs bakeCast/);
    });
});

describe("shader lab: the cast bake on a small map (the runtime's real bake)", () => {
    it("bakes the key shadow of a standing piece, each element alone, and reports every stand piece", () => {
        const casts = buildCasts(source(), REAL, 15.5);

        const report = casts.report as {
            kinds: Record<string, number>;
            standPieces: number;
            standWithShadowPx: number;
            standWithoutShadow: unknown[];
            shadowLengthPx: { min: number; max: number; cap: number };
            ms: Record<string, number>;
            bytes: number;
        };
        expect(casts.all.length).toBe(128 * 96 * 4);
        expect(report.bytes).toBe(128 * 96 * 4);
        expect(report.standPieces).toBe(2);
        expect(report.standWithShadowPx).toBe(2);
        expect(report.standWithoutShadow).toEqual([]);
        expect(report.shadowLengthPx.max).toBeLessThanOrEqual(report.shadowLengthPx.cap + 1e-9);
        expect(report.shadowLengthPx.min).toBeGreaterThanOrEqual(3 - 1e-9);
        expect(Object.keys(report.ms)).toEqual(
            expect.arrayContaining(["all", "contact", "key", "lamp", "surface", "silhouettesAndKinds"]),
        );
        const all = channelCounts(casts.all, 128, 96);
        const key = channelCounts(casts.alone.key, 128, 96);
        const contact = channelCounts(casts.alone.contact, 128, 96);
        // each element alone carries its own channel and the receiver mask, and nothing of the others
        expect(key.key).toBeGreaterThan(0);
        expect(key.contact).toBe(0);
        expect(contact.contact).toBeGreaterThan(0);
        expect(contact.key).toBe(0);
        expect(key.solid).toBe(all.solid);
        expect(all.key).toBe(key.key);
        // the rug is a floor piece: it hides nothing, so its rectangle is not "solid"
        expect(channelCounts(casts.all, 128, 96, [10, 60, 40, 20]).solid).toBe(0);
    });

    it("draws no contact band under a piece whose picture has its own painted shadow", () => {
        const withPaint = buildCasts(source(), REAL, 15.5);
        const forced = buildCasts(source({ painted: ["a/box.png", "a/soft.png"] }), REAL, 15.5);

        expect(channelCounts(forced.all, 128, 96).contact).toBeLessThan(channelCounts(withPaint.all, 128, 96).contact);
        expect(channelCounts(forced.all, 128, 96).contact).toBe(0);
    });

    it("lists a standing piece whose shadow is too small to read, with the reason", () => {
        const base = source();
        const withTiny: BakeSource = {
            ...base,
            placements: [
                ...base.placements,
                { key: "a/speck.png", x: 100, y: 60, name: "Pedrinha", depthOffset: 0, tags: [] },
            ],
            sprites: new Map([...base.sprites, ["a/speck.png", picture(4, 4, [1, 1, 3, 3])]]),
        };

        const report = buildCasts(withTiny, REAL, 13).report as {
            standPieces: number;
            standWithShadowPx: number;
            standWithoutShadow: { key: string; reason: string; pixels: number }[];
        };

        expect(report.standPieces).toBe(3);
        expect(report.standWithShadowPx).toBe(2);
        expect(report.standWithoutShadow).toHaveLength(1);
        expect(report.standWithoutShadow[0].key).toBe("a/speck.png");
        expect(report.standWithoutShadow[0].reason).toMatch(/shadow px outside its silhouette/);
        expect(report.standWithoutShadow[0].pixels).toBeLessThan(8);
    });

    it("bakes the same bytes twice", () => {
        const a = buildCasts(source(), REAL, 17.4);
        const b = buildCasts(source(), REAL, 17.4);

        expect(Buffer.compare(Buffer.from(a.all), Buffer.from(b.all))).toBe(0);
    });
});

describe("shader lab: channel counts", () => {
    it("reads map row y from buffer row height - 1 - y, inside the rectangle asked for", () => {
        const w = 4;
        const h = 3;
        const cast = new Uint8Array(w * h * 4);
        // the map pixel (1, 0), top row: a lamp byte, an umbra and a hard contact, on a surface
        const top = ((h - 1 - 0) * w + 1) * 4;
        cast.set([10, 255, 255, 128], top);
        // the map pixel (3, 2), bottom row: covered by a picture
        cast[((h - 1 - 2) * w + 3) * 4 + 3] = 255;

        const whole = channelCounts(cast, w, h);
        const topLeft = channelCounts(cast, w, h, [0, 0, 2, 1]);
        const bottomRow = channelCounts(cast, w, h, [0, 2, 4, 1]);

        expect(whole).toEqual({
            pixels: 12,
            lamp: 1,
            key: 1,
            umbra: 1,
            contact: 1,
            hardContact: 1,
            surface: 1,
            solid: 1,
        });
        expect(topLeft).toMatchObject({ pixels: 2, lamp: 1, surface: 1, solid: 0 });
        expect(bottomRow).toMatchObject({ pixels: 4, lamp: 0, solid: 1 });
        expect(channelCounts(cast, w, h, [-1, -1, 3, 3]).pixels).toBe(4);
        expect(channelCounts(cast, w, h, [-5, -5, 2, 2]).pixels).toBe(0);
    });
});

describe("shader lab: the people's stamps", () => {
    const hooks: StampHooks = {
        personShadowFrames: () => {
            // two frames side by side, 4 x 4 each, atlas 8 wide: the second is opaque in its middle 2 x 2
            const atlas = new Uint8ClampedArray(8 * 4 * 4);
            for (let y = 1; y < 3; y++) for (let x = 5; x < 7; x++) atlas[(y * 8 + x) * 4 + 3] = 255;
            return atlas;
        },
        newPersonShadow: () => ({ direction: 0, lengthClass: 0, alpha: 0, picked: false }),
        pickPersonShadow: (out, x, y) => {
            out.direction = x > 50 ? 1 : 0;
            out.lengthClass = 0;
            out.alpha = 0.5 + y / 1000;
            out.picked = true;
        },
        stampFrameAt: (direction) => [direction * 4, 0],
        STAMP_SIZE: 4,
        STAMP_ATLAS_WIDTH: 8,
        STAMP_COLOUR: [0, 0, 100],
    };
    const key = { dirIndex: 0, length: 0.4, strength: 0.6 };

    it("says what it lacks", () => {
        expect(missingStampHooks({})).toEqual([
            "personShadowFrames",
            "pickPersonShadow",
            "newPersonShadow",
            "stampFrameAt",
        ]);
        expect(missingStampHooks(hooks)).toEqual([]);
        expect(planStamps({}, [{ x: 1, y: 1 }], [], 1, key)).toBeNull();
    });

    it("asks the runtime to pick one stamp for each person, at whole pixels", () => {
        const plan = planStamps(
            hooks,
            [
                { x: 60.4, y: 20.6 },
                { x: 10, y: 10 },
            ],
            [],
            1,
            key,
        );

        expect(plan?.stamps).toEqual([
            { x: 60, y: 21, direction: 1, lengthClass: 0, alpha: 0.521 },
            { x: 10, y: 10, direction: 0, lengthClass: 0, alpha: 0.51 },
        ]);
    });

    it("blends the picked frame under the feet, as the colour of the stamp at its alpha", () => {
        const w = 12;
        const h = 12;
        const frame = new Uint8ClampedArray(w * h * 4).fill(200);
        const plan = planStamps(hooks, [{ x: 8, y: 8 }], [], 1, key);

        const written = compositeStamps(
            frame,
            w,
            h,
            { ...plan!, stamps: [{ ...plan!.stamps[0], direction: 1, alpha: 0.5 }] },
            hooks,
        );

        // frame 1's opaque pixels are its x 1..2, y 1..2: on the map (8 - 2 + 1 ..) = x 7..8, y 7..8
        expect(written).toBe(4);
        const at = (x: number, y: number) => Array.from(frame.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
        expect(at(7, 7)).toEqual([100, 100, 150]);
        expect(at(8, 8)).toEqual([100, 100, 150]);
        expect(at(6, 7)).toEqual([200, 200, 200]);
        expect(at(9, 9)).toEqual([200, 200, 200]);
    });

    it("clips a stamp at the edge of the frame", () => {
        const frame = new Uint8ClampedArray(4 * 4 * 4).fill(200);
        const plan = {
            stamps: [{ x: 0, y: 0, direction: 1, lengthClass: 0, alpha: 1 }],
            atlas: hooks.personShadowFrames!(),
        };

        expect(() => compositeStamps(frame, 4, 4, plan, hooks)).not.toThrow();
    });
});
