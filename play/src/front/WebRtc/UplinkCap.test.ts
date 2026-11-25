import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import type { VideoQualitySetting } from "../Connection/LocalUserStore";
import { effectiveVideoQuality, uplinkCapNoticeStore, uplinkCapStore } from "./UplinkCap";

const SAVED: VideoQualitySetting[] = ["low", "recommended", "high"];

describe("UplinkCap", () => {
    it("starts every session without a cap and without a notice", () => {
        expect(get(uplinkCapStore)).toBe(false);
        expect(get(uplinkCapNoticeStore)).toBe(false);
    });

    it.each(SAVED)("sends the saved quality, %s, while the camera is not capped", (saved) => {
        expect(effectiveVideoQuality(false, saved)).toBe(saved);
    });

    it.each(SAVED)("sends low while the camera is capped, whatever was saved (%s)", (saved) => {
        expect(effectiveVideoQuality(true, saved)).toBe("low");
    });
});
