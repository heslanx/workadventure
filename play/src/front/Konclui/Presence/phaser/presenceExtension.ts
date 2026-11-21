import type { SceneExtension, SceneFrameContext } from "../../../ExternalModule/ClientExtensionPoints";
import type { CrowdReading } from "../domain/crowd";
import { NEAREST_SHOWN, nearestPeople, type NearbyCandidate, type NearbyPerson } from "../domain/nearbyPeople";
import type { NearbyRow } from "../domain/peopleList";
import { FEET_OFFSET_Y, placeAt, type AreaLike, type Place } from "../domain/place";
import type { PresenceReading } from "../domain/presence";
import { NEARBY_ROWS } from "../domain/rosterWatch";

/** The least frame time, in milliseconds, between two readings: four a second is enough for a pill and a place name. */
const READING_INTERVAL_MS = 250;

/** The scene's remote characters as the pure functions read them. A generator, so no array is built per reading. */
function* candidatesOf(remoteCharacters: SceneFrameContext["remoteCharacters"]): Generator<NearbyCandidate> {
    for (const character of remoteCharacters.values()) {
        yield { id: character.userId, name: character.playerName, x: character.x, y: character.y };
    }
}

/** Where the people panel reads the people around the player, and whether it reads them at all right now. */
export interface CrowdOutput {
    /** Whether the people panel is on screen. While it is not, nothing about the crowd is computed. */
    wanted(): boolean;
    publish(reading: CrowdReading | undefined): void;
}

/** The map's areas by id, as the scene keeps them. Each lookup walks them anew: an iterator would be spent by the first. */
type Areas = ReadonlyMap<string, AreaLike> | undefined;

function placeOf(areas: Areas, point: { x: number; y: number }): Place | undefined {
    return areas === undefined ? undefined : placeAt(areas.values(), { x: point.x, y: point.y + FEET_OFFSET_Y });
}

/**
 * The people around the player, as rows of the people panel: the session each one is in the room's roster, the status the
 * scene last heard of and the place they stand in. Only the people in the area of interest are here, the characters the
 * scene holds, which is all the scene knows of a position.
 */
function crowdOf(
    context: SceneFrameContext,
    player: { x: number; y: number; playerName: string },
    areas: Areas,
    nearest: readonly NearbyPerson[],
): CrowdReading {
    const roomKey = context.scene.roomUrl;
    const people: NearbyRow[] = [];
    for (const person of nearest) {
        const character = context.remoteCharacters.get(person.id);
        if (character === undefined) continue;
        people.push({
            // The pusher names a session after the room and the player's id in it (`Space/Utils/UserLookup`).
            spaceUserId: `${roomKey}_${person.id}`,
            uuid: character.userUuid,
            name: person.name,
            status: context.remotePlayers.get(person.id)?.availabilityStatus,
            place: placeOf(areas, character),
        });
    }
    return {
        roomKey,
        me: {
            spaceUserId: context.scene.connection?.getSpaceUserId(),
            name: player.playerName,
            place: placeOf(areas, player),
        },
        people,
    };
}

/**
 * The one extension that reads the current player's surroundings: who is near and where they stand. The people pill
 * and the place chip share it, so the scene's characters are walked once per reading, not once per feature.
 *
 * The characters it reads are the ones the scene holds, which are the ones in the area of interest the server sends:
 * it never asks for the room's roster. It runs on the frame, so it takes a reading every 250 ms of frame time, with
 * no timer of its own, and hands it to `publish`, which the integration points at the presence store.
 *
 * While the people panel is open (`crowd.wanted()`), the same walk keeps the nearest `NEARBY_ROWS` people for its rows
 * and hands them, with their places, to `crowd.publish`. Closed, it keeps the four the pill shows and nothing more.
 */
export function createPresenceExtension(
    publish: (reading: PresenceReading | undefined) => void,
    crowd?: CrowdOutput,
): SceneExtension {
    let lastReadingTime = Number.NEGATIVE_INFINITY;
    let crowdPublished = false;
    return {
        id: "konclui.presence",
        onFrame(context) {
            const player = context.currentPlayer;
            if (player === undefined || context.time - lastReadingTime < READING_INTERVAL_MS) return;
            lastReadingTime = context.time;
            const crowdWanted = crowd?.wanted() === true;
            const nearby = nearestPeople(player, candidatesOf(context.remoteCharacters), {
                limit: crowdWanted ? NEARBY_ROWS : NEAREST_SHOWN,
            });
            const areas = context.scene.getGameMapFrontWrapper().getAreas();
            publish({
                nearest: nearby.nearest.slice(0, NEAREST_SHOWN),
                nearCount: nearby.nearCount,
                place: placeOf(areas, player),
            });
            if (crowd === undefined) return;
            if (crowdWanted) {
                crowd.publish(crowdOf(context, player, areas, nearby.nearest));
                crowdPublished = true;
            } else if (crowdPublished) {
                // The panel closed: what it last read must not be what it shows when it opens again.
                crowd.publish(undefined);
                crowdPublished = false;
            }
        },
        onShutdown() {
            // The next scene must not show the place and the people of this one.
            lastReadingTime = Number.NEGATIVE_INFINITY;
            publish(undefined);
            crowd?.publish(undefined);
            crowdPublished = false;
        },
    };
}
