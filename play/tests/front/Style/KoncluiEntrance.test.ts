import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The surfaces that open over the map arrive through the theme's one entrance (`.k-enter`, libs/tailwind/style/konclui.css),
 * as read from their sources: jsdom runs no cascade or animation. The browser check of the motion itself (frames,
 * reduced motion, interruption) is in docs/konclui-migration/ui-contracts.md, Motion.
 */
const front = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/front");
const read = (path: string): string => readFileSync(resolve(front, path), "utf8");

describe("the entrance of the surfaces over the map", () => {
    it.each([
        ["Konclui/OfficeMenu/components/OfficeMenu.svelte", "office-menu k-chrome k-enter"],
        ["Konclui/Shell/components/Frame.svelte", 'class="side-panel k-enter"'],
        ["Components/ActionBar/MenuIcons/ProfileMenuContent.svelte", "select-none k-enter"],
        ["Components/Exploration/Explorer.svelte", "mapexplorer k-enter"],
    ])("%s arrives through .k-enter", (path, marker) => {
        expect(read(path)).toContain(marker);
    });

    it("keeps one entrance: the office menu has no keyframes of its own", () => {
        expect(read("Konclui/OfficeMenu/components/OfficeMenu.svelte")).not.toContain("@keyframes");
    });

    it("never animates the grid that holds the map: a column that moved blanked the canvas mid-slide", () => {
        const frame = read("Konclui/Shell/components/Frame.svelte");

        expect(frame).not.toMatch(/transition[^;{}]*grid-template-columns/);
        expect(frame).not.toMatch(/animation[^;{}]*grid-template-columns/);
    });

    it("has the side panel come from the rail on a wide screen and rise on a phone", () => {
        const frame = read("Konclui/Shell/components/Frame.svelte");
        const style = frame.slice(frame.indexOf("<style>"));
        const wide = /\.side-panel \{\s*--k-enter-x: (-?\d+px);\s*--k-enter-y: (-?\d+px);/.exec(style);
        const phone =
            /@media \(max-width: 767px\)[\s\S]*?\.side-panel \{\s*--k-enter-x: (-?\d+px);\s*--k-enter-y: (-?\d+px);/.exec(
                style,
            );

        expect(wide?.slice(1)).toEqual(["-24px", "0px"]);
        expect(phone?.slice(1)).toEqual(["0px", "16px"]);
    });
});
