import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MainLayout is the HUD's one box: it pulls in most of the app, so it is not mounted here. These pin how it takes the strip
// that a panel floating over the game's start edge covers (the port gameViewportCoveredStart), so the dock and the
// in-call video layout stand beside the panel and not under it. Where the strip lies on screen is for the browser run.
describe("MainLayout beside a panel that floats over the game", () => {
    const source = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "../../../src/front/Components/MainLayout.svelte"),
        "utf8",
    );

    it("reads the strip from the extension point, not from an extension", () => {
        expect(source).toMatch(
            /import \{[^}]*\bgameViewportCoveredStart\b[^}]*\} from "\.\.\/ExternalModule\/ClientExtensionPoints";/,
        );
    });

    it("adds the strip to the chat's width in the start margin, so a floating chat and a floating panel both count", () => {
        const margin = /let marginLeft = \$derived\(([\s\S]*?)\);\n/.exec(source)?.[1] ?? "";

        expect(margin).toContain("$gameViewportCoveredStart");
        expect(margin).toContain("$chatSidebarWidthStore");
        expect(margin).toContain("$embeddedChatHost");
    });

    it("pads the start of the layout box by that margin, which is where the dock and the call layout lay out", () => {
        expect(source).toMatch(/id="main-layout"[\s\S]*?style="padding-inline-start : \{marginLeft\}px;/);
    });
});
