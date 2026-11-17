import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { MetaTagsBuilder } from "../../src/pusher/services/MetaTagsBuilder";

// Without an admin API these defaults are the tab title, the favicon, the browser chrome color, the share card and
// the name and icon of the installed PWA of every room.
describe("default meta tags", () => {
    async function defaultMetaTags() {
        return new MetaTagsBuilder("http://play.test/_/global/maps.test/map.json").getMeta("Mozilla/5.0 Chrome/140");
    }

    it("never name the upstream product or link to its site", async () => {
        const metaTags = await defaultMetaTags();

        expect(metaTags.title).toBe("Koncluí");
        expect(JSON.stringify(metaTags)).not.toMatch(/workadventu/i);
    });

    it("point every icon at a file the play server serves", async () => {
        const { favIcons, manifestIcons } = await defaultMetaTags();
        const icons = [...favIcons, ...manifestIcons].map((icon) => icon.src);

        expect(icons.length).toBeGreaterThan(0);
        for (const icon of icons) {
            expect(icon).toMatch(/^\/static\//);
            expect(icon).toMatch(/^\/static\/images\/konclui\//);
            expect(existsSync(`public${icon}`), icon).toBe(true);
        }
    });

    it("tint the browser chrome with the page background", async () => {
        const { themeColor } = await defaultMetaTags();
        const body = /<body[^>]*background-color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(
            readFileSync("index.html", "utf8"),
        );
        if (!body) {
            throw new Error("index.html no longer sets the body background as rgb()");
        }
        const pageBackground = `#${body
            .slice(1, 4)
            .map((channel) => Number(channel).toString(16).padStart(2, "0"))
            .join("")}`;

        expect(themeColor.toLowerCase()).toBe(pageBackground);
    });
});
