import type { SceneExtension, SceneFrameContext } from "../../../ExternalModule/ClientExtensionPoints";
import { NEAREST_SHOWN, nearestPeople, type NearbyCandidate } from "../domain/nearbyPeople";
import { FEET_OFFSET_Y, placeAt } from "../domain/place";
import type { PresenceReading } from "../domain/presence";

/** The least frame time, in milliseconds, between two readings: four a second is enough for a pill and a place name. */
const READING_INTERVAL_MS = 250;

/** The scene's remote characters as the pure functions read them. A generator, so no array is built per reading. */
function* candidatesOf(remoteCharacters: SceneFrameContext["remoteCharacters"]): Generator<NearbyCandidate> {
    for (const character of remoteCharacters.values()) {
        yield { id: character.userId, name: character.playerName, x: character.x, y: character.y };
    }
}

/**
 * The one extension that reads the current player's surroundings: who is near and where they stand. The people pill
 * and the place chip share it, so the scene's characters are walked once per reading, not once per feature.
 *
 * The characters it reads are the ones the scene holds, which are the ones in the area of interest the server sends:
 * it never asks for the room's roster. It runs on the frame, so it takes a reading every 250 ms of frame time, with
 * no timer of its own, and hands it to `publish`, which the integration points at the presence store.
 */
export function createPresenceExtension(publish: (reading: PresenceReading | undefined) => void): SceneExtension {
    let lastReadingTime = Number.NEGATIVE_INFINITY;
    return {
        id: "konclui.presence",
        onFrame(context) {
            const player = context.currentPlayer;
            if (player === undefined || context.time - lastReadingTime < READING_INTERVAL_MS) return;
            lastReadingTime = context.time;
            const nearby = nearestPeople(player, candidatesOf(context.remoteCharacters), { limit: NEAREST_SHOWN });
            const areas = context.scene.getGameMapFrontWrapper().getAreas();
            publish({
                ...nearby,
                place:
                    areas === undefined
                        ? undefined
                        : placeAt(areas.values(), { x: player.x, y: player.y + FEET_OFFSET_Y }),
            });
        },
        onShutdown() {
            // The next scene must not show the place and the people of this one.
            lastReadingTime = Number.NEGATIVE_INFINITY;
            publish(undefined);
        },
    };
}
