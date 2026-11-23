import * as Phaser from "phaser";
import { get } from "svelte/store";
import type { ForceFirstPeerUnilateralDestroyResult } from "../Space/SpacePeerManager/SpacePeerManager";
import { gameManager } from "../Phaser/Game/GameManager";
import { POSITION_DELAY } from "../Enum/EnvironmentVariable";
import { getAvatarBakeStats, isAvatarBakeEnabled } from "../Phaser/Entity/AvatarBakeCache";
import { isAvatarZeroWorkEnabled } from "../Phaser/Entity/AvatarZeroWork";
import { isAvatarDetailBudgetEnabled } from "../Phaser/Game/AvatarDetail";
import { backgroundProcessedLocalVideoTrackStore, rawLocalVideoTrackStore } from "../Stores/MediaStore";
import {
    createGpuFrameTimer,
    type GpuTimerContext,
    type GpuTimerMethod,
    type GpuTimerUnavailableReason,
} from "./GpuFrameTimer";
import { percentileOfSorted, summarizeFrameTimes, type E2EFrameStats } from "./FrameStats";
import {
    FRAME_BENCH_WINDOW,
    markShadingNight,
    readShadingCounters,
    readShadingNightMark,
    startFrameBench,
    type E2EFrameBench,
    type FrameBench,
} from "./FrameBench";
import { createBenchNight, type BenchNightResult } from "./BenchNight";
import { createCameraPanner } from "./CameraPan";
import {
    buildRecipes,
    createSyntheticCrowd,
    crowdMapFromManifest,
    type CrowdMap,
    type SyntheticCrowdReport,
} from "./SyntheticCrowd";

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

export { percentileOfSorted, summarizeFrameTimes };
export type { E2EFrameStats };

export const FRAME_AVG_BUDGET_MS = 11;
export const FRAME_MAX_BUDGET_MS = 16.7;

function countSamplesOver(samples: ArrayLike<number>, thresholdMs: number): number {
    let over = 0;
    for (let i = 0; i < samples.length; i++) {
        if (samples[i] > thresholdMs) {
            over++;
        }
    }
    return over;
}

/** The part of Phaser's event emitter the frame recorder uses. */
export interface E2EFrameEvents {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type E2EWebGLTimerContext = GpuTimerContext;

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

// Share of the rendered frames that must have a GPU sample before the GPU budget can be judged. Below it the
// missing frames are the ones where the GPU fell behind or was disturbed, so a pass would rest on the good ones.
export const GPU_MIN_COVERAGE = 0.9;

const GPU_SCOPE =
    "GL commands from PRE_RENDER to POST_RENDER of rendered frames; excludes texture uploads during the step and " +
    "compositor work for the DOM over the canvas; browsers may coarsen timer queries";

/** Why there is no GPU figure: no timer could be made, or the timer produced no sample. */
export type E2EGpuUnavailableReason = GpuTimerUnavailableReason | "no-samples";

export interface E2EGpuStats extends E2EFrameStats {
    supported: true;
    ext: GpuTimerMethod;
    timedFrames: number;
    disjointFrames: number;
    samples: number;
    /** Rendered frames with no usable sample. A high count means the figure understates the worst frames. */
    dropped: number;
    /** dropped / (samples + dropped). */
    droppedRatio: number;
    /** samples / rendered frames. */
    coverage: number;
    method: GpuTimerMethod;
    scope: string;
}

/**
 * The frame budget the owner set for the GPU: at most 11.0 ms on average and no frame above 16.7 ms. The same two
 * numbers are applied to main-thread work as a stand-in when no GPU timer exists; that is not the gate of
 * docs/PERFORMANCE.md N-04 (p95 at 200 visible avatars and at 1000), which is a different rule. A flag is null when
 * the recording cannot support a verdict: no samples, truncated, or (GPU) too few of the rendered frames measured.
 */
export interface E2EFrameBudgetReport {
    source: "gpu" | "work";
    avgBudgetMs: number;
    maxBudgetMs: number;
    avg: number;
    p99: number;
    max: number;
    avgPass: boolean | null;
    maxPass: boolean | null;
    pass: boolean | null;
    avgLimitMs: number;
    maxLimitMs: number;
    workOver16_7Ms: number;
    workOver11Ms: number;
    gpuOver16_7Ms: number | null;
    gpuOver11Ms: number | null;
    workPassed: boolean | null;
    gpuPassed: boolean | null;
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
    frameMs: E2EFrameStats;
    /** Scene update only, from the game's PRE_STEP to its POST_STEP. */
    stepMs: E2EFrameStats;
    /** From POST_STEP to POST_RENDER, over the frames that rendered. */
    renderMs: E2EFrameStats;
    /**
     * GPU execution time of rendered frames, or null when it could not be measured (see gpuUnavailableReason): never
     * zeros standing in for a measurement. Quote it only together with `dropped`, `coverage` and `method`.
     */
    gpuMs: E2EGpuStats | null;
    /** The extension that measured, or null when none did. Present even when no sample came out. */
    gpuMethod: GpuTimerMethod | null;
    gpuUnavailableReason: E2EGpuUnavailableReason | null;
    /** Rendered frames with no GPU sample, also when gpuMs is null. */
    gpuDropped: number;
    /** Evaluation against the <= 11 ms average and <= 16.7 ms max frame budget. */
    budget: E2EFrameBudgetReport;
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
    gl?: E2EWebGLTimerContext | null,
): { stop(): E2EFrameRecording } {
    const capacity = environment.capacity ?? MAX_RECORDED_FRAMES;
    const workMs = new SampleBuffer(capacity);
    const intervalMs = new SampleBuffer(capacity);
    const stepMs = new SampleBuffer(capacity);
    const renderMs = new SampleBuffer(capacity);
    const series = [workMs, intervalMs, stepMs, renderMs];
    const longTasks = { count: 0, totalMs: 0 };
    const gpuCreation = createGpuFrameTimer(gl, capacity);
    const gpuTimer = gpuCreation.timer;
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
        stepEnd = undefined;
        gpuTimer?.poll();
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
    const onPreRender = () => {
        if (stepEnd !== undefined) gpuTimer?.begin();
    };
    const onPostRender = () => {
        if (stepEnd === undefined) {
            return;
        }
        gpuTimer?.end();
        const end = environment.now();
        renderMs.push(end - stepEnd);
        frameEnd = end;
    };
    const listeners: [string, (...args: unknown[]) => void][] = [
        [Phaser.Core.Events.PRE_STEP, onPreStep],
        [Phaser.Core.Events.POST_STEP, onPostStep],
        [Phaser.Core.Events.PRE_RENDER, onPreRender],
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
            const gpuResult = gpuTimer
                ? gpuTimer.finish()
                : { samples: new Float64Array(0), dropped: 0, disjointFrames: 0 };
            if (observer) {
                // Entries the browser has queued but not yet delivered would be lost by disconnect()
                addLongTasks(observer.takeRecords());
                observer.disconnect();
            }
            const workKept = workMs.kept();
            const gpuKept = gpuResult.samples;
            const workSummary = summarizeFrameTimes(workKept);
            const truncated = series.some((samples) => samples.truncated);
            const workOver16_7Ms = countSamplesOver(workKept, FRAME_MAX_BUDGET_MS);
            const workOver11Ms = countSamplesOver(workKept, FRAME_AVG_BUDGET_MS);
            const renderedFrames = renderMs.count;
            const coverage = renderedFrames === 0 ? 0 : gpuKept.length / renderedFrames;
            const gpuUnavailableReason: E2EGpuUnavailableReason | null =
                gpuCreation.unavailable ?? (gpuKept.length === 0 ? "no-samples" : null);
            let gpuMs: E2EGpuStats | null = null;
            let gpuPassed: boolean | null = null;
            let gpuOver16_7Ms: number | null = null;
            let gpuOver11Ms: number | null = null;
            if (gpuTimer && gpuKept.length > 0) {
                const gpuSummary = summarizeFrameTimes(gpuKept);
                gpuOver16_7Ms = countSamplesOver(gpuKept, FRAME_MAX_BUDGET_MS);
                gpuOver11Ms = countSamplesOver(gpuKept, FRAME_AVG_BUDGET_MS);
                gpuMs = {
                    ...gpuSummary,
                    supported: true,
                    ext: gpuTimer.method,
                    timedFrames: gpuKept.length,
                    disjointFrames: gpuResult.disjointFrames,
                    samples: gpuKept.length,
                    dropped: gpuResult.dropped,
                    droppedRatio: gpuResult.dropped / (gpuKept.length + gpuResult.dropped),
                    coverage,
                    method: gpuTimer.method,
                    scope: GPU_SCOPE,
                };
                if (!truncated && coverage >= GPU_MIN_COVERAGE) {
                    gpuPassed = gpuSummary.avg <= FRAME_AVG_BUDGET_MS && gpuOver16_7Ms === 0;
                }
            }
            const frameMs = summarizeFrameTimes(intervalMs.kept());
            const selected = gpuMs ?? workSummary;
            const valid = !truncated && (gpuTimer ? gpuPassed !== null : workKept.length > 0);
            return {
                frames,
                durationMs: stoppedAt - startedAt,
                workMs: workSummary,
                intervalMs: frameMs,
                frameMs,
                stepMs: summarizeFrameTimes(stepMs.kept()),
                renderMs: summarizeFrameTimes(renderMs.kept()),
                gpuMs,
                gpuMethod: gpuTimer?.method ?? null,
                gpuUnavailableReason,
                gpuDropped: gpuResult.dropped,
                budget: {
                    source: gpuMs ? "gpu" : "work",
                    avgBudgetMs: FRAME_AVG_BUDGET_MS,
                    maxBudgetMs: FRAME_MAX_BUDGET_MS,
                    avg: selected.avg,
                    p99: selected.p99,
                    max: selected.max,
                    avgPass: valid ? selected.avg <= FRAME_AVG_BUDGET_MS : null,
                    maxPass: valid ? selected.max <= FRAME_MAX_BUDGET_MS : null,
                    pass: valid ? selected.avg <= FRAME_AVG_BUDGET_MS && selected.max <= FRAME_MAX_BUDGET_MS : null,
                    avgLimitMs: FRAME_AVG_BUDGET_MS,
                    maxLimitMs: FRAME_MAX_BUDGET_MS,
                    workOver16_7Ms,
                    workOver11Ms,
                    gpuOver16_7Ms,
                    gpuOver11Ms,
                    workPassed:
                        truncated || workKept.length === 0
                            ? null
                            : workSummary.avg <= FRAME_AVG_BUDGET_MS && workOver16_7Ms === 0,
                    gpuPassed,
                },
                skippedRenders: stepMs.count - renderMs.count,
                longTasks: { supported: observer !== undefined, ...longTasks },
                truncated,
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
        start(events: E2EFrameEvents, gl?: E2EWebGLTimerContext): void {
            if (running) {
                throw new Error("A frame recording is already running: call stopFrameRecording() first.");
            }
            running = beginFrameRecording(environment, events, gl);
        },
        isRunning(): boolean {
            return running !== undefined;
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

function currentWebGLContext(game: Phaser.Game): E2EWebGLTimerContext | undefined {
    const renderer = game.renderer as { gl?: unknown } | undefined;
    if (renderer && typeof renderer.gl === "object" && renderer.gl !== null) {
        return renderer.gl as E2EWebGLTimerContext;
    }
    return undefined;
}

export interface E2ERenderingCounts {
    remotePlayers: number;
    activeFullAvatars: number;
    activeDotAvatars: number;
    culledAvatars: number;
    bakedAvatarTextures: number;
}

function getRenderingCounts(): E2ERenderingCounts {
    const scene = gameManager.getCurrentGameScene();
    let remotePlayers = 0;
    let activeFullAvatars = 0;
    let activeDotAvatars = 0;
    let culledAvatars = 0;
    for (const player of scene.MapPlayersByKey.values()) {
        remotePlayers += 1;
        if (player.isCulled()) {
            culledAvatars += 1;
        } else if (player.getDetail() === "dot") {
            activeDotAvatars += 1;
        } else {
            activeFullAvatars += 1;
        }
    }
    const bakeStats = getAvatarBakeStats(scene.textures);
    return {
        remotePlayers,
        activeFullAvatars,
        activeDotAvatars,
        culledAvatars,
        bakedAvatarTextures: bakeStats.cached,
    };
}

function startFrameRecording(): void {
    if (frameBench) {
        throw new Error("A frame bench is running: both read the GPU timer, which cannot be shared. Stop it first.");
    }
    const game = gameManager.getCurrentGameScene().game;
    frameRecorder.start(game.events, currentWebGLContext(game));
}

function stopFrameRecording(): E2EFrameRecording {
    return frameRecorder.stop();
}

let frameBench: FrameBench | undefined;
let capturingWindow = false;

/**
 * The render node name of the Koncluí post pass (POST_NODE in Konclui/Ambience/phaser/postFilter.ts: an upstream file
 * must not import Konclui, E2EHooksBench.test.ts reads that file to keep the two equal).
 */
export const POST_FILTER_NODE = "KfxPost";

/**
 * The same pass when the shading is on (SHADED_POST_NODE in postFilter.ts): a second program that does everything the
 * first does and more, so a frame it drew counts as a frame with the post pass.
 */
export const SHADED_POST_FILTER_NODE = "KfxPostShaded";

/** The longest a fixed capture waits for its 301 game steps: a hidden or throttled tab never runs them. */
export const FRAME_CAPTURE_TIMEOUT_MS = 60_000;

/**
 * Starts the rolling frame bench (the last 300 frames): GPU time from a disjoint timer query, frame intervals, and the
 * bytes uploaded to the GPU. It wraps texImage2D and texSubImage2D of the game's context until stopFrameBench().
 * Read it with getFrameBench() while it runs.
 */
function startFrameBenchHook(): void {
    assertBenchSession();
    if (frameBench) {
        throw new Error("A frame bench is already running: call stopFrameBench() first.");
    }
    if (frameRecorder.isRunning()) {
        throw new Error(
            "A frame recording is running: both read the GPU timer, which cannot be shared. Stop it first.",
        );
    }
    const scene = gameManager.getCurrentGameScene();
    const game = scene.game;
    frameBench = startFrameBench({
        events: game.events,
        eventNames: {
            preStep: Phaser.Core.Events.PRE_STEP,
            postStep: Phaser.Core.Events.POST_STEP,
            preRender: Phaser.Core.Events.PRE_RENDER,
            postRender: Phaser.Core.Events.POST_RENDER,
        },
        gl: currentWebGLContext(game),
        now: () => performance.now(),
        mapSize: { width: scene.Map.widthInPixels, height: scene.Map.heightInPixels },
        counts: () => {
            const { activeFullAvatars, activeDotAvatars, culledAvatars, bakedAvatarTextures } = getRenderingCounts();
            return { activeFullAvatars, activeDotAvatars, culledAvatars, bakedAvatarTextures };
        },
        // The Koncluí shading's counters, published by the effects through FrameBench (this file does not import Koncluí)
        shading: readShadingCounters,
        shadingNightMark: readShadingNightMark,
        // Called at each rendered frame: a plain loop over the camera's filter list, no allocation
        postFilterActive: () => {
            const list = scene.cameras?.main?.filters?.internal?.list;
            if (!list) return false;
            for (let i = 0; i < list.length; i++) {
                const node = list[i].renderNode;
                if (list[i].active && (node === POST_FILTER_NODE || node === SHADED_POST_FILTER_NODE)) return true;
            }
            return false;
        },
    });
}

/**
 * Capture exactly 300 consecutive game intervals and drain their queries after the last interval. Rejects, with the
 * bench stopped and the game's hooks put back, when the game is destroyed or runs fewer than 301 steps in
 * FRAME_CAPTURE_TIMEOUT_MS (a hidden tab), so that a caller waiting on it is never left hanging.
 */
async function captureFrameBench(): Promise<E2EFrameBench> {
    startFrameBenchHook();
    const bench = frameBench;
    if (!bench) throw new Error("Frame benchmark failed to start");
    const events = gameManager.getCurrentGameScene().game.events;
    let steps = 0;
    capturingWindow = true;
    try {
        return await new Promise<E2EFrameBench>((resolve, reject) => {
            const finish = () => {
                events.off(Phaser.Core.Events.PRE_STEP, onStep);
                events.off(Phaser.Core.Events.DESTROY, onDestroy);
                window.clearTimeout(timeout);
            };
            const onDestroy = () => {
                finish();
                bench.stop();
                reject(new Error("Game destroyed during frame capture"));
            };
            const onTimeout = () => {
                finish();
                bench.stop();
                reject(
                    new Error(
                        `The game ran ${Math.max(steps - 1, 0)} of the 300 steps of a frame capture in ` +
                            `${FRAME_CAPTURE_TIMEOUT_MS / 1000} s: is the tab visible?`,
                    ),
                );
            };
            const onStep = () => {
                if (++steps <= FRAME_BENCH_WINDOW) return;
                finish();
                resolve(bench.stopAfterGpu());
            };
            const timeout = window.setTimeout(onTimeout, FRAME_CAPTURE_TIMEOUT_MS);
            events.on(Phaser.Core.Events.PRE_STEP, onStep);
            events.on(Phaser.Core.Events.DESTROY, onDestroy);
        });
    } finally {
        capturingWindow = false;
        if (frameBench === bench) frameBench = undefined;
    }
}
function getFrameBench(): E2EFrameBench {
    if (!frameBench) {
        throw new Error("No frame bench is running: call startFrameBench() first.");
    }
    return frameBench.snapshot();
}

/** Stops the bench, puts the context's methods back and returns the last reading. */
function stopFrameBenchHook(): E2EFrameBench {
    if (capturingWindow) throw new Error("A fixed frame capture is in progress");
    if (!frameBench) {
        throw new Error("No frame bench is running: call startFrameBench() first.");
    }
    const bench = frameBench;
    frameBench = undefined;
    return bench.stop();
}

/**
 * The key that opens a page to the bench-only hooks (the synthetic crowd, the night level, the camera pan, the frame
 * bench). window.e2eHooks is installed on every page of this client (svelte.ts, as upstream does), so its presence says
 * nothing: a session opts in by setting this key before it calls them, which the frame probe does. It is an opt-in, not
 * a security boundary: anyone can set it from the console, and what it opens is local (the crowd goes through the local
 * repository and sends nothing to the server).
 */
export const E2E_BENCH_KEY = "konclui.e2e.bench";

function assertBenchSession(): void {
    if (typeof localStorage === "undefined" || localStorage.getItem(E2E_BENCH_KEY) !== "1") {
        throw new Error(`This hook runs only in a bench session: localStorage "${E2E_BENCH_KEY}" must be "1".`);
    }
}

/** The map's fx manifest beside the map file, which says where the glass, the lights and the room borders are. */
async function loadCrowdMap(mapUrl: string, size: { width: number; height: number }): Promise<CrowdMap> {
    const response = await fetch(new URL("fx/manifest.json", mapUrl), { cache: "no-cache" });
    if (response.status === 404) {
        return crowdMapFromManifest(undefined, size);
    }
    if (!response.ok) {
        throw new Error(`Could not read the effects manifest of the map: HTTP ${response.status}`);
    }
    return crowdMapFromManifest(await response.json(), size);
}

// One crowd at a time. It is kept with the scene it joined, so that clearing it removes it from that scene.
let activeCrowd: ReturnType<typeof createSyntheticCrowd> | undefined;
let activeCrowdScene: unknown;

// Enough recipes for a varied crowd, few enough that the avatar bake cache (128 textures) keeps them all
const SYNTHETIC_RECIPES = 48;

/** Rejects when the scene runs no update within the time: a paused or hidden tab never will. */
function nextSceneUpdate(scene: ReturnType<typeof gameManager.getCurrentGameScene>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            scene.events.off(Phaser.Scenes.Events.POST_UPDATE, onUpdate);
            reject(new Error("The scene ran no update within 10 s: is the tab visible?"));
        }, 10_000);
        const onUpdate = () => {
            window.clearTimeout(timeout);
            resolve();
        };
        scene.events.once(Phaser.Scenes.Events.POST_UPDATE, onUpdate);
    });
}

/**
 * Joins `count` remote players through the repository a real join uses, each with a recipe of 4 to 6 layers from the
 * page's woka list, in four groups (near glass, under lights, across room borders, spread over the map), and walks
 * them 5 moves a second on paths fixed by their index. Resolves once the scene has taken them. Only in a session that
 * opted in (E2E_BENCH_KEY).
 */
async function spawnSyntheticCrowd(count: number): Promise<SyntheticCrowdReport> {
    assertBenchSession();
    const scene = gameManager.getCurrentGameScene();
    const [wokaList, map] = await Promise.all([
        gameManager.loadWokaData(),
        loadCrowdMap(scene.mapUrlFile, { width: scene.Map.widthInPixels, height: scene.Map.heightInPixels }),
    ]);
    const recipes = buildRecipes(wokaList, Math.min(count, SYNTHETIC_RECIPES));
    // A crowd that is empty, or that belongs to another scene (the player changed room, or a spawn threw), is bound to
    // that scene's repository and frames: a run must not take it for this scene's.
    if (activeCrowd && (activeCrowd.size === 0 || activeCrowdScene !== scene)) {
        activeCrowd = undefined;
    }
    activeCrowdScene = scene;
    activeCrowd ??= createSyntheticCrowd(
        {
            repository: scene.getRemotePlayersRepository(),
            events: scene.events,
            updateEvent: Phaser.Scenes.Events.UPDATE,
            hasPlayer: (userId) => scene.MapPlayersByKey.has(userId),
            nextFrame: () => nextSceneUpdate(scene),
        },
        POSITION_DELAY,
    );
    return activeCrowd.spawn(count, map, recipes);
}

/** Removes every synthetic player and the listener that walked them. */
async function clearSyntheticCrowd(): Promise<{ removed: number; remaining: number }> {
    const crowd = activeCrowd;
    if (!crowd) {
        return { removed: 0, remaining: 0 };
    }
    const result = await crowd.clear();
    if (activeCrowd === crowd && crowd.size === 0 && result.remaining === 0) {
        activeCrowd = undefined;
    }
    return result;
}

const benchNight = createBenchNight({
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
});

/**
 * Night for a measurement, 0 (day) to 1, through the effects' QA key; `null` gives the clock back. The effects take the
 * change within a second: wait that long before measuring.
 */
function setBenchNight(level: number | null): BenchNightResult {
    assertBenchSession();
    // Before the change, so that what the new hour causes (a bake, an upload) is counted from here
    markShadingNight();
    return benchNight(level);
}

function cameraPanner() {
    const scene = gameManager.getCurrentGameScene();
    return createCameraPanner(scene.getCameraManager(), scene.events, Phaser.Scenes.Events.UPDATE);
}

let panner: ReturnType<typeof createCameraPanner> | undefined;

/**
 * Moves the view by (dx, dy) screen pixels over `ms`, as a drag would, and resolves true when done. The view stays off
 * the player until releaseCameraPan().
 */
function panCamera(dx: number, dy: number, ms: number): Promise<boolean> {
    assertBenchSession();
    panner ??= cameraPanner();
    return panner.pan(dx, dy, ms);
}

function releaseCameraPan(): void {
    panner?.release();
    panner = undefined;
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
    getRenderingCounts,
    async sizeBenchToViewport() {
        assertBenchSession();
        const { waScaleManager } = await import("../Phaser/Services/WaScaleManager");
        // Use the full-resolution camera path at the current gameplay zoom.
        waScaleManager.applyNewSize(gameManager.getCurrentGameScene().getCameraManager().getCamera(), true);
    },
    /** The three avatar flags as this client reads them now (default and storage override), for the frame probe's report. */
    getAvatarFlags() {
        return {
            avatarDetailBudget: isAvatarDetailBudgetEnabled(),
            avatarZeroWork: isAvatarZeroWorkEnabled(),
            avatarBake: isAvatarBakeEnabled(),
        };
    },
    getRendererInfo() {
        const scene = gameManager.getCurrentGameScene();
        const renderer = scene.game.renderer as { gl?: WebGLRenderingContext };
        const context = renderer.gl;
        const info = context?.getExtension("WEBGL_debug_renderer_info");
        return {
            renderer: context && info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown",
            activeFilters: (scene.cameras.main.filters?.internal?.list ?? [])
                .filter((filter) => filter.active)
                .map((filter) => filter.renderNode),
            normalMapLoaded: scene.textures.getTextureKeys().some((key) => /^kfx-.+-normal$/.test(key)),
            width: context?.drawingBufferWidth,
            height: context?.drawingBufferHeight,
            version: context ? String(context.getParameter(context.VERSION)) : null,
        };
    },
    /**
     * The rolling frame bench for the 1,000-user gate: the last 300 frames' GPU time, frame intervals and upload
     * bytes. startFrameBench() before, stopFrameBench() after.
     */
    startFrameBench: startFrameBenchHook,
    getFrameBench,
    captureFrameBench,
    stopFrameBench: stopFrameBenchHook,
    /** Synthetic remote players for a load measurement. Only in a session that set localStorage E2E_BENCH_KEY. */
    spawnSyntheticCrowd,
    clearSyntheticCrowd,
    /** Night level 0..1 for a measurement, through the effects' QA key. */
    setBenchNight,
    panCamera,
    releaseCameraPan,
};
