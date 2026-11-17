import { describe, expect, it } from "vitest";
import {
    backgroundChoice,
    inviteLink,
    isBandwidthPreference,
    isQualityName,
    meterLevel,
    NO_DEVICE,
    shownDevice,
    STARTING_DEVICE,
} from "./mediaChoices";

describe("backgroundChoice", () => {
    it("names each kind of background", () => {
        expect(backgroundChoice({ mode: "none", blurAmount: 15 })).toBe("none");
        expect(backgroundChoice({ mode: "blur", blurAmount: 25 })).toBe("blur:25");
        expect(backgroundChoice({ mode: "blur" })).toBe("blur");
        expect(backgroundChoice({ mode: "image", blurAmount: 15, backgroundImage: "./a.jpg" })).toBe("image:./a.jpg");
    });

    it("treats an image mode without an image as no background", () => {
        expect(backgroundChoice({ mode: "image", blurAmount: 15 })).toBe("none");
    });
});

describe("meterLevel", () => {
    it("is silent without a spectrum", () => {
        expect(meterLevel(undefined)).toBe(0);
        expect(meterLevel([])).toBe(0);
    });

    it("grows with the average volume and stops at 100", () => {
        expect(meterLevel([2, 4, 6])).toBe(20);
        expect(meterLevel([40, 40])).toBe(100);
    });
});

describe("inviteLink", () => {
    // The address the user arrived by: someone else's invite, with its entrance and walk, and a stray query.
    const page = new URL("https://office.test/@/org/world/room?x=1#hall&moveTo=4,8");

    it("is the room's address alone without options, never the query or hash the user arrived with", () => {
        expect(inviteLink(page, {})).toBe("https://office.test/@/org/world/room");
    });

    it("enters by the chosen start position", () => {
        expect(inviteLink(page, { entryPoint: "lobby" })).toBe("https://office.test/@/org/world/room#lobby");
    });

    it("walks the guest to a position", () => {
        expect(inviteLink(page, { entryPoint: "start", walkTo: { x: 120, y: 48 } })).toBe(
            "https://office.test/@/org/world/room#start&moveTo=120,48",
        );
    });
});

describe("shownDevice", () => {
    it("is off only when the user turned the device off", () => {
        expect(shownDevice(false, "cam-1", "cam-1")).toBe(NO_DEVICE);
    });

    it("shows the device in use, then the one asked for", () => {
        expect(shownDevice(true, "cam-2", "cam-1")).toBe("cam-2");
        expect(shownDevice(true, undefined, "cam-1")).toBe("cam-1");
    });

    it("shows an on device as starting, never as off and never as a guessed device", () => {
        expect(shownDevice(true, undefined, undefined)).toBe(STARTING_DEVICE);
    });
});

describe("value guards", () => {
    it("accepts upstream's names only", () => {
        expect(isQualityName("high")).toBe(true);
        expect(isQualityName("ultra")).toBe(false);
        expect(isBandwidthPreference("balanced")).toBe(true);
        expect(isBandwidthPreference("fast")).toBe(false);
    });
});
