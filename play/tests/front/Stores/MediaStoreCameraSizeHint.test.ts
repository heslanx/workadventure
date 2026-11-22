import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The background transformer builds the segmenter that fits the camera first only when the store hands it the camera's
// size. The store is too entangled to mount here, so this pins the call itself: without the fourth argument a normal
// landscape webcam builds two segmenters at start-up (see MediaPipeTasksVisionWorkerRuntime's construction count tests).
describe("the camera size hint of the background transformer", () => {
    const source = readFileSync(resolve(__dirname, "../../../src/front/Stores/MediaStore.ts"), "utf8");

    it("is passed from the video track where the transformer is created", () => {
        const call = /createBackgroundTransformer\(([\s\S]*?)\n {8}\);/.exec(source);
        expect(call, "the call to createBackgroundTransformer was not found").not.toBeNull();
        expect(call?.[1]).toContain("getCameraSizeHint(videoTrackValue.track)");
    });

    it("comes from the module that owns the transformer", () => {
        expect(source).toMatch(
            /getCameraSizeHint,\s*\n\} from "\.\.\/WebRtc\/BackgroundProcessor\/createBackgroundTransformer";/,
        );
    });
});
