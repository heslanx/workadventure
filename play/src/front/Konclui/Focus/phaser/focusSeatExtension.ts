import type { SceneExtension } from "../../../ExternalModule/ClientExtensionPoints";
import { parseSeatPose } from "../../Workplace/domain/seatPose";

/** Stands for "the variable was never read", so the first frame always reports, even when the player is not seated. */
const NOT_READ = Symbol("not read");

/**
 * Tells focus whether the current player sits on a seat of the office. The seat is the player's own `officeSeat`
 * variable, which the map script publishes and the seated pose already draws; what makes it a seat is the same
 * parse (`Workplace/domain/seatPose.ts`).
 *
 * It reads the variable on every frame, which is one lookup and one comparison, and parses it only when the value
 * is another object than the last. It hands the answer to `publish`, which the integration points at the focus
 * store, so this layer writes no Konclui state. It never starts a focus: sitting only offers one.
 */
export function createFocusSeatExtension(publish: (seated: boolean) => void): SceneExtension {
    let last: unknown = NOT_READ;
    return {
        id: "konclui.focusSeat",
        onFrame(context) {
            if (context.currentPlayer === undefined) return;
            const value = context.getPlayerVariable("officeSeat");
            if (value === last) return;
            last = value;
            publish(parseSeatPose(value, context.baseUrl) !== undefined);
        },
        onShutdown() {
            // A scene that ends while the player sits must not leave a focus running in the next one.
            last = NOT_READ;
            publish(false);
        },
    };
}
