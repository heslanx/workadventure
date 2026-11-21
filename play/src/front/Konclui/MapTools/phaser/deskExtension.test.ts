import { describe, expect, it, vi } from "vitest";
import type { SceneFrameContext } from "../../../ExternalModule/ClientExtensionPoints";
import { createDeskExtension } from "./deskExtension";

const OWNER = { "chair-4": { uuid: "uuid-ana", name: "Ana" } };
const OTHER = { "chair-9": { uuid: "uuid-bia", name: "Bia" } };

/** The picture of chair 4 on the map: a tile wide and a tile and a half tall, corner at (96, 96). */
const CHAIR = { x: 96, y: 96, displayWidth: 32, displayHeight: 48 };
const SEATED = { v: 1, direction: "up" };

interface FrameOptions {
    /** The value of `mesas`. */
    readonly desks?: unknown;
    /** The value of the user's `officeSeat`. */
    readonly seat?: unknown;
    /** `null` for the scene before it has created the user's avatar. */
    readonly player?: { x: number; y: number } | null;
    /** The pieces the map placed, by id. */
    readonly entities?: ReadonlyMap<string, typeof CHAIR>;
}

/** A frame of the scene as the extension reads it: the variables, the avatar and the pieces of the map. */
function frame({
    desks,
    seat = null,
    player = { x: 112, y: 128 },
    entities = new Map([["chair-4", CHAIR]]),
}: FrameOptions) {
    return {
        scene: { getGameMapFrontWrapper: () => ({ getEntitiesManager: () => ({ getEntities: () => entities }) }) },
        currentPlayer: player ?? undefined,
        getRoomVariable: (key: string) => (key === "mesas" ? desks : undefined),
        getPlayerVariable: (key: string) => (key === "officeSeat" ? seat : undefined),
    } as unknown as SceneFrameContext;
}

/** An extension whose ports are spies, for the user `uuid-ana` unless said otherwise. */
function create(who: () => string | undefined = () => "uuid-ana") {
    const publishDesks = vi.fn();
    const publishAtDesk = vi.fn();
    const userId = vi.fn(who);
    const extension = createDeskExtension({ publishDesks, publishAtDesk, userId });
    return { extension, publishDesks, publishAtDesk, userId };
}

describe("the desk extension, the desks", () => {
    it("tells the tools which desks the room keeps, from the variable the office map declares", () => {
        const { extension, publishDesks } = create();

        extension.onFrame?.(frame({ desks: JSON.stringify(OWNER) }));

        expect(publishDesks).toHaveBeenCalledExactlyOnceWith({ kind: "desks", desks: OWNER });
    });

    it("says a room without the variable has none, on the first frame, so nothing is left from another room", () => {
        const { extension, publishDesks } = create();

        extension.onFrame?.(frame({ desks: undefined }));

        expect(publishDesks).toHaveBeenCalledExactlyOnceWith({ kind: "absent" });
    });

    it("reports a variable that is not desks, for the store to refuse", () => {
        const { extension, publishDesks } = create();

        extension.onFrame?.(frame({ desks: "{not json" }));

        expect(publishDesks).toHaveBeenCalledTimes(1);
        expect(publishDesks.mock.calls[0]?.[0]).toMatchObject({ kind: "invalid" });
    });

    it("follows the room when a desk is claimed or released", () => {
        const { extension, publishDesks } = create();

        extension.onFrame?.(frame({ desks: "{}" }));
        extension.onFrame?.(frame({ desks: JSON.stringify(OWNER) }));
        extension.onFrame?.(frame({ desks: "{}" }));

        expect(publishDesks.mock.calls.map(([reading]) => reading)).toEqual([
            { kind: "desks", desks: {} },
            { kind: "desks", desks: OWNER },
            { kind: "desks", desks: {} },
        ]);
    });

    it("parses again only when the value is another one, so a still frame costs a lookup and a comparison", () => {
        const { extension, publishDesks, userId } = create();
        const value = JSON.stringify(OWNER);

        for (let index = 0; index < 100; index++) extension.onFrame?.(frame({ desks: value }));

        expect(publishDesks).toHaveBeenCalledTimes(1);
        // Nor does a still frame ask who the user is: that reads the browser's storage.
        expect(userId).toHaveBeenCalledTimes(1);
    });

    it("does nothing for a scene that cannot read room variables", () => {
        const { extension, publishDesks, publishAtDesk } = create();

        extension.onFrame?.({} as SceneFrameContext);

        expect(publishDesks).not.toHaveBeenCalled();
        expect(publishAtDesk).not.toHaveBeenCalled();
    });

    it("leaves no desk behind when the scene shuts down, and reads the next room from its first frame", () => {
        const { extension, publishDesks } = create();
        extension.onFrame?.(frame({ desks: JSON.stringify(OWNER) }));
        publishDesks.mockClear();

        extension.onShutdown?.({} as never);
        extension.onFrame?.(frame({ desks: JSON.stringify(OWNER) }));

        expect(publishDesks.mock.calls.map(([reading]) => reading)).toEqual([
            { kind: "absent" },
            { kind: "desks", desks: OWNER },
        ]);
    });
});

describe("the desk extension, whether the user sits at their desk", () => {
    const own = JSON.stringify(OWNER);

    it("says so while the user sits and their avatar is on the chair of their desk", () => {
        const { extension, publishAtDesk } = create();

        extension.onFrame?.(frame({ desks: own, seat: SEATED }));

        expect(publishAtDesk).toHaveBeenLastCalledWith(true);
    });

    it("says no for a user who stands, even on the spot of their chair: the tool can still take them to it", () => {
        const { extension, publishAtDesk } = create();

        extension.onFrame?.(frame({ desks: own, seat: null }));

        expect(publishAtDesk).toHaveBeenLastCalledWith(false);
    });

    it("says no for a user who sits on another seat of the office", () => {
        const { extension, publishAtDesk } = create();

        extension.onFrame?.(frame({ desks: own, seat: SEATED, player: { x: 480, y: 128 } }));

        expect(publishAtDesk).toHaveBeenLastCalledWith(false);
    });

    it("says no for a user whose room gives them no desk, wherever they sit, and for one who is not known yet", () => {
        const stranger = create();
        stranger.extension.onFrame?.(frame({ desks: JSON.stringify(OTHER), seat: SEATED }));
        expect(stranger.publishAtDesk).toHaveBeenLastCalledWith(false);

        const unknown = create(() => undefined);
        unknown.extension.onFrame?.(frame({ desks: own, seat: SEATED }));
        expect(unknown.publishAtDesk).toHaveBeenLastCalledWith(false);
    });

    it("says no when the chair is no longer on the map, or the avatar is not there yet", () => {
        const deleted = create();
        deleted.extension.onFrame?.(frame({ desks: own, seat: SEATED, entities: new Map() }));
        expect(deleted.publishAtDesk).toHaveBeenLastCalledWith(false);

        const loading = create();
        loading.extension.onFrame?.(frame({ desks: own, seat: SEATED, player: null }));
        expect(loading.publishAtDesk).toHaveBeenLastCalledWith(false);
    });

    it("tells the tools on the first frame, and again only when the answer changes", () => {
        const { extension, publishAtDesk } = create();

        extension.onFrame?.(frame({ desks: own, seat: null }));
        extension.onFrame?.(frame({ desks: own, seat: null }));
        extension.onFrame?.(frame({ desks: own, seat: SEATED }));
        extension.onFrame?.(frame({ desks: own, seat: SEATED }));
        extension.onFrame?.(frame({ desks: own, seat: null }));

        expect(publishAtDesk.mock.calls.map(([here]) => here)).toEqual([false, true, false]);
    });

    it("follows the chair when it is moved on the map with its sitter, and stops saying so when the sitter is left behind", () => {
        const { extension, publishAtDesk } = create();
        extension.onFrame?.(frame({ desks: own, seat: SEATED }));

        extension.onFrame?.(
            frame({ desks: own, seat: SEATED, entities: new Map([["chair-4", { ...CHAIR, x: 480, y: 480 }]]) }),
        );

        expect(publishAtDesk.mock.calls.map(([here]) => here)).toEqual([true, false]);
    });

    it("stops saying so when the desk is released, and keeps saying so through a value that is not desks", () => {
        const { extension, publishAtDesk } = create();
        extension.onFrame?.(frame({ desks: own, seat: SEATED }));

        extension.onFrame?.(frame({ desks: "{not json", seat: SEATED }));
        expect(publishAtDesk).toHaveBeenLastCalledWith(true);

        extension.onFrame?.(frame({ desks: "{}", seat: SEATED }));
        expect(publishAtDesk).toHaveBeenLastCalledWith(false);
    });

    it("does not look for the chair while the user stands or has no desk, so most frames cost one lookup", () => {
        const getEntities = vi.fn(() => new Map([["chair-4", CHAIR]]));
        const context = {
            scene: { getGameMapFrontWrapper: () => ({ getEntitiesManager: () => ({ getEntities }) }) },
            currentPlayer: { x: 112, y: 128 },
            getRoomVariable: () => own,
            getPlayerVariable: () => null,
        } as unknown as SceneFrameContext;
        const { extension } = create();

        for (let index = 0; index < 50; index++) extension.onFrame?.(context);

        expect(getEntities).not.toHaveBeenCalled();
    });

    it("does not say the user sits at a desk in the next room: it says no when the scene shuts down", () => {
        const { extension, publishAtDesk } = create();
        extension.onFrame?.(frame({ desks: own, seat: SEATED }));

        extension.onShutdown?.({} as never);

        expect(publishAtDesk).toHaveBeenLastCalledWith(false);
    });
});
