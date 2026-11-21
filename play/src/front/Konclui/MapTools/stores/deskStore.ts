import { derived, writable, type Readable } from "svelte/store";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { getAdditionalMenuItemStore } from "../../../Stores/AdditionalItemsMenuStore";
import {
    DESK_ACTION_ID,
    deskReachable,
    deskToolState,
    type Desks,
    type DesksReading,
    type DeskToolState,
} from "../domain/desk";

const desks = writable<Desks | undefined>(undefined);
const atDesk = writable(false);

/** The id the room knows the user by, which is who owns a desk. `undefined` while the user is not known. */
export function localUserId(): string | undefined {
    return localUserStore.getLocalUser()?.uuid;
}

/**
 * Takes in what the scene read of the room's desks. A value that is not a record of owners is reported and ignored: the
 * desks stay as the last good reading said, since one bad write by a script is not a reason to take a user's desk away.
 */
export function publishDesks(reading: DesksReading): void {
    if (reading.kind === "invalid") {
        console.error(
            `[konclui] map tools: the room's desks could not be read, keeping the last ones: ${reading.reason}`,
        );
        return;
    }
    desks.set(reading.kind === "desks" ? reading.desks : undefined);
}

/** Takes in whether the scene sees the user seated at their own desk. */
export function publishAtDesk(here: boolean): void {
    atDesk.set(here);
}

/**
 * Whether the user has a desk to go to. It reads the desks the room keeps, which are the office map's own model, and
 * not WorkAdventure's personal areas, which the office map does not declare.
 */
export const deskReachableStore: Readable<boolean> = derived(
    [desks, getAdditionalMenuItemStore("top")],
    ([$desks, $items]) => deskReachable($desks, localUserId(), $items.has(DESK_ACTION_ID)),
);

/**
 * What the desk tool is: left out, on offer, or on the column but with nothing to do because the user already sits at
 * their desk. `atDesk` is published by the scene and only counts for a user who has a desk to go to.
 */
export const deskToolStore: Readable<DeskToolState> = derived([deskReachableStore, atDesk], ([$reachable, $atDesk]) =>
    deskToolState($reachable, $atDesk),
);
