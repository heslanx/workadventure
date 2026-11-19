import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "prom-client";
import { UserMovesMessage } from "@workadventure/messages";
import type { GameRoom } from "../src/Model/GameRoom";
import type { User } from "../src/Model/User";

const { cpuTrackerMock } = vi.hoisted(() => ({ cpuTrackerMock: { isOverHeating: vi.fn() } }));
vi.mock("../src/Services/CpuTracker", () => ({ cpuTracker: cpuTrackerMock }));

import { socketManager } from "../src/Services/SocketManager";

const METRIC = "workadventure_moves_shed_total";

/** Reads the counter the way a Prometheus scrape of the back does (text exposition format). */
async function scrapedShedCount(): Promise<number> {
    const line = (await register.metrics()).split("\n").find((l) => l.startsWith(`${METRIC} `));
    return line === undefined ? 0 : Number(line.split(" ")[1]);
}

function movesMessage(moving: boolean): UserMovesMessage {
    return UserMovesMessage.fromPartial({
        position: { x: 10, y: 20, direction: 0, moving },
        viewport: { top: 0, left: 0, bottom: 100, right: 100 },
    });
}

function sendMoves(count: number, moving: boolean): { updatePosition: ReturnType<typeof vi.fn> } {
    const room = { updatePosition: vi.fn() };
    for (let i = 0; i < count; i++) {
        socketManager.handleUserMovesMessage(room as unknown as GameRoom, {} as User, movesMessage(moving));
    }
    return room;
}

describe("moves shed counter on the back scrape", () => {
    afterEach(() => {
        cpuTrackerMock.isOverHeating.mockReset();
    });

    it("counts every moving update dropped while the CPU is overheating", async () => {
        const N = 50;
        cpuTrackerMock.isOverHeating.mockReturnValue(true);
        const before = await scrapedShedCount();

        const room = sendMoves(N, true);

        // Measured by this test: N moves shed -> the scrape reports N more than before.
        expect(await scrapedShedCount(), `shed ${N} moves, counter went from ${before}`).toBe(before + N);
        expect(room.updatePosition).not.toHaveBeenCalled();
    });

    it("does not count the final (not moving) position, which is still dispatched", async () => {
        cpuTrackerMock.isOverHeating.mockReturnValue(true);
        const before = await scrapedShedCount();

        const room = sendMoves(5, false);

        expect(await scrapedShedCount()).toBe(before);
        expect(room.updatePosition).toHaveBeenCalledTimes(5);
    });

    it("does not count moves while the CPU is healthy", async () => {
        cpuTrackerMock.isOverHeating.mockReturnValue(false);
        const before = await scrapedShedCount();

        const room = sendMoves(5, true);

        expect(await scrapedShedCount()).toBe(before);
        expect(room.updatePosition).toHaveBeenCalledTimes(5);
    });
});
