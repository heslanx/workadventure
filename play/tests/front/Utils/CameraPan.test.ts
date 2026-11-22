import { describe, expect, it } from "vitest";
import { createCameraPanner } from "../../../src/front/Utils/CameraPan";

const UPDATE = "update";

function setup() {
    const listeners = new Set<(time: number) => void>();
    const moves: [number, number][] = [];
    const log: string[] = [];
    const panner = createCameraPanner(
        {
            startManualPan: () => {
                log.push("startManualPan");
            },
            panBy: (x, y) => {
                moves.push([x, y]);
            },
            resumePlayerFollow: () => {
                log.push("resumePlayerFollow");
            },
        },
        {
            on: (event, listener) => {
                expect(event).toBe(UPDATE);
                listeners.add(listener);
            },
            off: (_event, listener) => {
                listeners.delete(listener);
            },
        },
        UPDATE,
    );
    const update = (time: number) => [...listeners].forEach((listener) => listener(time));
    const total = () => moves.reduce<[number, number]>((sum, [x, y]) => [sum[0] + x, sum[1] + y], [0, 0]);
    return { panner, listeners, moves, log, update, total };
}

describe("camera pan", () => {
    it("moves the view by exactly (dx, dy), in equal parts of the elapsed time, then resolves true and detaches", async () => {
        const { panner, listeners, update, total, moves } = setup();

        const done = panner.pan(200, -100, 1000);
        update(5000);
        update(5500);
        const halfway = total();
        update(6000);

        expect(halfway).toEqual([100, -50]);
        expect(total()).toEqual([200, -100]);
        await expect(done).resolves.toBe(true);
        expect(listeners.size).toBe(0);
        // The first frame only starts the clock: nothing moved at progress 0
        expect(moves).toHaveLength(2);
    });

    it("does not move past the target when a frame comes late", async () => {
        const { panner, update, total } = setup();

        const done = panner.pan(90, 0, 100);
        update(0);
        update(5000);

        await done;
        expect(total()).toEqual([90, 0]);
    });

    it("takes the view off the player first, as a drag does", async () => {
        const { panner, log } = setup();

        const done = panner.pan(1, 1, 100);
        expect(log).toEqual(["startManualPan"]);
        panner.release();
        await expect(done).resolves.toBe(false);
    });

    it("moves at once for a duration of 0 and attaches nothing", async () => {
        const { panner, listeners, total } = setup();

        await expect(panner.pan(7, 9, 0)).resolves.toBe(true);

        expect(total()).toEqual([7, 9]);
        expect(listeners.size).toBe(0);
    });

    it("lets a new pan replace the one running, which resolves false and leaves one listener", async () => {
        const { panner, listeners, update, total } = setup();

        const first = panner.pan(100, 0, 1000);
        update(0);
        update(500);
        const second = panner.pan(0, 40, 1000);

        await expect(first).resolves.toBe(false);
        expect(listeners.size).toBe(1);
        update(10_000);
        update(11_000);
        await expect(second).resolves.toBe(true);
        expect(total()).toEqual([50, 40]);
    });

    it("releases the view: stops a pan in progress and gives the camera back to the player", async () => {
        const { panner, listeners, log } = setup();
        const done = panner.pan(100, 0, 1000);

        panner.release();

        await expect(done).resolves.toBe(false);
        expect(listeners.size).toBe(0);
        expect(log).toEqual(["startManualPan", "resumePlayerFollow"]);
    });

    it.each([
        [Number.NaN, 0, 100],
        [0, Number.POSITIVE_INFINITY, 100],
        [0, 0, -1],
    ])("refuses pan(%s, %s, %s)", (dx, dy, ms) => {
        expect(() => setup().panner.pan(dx, dy, ms)).toThrow("finite numbers");
    });
});
