import { z } from "zod";

/**
 * The id of the action bar button the office's map script adds while its user has a desk. The script keeps the desks in
 * the room variable `mesas` and walks the user back to their chair when that button is pressed (`social.mjs`,
 * `myDeskButton`), so pressing it is how the map tools take the user to the desk. The coupling is on purpose and has one
 * place: if the script stops adding the button, `deskReachable` is false and the tool leaves, instead of staying as a
 * control that does nothing.
 */
export const DESK_ACTION_ID = "minha-mesa";

/** The room variable that holds the office's desks, which the map declares and the map script writes. */
export const DESKS_VARIABLE = "mesas";

/** The desks by the id of their chair. A desk with no owner is not in the record. */
export type Desks = Readonly<Record<string, { readonly uuid: string }>>;

export type DesksReading =
    | { readonly kind: "absent" }
    | { readonly kind: "desks"; readonly desks: Desks }
    | { readonly kind: "invalid"; readonly reason: string };

const DesksSchema = z.record(z.string(), z.object({ uuid: z.string() }).passthrough());

/**
 * Reads the value of the room variable `mesas`. The map script stores it as the JSON text of an object, the empty text
 * meaning no desks, and the room may hand over the object itself. A room without the variable has no desks to offer,
 * which is not an error; a value that is not a record of owners is one, and the caller keeps what it knew before.
 */
export function parseDesks(value: unknown): DesksReading {
    if (value === undefined) return { kind: "absent" };
    let candidate = value;
    if (typeof value === "string") {
        if (value === "") return { kind: "desks", desks: {} };
        try {
            candidate = JSON.parse(value);
        } catch (error: unknown) {
            return { kind: "invalid", reason: error instanceof Error ? error.message : "the text is not JSON" };
        }
    }
    const parsed = DesksSchema.safeParse(candidate);
    return parsed.success ? { kind: "desks", desks: parsed.data } : { kind: "invalid", reason: parsed.error.message };
}

/** The chair of the desk that `uuid` holds, or `undefined`. */
export function deskOf(desks: Desks, uuid: string): string | undefined {
    for (const [chair, owner] of Object.entries(desks)) {
        if (owner.uuid === uuid) return chair;
    }
    return undefined;
}

/**
 * Whether "go to my desk" can act: the room's desks give this user one, and the action that walks there is registered
 * (`DESK_ACTION_ID`). With either missing the tool is left out.
 */
export function deskReachable(desks: Desks | undefined, uuid: string | undefined, actionRegistered: boolean): boolean {
    return actionRegistered && desks !== undefined && uuid !== undefined && deskOf(desks, uuid) !== undefined;
}

/**
 * The player variable the office script publishes while its user sits, and clears (`null`) when they stand
 * (`seating.mjs`, `publish`). The map tools read only whether it is set: which seat it is does not travel with it.
 */
export const SEAT_VARIABLE = "officeSeat";

/**
 * How far from the chair's anchor the script still counts the avatar as seated on it (`seating.mjs`, `sit`: 8 px). The
 * anchor lies inside the chair's picture, so the picture grown by this much holds every position a sitter can have.
 */
export const SEAT_TOLERANCE_PX = 8;

/** A point of the map, in pixels. */
export interface Point {
    readonly x: number;
    readonly y: number;
}

/** The picture of a piece of furniture on the map, in pixels: its top-left corner and its size. */
export interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Whether the value of the seat variable says the user sits: the script clears it, to `null`, when they stand. */
export function isSeated(value: unknown): boolean {
    return typeof value === "object" && value !== null;
}

/**
 * Whether the user sits on the chair whose picture is `chair`. The seat variable does not say which chair it is, so
 * the place of the avatar does: a sitter stands on the chair's anchor, which is inside its picture. It can also say yes
 * for a sitter on another seat whose anchor falls inside this picture, which pictures of separate desk chairs do not
 * do. Standing in the box without sitting is not enough: that user can still be taken to the chair.
 */
export function isSeatedOnChair(seated: boolean, player: Point | undefined, chair: Box | undefined): boolean {
    if (!seated || player === undefined || chair === undefined) return false;
    const margin = SEAT_TOLERANCE_PX;
    return (
        player.x >= chair.x - margin &&
        player.x <= chair.x + chair.width + margin &&
        player.y >= chair.y - margin &&
        player.y <= chair.y + chair.height + margin
    );
}

/**
 * What "go to my desk" is right now: `absent` when it could not act at all (the room gives no desk, or the script's
 * button is not there), `here` when the user already sits at their desk, so pressing it would do nothing, and `ready`
 * otherwise. A tool that is `here` stays on the column, focusable, and says why it does not act.
 */
export type DeskToolState = "absent" | "here" | "ready";

export function deskToolState(reachable: boolean, atDesk: boolean): DeskToolState {
    if (!reachable) return "absent";
    return atDesk ? "here" : "ready";
}
