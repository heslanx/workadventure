import type { Readable, Unsubscriber } from "svelte/store";
import { analyticsClient } from "../Administration/AnalyticsClient";
import type { WebRtcSenderStats } from "../Components/Video/WebRtcStats";
import type { VideoQualitySetting } from "../Connection/LocalUserStore";
import { localEncoderStatsStore, type LocalEncoderStats } from "./LocalEncoderStats";
import { uplinkCapNoticeStore, uplinkCapStore } from "./UplinkCap";

/**
 * Takes the camera down to "low" when the uplink cannot carry the full ladder (720p + 360p + 180p), for the session,
 * and brings it back when the link recovers.
 *
 * On LiveKit the browser already switches the largest simulcast layer off when the uplink cannot fund it, but we keep
 * publishing the whole ladder: libwebrtc then pads up to its bandwidth estimate to try to get the layer back, so the
 * link stays saturated (the audio shares it), and on a link near the threshold the layer flaps (a keyframe and a freeze
 * for every viewer at each switch). "low" (captured at 360p, published as 360p + 180p) is the manual answer to that;
 * this applies it by itself.
 *
 * `bandwidthLimitedRatio` is the share of the last second the sender spent in qualityLimitationReason "bandwidth": the
 * allocator could not fund an active layer. Sampled once a second, over a window, it gives the share of time the
 * largest layer could not be sent: gaps are tolerated (a flapping link is the case this is for), a dip is ignored.
 *
 * - Cap: at least LIMITED_SAMPLES of the last WINDOW_SAMPLES eligible samples are limited, after a warm-up (a
 *   publication starts with a keyframe and a rate-control ramp-up, and so does a layer that resumes: dynacast switching
 *   it back on for a viewer). The earliest cap is 45 s after a publication starts.
 *   Eligible means a LiveKit camera with exactly one encoder, delivering frames, with two layers or more to lose, no
 *   screen share running (it competes for the same uplink, and is the user's own choice) and a saved quality that is
 *   not "low" already.
 * - Recovery: the estimate cannot prove that the full ladder fits, because while only 360p + 180p are sent it is capped
 *   near 1.5 times what is sent. Lifting the cap IS the probe, so it is done rarely: after a hold that grows with each
 *   failed trial (HOLD_MS, wall clock, the camera can be off meanwhile), and only on a link that looked healthy while
 *   capped. A lift when nobody is publishing costs nobody a republish, so it needs no proof: only that the camera has
 *   been away for IDLE_CONFIRM_MS, since a publication that is replaced (a reconnection, a codec change) is away for
 *   one reading, and lifting on that one would be a trial with no proof at all. Several encoders sending the camera at
 *   once (a publication overlapping its successor) are neither: it waits for one.
 * - Backoff: a cap that comes back within SURVIVAL_MS of live time after a lift was a failed trial, and the next hold is
 *   longer. A lift that survives that long starts over.
 * - The user always wins: a change of the saved camera quality, to any value, clears everything (reset()), the way to
 *   take the cap off by hand. Choosing the quality that is already selected is no change, and does nothing.
 *
 * The caps and the lifts are not free: a change to or from "low" reopens the camera and, on LiveKit, unpublishes and
 * publishes again, so the viewers see the tile go off for a moment. Hence the long windows and holds.
 *
 * Every threshold below is derived from libwebrtc's allocator rules and is NOT yet measured on a shaped link. The
 * `media.camera_cap.changed` analytics event exists to tune them: read it against `media.video_quality.sample`
 * (`bandwidthLimitedRatio`, `activeLayers`, `uploadLossRatio`, `availableOutgoingBitrate` are what a decision reads).
 *
 * Firefox and Safari report no limitation durations: the feature is inert there, by design. P2P and the SVC fallback
 * (one stream carrying its layers) are not covered either.
 */

export type UplinkLimitationAction = { kind: "cap"; level: number } | { kind: "lift"; reason: "recovered" | "idle" };

export const SAMPLE_INTERVAL_MS = 1000;
// The poll is a setInterval and an async getStats(): its readings come 1000 ms apart give or take a few, and a gate of
// exactly one interval would drop every one that comes a millisecond early, about half of them
const SAMPLE_JITTER_MS = 100;
// A publication starts with a keyframe and a rate-control ramp-up that look like a weak link
export const WARMUP_SAMPLES = 15;
export const WINDOW_SAMPLES = 30;
// More than half of the window (60 %): a link flapping around the threshold counts
export const LIMITED_SAMPLES = 18;
// A sample is limited when the sender spent at least this share of the second in "bandwidth"
const LIMITED_RATIO = 0.5;
// Long enough for the link to have changed, and the longer for each trial that failed: the last one is kept
export const HOLD_MS = [5 * 60_000, 10 * 60_000, 20 * 60_000, 60 * 60_000];
export const SURVIVAL_MS = 10 * 60_000;
// A step between two samples counts for no more than this much live time: a throttled tab is not a camera that ran
const MAX_LIVE_STEP_MS = 2000;
// What a window of live samples taken while capped must hold for the full ladder to be worth a trial
export const HEALTHY_MAX_LIMITED = 3;
export const HEALTHY_MAX_LOSS = 0.02;
// A veto only: it is about what 360p + 180p already need, a high estimate never shortens the hold
export const HEALTHY_MIN_AVAILABLE_BITRATE = 400_000;
// How long the camera must have been away for a cap to be lifted with no proof: longer than a publication takes to be
// replaced, far shorter than any hold
export const IDLE_CONFIRM_MS = 15_000;

interface HealthSample {
    limited: boolean;
    lossRatio: number | undefined;
    availableBitrate: number | undefined;
}

export interface UplinkLimitationContext {
    // The camera is held back while a screen share is being sent: it competes for the same uplink
    screenShareRunning: boolean;
    // What the user chose, not what is sent: a camera already on "low" has nothing to give up
    savedQuality: VideoQualitySetting;
}

/**
 * The encoder of the LiveKit camera, when there is exactly one. Decisions are read from `stats.encoders`, the
 * readings themselves: the aggregate drops what they need (see aggregateSenderStats).
 */
function livekitEncoder(stats: LocalEncoderStats | undefined): WebRtcSenderStats | undefined {
    return stats?.source === "Livekit" && stats.encoders.length === 1 ? stats.encoders[0] : undefined;
}

const deliversFrames = (encoder: WebRtcSenderStats) => encoder.captureFps !== undefined && encoder.captureFps >= 1;

// One sample a second whatever the number of readings, and none lost to the jitter of the poll
const isTooSoon = (now: number, lastSampleTime: number) => now - lastSampleTime < SAMPLE_INTERVAL_MS - SAMPLE_JITTER_MS;

const isLimited = (encoder: WebRtcSenderStats) =>
    encoder.bandwidthLimitedRatio !== undefined && encoder.bandwidthLimitedRatio >= LIMITED_RATIO;

export class UplinkLimitationDetector {
    // Not capped: the last eligible samples (is the largest layer limited), after the warm-up
    private samples: boolean[] = [];
    private warmup = WARMUP_SAMPLES;
    private source: string | undefined;
    private mimeType: string | undefined;
    // Of the last eligible reading: a layer that resumes (dynacast) climbs a ramp of its own
    private activeLayers: number | undefined;
    private lastSampleTime = -Infinity;

    // Live time since the last lift, while that lift is on trial: undefined once it survived, or before any lift
    private liveSinceLift: number | undefined;
    private lastEligibleTime: number | undefined;
    // Index in HOLD_MS of the current or last cap
    private level = 0;

    // Capped: when, and how the link looked since
    private cappedAt: number | undefined;
    private health: HealthSample[] = [];
    // Capped: since when no live camera has been read, undefined while one is
    private awaySince: number | undefined;

    /**
     * Feeds one reading of the camera's encoder stats. Returns the action to take when it is time. `undefined` stats
     * (nothing is published) are a reading too: when capped and the hold is over, they lift the cap once no camera has
     * been read for IDLE_CONFIRM_MS.
     */
    public sample(
        stats: LocalEncoderStats | undefined,
        context: UplinkLimitationContext,
        now: number = Date.now(),
    ): UplinkLimitationAction | undefined {
        return this.cappedAt === undefined
            ? this.sampleWhileUncapped(stats, context, now)
            : this.sampleWhileCapped(stats, context, now);
    }

    /**
     * The user chose a camera quality: whatever was decided, and whatever was learned, is void. Returns the level of
     * the cap it cleared, or undefined when the camera was not capped.
     */
    public reset(): number | undefined {
        const clearedLevel = this.cappedAt === undefined ? undefined : this.level;
        this.level = 0;
        this.liveSinceLift = undefined;
        this.cappedAt = undefined;
        this.startOver();
        return clearedLevel;
    }

    /** What is left of the hold of the current cap, or undefined when the camera is not capped. */
    public remainingHoldMs(now: number): number | undefined {
        return this.cappedAt === undefined ? undefined : Math.max(0, HOLD_MS[this.level] - (now - this.cappedAt));
    }

    /** No live camera has been read since the last reading of one, under a cap: the cap may be lifted as idle. */
    public isAway(): boolean {
        return this.cappedAt !== undefined && this.awaySince !== undefined;
    }

    /**
     * How long until the current cap can be lifted as idle if no camera comes back: whichever ends later of the hold
     * and of the time the camera must have been away. Undefined when the camera is not capped.
     */
    public idleLiftDelayMs(now: number): number | undefined {
        const hold = this.remainingHoldMs(now);
        if (hold === undefined) {
            return undefined;
        }
        const away = this.awaySince === undefined ? 0 : now - this.awaySince;
        return Math.max(hold, IDLE_CONFIRM_MS - away, 0);
    }

    private startOver(): void {
        this.samples = [];
        this.health = [];
        this.awaySince = undefined;
        this.warmup = WARMUP_SAMPLES;
        this.source = undefined;
        this.mimeType = undefined;
        this.activeLayers = undefined;
        this.lastEligibleTime = undefined;
    }

    private eligibleEncoder(
        stats: LocalEncoderStats | undefined,
        { screenShareRunning, savedQuality }: UplinkLimitationContext,
    ): WebRtcSenderStats | undefined {
        const encoder = livekitEncoder(stats);
        // With fewer than two active layers there is no largest layer to lose: a layer already off, or a room nobody
        // watches (dynacast)
        if (!encoder || !deliversFrames(encoder) || (encoder.activeLayers ?? 0) < 2) {
            return undefined;
        }
        return screenShareRunning || savedQuality === "low" ? undefined : encoder;
    }

    private sampleWhileUncapped(
        stats: LocalEncoderStats | undefined,
        context: UplinkLimitationContext,
        now: number,
    ): UplinkLimitationAction | undefined {
        const encoder = this.eligibleEncoder(stats, context);
        if (
            !encoder ||
            stats?.source !== this.source ||
            encoder.mimeType !== this.mimeType ||
            (this.activeLayers !== undefined && (encoder.activeLayers ?? 0) > this.activeLayers)
        ) {
            // A new stream, a transport switch, a codec change, a layer that resumes (the estimate was held near what
            // the other layers send, and has to climb to fund it, as after a keyframe) or a reading that proves
            // nothing: start over
            this.samples = [];
            this.warmup = WARMUP_SAMPLES;
            this.source = stats?.source;
            this.mimeType = encoder?.mimeType;
        }
        this.activeLayers = encoder?.activeLayers;
        if (!encoder) {
            this.lastEligibleTime = undefined;
            return undefined;
        }
        if (isTooSoon(now, this.lastSampleTime)) {
            return undefined;
        }
        this.lastSampleTime = now;
        this.countLiveTime(now);
        if (this.warmup > 0) {
            this.warmup--;
            return undefined;
        }
        this.samples.push(isLimited(encoder));
        if (this.samples.length > WINDOW_SAMPLES) {
            this.samples.shift();
        }
        if (this.samples.length < WINDOW_SAMPLES || this.samples.filter(Boolean).length < LIMITED_SAMPLES) {
            return undefined;
        }
        return this.cap(now);
    }

    /**
     * Time the camera really ran since the lift, in steps from one eligible sample to the next: the time with no
     * camera, with a screen share or on a link that is not LiveKit is not time the lift survived, and a tab throttled
     * to a reading a minute does not turn into a minute each.
     */
    private countLiveTime(now: number): void {
        if (this.liveSinceLift !== undefined && this.lastEligibleTime !== undefined) {
            this.liveSinceLift += Math.min(Math.max(0, now - this.lastEligibleTime), MAX_LIVE_STEP_MS);
            if (this.liveSinceLift >= SURVIVAL_MS) {
                this.level = 0;
                this.liveSinceLift = undefined;
            }
        }
        this.lastEligibleTime = now;
    }

    private cap(now: number): UplinkLimitationAction {
        // liveSinceLift is still set when the lift did not survive: its trial failed, and the hold grows
        if (this.liveSinceLift !== undefined) {
            this.level = Math.min(this.level + 1, HOLD_MS.length - 1);
        }
        this.liveSinceLift = undefined;
        this.cappedAt = now;
        this.startOver();
        return { kind: "cap", level: this.level };
    }

    private sampleWhileCapped(
        stats: LocalEncoderStats | undefined,
        { screenShareRunning }: UplinkLimitationContext,
        now: number,
    ): UplinkLimitationAction | undefined {
        const holdIsOver = this.remainingHoldMs(now) === 0;
        const encoder = livekitEncoder(stats);
        if (!encoder || !deliversFrames(encoder)) {
            // Several encoders sending the camera at once (a publication overlapping its successor) are a camera to
            // protect that cannot be read: wait for one
            if (stats?.source === "Livekit" && stats.encoders.some(deliversFrames)) {
                this.awaySince = undefined;
                return undefined;
            }
            // No camera to protect from a republish: nobody watches it, and there is nothing to learn from the link.
            // Once it has really gone, that is: a publication being replaced is away for a reading
            this.awaySince ??= now;
            return this.idleLiftDelayMs(now) === 0 ? this.lift("idle") : undefined;
        }
        this.awaySince = undefined;
        if (isTooSoon(now, this.lastSampleTime)) {
            return undefined;
        }
        this.lastSampleTime = now;
        // With no active layer nobody watches (dynacast): the ratio of a sender that sends nothing says nothing
        if ((encoder.activeLayers ?? 0) >= 1) {
            this.health.push({
                limited: isLimited(encoder),
                lossRatio: encoder.uploadLossRatio,
                availableBitrate: encoder.availableOutgoingBitrate,
            });
            if (this.health.length > WINDOW_SAMPLES) {
                this.health.shift();
            }
        }
        // A screen share is on the same uplink: wait for it to end rather than probe with it running
        if (!holdIsOver || screenShareRunning || this.health.length < WINDOW_SAMPLES || !this.linkLooksHealthy()) {
            return undefined;
        }
        return this.lift("recovered");
    }

    private linkLooksHealthy(): boolean {
        if (this.health.filter(({ limited }) => limited).length > HEALTHY_MAX_LIMITED) {
            return false;
        }
        const losses = this.health.flatMap(({ lossRatio }) => (lossRatio === undefined ? [] : [lossRatio]));
        // Rounded: thirty times 0.02 is not 0.6 in floating point, and a loss at the threshold is healthy
        const meanLoss = Math.round((losses.reduce((sum, loss) => sum + loss, 0) / losses.length) * 1e6) / 1e6;
        if (losses.length > 0 && meanLoss > HEALTHY_MAX_LOSS) {
            return false;
        }
        const estimates = this.health.flatMap(({ availableBitrate }) =>
            availableBitrate === undefined ? [] : [availableBitrate],
        );
        const latestEstimate = estimates[estimates.length - 1];
        return latestEstimate === undefined || latestEstimate >= HEALTHY_MIN_AVAILABLE_BITRATE;
    }

    private lift(reason: "recovered" | "idle"): UplinkLimitationAction {
        this.cappedAt = undefined;
        // On trial from now on, counting from zero: only live time counts (see countLiveTime)
        this.liveSinceLift = 0;
        this.startOver();
        return { kind: "lift", reason };
    }
}

/**
 * Feeds the detector with the stats of the local camera tile and applies what it decides. Subscribing is what keeps the
 * getStats() poll running, as for the CPU detectors. The saved quality is given, not read from MediaStore: this module
 * sits under the media code that reads the cap. Returns the function that stops it and its timer, which nothing needs
 * in the app, where it lives as long as the page.
 */
export function startUplinkLimitationDetector(savedQualityStore: Readable<VideoQualitySetting>): () => void {
    const detector = new UplinkLimitationDetector();
    const unsubscribers: Unsubscriber[] = [];
    let cameraStats: LocalEncoderStats | undefined;
    let screenShareRunning = false;
    let savedQuality: VideoQualitySetting = "recommended";
    let cappedLevel = 0;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;

    function clearHoldTimer(): void {
        clearTimeout(holdTimer);
        holdTimer = undefined;
    }

    // The stats store stops ticking when nothing is published, and the cap can be lifted all the same (see
    // idleLiftDelayMs): a timer does it, as nothing else may feed the detector, and goes when a camera is read again or
    // the cap goes. Armed on what the detector read, not on the stats being undefined: the last reading of a camera that
    // stopped can be a defined one
    function armHoldTimer(): void {
        clearHoldTimer();
        const remaining = detector.isAway() ? detector.idleLiftDelayMs(Date.now()) : undefined;
        if (remaining === undefined) {
            return;
        }
        holdTimer = setTimeout(() => {
            holdTimer = undefined;
            feed();
        }, remaining);
    }

    function apply(action: UplinkLimitationAction | undefined): void {
        if (!action) {
            return;
        }
        if (action.kind === "cap") {
            console.info(
                `The camera could not send its full ladder for most of the last 30 seconds: capping it to low quality (level ${action.level}, ${HOLD_MS[action.level] / 60_000} minutes at least)`,
            );
            cappedLevel = action.level;
            uplinkCapStore.set(true);
            // A trial that failed and caps again is not news a second time
            if (action.level === 0) {
                uplinkCapNoticeStore.set(true);
            }
            analyticsClient.trackAdminEvent("media.camera_cap.changed", { action: "capped", level: action.level });
        } else {
            console.info(
                action.reason === "recovered"
                    ? "The link looked healthy for the last 30 seconds: lifting the camera cap"
                    : "The hold of the camera cap is over and no camera has been sent for a while: lifting it",
            );
            uplinkCapStore.set(false);
            uplinkCapNoticeStore.set(false);
            analyticsClient.trackAdminEvent("media.camera_cap.changed", {
                action: "lifted",
                level: cappedLevel,
                reason: action.reason,
            });
        }
    }

    function feed(): void {
        apply(detector.sample(cameraStats, { screenShareRunning, savedQuality }));
        armHoldTimer();
    }

    // Module singletons in the app: only a test stops them
    unsubscribers.push(
        localEncoderStatsStore.screenSharing.subscribe((stats) => {
            screenShareRunning = stats !== undefined;
        }),
    );

    let initialQuality = true;
    unsubscribers.push(
        savedQualityStore.subscribe((quality) => {
            savedQuality = quality;
            if (initialQuality) {
                initialQuality = false;
                return;
            }
            // Whatever the user chooses wins: choosing another quality is the way to take the cap off by hand
            const clearedLevel = detector.reset();
            clearHoldTimer();
            uplinkCapStore.set(false);
            uplinkCapNoticeStore.set(false);
            if (clearedLevel !== undefined) {
                console.info("A camera quality was chosen: clearing the camera cap");
                analyticsClient.trackAdminEvent("media.camera_cap.changed", {
                    action: "cleared",
                    level: clearedLevel,
                    reason: "setting",
                });
            }
        }),
    );

    unsubscribers.push(
        localEncoderStatsStore.video.subscribe((stats) => {
            cameraStats = stats;
            feed();
        }),
    );

    return () => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
        clearHoldTimer();
    };
}
