import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The size of the emotes on a phone. jsdom applies no stylesheet and lays nothing out, so this reads the section's
// rules as text; that a finger lands on a 44 px square, and that six of them fit a 360 px screen, is for a browser.

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "EmoteSection.svelte"), "utf8");
const styles = source.slice(source.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of `selector` inside the media query whose condition is exactly `condition` (none for "" = outside). */
function declarations(condition: string, selector: string): Map<string, string> {
    const found = new Map<string, string>();
    const scope =
        condition === "" ? styles.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "") : mediaBlock(condition);
    for (const [, head = "", body = ""] of scope.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        if (head.trim() !== selector) continue;
        for (const declaration of body.split(";")) {
            const colon = declaration.indexOf(":");
            if (colon > 0) found.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
        }
    }
    return found;
}

function mediaBlock(condition: string): string {
    const start = styles.indexOf(`@media ${condition} {`);
    if (start < 0) throw new Error(`The section has no @media ${condition}`);
    let depth = 0;
    for (let index = styles.indexOf("{", start); index < styles.length; index++) {
        if (styles[index] === "{") depth++;
        if (styles[index] === "}" && --depth === 0) return styles.slice(styles.indexOf("{", start) + 1, index);
    }
    throw new Error(`@media ${condition} is not closed`);
}

describe("the emotes on a touch screen", () => {
    it("are 40 px squares by default and 44 px, the shell's minimum touch target, on a coarse pointer", () => {
        expect(declarations("", ".emote").get("width")).toBe("40px");
        expect(declarations("", ".emote").get("height")).toBe("40px");

        const touch = declarations("(pointer: coarse)", ".emote");
        expect(touch.get("width")).toBe("44px");
        expect(touch.get("height")).toBe("44px");
        expect(touch.get("min-width")).toBe("44px");
    });

    it("keeps the grid's columns as wide as the emotes on a coarse pointer, at every width", () => {
        expect(declarations("(pointer: coarse)", ".grid").get("grid-template-columns")).toBe("repeat(6, 44px)");
        expect(declarations("(pointer: coarse) and (min-width: 640px)", ".grid").get("grid-template-columns")).toBe(
            "repeat(9, 44px)",
        );
    });

    it("takes five columns on a coarse pointer under 360 px, where six of 44 px and their gaps do not fit", () => {
        // 6 x 44 + 5 x 8 = 304 px needs a 344 px screen with the menu's gutter and paddings; 5 x 44 + 4 x 8 = 252 px.
        expect(declarations("(pointer: coarse) and (max-width: 359px)", ".grid").get("grid-template-columns")).toBe(
            "repeat(5, 44px)",
        );
    });

    it("lets the wide coarse rule come after the wide default, so a tablet keeps nine columns", () => {
        expect(styles.indexOf("@media (pointer: coarse) and (min-width: 640px)")).toBeGreaterThan(
            styles.indexOf("@media (pointer: coarse) {"),
        );
    });
});
