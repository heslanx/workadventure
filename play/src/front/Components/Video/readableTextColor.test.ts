import { describe, expect, it } from "vitest";
import { readableTextColor } from "./readableTextColor";

function toLinear(channel: number): number {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(hexBackground: string, label: "white" | "black"): number {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hexBackground.slice(index, index + 2), 16));
    const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    return label === "white" ? 1.05 / (luminance + 0.05) : (luminance + 0.05) / 0.05;
}

describe("readableTextColor", () => {
    it("uses white on dark backgrounds and black on light ones", () => {
        expect(readableTextColor("#1b2a41")).toBe("white");
        expect(readableTextColor("#ffffff")).toBe("black");
    });

    it("uses black on a saturated green that a brightness threshold would label white", () => {
        expect(readableTextColor("#00c800")).toBe("black");
    });

    it("always reaches 4.5:1 on a sample of the color space", () => {
        for (let r = 0; r < 256; r += 51) {
            for (let g = 0; g < 256; g += 51) {
                for (let b = 0; b < 256; b += 51) {
                    const background = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
                    expect(contrast(background, readableTextColor(background))).toBeGreaterThanOrEqual(4.5);
                }
            }
        }
    });

    it("accepts the short hex form and falls back to white when the color cannot be read", () => {
        expect(readableTextColor("#fff")).toBe("black");
        expect(readableTextColor(null)).toBe("white");
        expect(readableTextColor("rebeccapurple")).toBe("white");
    });
});
