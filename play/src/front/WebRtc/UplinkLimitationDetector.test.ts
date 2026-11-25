// @vitest-environment jsdom
import { get, writable, type Writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { VideoQualitySetting } from "../Connection/LocalUserStore";
import type { WebRtcSenderStats } from "../Components/Video/WebRtcStats";
import { registerLocalEncoderStats, type LocalEncoderStats } from "./LocalEncoderStats";
import { uplinkCapNoticeStore, uplinkCapStore } from "./UplinkCap";
import {
    CAP_ESTIMATE_LINE,
    HEALTHY_MAX_LIMITED,
    HEALTHY_MAX_LOSS,
    HEALTHY_MIN_AVAILABLE_BITRATE,
    HOLD_MS,
    IDLE_CONFIRM_MS,
    LIMITED_SAMPLES,
    LOWER_LAYERS_BITRATE,
    LOWER_LAYERS_SHARE,
    SAMPLE_INTERVAL_MS,
    startUplinkLimitationDetector,
    SURVIVAL_MS,
    UplinkLimitationDetector,
    WARMUP_SAMPLES,
    WINDOW_SAMPLES,
    type UplinkLimitationAction,
} from "./UplinkLimitationDetector";

const trackAdminEvent = vi.hoisted(() => vi.fn());
vi.mock("../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent } }));

// One LiveKit camera that goes out as a full ladder, on a link that carries it: every field a decision may read
function encoder(extra: Partial<WebRtcSenderStats> = {}): WebRtcSenderStats {
    return {
        source: "Livekit",
        frameWidth: 1280,
        frameHeight: 720,
        mimeType: "video/VP9",
        bandwidth: 0,
        fps: 30,
        qualityLimitationReason: "none",
        encoderImplementation: "libvpx",
        captureFps: 30,
        activeLayers: 3,
        bandwidthLimitedRatio: 0,
        uploadLossRatio: 0,
        availableOutgoingBitrate: 2_000_000,
        ...extra,
    };
}

function stats(extra: Partial<WebRtcSenderStats> = {}, encoders?: WebRtcSenderStats[]): LocalEncoderStats {
    const single = encoder(extra);
    return { ...single, encoders: encoders ?? [single] };
}

// What a reading must show to count toward a cap: the allocator could not fund the largest layer for most of the second,
// and the estimate is under CAP_ESTIMATE_LINE (the trial of the 600 kbps run of the first two batches measured 369 to
// 518 kbps). The estimate is above HEALTHY_MIN_AVAILABLE_BITRATE: a lift test that ends on limited samples is about
// their number, not the estimate.
const limitedReading: Partial<WebRtcSenderStats> = { bandwidthLimitedRatio: 0.8, availableOutgoingBitrate: 500_000 };
const limited = (count: number, extra: Partial<WebRtcSenderStats> = {}) =>
    Array<LocalEncoderStats>(count).fill(stats({ ...limitedReading, ...extra }));
const fine = (count: number, extra: Partial<WebRtcSenderStats> = {}) =>
    Array<LocalEncoderStats>(count).fill(stats(extra));

// The shortest episode that can produce a cap: the warm-up, then a full window. Its last sample is second 44.
const weakUplink = () => limited(WARMUP_SAMPLES + WINDOW_SAMPLES);
const FIRST_CAP_SECOND = WARMUP_SAMPLES + WINDOW_SAMPLES - 1;

const describeAction = (action: UplinkLimitationAction) =>
    action.kind === "cap" ? `cap:${action.level}` : `lift:${action.reason}`;

interface Context {
    screenShareRunning: boolean;
    savedQuality: VideoQualitySetting;
}

// A clock the test moves by the second, and the decisions in order with the second they were taken at
function scenario(context: Context = { screenShareRunning: false, savedQuality: "recommended" }) {
    const detector = new UplinkLimitationDetector();
    const decisions: [number, string][] = [];
    let now = 0;
    const feed = (sample: LocalEncoderStats | undefined) => {
        const action = detector.sample(sample, context, now);
        if (action) {
            decisions.push([now / 1000, describeAction(action)]);
        }
        now += SAMPLE_INTERVAL_MS;
    };
    return {
        detector,
        decisions,
        context,
        // One sample a second from the current time on
        seconds: (samples: (LocalEncoderStats | undefined)[]) => samples.forEach(feed),
        at: (second: number) => {
            now = second * 1000;
        },
        wait: (ms: number) => {
            now += ms;
        },
    };
}

const HOLD_SECONDS = HOLD_MS.map((ms) => ms / 1000);
const IDLE_CONFIRM_SECONDS = IDLE_CONFIRM_MS / 1000;

describe("UplinkLimitationDetector thresholds", () => {
    it("keeps the schedule the allocator rules were read against", () => {
        expect(SAMPLE_INTERVAL_MS).toBe(1000);
        expect(WARMUP_SAMPLES).toBe(15);
        expect(WINDOW_SAMPLES).toBe(30);
        expect(LIMITED_SAMPLES).toBe(18);
        expect(HOLD_MS).toEqual([5 * 60_000, 10 * 60_000, 20 * 60_000, 60 * 60_000]);
        expect(SURVIVAL_MS).toBe(10 * 60_000);
        expect(HEALTHY_MAX_LIMITED).toBe(3);
        expect(HEALTHY_MAX_LOSS).toBe(0.02);
        expect(HEALTHY_MIN_AVAILABLE_BITRATE).toBe(400_000);
        expect(IDLE_CONFIRM_MS).toBe(15_000);
        // 360p (450 kbps) + 180p (160 kbps): UplinkLimitationDetector.livekit.test.ts checks them against livekit-client
        expect(LOWER_LAYERS_BITRATE).toBe(610_000);
        // 90 % of it: a choice inside the bracket the shaped links gave (the cap helped under 518 kbps, not from a median
        // of 583 kbps up; first two batches, one run per rate, the 700 and 800 kbps runs noisy), not a measured threshold
        expect(LOWER_LAYERS_SHARE).toBe(0.9);
        expect(CAP_ESTIMATE_LINE).toBe(549_000);
    });
});

describe("UplinkLimitationDetector, capping", () => {
    it("caps at the 45th second of a link that cannot carry the 360p + 180p layers, and only once however long it stays weak", () => {
        const sc = scenario();

        sc.seconds(limited(WARMUP_SAMPLES + 10 * WINDOW_SAMPLES));

        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);
    });

    it("leaves the samples of the warm-up out of the window", () => {
        const sc = scenario();

        // Counted, the first thirty samples would hold LIMITED_SAMPLES limited ones: only the last three are past the
        // warm-up, and the rest of the window is fine
        sc.seconds([...limited(LIMITED_SAMPLES), ...fine(WARMUP_SAMPLES + WINDOW_SAMPLES)]);

        expect(sc.decisions).toEqual([]);
    });

    it("ignores a dip of ten seconds", () => {
        const sc = scenario();

        sc.seconds([...fine(WARMUP_SAMPLES + 10), ...limited(10), ...fine(WINDOW_SAMPLES)]);

        expect(sc.decisions).toEqual([]);
    });

    it("caps with exactly the limited samples it asks for, not with one fewer", () => {
        const withLimited = (count: number) => {
            const sc = scenario();
            sc.seconds([...fine(WARMUP_SAMPLES + WINDOW_SAMPLES - count), ...limited(count)]);
            return sc.decisions;
        };

        expect(withLimited(LIMITED_SAMPLES - 1)).toEqual([]);
        expect(withLimited(LIMITED_SAMPLES)).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);
    });

    it("caps a flapping link that is limited two thirds of the time", () => {
        const sc = scenario();
        const flapping = Array.from({ length: WARMUP_SAMPLES + WINDOW_SAMPLES }, (_, second) =>
            second % 3 === 2 ? fine(1)[0] : limited(1)[0],
        );

        sc.seconds(flapping);

        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);
    });

    it.each([
        ["only one layer is active (a viewer-less room, or a layer already off)", { activeLayers: 1 }],
        ["the camera delivers no frames", { captureFps: 0 }],
        ["the camera does not report its frame rate", { captureFps: undefined }],
        ["the sender is a P2P peer connection", { source: "P2P" }],
    ])("does not cap when %s", (_, extra) => {
        const sc = scenario();

        sc.seconds(limited(WARMUP_SAMPLES + 2 * WINDOW_SAMPLES, extra));

        expect(sc.decisions).toEqual([]);
    });

    it("caps a camera that sends 360p + 180p, whose two active layers are the production shape of a capped one", () => {
        const sc = scenario();

        sc.seconds(limited(WARMUP_SAMPLES + WINDOW_SAMPLES, { activeLayers: 2 }));

        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);
    });

    it.each([
        ["a ratio just under half the second is not limited", 0.49, []],
        ["a ratio of half the second is limited", 0.5, [[FIRST_CAP_SECOND, "cap:0"]]],
    ])("%s", (_, bandwidthLimitedRatio, decisions) => {
        const sc = scenario();

        sc.seconds(limited(WARMUP_SAMPLES + WINDOW_SAMPLES, { bandwidthLimitedRatio }));

        expect(sc.decisions).toEqual(decisions);
    });

    it.each([
        ["a camera under one frame a second delivers none", 0.99, []],
        ["a camera at one frame a second does deliver", 1, [[FIRST_CAP_SECOND, "cap:0"]]],
    ])("%s", (_, captureFps, decisions) => {
        const sc = scenario();

        sc.seconds(limited(WARMUP_SAMPLES + WINDOW_SAMPLES, { captureFps }));

        expect(sc.decisions).toEqual(decisions);
    });

    it("does not cap when the browser reports no bandwidth limitation duration", () => {
        const sc = scenario();

        sc.seconds(limited(WARMUP_SAMPLES + 2 * WINDOW_SAMPLES, { bandwidthLimitedRatio: undefined }));

        expect(sc.decisions).toEqual([]);
    });

    it("does not cap when two encoders are running", () => {
        const sc = scenario();
        const two = stats(limitedReading, [encoder(limitedReading), encoder(limitedReading)]);

        sc.seconds(Array<LocalEncoderStats>(WARMUP_SAMPLES + 2 * WINDOW_SAMPLES).fill(two));

        expect(sc.decisions).toEqual([]);
    });

    it("does not cap while a screen share is running, which competes for the same uplink", () => {
        const sc = scenario({ screenShareRunning: true, savedQuality: "recommended" });

        sc.seconds(weakUplink());

        expect(sc.decisions).toEqual([]);
    });

    it("does not cap a camera the user already set to low", () => {
        const sc = scenario({ screenShareRunning: false, savedQuality: "low" });

        sc.seconds(weakUplink());

        expect(sc.decisions).toEqual([]);
    });

    it("starts over when a reading is missing, ineligible, or the codec changes", () => {
        // One sample short of a cap, twice: a cap only comes if the second run continues the first
        const almost = limited(WARMUP_SAMPLES + WINDOW_SAMPLES - 1);
        const rest = limited(WARMUP_SAMPLES + WINDOW_SAMPLES - 2);
        const after = (change: LocalEncoderStats | undefined) => {
            const sc = scenario();
            sc.seconds([...almost, change, ...rest]);
            return sc.decisions;
        };

        expect(after(undefined)).toEqual([]);
        expect(after(stats({ ...limitedReading, activeLayers: 1 }))).toEqual([]);
        expect(after(stats({ ...limitedReading, source: "P2P" }))).toEqual([]);
        expect(after(stats({ ...limitedReading, mimeType: "video/VP8" }))).toEqual([]);
        // The control: the same samples with a limited reading in the middle do make the cap
        expect(after(stats(limitedReading))).toHaveLength(1);
    });

    it("starts a new warm-up when a layer that was off resumes, whose ramp-up looks like a weak link", () => {
        const resumed = () => {
            const sc = scenario();
            // A viewer joins after a minute and a half: dynacast resumes the largest layer, which the estimate (held
            // near what two layers send) has to climb to fund
            sc.seconds([
                ...fine(WARMUP_SAMPLES + WINDOW_SAMPLES, { activeLayers: 2 }),
                ...limited(LIMITED_SAMPLES, { activeLayers: 3 }),
            ]);
            return sc.decisions;
        };
        const stayedOff = () => {
            const sc = scenario();
            sc.seconds([
                ...fine(WARMUP_SAMPLES + WINDOW_SAMPLES, { activeLayers: 2 }),
                ...limited(LIMITED_SAMPLES, { activeLayers: 2 }),
            ]);
            return sc.decisions;
        };

        expect(resumed()).toEqual([]);
        // The control: the same limited samples, with no layer resuming, do make the cap
        expect(stayedOff()).toEqual([[WARMUP_SAMPLES + WINDOW_SAMPLES + LIMITED_SAMPLES - 1, "cap:0"]]);
    });

    it("takes one sample a second, however fast the readings arrive", () => {
        const detector = new UplinkLimitationDetector();
        const context = { screenShareRunning: false, savedQuality: "recommended" } as const;
        const capTimes: number[] = [];

        // A reading every 250 ms for a little more than the 45 s a cap needs
        for (let now = 0; now <= 50_000; now += 250) {
            if (detector.sample(stats(limitedReading), context, now)) {
                capTimes.push(now);
            }
        }

        expect(capTimes).toEqual([44_000]);
    });

    it("does not lose a sample to the jitter of a one second poll", () => {
        const detector = new UplinkLimitationDetector();
        const context = { screenShareRunning: false, savedQuality: "recommended" } as const;
        const capTimes: number[] = [];

        // The poll is a setInterval and an async getStats(): readings 994 and 1006 ms apart, never exactly 1000
        for (let reading = 0; reading <= 50; reading++) {
            const now = reading * 1000 + (reading % 2 === 0 ? 3 : -3);
            if (detector.sample(stats(limitedReading), context, now)) {
                capTimes.push(now);
            }
        }

        expect(capTimes).toEqual([44_003]);
    });
});

describe("UplinkLimitationDetector, what counts toward a cap", () => {
    // The largest layer is limited in every reading, and the estimate follows `estimates`, one value a second
    const limitedWith = (estimates: (number | undefined)[]) =>
        estimates.map((availableOutgoingBitrate) => stats({ ...limitedReading, availableOutgoingBitrate }));
    // The estimate moves between the two ends of the range a shaped link gave
    const between = (low: number, high: number, count: number) =>
        limitedWith(Array.from({ length: count }, (_, second) => (second % 2 === 0 ? low : high)));

    it.each([
        ["1 Mbps", 717_000, 947_000],
        ["1.3 Mbps", 917_000, 1_244_000],
    ])(
        "never caps a camera whose largest layer is limited all the time on a %s uplink: the estimate funds the 360p layer",
        (_, low, high) => {
            const sc = scenario();

            sc.seconds(between(low, high, WARMUP_SAMPLES + 4 * WINDOW_SAMPLES));

            expect(sc.decisions).toEqual([]);
        },
    );

    it("caps the same camera at the same second on a 600 kbps uplink: the estimate cannot fund the 360p layer", () => {
        const sc = scenario();

        sc.seconds(between(369_000, 518_000, WARMUP_SAMPLES + WINDOW_SAMPLES));

        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);
    });

    it("does not count a reading with no estimate, however long the largest layer stays limited", () => {
        const sc = scenario();

        sc.seconds(limited(WARMUP_SAMPLES + 4 * WINDOW_SAMPLES, { availableOutgoingBitrate: undefined }));

        expect(sc.decisions).toEqual([]);
    });

    it.each([
        ["does not cap with one reading under the line fewer than a cap asks for", LIMITED_SAMPLES - 1, []],
        ["caps with as many readings under the line as a cap asks for", LIMITED_SAMPLES, [[FIRST_CAP_SECOND, "cap:0"]]],
    ])("%s, the rest of the window having no estimate", (_, withEstimate, decisions) => {
        const sc = scenario();

        sc.seconds([
            ...fine(WARMUP_SAMPLES),
            ...limited(WINDOW_SAMPLES - withEstimate, { availableOutgoingBitrate: undefined }),
            ...limited(withEstimate),
        ]);

        expect(sc.decisions).toEqual(decisions);
    });

    // The trials of the first two batches of 2026-11-25 on a shaped link (one run per rate, a loaded host, the 700 and
    // 800 kbps runs noisy): the range and the median of the estimate are measured, the readings in between are not kept
    // here. Each window below is built to match them, 30 readings in kbps from the lowest to the highest, and is played
    // in a fixed shuffled order (7 is coprime with 30, so every stretch of 30 seconds holds each reading once) so that the
    // estimate moves as it did. They show how the rule treats such a window, not what those runs would have done: the
    // median alone leaves the count under the line open.
    describe("on the estimates a shaped link gave, the largest layer limited in every reading", () => {
        const trial = {
            // 418 to 713 kbps, median 583: 12 readings under the line, 7 more between the line and what the two lower
            // layers ask for. The median alone allows at most 15 under the line, short of the 18 a cap asks for. A line at
            // LOWER_LAYERS_BITRATE would have counted 19 of this window's 30 readings and capped it, where the viewer got
            // 360p all the time in the trial of the real link, without a cap
            "800 kbps": [
                418, 430, 445, 458, 470, 485, 497, 510, 522, 531, 540, 546, 560, 575, 583, 583, 590, 598, 606, 615, 624,
                633, 642, 651, 660, 672, 683, 694, 704, 713,
            ],
            // 225 to 602 kbps, median 433: 22 readings under the line, 8 over it. The median alone puts at least 15 under
            // the line, and the range allows up to 29: this is one window the same figures allow, with enough under the
            // line to cap
            "700 kbps": [
                225, 250, 275, 300, 325, 350, 370, 390, 405, 415, 422, 427, 430, 432, 433, 433, 460, 480, 500, 520, 535,
                545, 552, 560, 568, 575, 582, 590, 596, 602,
            ],
        };
        const median = (sorted: number[]) => (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        const underTheLine = (sorted: number[]) => sorted.filter((kbps) => kbps * 1000 < CAP_ESTIMATE_LINE).length;
        const played = (sorted: number[], seconds: number) =>
            limitedWith(Array.from({ length: seconds }, (_, second) => sorted[(second * 7) % sorted.length] * 1000));

        it("builds the windows the readings describe", () => {
            for (const sorted of Object.values(trial)) {
                expect(sorted).toHaveLength(WINDOW_SAMPLES);
                expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
            }
            expect([trial["800 kbps"][0], median(trial["800 kbps"]), trial["800 kbps"][29]]).toEqual([418, 583, 713]);
            expect([trial["700 kbps"][0], median(trial["700 kbps"]), trial["700 kbps"][29]]).toEqual([225, 433, 602]);
            expect(underTheLine(trial["800 kbps"])).toBe(12);
            expect(underTheLine(trial["700 kbps"])).toBe(22);
        });

        it("never caps an estimate like the 800 kbps trial: fewer than a cap asks for are under the line", () => {
            const sc = scenario();

            sc.seconds([...fine(WARMUP_SAMPLES), ...played(trial["800 kbps"], 4 * WINDOW_SAMPLES)]);

            expect(underTheLine(trial["800 kbps"])).toBeLessThan(LIMITED_SAMPLES);
            expect(sc.decisions).toEqual([]);
        });

        it("caps an estimate like the 700 kbps trial, at the first full window", () => {
            const sc = scenario();

            sc.seconds([...fine(WARMUP_SAMPLES), ...played(trial["700 kbps"], 4 * WINDOW_SAMPLES)]);

            expect(underTheLine(trial["700 kbps"])).toBeGreaterThanOrEqual(LIMITED_SAMPLES);
            expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);
        });
    });

    describe("on a link that hovers around the line", () => {
        const under = CAP_ESTIMATE_LINE - 10_000;
        const over = CAP_ESTIMATE_LINE + 10_000;
        // Under the line three seconds in five: 18 of a window of 30. The same with its first second over: 17.
        const eighteenOfThirty = Array.from({ length: WINDOW_SAMPLES }, (_, second) => second % 5 < 3);
        const seventeenOfThirty = eighteenOfThirty.map((isUnder, second) => isUnder && second !== 0);
        const hover = (isUnder: boolean[]) => limitedWith(isUnder.map((below) => (below ? under : over)));

        it.each([
            ["17 of the last 30 readings under the line: no cap", seventeenOfThirty, []],
            ["18 of the last 30 readings under the line: a cap", eighteenOfThirty, [[FIRST_CAP_SECOND, "cap:0"]]],
            [
                "17 of the last 30, then a reading under the line that pushes an over one out of the window: a cap",
                [...seventeenOfThirty, true],
                [[FIRST_CAP_SECOND + 1, "cap:0"]],
            ],
        ])("%s", (_, isUnder, decisions) => {
            const sc = scenario();

            sc.seconds([...fine(WARMUP_SAMPLES), ...hover(isUnder)]);

            expect(sc.decisions).toEqual(decisions);
        });
    });

    it.each([
        ["an estimate exactly at the line does not count", CAP_ESTIMATE_LINE, []],
        ["an estimate one bit per second under the line counts", CAP_ESTIMATE_LINE - 1, [[FIRST_CAP_SECOND, "cap:0"]]],
        // The same two rows with the figure written out, so that the boundary is pinned apart from the exported line
        ["an estimate of 549 000 bits per second does not count", 549_000, []],
        ["an estimate of 548 999 bits per second counts", 548_999, [[FIRST_CAP_SECOND, "cap:0"]]],
        // The median of the 800 kbps trial: the browser's estimate funds the 360p layer there, and the viewer got 360p all
        // the time in that trial, without a cap
        ["an estimate between the line and what the two lower layers ask for does not count (583 kbps)", 583_000, []],
        [
            "an estimate one bit per second under what the two lower layers ask for does not count: that was the line once",
            LOWER_LAYERS_BITRATE - 1,
            [],
        ],
    ])("%s", (_, availableOutgoingBitrate, decisions) => {
        const sc = scenario();

        sc.seconds(limited(WARMUP_SAMPLES + WINDOW_SAMPLES, { availableOutgoingBitrate }));

        expect(sc.decisions).toEqual(decisions);
    });

    it("does not count an estimate under the line while the largest layer is not limited", () => {
        const sc = scenario();

        sc.seconds(fine(WARMUP_SAMPLES + 2 * WINDOW_SAMPLES, { availableOutgoingBitrate: CAP_ESTIMATE_LINE - 1 }));

        expect(sc.decisions).toEqual([]);
    });
});

describe("UplinkLimitationDetector, lifting", () => {
    // The cap of every test below is taken at second 44, level 0, hold of 300 s: the hold is over at second 344
    const HOLD_OVER = FIRST_CAP_SECOND + HOLD_SECONDS[0];

    // Capped at second 44, then `window` is fed one sample a second so that its last sample is the one the hold ends on.
    // `afterCap` is what changes once the camera is capped (a screen share starting, which would have kept it from being).
    function cappedLinkWithTheHoldEndingOn(window: (LocalEncoderStats | undefined)[], afterCap: Partial<Context> = {}) {
        const sc = scenario();
        sc.seconds(weakUplink());
        Object.assign(sc.context, afterCap);
        sc.at(HOLD_OVER - (window.length - 1));
        sc.seconds(window);
        return sc;
    }

    it("lifts when the hold has elapsed and nothing has been published since the cap, to the second", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        // The camera goes off, and the stats with it: no reading until the hold ends
        sc.seconds([undefined]);

        sc.at(HOLD_OVER - 1);
        sc.seconds([undefined, undefined]);

        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER, "lift:idle"],
        ]);
    });

    // One reading a second from the end of the hold on: the first says the camera is away, the last that it has been
    // for IDLE_CONFIRM_MS
    const awayLongEnough = <T>(reading: T) => Array<T>(IDLE_CONFIRM_SECONDS + 1).fill(reading);

    it.each([
        ["the camera is off", undefined],
        ["the room moved to P2P", stats({ source: "P2P" })],
        ["the camera delivers no frames", stats({ captureFps: 0 })],
        ["the camera does not report its frame rate", stats({ captureFps: undefined })],
    ])("lifts once the hold has elapsed and %s for fifteen seconds, nobody watches a republish", (_, reading) => {
        const sc = scenario();
        sc.seconds(weakUplink());

        sc.at(HOLD_OVER);
        sc.seconds(awayLongEnough(reading));

        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER + IDLE_CONFIRM_SECONDS, "lift:idle"],
        ]);
    });

    it("keeps the cap when the camera is away for a reading, a publication being replaced on a link still weak", () => {
        const sc = scenario();
        sc.seconds(weakUplink());

        sc.at(HOLD_OVER);
        // A reconnection: no stats for a moment, then the same camera on the same link
        sc.seconds([...limited(WINDOW_SAMPLES), undefined, ...limited(WINDOW_SAMPLES), undefined, ...limited(5)]);

        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);
    });

    it("starts counting the time away again each time the camera comes back", () => {
        const sc = scenario();
        sc.seconds(weakUplink());

        sc.at(HOLD_OVER);
        // Fourteen seconds away, one live reading, fourteen away: never fifteen in a row
        sc.seconds([
            ...Array<undefined>(IDLE_CONFIRM_SECONDS).fill(undefined),
            ...limited(1),
            ...Array<undefined>(IDLE_CONFIRM_SECONDS).fill(undefined),
        ]);
        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);

        sc.seconds([undefined]);
        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER + 2 * IDLE_CONFIRM_SECONDS + 1, "lift:idle"],
        ]);
    });

    it("counts the time away before the hold ends, and says how long is left until the lift", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        const second = (value: number) => value * 1000;

        // Live and capped: the rest of the hold, and at least the time the camera would have to be away
        expect(sc.detector.idleLiftDelayMs(second(FIRST_CAP_SECOND + 1))).toBe(HOLD_MS[0] - 1000);
        expect(sc.detector.idleLiftDelayMs(second(HOLD_OVER + 5))).toBe(IDLE_CONFIRM_MS);

        // Away from five seconds before the end of the hold
        sc.at(HOLD_OVER - 5);
        sc.seconds([undefined]);
        expect(sc.detector.idleLiftDelayMs(second(HOLD_OVER - 4))).toBe(IDLE_CONFIRM_MS - 1000);
        sc.at(HOLD_OVER + IDLE_CONFIRM_SECONDS - 6);
        sc.seconds([undefined, undefined]);

        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER + IDLE_CONFIRM_SECONDS - 5, "lift:idle"],
        ]);
        expect(sc.detector.idleLiftDelayMs(second(HOLD_OVER + IDLE_CONFIRM_SECONDS))).toBeUndefined();
    });

    it("waits while two encoders are sending the camera, which is no camera off and no link to read", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        // The old and the new publication, overlapping for a moment
        const overlap = stats({}, [encoder(), encoder()]);

        sc.at(HOLD_OVER);
        sc.seconds([overlap]);
        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);

        sc.seconds(fine(WINDOW_SAMPLES));
        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER + WINDOW_SAMPLES, "lift:recovered"],
        ]);
    });

    it("counts an overlap of two encoders as a camera: the time away starts over after it", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        const overlap = stats({}, [encoder(), encoder()]);

        sc.at(HOLD_OVER);
        sc.seconds([
            ...Array<undefined>(10).fill(undefined),
            ...Array<LocalEncoderStats>(5).fill(overlap),
            ...Array<undefined>(IDLE_CONFIRM_SECONDS).fill(undefined),
        ]);
        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);

        sc.seconds([undefined]);
        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER + 10 + 5 + IDLE_CONFIRM_SECONDS, "lift:idle"],
        ]);
    });

    it("lifts as idle when two encoders are registered and neither delivers frames", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        const paused = stats({}, [encoder({ captureFps: 0 }), encoder({ captureFps: undefined })]);

        sc.at(HOLD_OVER);
        sc.seconds(awayLongEnough(paused));

        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER + IDLE_CONFIRM_SECONDS, "lift:idle"],
        ]);
    });

    it("lifts as idle for a camera that is off, even with a screen share running", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        sc.context.screenShareRunning = true;

        sc.at(HOLD_OVER);
        sc.seconds(awayLongEnough(undefined));

        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER + IDLE_CONFIRM_SECONDS, "lift:idle"],
        ]);
    });

    it("never lifts before the hold has elapsed, however healthy the link looks", () => {
        const sc = scenario();
        sc.seconds(weakUplink());

        // 10 Mbit/s estimate and no loss for a hundred seconds: a high estimate never shortens the hold
        sc.seconds(fine(100, { availableOutgoingBitrate: 10_000_000 }));

        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);
    });

    it("lifts once the hold has elapsed and the last window of live samples is healthy", () => {
        const sc = cappedLinkWithTheHoldEndingOn(fine(WINDOW_SAMPLES));

        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER, "lift:recovered"],
        ]);
    });

    it("waits for a full window of live samples", () => {
        const sc = cappedLinkWithTheHoldEndingOn(fine(WINDOW_SAMPLES - 1));

        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);
    });

    it("waits while a screen share is running, then lifts on the next healthy sample", () => {
        const sc = cappedLinkWithTheHoldEndingOn(fine(WINDOW_SAMPLES), { screenShareRunning: true });
        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);

        sc.context.screenShareRunning = false;
        sc.seconds(fine(1));

        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER + 1, "lift:recovered"],
        ]);
    });

    it("does not lift with more than the limited samples a healthy window may hold", () => {
        const lifts = (count: number) =>
            cappedLinkWithTheHoldEndingOn([...fine(WINDOW_SAMPLES - count), ...limited(count)]).decisions.slice(1);

        expect(lifts(HEALTHY_MAX_LIMITED + 1)).toEqual([]);
        expect(lifts(HEALTHY_MAX_LIMITED)).toEqual([[HOLD_OVER, "lift:recovered"]]);
    });

    it("counts a limited sample against the lift whatever the estimate says", () => {
        // The estimate only decides the cap: while capped it is frozen, and a limited second is a limited second
        const aboveTheLine = { availableOutgoingBitrate: CAP_ESTIMATE_LINE + 1 };
        const lifts = (count: number) =>
            cappedLinkWithTheHoldEndingOn([
                ...fine(WINDOW_SAMPLES - count),
                ...limited(count, aboveTheLine),
            ]).decisions.slice(1);

        expect(lifts(HEALTHY_MAX_LIMITED + 1)).toEqual([]);
        expect(lifts(HEALTHY_MAX_LIMITED)).toEqual([[HOLD_OVER, "lift:recovered"]]);
    });

    it("does not lift while the mean loss of the window is above what a healthy link loses", () => {
        const lifts = (loss: number) =>
            cappedLinkWithTheHoldEndingOn(fine(WINDOW_SAMPLES, { uploadLossRatio: loss })).decisions.slice(1);

        expect(lifts(0.03)).toEqual([]);
        expect(lifts(HEALTHY_MAX_LOSS)).toEqual([[HOLD_OVER, "lift:recovered"]]);
    });

    it("weighs the mean loss, so that one lossy second does not hold the cap", () => {
        const sc = cappedLinkWithTheHoldEndingOn([...fine(WINDOW_SAMPLES - 1), ...fine(1, { uploadLossRatio: 0.5 })]);

        expect(sc.decisions.slice(1)).toEqual([[HOLD_OVER, "lift:recovered"]]);
    });

    it("takes the mean over the samples that report a loss, and none is no objection", () => {
        const unreported = (count: number) => fine(count, { uploadLossRatio: undefined });
        const lifts = (window: LocalEncoderStats[]) => cappedLinkWithTheHoldEndingOn(window).decisions.slice(1);

        expect(lifts([...unreported(10), ...fine(20, { uploadLossRatio: 0.03 })])).toEqual([]);
        expect(lifts(unreported(WINDOW_SAMPLES))).toEqual([[HOLD_OVER, "lift:recovered"]]);
    });

    it("does not lift while the latest bandwidth estimate cannot carry the 360p + 180p it already sends", () => {
        const lifts = (available: number | undefined) =>
            cappedLinkWithTheHoldEndingOn(
                fine(WINDOW_SAMPLES, { availableOutgoingBitrate: available }),
            ).decisions.slice(1);

        expect(lifts(HEALTHY_MIN_AVAILABLE_BITRATE - 1)).toEqual([]);
        expect(lifts(HEALTHY_MIN_AVAILABLE_BITRATE)).toEqual([[HOLD_OVER, "lift:recovered"]]);
        // A browser that does not report an estimate does not veto
        expect(lifts(undefined)).toEqual([[HOLD_OVER, "lift:recovered"]]);
    });

    it("judges the estimate by its latest value, not by the worst one of the window", () => {
        const sc = cappedLinkWithTheHoldEndingOn([
            ...fine(WINDOW_SAMPLES - 1, { availableOutgoingBitrate: 100_000 }),
            ...fine(1, { availableOutgoingBitrate: 2_000_000 }),
        ]);

        expect(sc.decisions.slice(1)).toEqual([[HOLD_OVER, "lift:recovered"]]);
    });

    it("lets samples of a camera nobody watches neither advance nor clear the healthy window", () => {
        const nobodyWatching = fine(10, { activeLayers: 0, bandwidthLimitedRatio: 1, uploadLossRatio: 0.5 });
        const sc = cappedLinkWithTheHoldEndingOn([...fine(WINDOW_SAMPLES - 1), ...nobodyWatching]);
        // Neither a full window (they did not advance it), nor an unhealthy one (they did not clear or fill it)
        expect(sc.decisions).toEqual([[FIRST_CAP_SECOND, "cap:0"]]);

        sc.seconds(fine(1));

        expect(sc.decisions).toEqual([
            [FIRST_CAP_SECOND, "cap:0"],
            [HOLD_OVER + 1, "lift:recovered"],
        ]);
    });

    it.each([
        ["two layers, 360p + 180p, as a capped camera sends", 2],
        ["one layer, when a viewer asks for the smallest tile only", 1],
    ])("counts the samples of a camera sending %s", (_, activeLayers) => {
        const sc = cappedLinkWithTheHoldEndingOn(fine(WINDOW_SAMPLES, { activeLayers }));

        expect(sc.decisions.slice(1)).toEqual([[HOLD_OVER, "lift:recovered"]]);
    });

    it("lets readings of no live camera neither advance nor clear the healthy window while the hold runs", () => {
        const noLiveCamera = [undefined, stats({ source: "P2P" }), stats({ captureFps: 0 })];
        // A full healthy window, then readings that prove nothing, then the one live sample the hold ends on
        const sc = cappedLinkWithTheHoldEndingOn([...fine(WINDOW_SAMPLES), ...noLiveCamera, ...fine(1)]);

        expect(sc.decisions.slice(1)).toEqual([[HOLD_OVER, "lift:recovered"]]);
    });

    it("takes one sample a second while capped, however fast the readings arrive", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        const decisions: string[] = [];
        const lastReadingAt = (HOLD_OVER + 30) * 1000;

        // A reading every 250 ms from ten seconds before the hold ends to the end of the window: ten seconds of the
        // window are used before one a second takes over, and fast readings would have filled it long before
        for (let now = (HOLD_OVER - 10) * 1000; now <= lastReadingAt; now += now < HOLD_OVER * 1000 ? 250 : 1000) {
            const action = sc.detector.sample(stats(), sc.context, now);
            if (action) {
                decisions.push(`${now / 1000}:${describeAction(action)}`);
            }
        }

        // Eleven samples by the end of the hold (one a second, the first and last included), thirty at the 19th second
        expect(decisions).toEqual([`${HOLD_OVER + 19}:lift:recovered`]);
    });

    it("reports how much of the hold is left, and nothing when not capped", () => {
        const sc = scenario();
        expect(sc.detector.remainingHoldMs(0)).toBeUndefined();

        sc.seconds(weakUplink());

        expect(sc.detector.remainingHoldMs(FIRST_CAP_SECOND * 1000 + 1000)).toBe(HOLD_MS[0] - 1000);
        expect(sc.detector.remainingHoldMs(HOLD_OVER * 1000 + 5000)).toBe(0);
    });
});

describe("UplinkLimitationDetector, backing off", () => {
    // The camera goes off once capped, the cap lifts as idle at the end of its hold, and the camera comes back on a link
    // that is as weak as before
    function capAndLiftAsIdle(sc: ReturnType<typeof scenario>, hold: number) {
        sc.seconds(weakUplink());
        const [capSecond] = sc.decisions[sc.decisions.length - 1];
        sc.seconds([undefined]);
        sc.at(capSecond + hold);
        sc.seconds([undefined]);
    }

    it("raises the level each time a cap comes back within ten minutes of live time, and stays on the last", () => {
        const sc = scenario();

        capAndLiftAsIdle(sc, HOLD_SECONDS[0]);
        capAndLiftAsIdle(sc, HOLD_SECONDS[1]);
        capAndLiftAsIdle(sc, HOLD_SECONDS[2]);
        capAndLiftAsIdle(sc, HOLD_SECONDS[3]);
        capAndLiftAsIdle(sc, HOLD_SECONDS[3]);

        expect(sc.decisions.map(([, decision]) => decision)).toEqual([
            "cap:0",
            "lift:idle",
            "cap:1",
            "lift:idle",
            "cap:2",
            "lift:idle",
            "cap:3",
            "lift:idle",
            "cap:3",
            "lift:idle",
        ]);
    });

    it("forgets how long the camera was away under the cap before: a new cap counts from its own readings", () => {
        const sc = scenario();
        capAndLiftAsIdle(sc, HOLD_SECONDS[0]);
        sc.seconds(weakUplink());
        const [secondCap] = sc.decisions[sc.decisions.length - 1];

        // The first reading with no camera comes when the hold of the second cap ends: fifteen seconds to go
        sc.at(secondCap + HOLD_SECONDS[1]);
        sc.seconds(Array<undefined>(IDLE_CONFIRM_SECONDS).fill(undefined));
        expect(sc.decisions.map(([, decision]) => decision)).toEqual(["cap:0", "lift:idle", "cap:1"]);

        sc.seconds([undefined]);
        expect(sc.decisions[sc.decisions.length - 1]).toEqual([
            secondCap + HOLD_SECONDS[1] + IDLE_CONFIRM_SECONDS,
            "lift:idle",
        ]);
    });

    it("holds each level for its own wall-clock time", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        sc.seconds([undefined]);
        sc.at(FIRST_CAP_SECOND + HOLD_SECONDS[0]);
        sc.seconds([undefined]);
        sc.seconds(weakUplink());
        const [secondCap] = sc.decisions[sc.decisions.length - 1];
        sc.seconds([undefined]);

        // Level 1: ten minutes, not five
        sc.at(secondCap + HOLD_SECONDS[1] - 1);
        sc.seconds([undefined]);
        expect(sc.decisions.map(([, decision]) => decision)).toEqual(["cap:0", "lift:idle", "cap:1"]);
        sc.seconds([undefined]);

        expect(sc.decisions[sc.decisions.length - 1]).toEqual([secondCap + HOLD_SECONDS[1], "lift:idle"]);
    });

    // The cap is taken on the sample that brings LIMITED_SAMPLES limited ones into a window of fine ones, and every step
    // since the lift is live time: the cap is taken `liveSeconds` after the first sample of the lift
    function capAfterLiveSeconds(sc: ReturnType<typeof scenario>, liveSeconds: number) {
        sc.seconds(fine(liveSeconds - LIMITED_SAMPLES + 1));
        sc.seconds(limited(WINDOW_SAMPLES));
    }

    it("resets the level once a lift has survived ten minutes of live time", () => {
        const sc = scenario();
        capAndLiftAsIdle(sc, HOLD_SECONDS[0]);
        capAndLiftAsIdle(sc, HOLD_SECONDS[1]);

        capAfterLiveSeconds(sc, SURVIVAL_MS / 1000);

        expect(sc.decisions.map(([, decision]) => decision)).toEqual([
            "cap:0",
            "lift:idle",
            "cap:1",
            "lift:idle",
            "cap:0",
        ]);
    });

    it("keeps raising the level for a lift that fell one second short of surviving", () => {
        const sc = scenario();
        capAndLiftAsIdle(sc, HOLD_SECONDS[0]);
        capAndLiftAsIdle(sc, HOLD_SECONDS[1]);

        capAfterLiveSeconds(sc, SURVIVAL_MS / 1000 - 1);

        expect(sc.decisions.map(([, decision]) => decision)).toEqual([
            "cap:0",
            "lift:idle",
            "cap:1",
            "lift:idle",
            "cap:2",
        ]);
    });

    it("does not count idle time as survival", () => {
        const sc = scenario();
        capAndLiftAsIdle(sc, HOLD_SECONDS[0]);

        // An hour of a camera that is off
        sc.seconds(Array<undefined>(3600).fill(undefined));
        sc.seconds(weakUplink());

        expect(sc.decisions.map(([, decision]) => decision)).toEqual(["cap:0", "lift:idle", "cap:1"]);
    });

    it("counts a step of a throttled tab for no more than two seconds", () => {
        const sc = scenario();
        capAndLiftAsIdle(sc, HOLD_SECONDS[0]);

        // Eleven readings a minute apart span 600 s of wall clock, and 20 s of live time
        for (let reading = 0; reading < 11; reading++) {
            sc.seconds(fine(1));
            sc.wait(59_000);
        }
        sc.seconds(weakUplink());

        expect(sc.decisions.map(([, decision]) => decision)).toEqual(["cap:0", "lift:idle", "cap:1"]);
    });
});

describe("UplinkLimitationDetector, when the user chooses", () => {
    it("clears the cap, reports the level it cleared and starts over from level 0", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        sc.seconds([undefined]);
        sc.at(FIRST_CAP_SECOND + HOLD_SECONDS[0]);
        sc.seconds([undefined]);
        sc.seconds(weakUplink());
        expect(sc.decisions.map(([, decision]) => decision)).toEqual(["cap:0", "lift:idle", "cap:1"]);

        expect(sc.detector.reset()).toBe(1);
        sc.seconds(weakUplink());

        expect(sc.decisions.map(([, decision]) => decision)).toEqual(["cap:0", "lift:idle", "cap:1", "cap:0"]);
    });

    it("starts over from level 0 for a lift that was on trial when the user chose", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        sc.seconds([undefined]);
        sc.at(FIRST_CAP_SECOND + HOLD_SECONDS[0]);
        sc.seconds([undefined]);
        expect(sc.decisions.map(([, decision]) => decision)).toEqual(["cap:0", "lift:idle"]);

        expect(sc.detector.reset()).toBeUndefined();
        sc.seconds(weakUplink());

        // Not "cap:1": the weak link that came back is not a failed trial of a lift the user replaced
        expect(sc.decisions.map(([, decision]) => decision)).toEqual(["cap:0", "lift:idle", "cap:0"]);
    });

    it("forgets how long the camera was away under the cap the user cleared", () => {
        const sc = scenario();
        sc.seconds(weakUplink());
        sc.seconds([undefined]);
        expect(sc.detector.isAway()).toBe(true);

        expect(sc.detector.reset()).toBe(0);
        expect(sc.detector.isAway()).toBe(false);
        sc.seconds(weakUplink());
        const [secondCap] = sc.decisions[sc.decisions.length - 1];
        sc.at(secondCap + HOLD_SECONDS[0]);
        sc.seconds([undefined]);

        // No lift on that one reading: the time away before the reset is not this cap's
        expect(sc.decisions.map(([, decision]) => decision)).toEqual(["cap:0", "cap:0"]);
    });

    it("reports nothing when there was no cap, and forgets the window and the warm-up it had", () => {
        const sc = scenario();
        // One sample short of a cap
        sc.seconds(limited(WARMUP_SAMPLES + WINDOW_SAMPLES - 1));

        expect(sc.detector.reset()).toBeUndefined();
        sc.seconds(limited(1));

        expect(sc.decisions).toEqual([]);
    });
});

describe("startUplinkLimitationDetector", () => {
    const videoStats = writable<WebRtcSenderStats | undefined>(undefined);
    let savedQuality: Writable<VideoQualitySetting>;
    let stop: () => void;

    // A reading every second for `count` seconds, as the stats poll gives them
    function tick(reading: WebRtcSenderStats | undefined, count = 1) {
        for (let index = 0; index < count; index++) {
            videoStats.set(reading);
            vi.advanceTimersByTime(SAMPLE_INTERVAL_MS);
        }
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        trackAdminEvent.mockClear();
        uplinkCapStore.set(false);
        uplinkCapNoticeStore.set(false);
        videoStats.set(undefined);
        savedQuality = writable<VideoQualitySetting>("recommended");
        const unregister = registerLocalEncoderStats("video", videoStats);
        stop = startUplinkLimitationDetector(savedQuality);
        onTestFinished(() => {
            stop();
            unregister();
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const weak = () => encoder(limitedReading);

    it("caps the camera, tells the user and reports the cap once the link is weak", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES - 1);
        expect(get(uplinkCapStore)).toBe(false);

        tick(weak());

        expect(get(uplinkCapStore)).toBe(true);
        expect(get(uplinkCapNoticeStore)).toBe(true);
        expect(trackAdminEvent).toHaveBeenCalledExactlyOnceWith("media.camera_cap.changed", {
            action: "capped",
            level: 0,
        });
    });

    it("says in the console which line the estimate stayed under when it caps", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);

        expect(console.info).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining("stayed under 549 kbps (90 % of what the 360p and 180p layers ask for)"),
        );
    });

    it("never caps while a screen share is running", () => {
        const unregister = registerLocalEncoderStats("screenSharing", writable(encoder({ activeLayers: 1 })));
        onTestFinished(unregister);

        tick(weak(), WARMUP_SAMPLES + 2 * WINDOW_SAMPLES);

        expect(get(uplinkCapStore)).toBe(false);
    });

    it("lifts the cap and lowers the notice when the hold ends with the camera off, on a timer of its own", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        trackAdminEvent.mockClear();

        // Nothing is published any more: the stats store stops ticking, so only the timer can end the hold
        videoStats.set(undefined);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(HOLD_MS[0] - 2 * SAMPLE_INTERVAL_MS - 1);
        expect(get(uplinkCapStore)).toBe(true);
        vi.advanceTimersByTime(2 * SAMPLE_INTERVAL_MS + 1);

        expect(get(uplinkCapStore)).toBe(false);
        expect(get(uplinkCapNoticeStore)).toBe(false);
        expect(trackAdminEvent).toHaveBeenCalledExactlyOnceWith("media.camera_cap.changed", {
            action: "lifted",
            level: 0,
            reason: "idle",
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("waits for the camera to have been away a while when the stats go after the hold has ended", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        // Still capped well after the hold: the link never looked healthy
        tick(weak(), HOLD_MS[0] / SAMPLE_INTERVAL_MS + WINDOW_SAMPLES);
        expect(get(uplinkCapStore)).toBe(true);

        // A publication being replaced: gone for two seconds
        videoStats.set(undefined);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(2 * SAMPLE_INTERVAL_MS);
        tick(weak(), 2 * IDLE_CONFIRM_SECONDS);
        expect(get(uplinkCapStore)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);

        // The camera is switched off for good
        videoStats.set(undefined);
        vi.advanceTimersByTime(IDLE_CONFIRM_MS - 1);
        expect(get(uplinkCapStore)).toBe(true);
        vi.advanceTimersByTime(1);

        expect(get(uplinkCapStore)).toBe(false);
        expect(trackAdminEvent).toHaveBeenLastCalledWith("media.camera_cap.changed", {
            action: "lifted",
            level: 0,
            reason: "idle",
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("arms its timer for the fifteen seconds away once the hold is over, not for a hold that is already gone", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        tick(weak(), HOLD_MS[0] / SAMPLE_INTERVAL_MS + WINDOW_SAMPLES);
        expect(get(uplinkCapStore)).toBe(true);

        videoStats.set(undefined);
        const armedAt = Date.now();
        vi.advanceTimersToNextTimer();

        // One timer, of the whole delay: a timer of the hold alone would be one of 0 ms, armed again and again
        expect(Date.now() - armedAt).toBe(IDLE_CONFIRM_MS);
        expect(get(uplinkCapStore)).toBe(false);
    });

    it("lifts a cap whose camera stopped on a reading that is not a camera, when no other reading follows", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        tick(weak(), HOLD_MS[0] / SAMPLE_INTERVAL_MS + WINDOW_SAMPLES);

        // The last readings of a sender that is going away are defined, and then the store says nothing more
        tick(encoder({ captureFps: undefined }), 3);
        expect(get(uplinkCapStore)).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(IDLE_CONFIRM_MS);

        expect(get(uplinkCapStore)).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("drops the timer when the stats come back, and leaves the lift to the live samples", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        videoStats.set(undefined);
        expect(vi.getTimerCount()).toBe(1);

        videoStats.set(weak());

        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(HOLD_MS[0] + 60_000);
        expect(get(uplinkCapStore)).toBe(true);
    });

    it("reports the level of the cap it lifts, on a recovery trial that failed", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        videoStats.set(undefined);
        vi.advanceTimersByTime(HOLD_MS[0]);
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        expect(trackAdminEvent).toHaveBeenLastCalledWith("media.camera_cap.changed", { action: "capped", level: 1 });

        videoStats.set(undefined);
        vi.advanceTimersByTime(HOLD_MS[1]);

        expect(trackAdminEvent).toHaveBeenLastCalledWith("media.camera_cap.changed", {
            action: "lifted",
            level: 1,
            reason: "idle",
        });
    });

    it("reports the level of the cap it clears, on a recovery trial that failed", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        videoStats.set(undefined);
        vi.advanceTimersByTime(HOLD_MS[0]);
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        expect(trackAdminEvent).toHaveBeenLastCalledWith("media.camera_cap.changed", { action: "capped", level: 1 });

        savedQuality.set("high");

        expect(trackAdminEvent).toHaveBeenLastCalledWith("media.camera_cap.changed", {
            action: "cleared",
            level: 1,
            reason: "setting",
        });
    });

    it("does not raise the notice again for a recovery trial that caps again", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        videoStats.set(undefined);
        vi.advanceTimersByTime(HOLD_MS[0]);
        expect(get(uplinkCapNoticeStore)).toBe(false);
        trackAdminEvent.mockClear();

        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);

        expect(get(uplinkCapStore)).toBe(true);
        expect(get(uplinkCapNoticeStore)).toBe(false);
        expect(trackAdminEvent).toHaveBeenCalledExactlyOnceWith("media.camera_cap.changed", {
            action: "capped",
            level: 1,
        });
    });

    it("clears the cap, the notice and the timer when the user chooses a quality, whatever it is", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        videoStats.set(undefined);
        trackAdminEvent.mockClear();

        savedQuality.set("high");

        expect(get(uplinkCapStore)).toBe(false);
        expect(get(uplinkCapNoticeStore)).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        expect(trackAdminEvent).toHaveBeenCalledExactlyOnceWith("media.camera_cap.changed", {
            action: "cleared",
            level: 0,
            reason: "setting",
        });
    });

    it("says nothing when the user chooses a quality and there was no cap", () => {
        savedQuality.set("high");

        expect(get(uplinkCapStore)).toBe(false);
        expect(trackAdminEvent).not.toHaveBeenCalled();
    });

    it("leaves nothing running once stopped", () => {
        tick(weak(), WARMUP_SAMPLES + WINDOW_SAMPLES);
        videoStats.set(undefined);
        expect(vi.getTimerCount()).toBe(1);

        stop();

        expect(vi.getTimerCount()).toBe(0);
        savedQuality.set("high");
        expect(trackAdminEvent).toHaveBeenCalledTimes(1);
    });
});
