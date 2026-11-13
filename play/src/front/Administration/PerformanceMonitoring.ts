export function startRoomConnectionMonitoring(retryAttempt: number): (outcome: "connected" | "error") => void {
    const started = performance.now();
    let completed = false;
    return (outcome) => {
        if (completed) return;
        completed = true;
        try {
            window.posthog?.capture("wa_room_connection", {
                outcome,
                duration_ms: Math.round(performance.now() - started),
                retry_bucket: retryAttempt === 0 ? "first" : retryAttempt < 4 ? "retry" : "repeated_retry",
            });
        } catch {
            // Analytics must not turn a successful connection into a rejected promise.
        }
    };
}

/** Sample Phaser's existing FPS counter; never add another animation loop. */
export function startPerformanceMonitoring(readFps: () => number): () => void {
    const samples: number[] = [];
    const timer = setInterval(() => {
        if (document.visibilityState !== "visible" || !window.posthog) {
            samples.length = 0;
            return;
        }
        const fps = readFps();
        if (!Number.isFinite(fps) || fps <= 0) {
            samples.length = 0;
            return;
        }
        samples.push(fps);
        if (samples.length < 30) return;
        samples.sort((a, b) => a - b);
        try {
            window.posthog.capture("wa_game_performance", {
                fps_p10: Math.round(samples[2]),
                fps_p50: Math.round(samples[14]),
                samples: samples.length,
                window_seconds: 30,
            });
        } catch {
            // An analytics failure must not interrupt the game.
        }
        samples.length = 0;
    }, 1000);
    return () => clearInterval(timer);
}
