import { VideoPresets } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { LOWER_LAYERS_BITRATE } from "./UplinkLimitationDetector";

// The detector imports the analytics client, which this test does not exercise
vi.mock("../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));

// The detector holds LOWER_LAYERS_BITRATE as a number: no module of play/src/front may import livekit-client, which is a
// lazy chunk (livekitStaysLazy.test.ts). A test may, and fails here when a livekit-client update moves the presets.
// The default layer list itself is internal to livekit-client: a change of which presets it uses is not seen here.
// LiveKitRoom.test.ts pins that the front sets no simulcast layers for the full ladder.
describe("LOWER_LAYERS_BITRATE", () => {
    it("is the bitrate of VideoPresets.h360 and h180 added up", () => {
        // room/track/options.ts: videoSimulcastLayers "defaults to h180, h360"
        expect(VideoPresets.h360.encoding.maxBitrate + VideoPresets.h180.encoding.maxBitrate).toBe(
            LOWER_LAYERS_BITRATE,
        );
    });
});
