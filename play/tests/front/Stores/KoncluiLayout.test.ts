import { describe, expect, it } from "vitest";
import {
    coWebsiteRatioAtPointer,
    isKoncluiShellActive,
    splitGameViewport,
} from "../../../src/front/Stores/KoncluiLayout";

describe("Konclui room shell", () => {
    const ready = {
        roomId: "~/konclui-office/office.wam",
        sceneLoaded: true,
        loading: false,
        entryScreenVisible: false,
        errorVisible: false,
    };

    it("activates after root navigation resolves to the same room as direct navigation", () => {
        expect(isKoncluiShellActive({ ...ready, roomId: undefined, sceneLoaded: false })).toBe(false);
        expect(isKoncluiShellActive(ready)).toBe(true);
        expect(isKoncluiShellActive({ ...ready, roomId: "/~/konclui-office/office.wam/" })).toBe(true);
    });

    it.each(["~/baseline/office.wam", "~/konclui-office/other.wam", "~/not-konclui-office/office.wam"])(
        "preserves the upstream layout for %s",
        (roomId) => expect(isKoncluiShellActive({ ...ready, roomId })).toBe(false),
    );

    it.each([{ sceneLoaded: false }, { loading: true }, { entryScreenVisible: true }, { errorVisible: true }])(
        "restores entry or error layout for %o",
        (state) => {
            expect(isKoncluiShellActive({ ...ready, ...state })).toBe(false);
        },
    );
});

describe("game viewport within the office frame", () => {
    it("uses the measured frame without subtracting the people panel twice", () => {
        expect(
            splitGameViewport(
                { width: 1072, height: 788 },
                {
                    visible: false,
                    fullscreen: false,
                    ratio: 0.5,
                    vertical: false,
                },
            ).game,
        ).toEqual({ width: 1072, height: 788 });
    });

    it("shares the available frame with a landscape co-website", () => {
        expect(
            splitGameViewport(
                { width: 704, height: 788 },
                {
                    visible: true,
                    fullscreen: false,
                    ratio: 0.25,
                    vertical: false,
                },
            ),
        ).toEqual({ game: { width: 528, height: 788 }, website: { width: 176, height: 788 } });
    });

    it("shares the available height with a portrait co-website", () => {
        expect(
            splitGameViewport(
                { width: 360, height: 800 },
                {
                    visible: true,
                    fullscreen: false,
                    ratio: 0.5,
                    vertical: true,
                },
            ),
        ).toEqual({ game: { width: 360, height: 400 }, website: { width: 360, height: 400 } });
    });

    it("preserves upstream website geometry while hiding the fullscreen game", () => {
        expect(
            splitGameViewport(
                { width: 704, height: 788 },
                {
                    visible: true,
                    fullscreen: true,
                    ratio: 0.5,
                    vertical: false,
                },
            ),
        ).toEqual({ game: { width: 0, height: 0 }, website: { width: 352, height: 788 } });
    });
});

describe("co-website divider coordinates", () => {
    const bounds = { left: 362, top: 6, width: 1072, height: 788 };

    it("preserves the midpoint inside an offset office frame", () => {
        expect(coWebsiteRatioAtPointer(bounds, { x: 898, y: 400 }, false, false)).toBe(0.5);
        expect(coWebsiteRatioAtPointer(bounds, { x: 898, y: 400 }, false, true)).toBe(0.5);
        expect(coWebsiteRatioAtPointer(bounds, { x: 898, y: 400 }, true, false)).toBe(0.5);
    });

    it("clamps dragging outside the frame while preserving the resize handle", () => {
        expect(coWebsiteRatioAtPointer(bounds, { x: 1500, y: 900 }, false, false)).toBe(8 / 1072);
        expect(coWebsiteRatioAtPointer(bounds, { x: 0, y: 0 }, false, false)).toBe(1);
        expect(coWebsiteRatioAtPointer(bounds, { x: 0, y: 0 }, false, true)).toBe(8 / 1072);
        expect(coWebsiteRatioAtPointer(bounds, { x: 0, y: 0 }, true, false)).toBe(8 / 788);
    });
});
