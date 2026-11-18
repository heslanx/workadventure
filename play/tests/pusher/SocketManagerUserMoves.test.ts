import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "prom-client";
import { PositionMessage_Direction, UserMovesMessage } from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { SocketManager } from "../../src/pusher/services/SocketManager";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";

const VIEWPORT = { left: 0, top: 0, right: 319, bottom: 319 };
const DROPPED_MOVES_METRIC = "workadventure_counter_dropped_moves";

function userMoves(x: number, moving: boolean, viewport = VIEWPORT): UserMovesMessage {
    return UserMovesMessage.fromPartial({
        position: { x, y: 100, direction: PositionMessage_Direction.RIGHT, moving },
        viewport,
    });
}

async function droppedMovesCount(): Promise<number> {
    const metric = await register.getSingleMetric(DROPPED_MOVES_METRIC)?.get();
    return metric?.values[0]?.value ?? 0;
}

/**
 * A client that sends more moves than it needs to makes the pusher, the back and every watcher pay for each one, so
 * the pusher forwards a socket's moves to the back at a bounded rate. The bound never costs the last word: a stop
 * goes through whatever the rate, or the avatar would walk on in the other clients' view.
 */
describe("SocketManager user moves rate", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function setup() {
        const manager = new SocketManager();
        const applyViewport = vi.spyOn(manager, "handleViewport").mockImplementation(() => undefined);
        // Every socket made here belongs to the same manager, as the sockets of one pusher do.
        const addSocket = () => {
            const socketWrite = vi.fn();
            const newSocket = {
                getUserData: () => ({ backConnection: { write: socketWrite } }),
            } as unknown as PusherWebSocket;
            return { socket: newSocket, write: socketWrite };
        };
        const { socket, write } = addSocket();
        const forwardedPositions = () =>
            write.mock.calls.map(([message]) => message.message.userMovesMessage.position.x as number);
        // One message every 1000/rate ms, the first at the current instant.
        const sendForSeconds = (seconds: number, ratePerSecond: number, moving = true) => {
            const startMs = Date.now();
            const count = seconds * ratePerSecond;
            for (let i = 0; i < count; i++) {
                vi.setSystemTime(startMs + Math.round((i * 1000) / ratePerSecond));
                manager.handleUserMovesMessage(socket, userMoves(i, moving));
            }
        };
        return { manager, socket, write, addSocket, applyViewport, forwardedPositions, sendForSeconds };
    }

    // Measurement, rerun with:
    //   npm test -- --run tests/pusher/SocketManagerUserMoves.test.ts -t "moves forwarded per second"
    // Before the rate limit every one of the 60 messages a second was forwarded (60.0 per second).
    it("moves forwarded per second: a client sending 60 a second gets about 10 a second to the back", () => {
        const { write, sendForSeconds } = setup();
        const sentPerSecond = 60;
        const seconds = 10;

        sendForSeconds(seconds, sentPerSecond);

        const forwardedPerSecond = write.mock.calls.length / seconds;
        console.info(
            `[move rate] sent ${sentPerSecond}/s for ${seconds} s, forwarded to the back ${forwardedPerSecond.toFixed(1)}/s`,
        );
        expect(forwardedPerSecond).toBeGreaterThanOrEqual(9.5);
        expect(forwardedPerSecond).toBeLessThanOrEqual(11);
    });

    it("forwards every move of a client that stays under the rate", () => {
        const { write, sendForSeconds } = setup();

        sendForSeconds(10, 5);

        expect(write).toHaveBeenCalledTimes(50);
    });

    it("forwards a stop after the bucket ran dry, behind the last move that went through", () => {
        const { manager, socket, forwardedPositions, sendForSeconds } = setup();
        sendForSeconds(1, 60);
        const positionsBeforeStop = forwardedPositions();

        manager.handleUserMovesMessage(socket, userMoves(999, false));

        expect(forwardedPositions()).toEqual([...positionsBeforeStop, 999]);
    });

    it("forwards every stop of a client that sends nothing else, however fast", () => {
        const { write, sendForSeconds } = setup();

        sendForSeconds(1, 60, false);

        expect(write).toHaveBeenCalledTimes(60);
    });

    it("limits each socket on its own, so a busy socket does not starve another one of the same manager", () => {
        const { manager, write, addSocket, sendForSeconds } = setup();
        const quiet = addSocket();
        sendForSeconds(1, 60);
        expect(write.mock.calls.length).toBeLessThan(60);

        manager.handleUserMovesMessage(quiet.socket, userMoves(1, true));

        expect(quiet.write).toHaveBeenCalledTimes(1);
    });

    it("forwards moves again once the client has been quiet for a second", () => {
        const { manager, socket, write, sendForSeconds } = setup();
        sendForSeconds(1, 60);
        const forwardedBefore = write.mock.calls.length;

        vi.advanceTimersByTime(1000);
        manager.handleUserMovesMessage(socket, userMoves(1, true));
        manager.handleUserMovesMessage(socket, userMoves(2, true));

        expect(write).toHaveBeenCalledTimes(forwardedBefore + 2);
    });

    it("still applies the viewport of a move it does not forward", () => {
        const { manager, socket, write, applyViewport, sendForSeconds } = setup();
        sendForSeconds(1, 60);
        const forwardedBefore = write.mock.calls.length;
        const scrolled = { left: 320, top: 0, right: 639, bottom: 319 };

        manager.handleUserMovesMessage(socket, userMoves(999, true, scrolled));

        expect(write).toHaveBeenCalledTimes(forwardedBefore);
        expect(applyViewport).toHaveBeenLastCalledWith(socket, scrolled);
    });

    it("counts the moves it does not forward, and none that it forwards", async () => {
        const { sendForSeconds, write } = setup();
        const droppedBefore = await droppedMovesCount();

        sendForSeconds(1, 60);

        const dropped = (await droppedMovesCount()) - droppedBefore;
        expect(dropped).toBe(60 - write.mock.calls.length);
        expect(dropped).toBeGreaterThan(0);
    });
});
