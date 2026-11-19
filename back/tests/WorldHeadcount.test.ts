import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterType, SpaceUser } from "@workadventure/messages";
import { mock } from "vitest-mock-extended";
import type { BackToPusherSpaceMessage } from "@workadventure/messages";
import { Space, WORLD_HEADCOUNT_DEBOUNCE_MS } from "../src/Model/Space";
import { DistinctCounter } from "../src/Model/DistinctCounter";
import type { SpacesWatcher } from "../src/Model/SpacesWatcher";
import type { EventProcessor } from "../src/Model/EventProcessor";

const WORLD = "world";
const WORLD_SPACE = `${WORLD}.allWorldUser`;

type StatePatchOperation = { op: string; path: string; value?: unknown };

function createSpace(name = WORLD_SPACE, publishWorldHeadcount = true): Space {
    return new Space(name, FilterType.ALL_USERS, mock<EventProcessor>(), [], WORLD, undefined, publishWorldHeadcount);
}

function createWatcher(): { watcher: SpacesWatcher; statePatches: StatePatchOperation[][] } {
    const statePatches: StatePatchOperation[][] = [];
    const watcher = mock<SpacesWatcher>({
        id: "pusher-1",
        write: (envelope: BackToPusherSpaceMessage) => {
            const message = envelope.message;
            if (message?.$case === "spaceStatePatchMessage") {
                statePatches.push(JSON.parse(message.spaceStatePatchMessage.patch) as StatePatchOperation[]);
            }
            return true;
        },
    });
    return { watcher, statePatches };
}

function user(spaceUserId: string, uuid: string): SpaceUser {
    return SpaceUser.fromPartial({ spaceUserId, uuid });
}

describe("DistinctCounter", () => {
    it("counts a key once however many times it was added", () => {
        const counter = new DistinctCounter();
        counter.add("a");
        counter.add("a");
        counter.add("b");
        expect(counter.size).toBe(2);
    });

    it("forgets a key only when its last reference is removed", () => {
        const counter = new DistinctCounter();
        counter.add("a");
        counter.add("a");
        counter.remove("a");
        expect(counter.size).toBe(1);
        counter.remove("a");
        expect(counter.size).toBe(0);
    });

    it("ignores the removal of a key it never saw", () => {
        const counter = new DistinctCounter();
        counter.remove("ghost");
        counter.add("a");
        expect(counter.size).toBe(1);
    });
});

describe("World space headcount", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("counts two sessions of one uuid as one person", () => {
        const space = createSpace();
        const { watcher, statePatches } = createWatcher();
        space.addWatcher(watcher);

        space.addUser(watcher, user("tab-1", "uuid-erick"));
        space.addUser(watcher, user("tab-2", "uuid-erick"));
        space.addUser(watcher, user("tab-3", "uuid-maria"));
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);

        expect(space.getState().headcount).toBe(2);
        expect(statePatches).toEqual([[{ op: "add", path: "/headcount", value: 2 }]]);
    });

    it("keeps a person counted until their last session leaves", () => {
        const space = createSpace();
        const { watcher } = createWatcher();
        space.addWatcher(watcher);
        space.addUser(watcher, user("tab-1", "uuid-erick"));
        space.addUser(watcher, user("tab-2", "uuid-erick"));
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);
        expect(space.getState().headcount).toBe(1);

        space.removeUser(watcher, "tab-1");
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);
        expect(space.getState().headcount).toBe(1);

        space.removeUser(watcher, "tab-2");
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);
        expect(space.getState().headcount).toBe(0);
    });

    it("counts a user without a uuid by its space user id", () => {
        const space = createSpace();
        const { watcher } = createWatcher();
        space.addWatcher(watcher);

        space.addUser(watcher, user("guest-1", ""));
        space.addUser(watcher, user("guest-2", ""));
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);

        expect(space.getState().headcount).toBe(2);
    });

    it("sends one patch for ten joins inside one second", () => {
        const space = createSpace();
        const { watcher, statePatches } = createWatcher();
        space.addWatcher(watcher);

        for (let i = 0; i < 10; i++) {
            space.addUser(watcher, user(`user-${i}`, `uuid-${i}`));
            vi.advanceTimersByTime(90);
        }
        expect(statePatches).toHaveLength(0);
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);

        expect(statePatches).toEqual([[{ op: "add", path: "/headcount", value: 10 }]]);
    });

    it("sends nothing when the count is back where it was before the window ended", () => {
        const space = createSpace();
        const { watcher, statePatches } = createWatcher();
        space.addWatcher(watcher);

        space.addUser(watcher, user("tab-1", "uuid-erick"));
        space.removeUser(watcher, "tab-1");
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS * 3);

        expect(statePatches).toHaveLength(0);
    });

    it("stops counting the users of a pusher that went away", () => {
        const space = createSpace();
        const { watcher } = createWatcher();
        const other = createWatcher();
        space.addWatcher(watcher);
        space.addWatcher(other.watcher);
        space.addUser(watcher, user("a", "uuid-a"));
        space.addUser(watcher, user("b", "uuid-b"));
        space.addUser(other.watcher, user("c", "uuid-c"));
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);
        expect(space.getState().headcount).toBe(3);

        space.removeWatcher(watcher);
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);

        expect(space.getState().headcount).toBe(1);
    });

    it("counts a user added again under the same space user id once", () => {
        const space = createSpace();
        const { watcher } = createWatcher();
        space.addWatcher(watcher);

        space.addUser(watcher, user("tab-2", "uuid-maria"));
        space.addUser(watcher, user("tab-1", "uuid-erick"));
        space.addUser(watcher, user("tab-1", "uuid-erick"));
        space.removeUser(watcher, "tab-1");
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);

        expect(space.getState().headcount).toBe(1);
    });

    it("follows the users a pusher synced after a reconnect, not the ones it had before", () => {
        const space = createSpace();
        const { watcher } = createWatcher();
        space.addWatcher(watcher);
        space.addUser(watcher, user("a", "uuid-a"));
        space.addUser(watcher, user("b", "uuid-b"));

        space.syncUsersFromPusher(watcher, [user("b", "uuid-b"), user("c", "uuid-c")]);
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);
        expect(space.getState().headcount).toBe(2);

        space.removeUser(watcher, "b");
        space.removeUser(watcher, "c");
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);
        expect(space.getState().headcount).toBe(0);
    });

    it("counts the users synced by a pusher into a back that restarted and never saw them join", () => {
        const space = createSpace();
        const { watcher, statePatches } = createWatcher();
        space.addWatcher(watcher);

        space.syncUsersFromPusher(watcher, [user("a", "uuid-a"), user("b", "uuid-b"), user("b2", "uuid-b")]);
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);

        expect(space.getState().headcount).toBe(2);
        expect(statePatches).toHaveLength(1);
    });

    it("leaves every other space without a headcount", () => {
        const space = createSpace(`${WORLD}.proximity-bubble`);
        const { watcher, statePatches } = createWatcher();
        space.addWatcher(watcher);

        space.addUser(watcher, user("a", "uuid-a"));
        space.addUser(watcher, user("b", "uuid-b"));
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS * 2);

        expect(statePatches).toHaveLength(0);
        expect(space.getState().headcount).toBeUndefined();
    });

    it("publishes nothing while the headcount is turned off, as it is by default", () => {
        const space = createSpace(WORLD_SPACE, false);
        const { watcher, statePatches } = createWatcher();
        space.addWatcher(watcher);

        space.addUser(watcher, user("a", "uuid-a"));
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS * 2);

        expect(statePatches).toHaveLength(0);
        expect(space.getState().headcount).toBeUndefined();
    });

    it("sends nothing once the space is destroyed", () => {
        const space = createSpace();
        const { watcher, statePatches } = createWatcher();
        space.addWatcher(watcher);
        space.addUser(watcher, user("a", "uuid-a"));

        space.destroy();
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS * 2);

        expect(statePatches).toHaveLength(0);
    });
});

/**
 * MEASUREMENT (simulated clock, rerunnable): 1000 users join the world space, one every 60 ms, over 60 s. The
 * numbers are pinned in the assertions below; "before" is what the same run gave before the headcount existed.
 */
describe("World space headcount, 1000 users joining over 60 s", () => {
    const USERS = 1000;
    const RAMP_MS = 60_000;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function simulateRamp(): {
        statePatchesDuringRamp: number;
        statePatchesTotal: number;
        lastHeadcount: number | undefined;
    } {
        const space = createSpace();
        const { watcher, statePatches } = createWatcher();
        space.addWatcher(watcher);

        const stepMs = RAMP_MS / USERS;
        let statePatchesDuringRamp = 0;
        for (let i = 0; i < USERS; i++) {
            space.addUser(watcher, user(`user-${i}`, `uuid-${i}`));
            vi.advanceTimersByTime(stepMs);
        }
        statePatchesDuringRamp = statePatches.length;
        vi.advanceTimersByTime(WORLD_HEADCOUNT_DEBOUNCE_MS);

        return {
            statePatchesDuringRamp,
            statePatchesTotal: statePatches.length,
            lastHeadcount: space.getState().headcount,
        };
    }

    it("sends at most one state patch per second to every watcher: 58 patches in 60 s (0.97/s), 59 with the last one, ending on 1000", () => {
        const result = simulateRamp();

        expect(result.statePatchesDuringRamp / (RAMP_MS / 1000)).toBeLessThanOrEqual(1);
        expect({ ...result, patchesPerSecond: result.statePatchesDuringRamp / (RAMP_MS / 1000) }).toEqual({
            statePatchesDuringRamp: 58,
            statePatchesTotal: 59,
            lastHeadcount: USERS,
            patchesPerSecond: 58 / 60,
        });
    });

    it("would send one patch per join (1000, 16.7/s) without the debounce: the count changes on every join", () => {
        const counter = new DistinctCounter();
        let changes = 0;
        for (let i = 0; i < USERS; i++) {
            const before = counter.size;
            counter.add(`uuid-${i}`);
            if (counter.size !== before) {
                changes++;
            }
        }

        expect(changes).toBe(1000);
        expect(changes / (RAMP_MS / 1000)).toBeCloseTo(16.67, 2);
    });
});
