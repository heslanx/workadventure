import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    BASE_CONTROLS,
    COLUMN_PADDING,
    COLUMN_RIGHT_INSET,
    COLUMN_WIDTH,
    CONTROL_GAP,
    CONTROL_SIZE,
    MAX_TOOLS,
    columnBox,
    intersects,
} from "../domain/columnLayout";

// jsdom resolves neither calc() nor the cascade of a compiled Svelte style, so the numbers the model uses are checked
// against the sources that set them, and the placement is computed from the numbers those sources say.
const here = dirname(fileURLToPath(import.meta.url));
const front = resolve(here, "../../..");
const read = (path: string) => readFileSync(path, "utf8");
const explorer = read(join(front, "Components/ActionsMenu/ExplorerMenu.svelte"));
const konclui = read(resolve(front, "../../../libs/tailwind/style/konclui.css"));
const frame = read(join(front, "Konclui/Shell/components/Frame.svelte"));
const dock = read(join(front, "Konclui/Shell/components/Dock.svelte"));

const COLUMN_SELECTOR = '.konclui :global([data-testid="actions-explorer"])';

/** The `bottom` the frame gives the column, in a media query (`undefined` for none), as the text of its value. */
function frameBottom(media: string | undefined): string | undefined {
    const style = frame.slice(frame.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");
    const scope = media === undefined ? style : style.slice(style.indexOf(`@media ${media}`));
    const selector = COLUMN_SELECTOR.replaceAll(/[.[\]()]/g, "\\$&");
    return new RegExp(`${selector}[^{]*\\{[^}]*bottom:\\s*([^;]+);`).exec(scope)?.[1].trim();
}

describe("the zoom column's numbers match the markup and the styles that draw it", () => {
    it("draws every control 36 px, in a column with 6 px gaps and 6 px of padding", () => {
        expect(/\.k-control\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/.test(konclui)).toBe(true);
        expect(CONTROL_SIZE).toBe(36);
        expect(explorer).toContain("k-control-column flex flex-col justify-center gap-1.5");
        expect(CONTROL_GAP).toBe(6);
        expect(explorer).toMatch(/k-chrome rounded-lg pointer-events-auto p-1\.5/);
        expect(COLUMN_PADDING).toBe(6);
        expect(COLUMN_WIDTH).toBe(48);
    });

    it("stands the column 0.5 rem in from the map's right edge", () => {
        expect(explorer).toContain("calc(${mapEditorRightOffset + rightGutter}px + 0.5rem)");
        expect(COLUMN_RIGHT_INSET).toBe(8);
    });
});

describe("the zoom column with its tools beside the dock", () => {
    // The dock stack is a 48 px dock with 6 px of padding and 14 px under it, and it wraps into rows on a phone.
    const DOCK_STACKS = [76, 124, 172];
    const ALL_CONTROLS = BASE_CONTROLS + MAX_TOOLS;
    const TOP_ROW_BOTTOM = 12 + 44;

    /** The clearance above the dock stack the frame sets on a phone: `calc(var(--konclui-dock-stack-height, F px) + C px)`. */
    function phoneClearance(): number {
        const value = frameBottom("(max-width: 767px)") ?? "";
        const match = /^calc\(var\(--konclui-dock-stack-height, \d+px\) \+ (\d+)px\)$/.exec(value);
        if (match === null) throw new Error(`the frame's phone rule for the column changed: "${value}"`);
        return Number(match[1]);
    }

    it("lifts the column above the dock stack on a phone, by the height the dock publishes", () => {
        expect(phoneClearance()).toBe(8);
        expect(dock).toContain('setProperty("--konclui-dock-stack-height"');
    });

    it.each([
        ["375x812", 375, 812],
        ["375x667", 375, 667],
        ["390x844", 390, 844],
    ])("keeps all six controls clear of the dock and of the top row on a %s phone", (_name, width, height) => {
        for (const stack of DOCK_STACKS) {
            const column = columnBox({ width, height }, stack + phoneClearance(), ALL_CONTROLS);
            const dockStack = { left: 0, right: width, top: height - stack, bottom: height };
            const topRow = { left: 0, right: width, top: 0, bottom: TOP_ROW_BOTTOM };

            expect(intersects(column, dockStack)).toBe(false);
            expect(dockStack.top - column.bottom).toBe(8);
            expect(intersects(column, topRow)).toBe(false);
        }
    });

    it("keeps the column inside the viewport at 375 px, whatever the tools", () => {
        for (let tools = 0; tools <= MAX_TOOLS; tools++) {
            const column = columnBox({ width: 375, height: 812 }, 124 + phoneClearance(), BASE_CONTROLS + tools);

            expect(column.left).toBeGreaterThanOrEqual(0);
            expect(column.right).toBe(375 - COLUMN_RIGHT_INSET);
            expect(column.top).toBeGreaterThanOrEqual(TOP_ROW_BOTTOM);
        }
    });

    it("stands on the dock's line from 768 px, where the centred dock leaves the column its own side", () => {
        expect(frameBottom(undefined)).toBe("calc(var(--frame-gap) + 14px)");
        const frameGap = 6;
        const column = columnBox({ width: 768, height: 1024 }, frameGap + 14, ALL_CONTROLS);
        // Beside the rail (60 px) and the map's 6 px gap, the dock is centred in the card and about 480 px wide.
        const card = { left: 60, right: 768 - 6 };
        const centre = (card.left + card.right) / 2;
        const dockBox = { left: centre - 240, right: centre + 240, top: 1024 - 62, bottom: 1024 };

        expect(intersects(column, dockBox)).toBe(false);
    });
});
