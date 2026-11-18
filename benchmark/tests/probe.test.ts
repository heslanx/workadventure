import { describe, expect, it } from "vitest";
import {
    PositionMessage_Direction,
    PusherToFrontWebSocketMessage,
    UserJoinedMessage,
} from "../../libs/messages/src/ts-proto-generated/messages";
import { MoveProbe, deliveryRatio, firstObserverIndex } from "../src/probe";
import { decodeServerFrame, viewportAround } from "../src/protocol";

const ROOM = "http://play.test/_/global/maps.test/a.json";
const OTHER_ROOM = "http://play.test/_/global/maps.test/b.json";

/** Period-2 positions keep the matching rule easy to reason about: step 1 and step 3 look the same. */
function positionOf(index: number, step: number) {
    return { x: step % 2, y: index };
}

function probeWithObserver(overrides: { observerAccepted?: boolean; roomUrlOf?: string[] } = {}) {
    const probe = new MoveProbe({
        roomUrlOf: overrides.roomUrlOf ?? [ROOM, ROOM],
        firstObserver: 0,
        observers: 1,
        positionOf,
    });
    probe.registerUser(1, 99);
    probe.setAccepted(1, true);
    probe.setAccepted(0, overrides.observerAccepted ?? true);
    return probe;
}

describe("delivery ratio and observer selection", () => {
    it("divides received by expected and reports null when nothing was expected", () => {
        expect(deliveryRatio(3, 4)).toBe(0.75);
        expect(deliveryRatio(0, 0)).toBeNull();
    });

    it("starts the observers after the planned early leavers while enough sessions remain", () => {
        // Revert to observers starting at index 0 and the first case returns 0, so every observer leaves early.
        expect(firstObserverIndex(1000, 100, 20)).toBe(100);
        expect(firstObserverIndex(30, 25, 20)).toBe(10);
        expect(firstObserverIndex(10, 10, 20)).toBe(0);
    });
});

describe("move probe", () => {
    it("measures latency from the send of the matching step to the arrival", () => {
        const probe = probeWithObserver();
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));
        probe.recordSend(1, 1, positionOf(1, 1), 100);

        probe.recordReceive(0, 99, positionOf(1, 1), 130);

        const summary = probe.summary();
        expect(summary.moveLatencyMs).toEqual({ count: 1, p50: 30, p95: 30, p99: 30 });
        expect(summary.delivery).toEqual({ expected: 1, received: 1, ratio: 1 });
        expect(summary.unmatched).toBe(0);
    });

    it("reports p50, p95 and p99 of the latency samples", () => {
        // Swap any two of the fractions in summary() and one of these three values changes.
        const probe = probeWithObserver();
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));
        for (let step = 1; step <= 100; step++) {
            probe.recordSend(1, step, positionOf(1, step), step * 1000);
            probe.recordReceive(0, 99, positionOf(1, step), step * 1000 + step);
        }

        expect(probe.summary().moveLatencyMs).toEqual({ count: 100, p50: 50, p95: 95, p99: 99 });
    });

    it("matches a repeated position to its most recent send, not its first", () => {
        // Revert the backward walk in findSentAt and this reports 110 ms instead of 10 ms.
        const probe = probeWithObserver();
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));
        probe.recordSend(1, 1, positionOf(1, 1), 100);
        probe.recordSend(1, 2, positionOf(1, 2), 150);
        probe.recordSend(1, 3, positionOf(1, 3), 200);

        probe.recordReceive(0, 99, positionOf(1, 3), 210);

        expect(probe.summary().moveLatencyMs.p50).toBe(10);
    });

    it("counts an expected delivery only when the move falls inside the observer viewport", () => {
        // Revert the insideViewport check in recordSend and the expected count becomes 1 instead of 0.
        const probe = probeWithObserver();
        probe.setViewport(0, { left: 500, top: 500, right: 600, bottom: 600 });
        probe.recordSend(1, 1, positionOf(1, 1), 100);

        expect(probe.summary().delivery).toEqual({ expected: 0, received: 0, ratio: null });
    });

    it("expects nothing from a mover in another room", () => {
        // Remove the same-room condition in recordSend and the expected count becomes 1 instead of 0.
        const probe = probeWithObserver({ roomUrlOf: [ROOM, OTHER_ROOM] });
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));
        probe.recordSend(1, 1, positionOf(1, 1), 100);

        expect(probe.summary().delivery.expected).toBe(0);
    });

    it("does not expect a mover to receive its own move", () => {
        // Remove the observer !== index condition in recordSend and the expected count becomes 2 instead of 1.
        const probe = new MoveProbe({ roomUrlOf: [ROOM, ROOM], firstObserver: 0, observers: 2, positionOf });
        probe.setAccepted(0, true);
        probe.setAccepted(1, true);
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));
        probe.setViewport(1, viewportAround({ x: 1, y: 1 }));
        probe.recordSend(1, 1, positionOf(1, 1), 100);

        expect(probe.summary().delivery.expected).toBe(1);
    });

    it("observes only the configured range of sessions", () => {
        // Revert isObserver and the send loop to start at index 0 and session 0 also expects the move (2 instead of 1).
        const probe = new MoveProbe({ roomUrlOf: [ROOM, ROOM, ROOM], firstObserver: 1, observers: 1, positionOf });
        for (const index of [0, 1, 2]) {
            probe.setAccepted(index, true);
            probe.setViewport(index, viewportAround({ x: 1, y: 2 }));
        }
        probe.recordSend(2, 1, positionOf(2, 1), 100);

        expect(probe.isObserver(0)).toBe(false);
        expect(probe.isObserver(1)).toBe(true);
        expect(probe.summary().observers).toBe(1);
        expect(probe.summary().delivery.expected).toBe(1);
    });

    it("counts an arrival as received only when it matches an expected delivery", () => {
        // Count every matched arrival as received (drop the expectedKeys check) and received becomes 1, ratio null.
        const probe = probeWithObserver();
        probe.setViewport(0, { left: 500, top: 500, right: 600, bottom: 600 });
        probe.recordSend(1, 1, positionOf(1, 1), 100);
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));

        probe.recordReceive(0, 99, positionOf(1, 1), 130);

        const summary = probe.summary();
        expect(summary.delivery).toEqual({ expected: 0, received: 0, ratio: null });
        expect(summary.outsideExpectation).toBe(1);
        expect(summary.moveLatencyMs.count).toBe(0);
    });

    it("counts a repeated arrival of the same move once", () => {
        // Keep the expected key after its first match (has instead of delete) and the ratio becomes 2.
        const probe = probeWithObserver();
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));
        probe.recordSend(1, 1, positionOf(1, 1), 100);

        probe.recordReceive(0, 99, positionOf(1, 1), 130);
        probe.recordReceive(0, 99, positionOf(1, 1), 140);

        const summary = probe.summary();
        expect(summary.delivery).toEqual({ expected: 1, received: 1, ratio: 1 });
        expect(summary.outsideExpectation).toBe(1);
    });

    it("ignores deliveries to an observer that is no longer accepted", () => {
        const probe = probeWithObserver({ observerAccepted: false });
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));
        probe.recordSend(1, 1, positionOf(1, 1), 100);
        probe.recordReceive(0, 99, positionOf(1, 1), 130);

        expect(probe.summary().delivery).toEqual({ expected: 0, received: 0, ratio: null });
        expect(probe.summary().moveLatencyMs.count).toBe(0);
    });

    it("reports an arrival that matches no sent step as unmatched, with no latency sample", () => {
        // Revert the unmatched branch in recordReceive and this records a latency sample instead.
        const probe = probeWithObserver();
        probe.setViewport(0, viewportAround({ x: 500, y: 500 }));
        probe.recordSend(1, 1, positionOf(1, 1), 100);

        probe.recordReceive(0, 99, { x: 500, y: 500 }, 130);

        const summary = probe.summary();
        expect(summary.unmatched).toBe(1);
        expect(summary.delivery.received).toBe(0);
        expect(summary.moveLatencyMs.count).toBe(0);
    });

    it("ignores arrivals from a user id this process never registered", () => {
        const probe = probeWithObserver();
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));
        probe.recordSend(1, 1, positionOf(1, 1), 100);

        probe.recordReceive(0, 12345, positionOf(1, 1), 130);

        expect(probe.summary().delivery.received).toBe(0);
    });
});

describe("move probe window", () => {
    // Moves are sent at 100 ms, 300 ms and 500 ms; the window covers 200..400 ms, so only the one at 300 counts.
    const window = { startMs: 200, endMs: 400 };

    function windowedProbe(lookbackSteps?: number) {
        const probe = new MoveProbe({
            roomUrlOf: [ROOM, ROOM],
            firstObserver: 0,
            observers: 1,
            positionOf,
            lookbackSteps,
            window,
        });
        probe.registerUser(1, 99);
        probe.setAccepted(1, true);
        probe.setAccepted(0, true);
        probe.setViewport(0, viewportAround({ x: 1, y: 1 }));
        return probe;
    }

    it("expects and counts only the moves sent inside the window", () => {
        // Remove the in-window check in recordSend and all three moves are expected.
        const probe = windowedProbe();
        probe.recordSend(1, 1, { x: 1, y: 1 }, 100);
        probe.recordSend(1, 2, { x: 0, y: 1 }, 300);
        probe.recordSend(1, 3, { x: 1, y: 1 }, 500);

        probe.recordReceive(0, 99, { x: 0, y: 1 }, 330);

        expect(probe.summary().delivery).toEqual({ expected: 1, received: 1, ratio: 1 });
        expect(probe.summary().moveLatencyMs.count).toBe(1);
    });

    it("does not call a late arrival of a move sent before the window unexpected", () => {
        // The move at 100 ms arrives at 250 ms, inside the window: it was never expected, but it is not stray either.
        const probe = windowedProbe();
        probe.recordSend(1, 1, { x: 1, y: 1 }, 100);

        probe.recordReceive(0, 99, { x: 1, y: 1 }, 250);

        const summary = probe.summary();
        expect(summary.outsideExpectation).toBe(0);
        expect(summary.delivery).toEqual({ expected: 0, received: 0, ratio: null });
    });

    it("still counts a stray arrival inside the window, and ignores one outside it", () => {
        const probe = windowedProbe();
        probe.recordSend(1, 1, { x: 1, y: 1 }, 300);
        probe.recordReceive(0, 99, { x: 1, y: 1 }, 320);

        probe.recordReceive(0, 99, { x: 1, y: 1 }, 350);
        probe.recordReceive(0, 99, { x: 1, y: 1 }, 600);
        probe.recordReceive(0, 99, { x: 9, y: 9 }, 380);
        probe.recordReceive(0, 99, { x: 9, y: 9 }, 700);

        // The repeat at 350 and the unknown point at 380 are inside the window; the ones at 600 and 700 are not.
        expect(probe.summary()).toMatchObject({ outsideExpectation: 1, unmatched: 1 });
    });

    it.each([
        [2, "unmatched"],
        [4, "matched"],
    ])("with a look-back of %i steps, an arrival of a move five sends old is %s", (lookbackSteps, outcome) => {
        // A pattern with a short period passes its own look-back; the probe must not search further back than that.
        const probe = new MoveProbe({
            roomUrlOf: [ROOM, ROOM],
            firstObserver: 0,
            observers: 1,
            positionOf: (index, step) => ({ x: step, y: index }),
            lookbackSteps,
        });
        probe.registerUser(1, 99);
        probe.setAccepted(1, true);
        probe.setAccepted(0, true);
        probe.setViewport(0, { left: 0, top: 0, right: 100, bottom: 100 });
        for (let step = 1; step <= 5; step++) {
            probe.recordSend(1, step, { x: step, y: 1 }, step * 100);
        }

        probe.recordReceive(0, 99, { x: 1, y: 1 }, 700);

        const summary = probe.summary();
        expect(summary.unmatched).toBe(outcome === "unmatched" ? 1 : 0);
        expect(summary.delivery.received).toBe(outcome === "matched" ? 1 : 0);
    });
});

describe("move extraction in decodeServerFrame", () => {
    const position = { x: 3, y: 4, direction: PositionMessage_Direction.DOWN, moving: true };

    function batchFrame() {
        return PusherToFrontWebSocketMessage.encode({
            nonce: 2,
            message: {
                message: {
                    $case: "batchMessage",
                    batchMessage: {
                        event: "",
                        payload: [
                            { message: { $case: "userMovedMessage", userMovedMessage: { userId: 5, position } } },
                            {
                                message: {
                                    $case: "userJoinedMessage",
                                    userJoinedMessage: UserJoinedMessage.fromPartial({
                                        userId: 6,
                                        position: { ...position, x: 7, y: 8 },
                                    }),
                                },
                            },
                            { message: { $case: "pingMessage", pingMessage: {} } },
                        ],
                    },
                },
            },
        }).finish();
    }

    it("reads the positions of moves and zone entries inside a batch when asked to", () => {
        // Remove either branch that pushes userMovedMessage or userJoinedMessage and its entry is missing.
        const decoded = decodeServerFrame(batchFrame(), true);

        expect(decoded.moves).toEqual([
            { userId: 5, x: 3, y: 4 },
            { userId: 6, x: 7, y: 8 },
        ]);
        expect(decoded.signals).toEqual([{ kind: "ping" }]);
    });

    it("collects no moves for a session that does not observe", () => {
        // Drop the collectMoves condition and this lists both moves.
        expect(decodeServerFrame(batchFrame()).moves).toEqual([]);
    });
});
