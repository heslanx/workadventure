/**
 * A timed pan of the game camera for a measurement, through the camera manager's own manual pan (the one a drag uses),
 * moved a little each frame from the scene's UPDATE event: no timer, and the listener is gone when the pan ends.
 */

/** The part of CameraManager the pan uses. */
export interface PannableCamera {
    startManualPan(): void;
    /** Moves the view by screen pixels, as a drag does. */
    panBy(screenX: number, screenY: number): void;
    resumePlayerFollow(): void;
}

/** The part of the scene's event emitter the pan uses. The UPDATE event passes the game time in ms first. */
export interface PanEvents {
    on(event: string, listener: (time: number) => void): unknown;
    off(event: string, listener: (time: number) => void): unknown;
}

export function createCameraPanner(camera: PannableCamera, events: PanEvents, updateEvent: string) {
    let running: { cancel(): void } | undefined;

    const cancel = () => {
        running?.cancel();
        running = undefined;
    };

    return {
        /**
         * Moves the view by (dx, dy) screen pixels over `ms` of game time, in equal parts of the elapsed time. Resolves
         * true when the pan completed and false when another pan or release() replaced it. A new pan replaces the one
         * running. Takes the view off the player: release() gives it back.
         */
        pan(dx: number, dy: number, ms: number): Promise<boolean> {
            if (![dx, dy, ms].every(Number.isFinite) || ms < 0) {
                throw new Error("panCamera(dx, dy, ms) needs finite numbers and a duration of 0 or more.");
            }
            cancel();
            camera.startManualPan();
            if (ms === 0) {
                camera.panBy(dx, dy);
                return Promise.resolve(true);
            }
            return new Promise<boolean>((resolve) => {
                let startedAt: number | undefined;
                let doneX = 0;
                let doneY = 0;
                const finish = (completed: boolean) => {
                    events.off(updateEvent, onUpdate);
                    if (running === handle) {
                        running = undefined;
                    }
                    resolve(completed);
                };
                const onUpdate = (time: number) => {
                    startedAt ??= time;
                    const progress = Math.min(1, (time - startedAt) / ms);
                    const targetX = dx * progress;
                    const targetY = dy * progress;
                    if (targetX !== doneX || targetY !== doneY) {
                        camera.panBy(targetX - doneX, targetY - doneY);
                        doneX = targetX;
                        doneY = targetY;
                    }
                    if (progress >= 1) {
                        finish(true);
                    }
                };
                const handle = { cancel: () => finish(false) };
                running = handle;
                events.on(updateEvent, onUpdate);
            });
        },
        /** Stops a pan in progress and gives the view back to the player. */
        release(): void {
            cancel();
            camera.resumePlayerFollow();
        },
    };
}
