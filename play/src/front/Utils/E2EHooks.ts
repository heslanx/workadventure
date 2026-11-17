import * as Phaser from "phaser";
import { get } from "svelte/store";
import type { ForceFirstPeerUnilateralDestroyResult } from "../Space/SpacePeerManager/SpacePeerManager";
import { gameManager } from "../Phaser/Game/GameManager";
import { backgroundProcessedLocalVideoTrackStore, rawLocalVideoTrackStore } from "../Stores/MediaStore";

import Camera = Phaser.Cameras.Scene2D.Camera;

let webRtcConnectionsCount = 0;
let livekitConnectionsCount = 0;

type StatsSource = { getRTCStatsReport(): Promise<RTCStatsReport | undefined> };

/** What a LiveKit room of this page shows E2E tests: the camera it publishes and the cameras it receives. */
export interface E2ELivekitRoom {
    getE2EVideoTracks(): { sent: StatsSource | undefined; received: { from: string; track: StatsSource }[] };
}

const livekitRooms = new Set<E2ELivekitRoom>();

/** A video stream as the browser reports it, measured over one second. */
export interface E2EVideoStream {
    // Whose camera it is, for a stream we receive
    from?: string;
    // Simulcast layer ("q", "h", "f"), for a stream we send
    rid?: string;
    mimeType?: string;
    width: number;
    height: number;
    fps: number;
    kbps: number;
}

interface Coordinates {
    x: number;
    y: number;
}

interface E2ECoordinateOptions {
    timeoutMs?: number;
    retryIntervalMs?: number;
    tolerance?: number;
}

interface CameraEffectWithIsRunning {
    isRunning?: boolean;
}

const DEFAULT_COORDINATE_STABILITY_TIMEOUT_MS = 10_000;
const DEFAULT_COORDINATE_STABILITY_RETRY_INTERVAL_MS = 500;
const DEFAULT_COORDINATE_STABILITY_TOLERANCE = 1;

function wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, delayMs);
    });
}

function waitForNextFrame(): Promise<void> {
    return new Promise((resolve) => {
        gameManager.getCurrentGameScene().events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
            resolve();
        });
    });
}

function isEffectRunning(effect: CameraEffectWithIsRunning | undefined): boolean {
    return effect?.isRunning === true;
}

function hasRunningCameraEffect(camera: Camera): boolean {
    return (
        isEffectRunning(camera.fadeEffect) ||
        isEffectRunning(camera.flashEffect) ||
        isEffectRunning(camera.panEffect) ||
        isEffectRunning(camera.rotateToEffect) ||
        isEffectRunning(camera.shakeEffect) ||
        isEffectRunning(camera.zoomEffect)
    );
}

function currentCameraHasRunningEffect(): boolean {
    return hasRunningCameraEffect(gameManager.getCurrentGameScene().getCameraManager().getCamera());
}

function getGameCanvas(): HTMLCanvasElement {
    const canvas = document.querySelector<HTMLCanvasElement>("#game canvas");

    if (!canvas) {
        throw new Error('Unable to convert game coordinates: "#game canvas" was not found.');
    }

    return canvas;
}

function getGameToBrowserCoordinatesSnapshot(gameCoordinates: Coordinates): Coordinates {
    const scene = gameManager.getCurrentGameScene();
    const camera = scene.getCameraManager().getCamera();

    // camera.preRender() must be called before accessing worldView or camera matrices to ensure they are up to date.
    // See the same pattern in GameScene.connect().
    camera.preRender();

    const canvas = getGameCanvas();
    const canvasRect = canvas.getBoundingClientRect();
    const canvasInternalWidth = canvas.width || camera.width;
    const canvasInternalHeight = canvas.height || camera.height;
    const scaleX = canvasRect.width / canvasInternalWidth;
    const scaleY = canvasRect.height / canvasInternalHeight;
    const canvasPoint = camera.matrixCombined.transformPoint(gameCoordinates.x, gameCoordinates.y, { x: 0, y: 0 });
    const x = canvasRect.left + canvasPoint.x * scaleX;
    const y = canvasRect.top + canvasPoint.y * scaleY;
    const roundTrip = camera.getWorldPoint(canvasPoint.x, canvasPoint.y);

    if (!areCoordinatesClose(gameCoordinates, roundTrip, DEFAULT_COORDINATE_STABILITY_TOLERANCE)) {
        throw new Error(
            "Unable to convert game coordinates: camera coordinate round trip did not return the original point. " +
                JSON.stringify({
                    gameCoordinates,
                    canvasPoint,
                    roundTrip: {
                        x: roundTrip.x,
                        y: roundTrip.y,
                    },
                    tolerance: DEFAULT_COORDINATE_STABILITY_TOLERANCE,
                }),
        );
    }

    return {
        x,
        y,
    };
}

function areCoordinatesClose(first: Coordinates, second: Coordinates, tolerance: number): boolean {
    return Math.abs(first.x - second.x) <= tolerance && Math.abs(first.y - second.y) <= tolerance;
}

async function gameToBrowserCoordinates(
    gameCoordinates: Coordinates,
    options: E2ECoordinateOptions = {},
): Promise<Coordinates> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_COORDINATE_STABILITY_TIMEOUT_MS;
    const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_COORDINATE_STABILITY_RETRY_INTERVAL_MS;
    const tolerance = options.tolerance ?? DEFAULT_COORDINATE_STABILITY_TOLERANCE;
    const startedAt = Date.now();

    const waitForStableCoordinates = async (): Promise<Coordinates> => {
        const firstSnapshot = getGameToBrowserCoordinatesSnapshot(gameCoordinates);
        const cameraWasAnimating = currentCameraHasRunningEffect();

        await waitForNextFrame();

        const secondSnapshot = getGameToBrowserCoordinatesSnapshot(gameCoordinates);
        const coordinatesAreStable = areCoordinatesClose(firstSnapshot, secondSnapshot, tolerance);
        const cameraIsAnimating = currentCameraHasRunningEffect();
        const cameraIsStable = !cameraWasAnimating && !cameraIsAnimating;

        if (coordinatesAreStable && cameraIsStable) {
            return {
                x: secondSnapshot.x,
                y: secondSnapshot.y,
            };
        }

        if (Date.now() - startedAt >= timeoutMs) {
            throw new Error(
                `Unable to convert game coordinates to stable browser coordinates within ${timeoutMs}ms. ` +
                    JSON.stringify({
                        firstSnapshot,
                        secondSnapshot,
                        cameraWasAnimating,
                        cameraIsAnimating,
                        tolerance,
                    }),
            );
        }

        await wait(retryIntervalMs);
        return waitForStableCoordinates();
    };

    return waitForStableCoordinates();
}

/**
 * [DEBUG] Forces a WebRTC peer failure to test the retry mechanism.
 * This function finds the first SimplePeer with active video peers and triggers a forced failure.
 * @returns Information about the triggered failure, or null if no peers found
 */
function testWebRtcRetry(): { spaceName: string; userId: string; triggered: boolean } | null {
    try {
        const spaceRegistry = gameManager.getCurrentGameScene().spaceRegistry;
        const spaces = spaceRegistry.getAll();

        for (const space of spaces) {
            const simplePeer = space.simplePeer;
            if (simplePeer) {
                const result = simplePeer.forceFirstPeerFailure();
                if (result) {
                    console.info(
                        `[DEBUG] Retry test triggered for space "${space.getName()}", userId: ${result.userId}`,
                    );
                    return { spaceName: space.getName(), ...result };
                }
            }
        }

        console.warn("[DEBUG] No active video peers found in any space to test retry");
        return null;
    } catch (error) {
        console.error("[DEBUG] Error while triggering WebRTC retry test:", error);
        return null;
    }
}

/**
 * [DEBUG] Unilaterally destroys a WebRTC peer to test the retry mechanism.
 * This simulates an unexpected local peer destruction without asking the remote peer to close.
 * @returns Information about the triggered failure, or null if no peers found
 */
async function testWebRtcUnilateralDestroyRetry(): Promise<
    (ForceFirstPeerUnilateralDestroyResult & { spaceName: string }) | null
> {
    try {
        const spaceRegistry = gameManager.getCurrentGameScene().spaceRegistry;
        const spaces = spaceRegistry.getAll();

        const triggerForSpace = async (
            spaceIndex: number,
        ): Promise<(ForceFirstPeerUnilateralDestroyResult & { spaceName: string }) | null> => {
            const space = spaces[spaceIndex];
            if (!space) {
                console.warn("[DEBUG] No active video peers found in any space to test unilateral destroy retry");
                return null;
            }

            const simplePeer = space.simplePeer;
            if (simplePeer) {
                const result = await simplePeer.forceFirstPeerUnilateralDestroy();
                if (result) {
                    console.info("[DEBUG] WebRTC unilateral destroy retry test triggered", {
                        spaceName: space.getName(),
                        ...result,
                    });
                    return { spaceName: space.getName(), ...result };
                }
            }

            return triggerForSpace(spaceIndex + 1);
        };

        return await triggerForSpace(0);
    } catch (error) {
        console.error("[DEBUG] Error while triggering WebRTC unilateral destroy retry test:", error);
        return null;
    }
}

/**
 * [DEBUG] Forces a server disconnected event to test the reconnection flow (connection issue toast, wait for pusher, reload scene).
 * Emits on the current RoomConnection's serverDisconnected subject so the same handlers as a real disconnect run.
 * @returns { triggered: true } if the event was emitted, or null if not in a game scene or no connection
 */
function triggerServerDisconnected(): { triggered: true } | null {
    try {
        const scene = gameManager.getCurrentGameScene();
        const connection = scene.connection;
        if (!connection) {
            console.warn("[DEBUG] No room connection available to trigger serverDisconnected");
            return null;
        }
        connection._serverDisconnected.next();
        console.info("[DEBUG] serverDisconnected event triggered for E2E test");
        return { triggered: true };
    } catch (error) {
        console.error("[DEBUG] Error while triggering serverDisconnected:", error);
        return null;
    }
}

/**
 * [DEBUG] Forces a LiveKit WebSocket close to test the reconnection mechanism.
 * This function finds the first space with an active LiveKit connection and closes the WebSocket.
 * @returns Information about the triggered close, or null if no LiveKit connection found
 */
function testLivekitRetry(): { spaceName: string; closed: boolean } | null {
    try {
        const spaceRegistry = gameManager.getCurrentGameScene().spaceRegistry;
        const spaces = spaceRegistry.getAll();

        for (const space of spaces) {
            const spacePeerManager = space.spacePeerManager;
            if (spacePeerManager) {
                const result = spacePeerManager.forceWebSocketClose();
                if (result) {
                    console.info(`[DEBUG] LiveKit WebSocket close triggered for space "${space.getName()}"`);
                    return { spaceName: space.getName(), closed: true };
                }
            }
        }

        console.warn("[DEBUG] No active LiveKit connections found in any space to test retry");
        return null;
    } catch (error) {
        console.error("[DEBUG] Error while triggering LiveKit retry test:", error);
        return null;
    }
}

export function incrementWebRtcConnectionsCount() {
    webRtcConnectionsCount++;
}

export function decrementWebRtcConnectionsCount() {
    webRtcConnectionsCount--;
}

export function incrementLivekitConnectionsCount() {
    livekitConnectionsCount++;
}

export function decrementLivekitConnectionsCount() {
    livekitConnectionsCount--;
}

export function registerLivekitRoom(room: E2ELivekitRoom) {
    livekitRooms.add(room);
}

export function unregisterLivekitRoom(room: E2ELivekitRoom) {
    livekitRooms.delete(room);
}

function videoStreams(before: RTCStatsReport | undefined, after: RTCStatsReport | undefined, from?: string) {
    const streams: E2EVideoStream[] = [];
    after?.forEach((stat) => {
        if ((stat.type !== "outbound-rtp" && stat.type !== "inbound-rtp") || stat.kind !== "video") {
            return;
        }
        const previous = before?.get(stat.id);
        const bytes = (report: { bytesSent?: number; bytesReceived?: number }) =>
            report.bytesSent ?? report.bytesReceived ?? 0;
        // Counted rather than read from framesPerSecond, which not every browser reports
        const frames = (report: { framesEncoded?: number; framesDecoded?: number }) =>
            report.framesEncoded ?? report.framesDecoded ?? 0;
        const elapsedMs = previous ? stat.timestamp - previous.timestamp : 0;
        streams.push({
            from,
            rid: stat.rid,
            mimeType: after.get(stat.codecId)?.mimeType,
            width: stat.frameWidth ?? 0,
            height: stat.frameHeight ?? 0,
            fps: elapsedMs > 0 ? Math.round(((frames(stat) - frames(previous)) * 1000) / elapsedMs) : 0,
            kbps: elapsedMs > 0 ? Math.round(((bytes(stat) - bytes(previous)) * 8) / elapsedMs) : 0,
        });
    });
    return streams;
}

/** The camera layers this page sends on LiveKit and the cameras it receives, each measured over one second. */
async function getLivekitVideoStreams(): Promise<{ sent: E2EVideoStream[]; received: E2EVideoStream[] }> {
    const sources = [...livekitRooms].flatMap((room) => {
        const { sent, received } = room.getE2EVideoTracks();
        return [...(sent ? [{ from: undefined, track: sent }] : []), ...received];
    });
    const sample = () => Promise.all(sources.map((source) => source.track.getRTCStatsReport()));
    const before = await sample();
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000);
    });
    const after = await sample();
    const streams = sources.flatMap((source, index) => videoStreams(before[index], after[index], source.from));
    return {
        sent: streams.filter((stream) => stream.from === undefined),
        received: streams.filter((stream) => stream.from !== undefined),
    };
}

const FRAME_SAMPLE_SIDE = 16;

/** One frame of a video track reduced to a 16x16 grid of gray levels. */
async function sampleTrackFrame(track: MediaStreamTrack): Promise<number[]> {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    await video.play();
    await new Promise<void>((resolve) => {
        video.requestVideoFrameCallback(() => resolve());
    });
    const canvas = document.createElement("canvas");
    canvas.width = FRAME_SAMPLE_SIDE;
    canvas.height = FRAME_SAMPLE_SIDE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        throw new Error("Unable to create a 2D context");
    }
    context.drawImage(video, 0, 0, FRAME_SAMPLE_SIDE, FRAME_SAMPLE_SIDE);
    video.pause();
    video.srcObject = null;
    const { data } = context.getImageData(0, 0, FRAME_SAMPLE_SIDE, FRAME_SAMPLE_SIDE);
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
        gray.push((data[i] + data[i + 1] + data[i + 2]) / 3);
    }
    return gray;
}

/**
 * Compares one frame of the raw camera track with one frame of the track that goes out after background
 * processing: mean gray level of the processed frame and mean absolute difference between the two.
 * Null while either track is missing.
 */
async function compareLocalVideoFrames(): Promise<{ processedMeanGray: number; meanAbsDiff: number } | null> {
    const raw = get(rawLocalVideoTrackStore);
    const processed = get(backgroundProcessedLocalVideoTrackStore);
    if (raw.type !== "success" || !raw.track || processed.type !== "success" || !processed.track) {
        return null;
    }
    const [rawGray, processedGray] = await Promise.all([
        sampleTrackFrame(raw.track),
        sampleTrackFrame(processed.track),
    ]);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
        processedMeanGray: mean(processedGray),
        meanAbsDiff: mean(processedGray.map((value, index) => Math.abs(value - rawGray[index]))),
    };
}

/**
 * Nearest-rank percentile of values sorted ascending: the smallest value that at least `percent` percent of them do
 * not exceed. Zero for an empty series.
 */
export function percentileOfSorted(sorted: ArrayLike<number>, percent: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    // `percent` is a whole number, so the product is exact where 0.95 * 20 is not
    const rank = Math.ceil((percent * sorted.length) / 100);
    return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/** How a series of durations in milliseconds is distributed. */
export interface E2EFrameStats {
    p50: number;
    p95: number;
    p99: number;
    max: number;
}

/** The distribution of a series of durations, in the order they are given and left untouched. */
export function summarizeFrameTimes(samples: ArrayLike<number>): E2EFrameStats {
    const sorted = Float64Array.from(samples).sort();
    return {
        p50: percentileOfSorted(sorted, 50),
        p95: percentileOfSorted(sorted, 95),
        p99: percentileOfSorted(sorted, 99),
        max: percentileOfSorted(sorted, 100),
    };
}

/** The part of Phaser's event emitter the frame recorder uses. */
export interface E2EFrameEvents {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** The part of PerformanceObserver the frame recorder uses, so that a test can stand in for the browser. */
export interface E2ELongTaskObserver {
    observe(options: { type: string }): void;
    takeRecords(): readonly { duration: number }[];
    disconnect(): void;
}

export interface E2ELongTaskObserverClass {
    new (callback: (list: { getEntries(): readonly { duration: number }[] }) => void): E2ELongTaskObserver;
    readonly supportedEntryTypes?: readonly string[];
}

export interface E2EFrameRecording {
    /** Frames the game started while recording. `intervalMs` has one sample fewer: the first has no predecessor. */
    frames: number;
    durationMs: number;
    /**
     * The cost of a frame, and the series a frame-time budget is judged on: main-thread time from PRE_STEP to the
     * last event of the same frame (POST_RENDER, or POST_STEP when it did not render). A frame that threw before
     * POST_STEP adds no sample.
     */
    workMs: E2EFrameStats;
    /**
     * Time between the requestAnimationFrame timestamps of consecutive frames: what the player sees, but bounded
     * below by the display refresh period (16.7 ms at 60 Hz, 8.3 ms at 120 Hz) whatever the frame costs.
     */
    intervalMs: E2EFrameStats;
    /** Scene update only, from the game's PRE_STEP to its POST_STEP. */
    stepMs: E2EFrameStats;
    /** From POST_STEP to POST_RENDER, over the frames that rendered. */
    renderMs: E2EFrameStats;
    /** Frames that reached POST_STEP but not POST_RENDER: nothing was dirty (see Game.isDirty), or the render threw. */
    skippedRenders: number;
    /** Long tasks (50 ms or more of main thread) while recording. Not every browser reports them. */
    longTasks: { supported: boolean; count: number; totalMs: number };
    /** True when the recording outgrew its buffer: the percentiles then cover only its first frames. */
    truncated: boolean;
}

export interface E2EFrameRecorderEnvironment {
    now(): number;
    observerClass: E2ELongTaskObserverClass | undefined;
    // How many samples each series keeps. Past it a recording goes on counting but no longer stores.
    capacity?: number;
}

// About 16 minutes at 60 fps
const MAX_RECORDED_FRAMES = 60_000;

/** One series of durations in a typed array allocated once, so that recording a frame never allocates. */
class SampleBuffer {
    private readonly samples: Float64Array;
    private total = 0;

    constructor(capacity: number) {
        this.samples = new Float64Array(capacity);
    }

    push(sample: number): void {
        if (this.total < this.samples.length) {
            this.samples[this.total] = sample;
        }
        this.total++;
    }

    /** Samples pushed, kept or not. */
    get count(): number {
        return this.total;
    }

    get truncated(): boolean {
        return this.total > this.samples.length;
    }

    kept(): Float64Array {
        return this.samples.subarray(0, Math.min(this.total, this.samples.length));
    }
}

function observeLongTasks(
    observerClass: E2ELongTaskObserverClass | undefined,
    onEntries: (entries: readonly { duration: number }[]) => void,
): E2ELongTaskObserver | undefined {
    if (!observerClass?.supportedEntryTypes?.includes("longtask")) {
        return undefined;
    }
    const observer = new observerClass((list) => onEntries(list.getEntries()));
    observer.observe({ type: "longtask" });
    return observer;
}

function beginFrameRecording(
    environment: E2EFrameRecorderEnvironment,
    events: E2EFrameEvents,
): { stop(): E2EFrameRecording } {
    const capacity = environment.capacity ?? MAX_RECORDED_FRAMES;
    const workMs = new SampleBuffer(capacity);
    const intervalMs = new SampleBuffer(capacity);
    const stepMs = new SampleBuffer(capacity);
    const renderMs = new SampleBuffer(capacity);
    const series = [workMs, intervalMs, stepMs, renderMs];
    const longTasks = { count: 0, totalMs: 0 };
    let frames = 0;
    let previousTimestamp: number | undefined;
    let frameStart: number | undefined;
    let stepEnd: number | undefined;
    let frameEnd: number | undefined;

    // A frame's work is known only once the next one starts or the recording stops, since a frame may or may not render
    const closeFrame = () => {
        if (frameStart !== undefined && frameEnd !== undefined) {
            workMs.push(frameEnd - frameStart);
        }
        frameEnd = undefined;
    };

    // A frame that throws never emits POST_STEP (Game.step) and one that does not render never emits POST_RENDER:
    // such a frame adds no sample to the series of the event it lacks. A recording that starts in the middle of a
    // frame sees the end of it without the start, which the two guards drop.
    const onPreStep = (time?: unknown) => {
        closeFrame();
        frameStart = environment.now();
        // Phaser passes the requestAnimationFrame timestamp, which is vsync-aligned and excludes the callbacks and
        // PRE_STEP listeners that ran before this one
        const timestamp = typeof time === "number" ? time : frameStart;
        if (previousTimestamp !== undefined) {
            intervalMs.push(timestamp - previousTimestamp);
        }
        previousTimestamp = timestamp;
        frames++;
    };
    const onPostStep = () => {
        if (frameStart === undefined) {
            return;
        }
        stepEnd = environment.now();
        stepMs.push(stepEnd - frameStart);
        frameEnd = stepEnd;
    };
    const onPostRender = () => {
        if (stepEnd === undefined) {
            return;
        }
        const end = environment.now();
        renderMs.push(end - stepEnd);
        frameEnd = end;
    };
    const listeners: [string, (...args: unknown[]) => void][] = [
        [Phaser.Core.Events.PRE_STEP, onPreStep],
        [Phaser.Core.Events.POST_STEP, onPostStep],
        [Phaser.Core.Events.POST_RENDER, onPostRender],
    ];
    const addLongTasks = (entries: readonly { duration: number }[]) => {
        for (const entry of entries) {
            longTasks.count++;
            longTasks.totalMs += entry.duration;
        }
    };

    const startedAt = environment.now();
    const observer = observeLongTasks(environment.observerClass, addLongTasks);
    for (const [event, listener] of listeners) {
        events.on(event, listener);
    }

    return {
        stop() {
            const stoppedAt = environment.now();
            for (const [event, listener] of listeners) {
                events.off(event, listener);
            }
            closeFrame();
            if (observer) {
                // Entries the browser has queued but not yet delivered would be lost by disconnect()
                addLongTasks(observer.takeRecords());
                observer.disconnect();
            }
            return {
                frames,
                durationMs: stoppedAt - startedAt,
                workMs: summarizeFrameTimes(workMs.kept()),
                intervalMs: summarizeFrameTimes(intervalMs.kept()),
                stepMs: summarizeFrameTimes(stepMs.kept()),
                renderMs: summarizeFrameTimes(renderMs.kept()),
                skippedRenders: stepMs.count - renderMs.count,
                longTasks: { supported: observer !== undefined, ...longTasks },
                truncated: series.some((samples) => samples.truncated),
            };
        },
    };
}

/**
 * Times the game's frames from the outside, through the events Phaser's game loop already emits. Nothing is attached
 * to the game or to the browser until start(), and stop() detaches all of it.
 */
export function createFrameRecorder(environment: E2EFrameRecorderEnvironment) {
    let running: { stop(): E2EFrameRecording } | undefined;

    return {
        start(events: E2EFrameEvents): void {
            if (running) {
                throw new Error("A frame recording is already running: call stopFrameRecording() first.");
            }
            running = beginFrameRecording(environment, events);
        },
        stop(): E2EFrameRecording {
            if (!running) {
                throw new Error("No frame recording is running: call startFrameRecording() first.");
            }
            const recording = running;
            running = undefined;
            return recording.stop();
        },
    };
}

const frameRecorder = createFrameRecorder({
    now: () => performance.now(),
    observerClass: typeof PerformanceObserver === "undefined" ? undefined : PerformanceObserver,
});

function startFrameRecording(): void {
    frameRecorder.start(gameManager.getCurrentGameScene().game.events);
}

function stopFrameRecording(): E2EFrameRecording {
    return frameRecorder.stop();
}

/**
 * The e2eHooks object contains methods used for E2E tests.
 * We should refrain from growing this object too much but it can be useful in very specific circumstances (usually linked to Phaser testing)
 */
export const e2eHooks = {
    waitForNextFrame,
    getWebRtcConnectionsCount(): number {
        return webRtcConnectionsCount;
    },
    getLivekitConnectionsCount(): number {
        return livekitConnectionsCount;
    },
    getLivekitRoomsCount(): number {
        return livekitRooms.size;
    },
    getLivekitVideoStreams,
    gameToBrowserCoordinates,
    /**
     * [DEBUG] Forces a WebRTC peer failure to test the retry mechanism.
     */
    testWebRtcRetry,
    /**
     * [DEBUG] Unilaterally destroys a WebRTC peer to test the retry mechanism.
     */
    testWebRtcUnilateralDestroyRetry,
    /**
     * [DEBUG] Forces a LiveKit WebSocket close to test the reconnection mechanism.
     */
    testLivekitRetry,
    /**
     * [DEBUG] Forces a server disconnected event to test the reconnection flow.
     */
    triggerServerDisconnected,
    /**
     * Used by the virtual background smoke test.
     */
    compareLocalVideoFrames,
    /**
     * Frame-time measurement: stopFrameRecording() returns percentiles of the frames played since
     * startFrameRecording(). Only a screen backed by a real GPU gives numbers worth quoting.
     */
    startFrameRecording,
    stopFrameRecording,
};
