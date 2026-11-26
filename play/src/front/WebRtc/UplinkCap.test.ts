import { get } from "svelte/store";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { VideoQualitySetting } from "../Connection/LocalUserStore";
import {
    effectiveVideoQuality,
    onUplinkCapClearRequest,
    requestUplinkCapClear,
    uplinkCapNoticeStore,
    uplinkCapStore,
} from "./UplinkCap";

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

describe("the request to take the cap off by hand", () => {
    afterEach(() => {
        uplinkCapStore.set(false);
        uplinkCapNoticeStore.set(false);
    });

    it("tells every listener once while the camera is capped", () => {
        const first = vi.fn();
        const second = vi.fn();
        onTestFinished(onUplinkCapClearRequest(first));
        onTestFinished(onUplinkCapClearRequest(second));
        uplinkCapStore.set(true);

        requestUplinkCapClear();

        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });

    it("does nothing while the camera is not capped", () => {
        const listener = vi.fn();
        onTestFinished(onUplinkCapClearRequest(listener));

        requestUplinkCapClear();

        expect(listener).not.toHaveBeenCalled();
    });

    it("does not touch the stores itself: the one that decided the cap takes it off", () => {
        onTestFinished(onUplinkCapClearRequest(vi.fn()));
        uplinkCapStore.set(true);
        uplinkCapNoticeStore.set(true);

        requestUplinkCapClear();

        expect(get(uplinkCapStore)).toBe(true);
        expect(get(uplinkCapNoticeStore)).toBe(true);
    });

    it("stops telling a listener that stopped listening, and only that one", () => {
        const stopped = vi.fn();
        const staying = vi.fn();
        const stop = onUplinkCapClearRequest(stopped);
        onTestFinished(stop);
        onTestFinished(onUplinkCapClearRequest(staying));
        uplinkCapStore.set(true);

        stop();
        requestUplinkCapClear();

        expect(stopped).not.toHaveBeenCalled();
        expect(staying).toHaveBeenCalledOnce();
    });

    it("does nothing when nobody listens", () => {
        uplinkCapStore.set(true);

        expect(() => requestUplinkCapClear()).not.toThrow();
        expect(get(uplinkCapStore)).toBe(true);
    });
});
