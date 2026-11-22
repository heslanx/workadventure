import { describe, expect, it } from "vitest";
import { createGpuFrameTimer } from "../../../src/front/Utils/GpuFrameTimer";
import { createFakeTimerGl } from "./fakeTimerGl";

const MS = 1_000_000;

/** One rendered frame as the recorder drives it: poll at PRE_STEP, begin at POST_STEP, end at POST_RENDER. */
function renderFrame(timer: { poll(): void; begin(): void; end(): void }): void {
    timer.poll();
    timer.begin();
    timer.end();
}

describe("createGpuFrameTimer", () => {
    describe("availability", () => {
        it("says there is no context, rather than throwing, when the renderer has none", () => {
            expect(createGpuFrameTimer(undefined, 10)).toEqual({ unavailable: "no-webgl-context" });
            expect(createGpuFrameTimer(null, 10)).toEqual({ unavailable: "no-webgl-context" });
        });

        it("says the extension is missing when the context offers neither timer extension", () => {
            const { gl } = createFakeTimerGl({ flavor: "none" });

            // Reverting the unavailable return makes it read a null extension and throw
            expect(createGpuFrameTimer(gl, 10)).toEqual({ unavailable: "extension-missing" });
        });

        it("is unavailable when the context hands out null queries", () => {
            const { gl } = createFakeTimerGl({ flavor: "webgl2", nullQueries: true });

            // Without the null guard the pool holds nulls and beginQuery(null) throws on the first frame
            expect(createGpuFrameTimer(gl, 10)).toEqual({ unavailable: "query-creation-failed" });
        });

        it.each(["webgl2", "webgl1"] as const)(
            "deletes the queries it had created when a %s context is lost half way through the pool",
            (flavor) => {
                const fake = createFakeTimerGl({ flavor, nullQueryAfter: 3 });

                expect(createGpuFrameTimer(fake.gl, 10)).toEqual({ unavailable: "query-creation-failed" });

                // Three real queries were created before the null one. Removing the cleanup loop leaves all three alive.
                expect(fake.queries).toHaveLength(3);
                expect(fake.liveQueries()).toBe(0);
            },
        );
    });

    describe.each(["webgl2", "webgl1"] as const)("on a %s context", (flavor) => {
        const method = flavor === "webgl2" ? "EXT_disjoint_timer_query_webgl2" : "EXT_disjoint_timer_query";

        it("reports the method and GPU time in milliseconds of each frame, and deletes every query at finish", () => {
            const fake = createFakeTimerGl({ flavor, elapsedNs: [4 * MS, 8 * MS, 12 * MS] });
            const { timer } = createGpuFrameTimer(fake.gl, 10);

            for (let i = 0; i < 3; i++) renderFrame(timer!);
            const result = timer!.finish();

            // The WebGL1 variant fails here if the *EXT entry points are replaced by the WebGL2 ones: it has none
            expect(timer!.method).toBe(method);
            expect(Array.from(result.samples)).toEqual([4, 8, 12]);
            expect(result.dropped).toBe(0);
            expect(fake.liveQueries()).toBe(0);
        });
    });

    describe("asynchronous results", () => {
        it("keeps a frame whose result is not ready yet pending and collects it on a later poll, oldest first", () => {
            const fake = createFakeTimerGl({ flavor: "webgl2", elapsedNs: [5 * MS, 6 * MS], autoReady: false });
            const { timer } = createGpuFrameTimer(fake.gl, 10);

            renderFrame(timer!);
            renderFrame(timer!);
            timer!.poll();
            fake.finishOldest(1);
            timer!.poll();
            fake.finishAll();
            timer!.poll();
            const result = timer!.finish();

            // Reading the result without checking availability throws in the fake, as it would stall a real GPU
            expect(Array.from(result.samples)).toEqual([5, 6]);
            expect(result.dropped).toBe(0);
        });

        it("drops a query still unresolved at finish and counts it instead of waiting", () => {
            const fake = createFakeTimerGl({ flavor: "webgl2", elapsedNs: [5 * MS, 6 * MS], autoReady: false });
            const { timer } = createGpuFrameTimer(fake.gl, 10);

            renderFrame(timer!);
            renderFrame(timer!);
            fake.finishOldest(1);
            const result = timer!.finish();

            // Pushing the unresolved query's time anyway reads it unready and throws; skipping the count gives 0
            expect(Array.from(result.samples)).toEqual([5]);
            expect(result.dropped).toBe(1);
            expect(fake.liveQueries()).toBe(0);
        });

        it("skips a frame when all eight queries are in flight, counts it, and recovers once results arrive", () => {
            const fake = createFakeTimerGl({
                flavor: "webgl2",
                elapsedNs: new Array(20).fill(3 * MS),
                autoReady: false,
            });
            const { timer } = createGpuFrameTimer(fake.gl, 100);

            for (let i = 0; i < 9; i++) renderFrame(timer!);
            fake.finishAll();
            renderFrame(timer!);
            const result = timer!.finish();

            // Without the skip, begin() reuses an open query or exceeds the pool: the fake throws or live > 8
            expect(result.dropped).toBe(1 + 1);
            expect(result.samples).toHaveLength(8);
            expect(fake.queries.length).toBe(8);
        });
    });

    describe("disjoint events", () => {
        it("drops every query in flight when the flag is set, although reading it clears it", () => {
            const fake = createFakeTimerGl({
                flavor: "webgl2",
                elapsedNs: [50 * MS, 60 * MS, 70 * MS, 7 * MS],
                autoReady: false,
            });
            const { timer } = createGpuFrameTimer(fake.gl, 10);

            renderFrame(timer!);
            renderFrame(timer!);
            renderFrame(timer!);
            fake.finishAll();
            fake.raiseDisjoint();
            timer!.poll();
            renderFrame(timer!);
            fake.finishAll();
            const result = timer!.finish();

            // Reading the flag once per query keeps [60, 70]: only the first of the three is dropped
            expect(Array.from(result.samples)).toEqual([7]);
            expect(result.dropped).toBe(3);
        });

        it("clears a flag left over from before the recording instead of dropping its first frame", () => {
            const fake = createFakeTimerGl({ flavor: "webgl2", elapsedNs: [9 * MS] });
            fake.raiseDisjoint();
            const { timer } = createGpuFrameTimer(fake.gl, 10);

            renderFrame(timer!);
            const result = timer!.finish();

            // Without the read at creation the stale flag drops this good frame
            expect(Array.from(result.samples)).toEqual([9]);
            expect(result.dropped).toBe(0);
        });

        it("reads the flag only when a result is available, not on every poll", () => {
            const fake = createFakeTimerGl({ flavor: "webgl2", elapsedNs: [1 * MS], autoReady: false });
            const { timer } = createGpuFrameTimer(fake.gl, 10);
            const readsAtCreation = fake.disjointReads();

            renderFrame(timer!);
            timer!.poll();
            timer!.poll();

            expect(fake.disjointReads()).toBe(readsAtCreation);
        });
    });

    describe("bad results", () => {
        it("counts a failed read as dropped, never as a 0 ms frame", () => {
            const fake = createFakeTimerGl({ flavor: "webgl2", elapsedNs: [null, 8 * MS] });
            const { timer } = createGpuFrameTimer(fake.gl, 10);

            renderFrame(timer!);
            renderFrame(timer!);
            const result = timer!.finish();

            // Number(null) is 0, which keeps [0, 8] and pulls the average down
            expect(Array.from(result.samples)).toEqual([8]);
            expect(result.dropped).toBe(1);
        });

        it("counts a result the sample buffer has no room for as dropped", () => {
            const fake = createFakeTimerGl({ flavor: "webgl2", elapsedNs: [1 * MS, 2 * MS, 3 * MS] });
            const { timer } = createGpuFrameTimer(fake.gl, 2);

            for (let i = 0; i < 3; i++) renderFrame(timer!);
            const result = timer!.finish();

            expect(Array.from(result.samples)).toEqual([1, 2]);
            expect(result.dropped).toBe(1);
        });
    });

    describe("frames that do not render", () => {
        it("discards the open query of a frame that stepped but did not render, so that the next sample spans one frame", () => {
            const fake = createFakeTimerGl({ flavor: "webgl2", elapsedNs: [99 * MS, 5 * MS] });
            const { timer } = createGpuFrameTimer(fake.gl, 10);

            // Frame 1: POST_STEP only. Frame 2: renders.
            timer!.poll();
            timer!.begin();
            timer!.poll();
            timer!.begin();
            timer!.end();
            const result = timer!.finish();

            // Without the discard the second begin() is a nested beginQuery, an INVALID_OPERATION in the fake
            expect(Array.from(result.samples)).toEqual([5]);
            expect(result.dropped).toBe(0);
            expect(fake.hasOpenQuery()).toBe(false);
            expect(fake.liveQueries()).toBe(0);
        });

        it("ends and deletes the open query when the recording stops between POST_STEP and POST_RENDER", () => {
            const fake = createFakeTimerGl({ flavor: "webgl2", elapsedNs: [4 * MS] });
            const { timer } = createGpuFrameTimer(fake.gl, 10);

            timer!.begin();
            const result = timer!.finish();

            expect(fake.hasOpenQuery()).toBe(false);
            expect(fake.liveQueries()).toBe(0);
            expect(result.samples).toHaveLength(0);
        });
    });
});
