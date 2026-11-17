import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultOptions } from "../../../src/front/Notification/Notification";

/** Width and height of a PNG, read from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
    const header = readFileSync(file);
    expect(header.subarray(1, 4).toString("latin1"), `${file} is not a PNG`).toBe("PNG");
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

describe("default notification artwork", () => {
    // The operating system scales the icon up: a mark under 192 px is blurred, and a wordmark is cropped.
    it.each(Object.entries(defaultOptions))("serves a square %s of at least 192 px", (_slot, url) => {
        expect(url).toMatch(/^\/static\//);
        const { width, height } = pngSize(`public${url}`);

        expect(width).toBe(height);
        expect(width).toBeGreaterThanOrEqual(192);
    });

    it("has no large hero image, which would show the logo a second time", () => {
        expect(defaultOptions).not.toHaveProperty("image");
    });
});
