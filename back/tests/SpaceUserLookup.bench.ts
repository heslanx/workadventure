import { bench, describe } from "vitest";
import { mock } from "vitest-mock-extended";
import { FilterType, PrivateEvent, SpaceUser } from "@workadventure/messages";
import { Space } from "../src/Model/Space";
import type { SpacesWatcher } from "../src/Model/SpacesWatcher";
import type { EventProcessor } from "../src/Model/EventProcessor";

/**
 * What does it cost the back to find one of the users of a megaphone space by id?
 *
 * Every LiveKit invitation to a listener goes through `Space.dispatchPrivateEvent`, which has to resolve the
 * sender, and a megaphone with 1000 people in it sends 999 of them at once when a speaker starts. Each lookup
 * used to flatten the users of every pusher into a fresh array and scan it, so the burst cost O(N^2).
 * One iteration below is one such burst; the time reported is the time of those 999 lookups.
 *
 * Run with `PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest bench --config vitest.config.ts --run tests/SpaceUserLookup.bench.ts`.
 *
 * Measured on an M-series laptop under a load average of about 200 (other agents), so only the ratio is solid.
 * One burst of 999 lookups, 1000 users on one pusher, mean (fastest sample), two runs each:
 *
 *   getUser                       before 23.6 ms (14.2), 54.2 ms (13.7)   after 0.14 ms (0.020), 0.10 ms (0.020)
 *   dispatchPrivateEvent          before 65.2 ms (36.2), 34.8 ms (16.9)   after 0.64 ms (0.090), 1.77 ms (0.092)
 *
 * The 22 ms the engine plan quotes is the first row on a quiet machine.
 */

const USER_COUNT = 1000;

function createSpace(watcherCount: number): { space: Space; spaceUserIds: string[] } {
    const eventProcessor = {
        processPrivateEvent: (event: unknown) => event,
    } as unknown as EventProcessor;
    const space = new Space("megaphone", FilterType.LIVE_STREAMING_USERS, eventProcessor, [], "world");
    const usersByWatcher = (space as unknown as { users: Map<SpacesWatcher, Map<string, SpaceUser>> }).users;

    const spaceUserIds: string[] = [];
    for (let watcherIndex = 0; watcherIndex < watcherCount; watcherIndex++) {
        const watcher = mock<SpacesWatcher>({ id: `watcher-${watcherIndex}`, write: () => true });
        usersByWatcher.set(watcher, new Map<string, SpaceUser>());
    }
    const watchers = [...usersByWatcher.keys()];
    for (let index = 0; index < USER_COUNT; index++) {
        const spaceUserId = `user_${index}`;
        spaceUserIds.push(spaceUserId);
        usersByWatcher
            .get(watchers[index % watcherCount])
            ?.set(spaceUserId, SpaceUser.fromPartial({ spaceUserId, uuid: `uuid-${index}`, name: spaceUserId }));
    }
    return { space, spaceUserIds };
}

describe.each([1, 4])("999 lookups in a space of 1000 users on %i pusher(s)", (watcherCount) => {
    const { space, spaceUserIds } = createSpace(watcherCount);
    // The speaker is user_0; the other 999 are the listeners.
    const listenerIds = spaceUserIds.slice(1);

    bench("getUser", () => {
        for (const spaceUserId of listenerIds) {
            space.getUser(spaceUserId);
        }
    });

    // Built once: the bench is about the lookup, not about building messages.
    const invitations = listenerIds.map((spaceUserId) =>
        PrivateEvent.fromPartial({
            spaceName: "megaphone",
            senderUserId: spaceUserId,
            receiverUserId: spaceUserId,
            spaceEvent: {
                event: {
                    $case: "livekitInvitationMessage",
                    livekitInvitationMessage: { token: "token", serverUrl: "wss://livekit.example" },
                },
            },
        }),
    );

    bench("dispatchPrivateEvent (the invitation burst)", () => {
        for (const invitation of invitations) {
            space.dispatchPrivateEvent(invitation);
        }
    });
});
