import { afterEach, describe, expect, it, vi } from "vitest";
import {
    startPerformanceMonitoring,
    startRoomConnectionMonitoring,
} from "../../../src/front/Administration/PerformanceMonitoring";

describe("performance telemetry", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        delete window.posthog;
    });

    it("emits one bounded connection outcome and never interrupts connection handling", () => {
        const capture = vi.fn();
        window.posthog = { capture } as never;
        vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(350);
        const report = startRoomConnectionMonitoring(7);
        report("connected");
        report("error");
        expect(capture).toHaveBeenCalledExactlyOnceWith("wa_room_connection", {
            outcome: "connected",
            duration_ms: 250,
            retry_bucket: "repeated_retry",
        });
        capture.mockImplementation(() => {
            throw new Error("SDK failed");
        });
        expect(() => startRoomConnectionMonitoring(0)("error")).not.toThrow();
    });

    it("reports percentiles and stops sampling after disposal", () => {
        vi.useFakeTimers();
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
        const capture = vi.fn();
        window.posthog = { capture } as never;
        let sample = 0;
        const stop = startPerformanceMonitoring(() => ++sample);
        vi.advanceTimersByTime(30_000);
        expect(capture).toHaveBeenCalledExactlyOnceWith("wa_game_performance", {
            fps_p10: 3,
            fps_p50: 15,
            samples: 30,
            window_seconds: 30,
        });
        stop();
        vi.advanceTimersByTime(60_000);
        expect(capture).toHaveBeenCalledTimes(1);
    });

    it("does not report background-tab throttling as game slowness", () => {
        vi.useFakeTimers();
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        const capture = vi.fn();
        window.posthog = { capture } as never;
        const stop = startPerformanceMonitoring(() => 1);
        vi.advanceTimersByTime(60_000);
        stop();
        expect(capture).not.toHaveBeenCalled();
    });
});
