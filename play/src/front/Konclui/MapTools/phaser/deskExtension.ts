import type { SceneExtension } from "../../../ExternalModule/ClientExtensionPoints";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import {
    DESKS_VARIABLE,
    SEAT_VARIABLE,
    deskOf,
    isSeated,
    isSeatedOnChair,
    parseDesks,
    type Box,
    type DesksReading,
} from "../domain/desk";

/** Stands for "the variable was never read", so the first frame always reports, even for a room with no desks. */
const NOT_READ = Symbol("not read");

/** What the extension hands over, and the one thing it asks for. The integration points them at the desk store. */
export interface DeskExtensionPorts {
    /** The desks the room keeps, as read from its variable. */
    readonly publishDesks: (reading: DesksReading) => void;
    /** Whether the user sits at their own desk. Called when the answer changes, and with `false` on the first frame. */
    readonly publishAtDesk: (atDesk: boolean) => void;
    /** The id the room knows the user by, `undefined` while it is not known. Asked when the desks change, not per frame. */
    readonly userId: () => string | undefined;
}

/** The picture of a chair the map placed, or `undefined` when the map has no such piece (it was deleted in the editor). */
function chairBox(scene: GameScene, chairId: string): Box | undefined {
    const chair = scene.getGameMapFrontWrapper().getEntitiesManager().getEntities().get(chairId);
    if (chair === undefined) return undefined;
    return { x: chair.x, y: chair.y, width: chair.displayWidth, height: chair.displayHeight };
}

/**
 * Tells the tools which desks the room keeps and whether the user sits at theirs. The variable `mesas` is the one the
 * office map declares and its script writes; the scene holds it already, so a frame costs one lookup and one
 * comparison, and the value is parsed only when it is another object than the last. It hands what it read to the
 * ports, which the integration points at the desk store, so this layer writes no Konclui state.
 *
 * Whether the user sits at their desk is worked out from what the scene already holds, on each frame and only for a
 * user who has a desk: whether their `officeSeat` variable is set, which is a lookup, and only then whether their
 * avatar is on the chair of their desk, which is one lookup of the piece and four comparisons. A user without a desk,
 * or standing, costs nothing more than the lookup of the variable.
 *
 * It reads one variable of the room, the user's own variable and one piece of the map. It never asks for the room's
 * roster.
 */
export function createDeskExtension(ports: DeskExtensionPorts): SceneExtension {
    let last: unknown = NOT_READ;
    // The chair of the user's desk, kept from the last good reading of the variable.
    let ownChair: string | undefined;
    let atDesk: boolean | undefined;

    const report = (here: boolean): void => {
        if (here === atDesk) return;
        atDesk = here;
        ports.publishAtDesk(here);
    };

    return {
        id: "konclui.desks",
        onFrame(context) {
            if (context.getRoomVariable === undefined) return;
            const value = context.getRoomVariable(DESKS_VARIABLE);
            if (value !== last) {
                last = value;
                const reading = parseDesks(value);
                ports.publishDesks(reading);
                // A value that is not desks is refused by the store, which keeps the last good ones, so the chair stays too.
                if (reading.kind !== "invalid") {
                    const user = ports.userId();
                    ownChair = reading.kind === "desks" && user !== undefined ? deskOf(reading.desks, user) : undefined;
                }
            }
            if (ownChair === undefined || !isSeated(context.getPlayerVariable(SEAT_VARIABLE))) {
                report(false);
                return;
            }
            report(isSeatedOnChair(true, context.currentPlayer, chairBox(context.scene, ownChair)));
        },
        onShutdown() {
            // The next room must not offer the desk of this one, nor say the user sits at it.
            last = NOT_READ;
            ownChair = undefined;
            ports.publishDesks({ kind: "absent" });
            report(false);
        },
    };
}
