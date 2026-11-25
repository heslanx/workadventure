import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The surfaces that open over the map arrive through the theme's one entrance (`.k-enter`, libs/tailwind/style/konclui.css)
 * or, where an `{#if}` removes them and they must also leave, through the transition built on it (`transition:surface`,
 * play/src/front/Utils/surfaceTransition.ts). Both read the same `--k-enter-*` variables. They are read from their
 * sources: jsdom runs no cascade or animation. The browser check of the motion itself (frames, reduced motion,
 * interruption) is in docs/konclui-migration/ui-contracts.md, Motion.
 */
const front = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/front");
const read = (path: string): string => readFileSync(resolve(front, path), "utf8");

describe("the entrance of the surfaces over the map", () => {
    it.each([["Components/Exploration/Explorer.svelte", "mapexplorer k-enter"]])(
        "%s arrives through .k-enter",
        (path, marker) => {
            expect(read(path)).toContain(marker);
        },
    );

    describe("the office menu", () => {
        const menu = read("Konclui/OfficeMenu/components/OfficeMenu.svelte");

        it("arrives and leaves through the surface transition, on the element directly under its {#if}", () => {
            expect(menu).toMatch(/import \{ surface \} from "\.\.\/\.\.\/\.\.\/Utils\/surfaceTransition";/);
            // Directly under the block that closes it: only there does Svelte hold the element for the exit.
            expect(menu).toMatch(
                /\{#if \$officeMenuOpenStore\}\s*<div\s[^>]*class="office-menu [^"]*"[^>]*\btransition:surface\b/,
            );
        });

        it("keeps one entrance: no class that arrives too, no timer, no keyframes of its own", () => {
            // A second entrance on the same element would play both: the surface would arrive twice.
            expect(menu).not.toMatch(/class="[^"]*(?<![-\w])k-enter(?![-\w])[^"]*"/);
            expect(menu).not.toContain("@keyframes");
            // Local, so that nothing springs in at room entry, and one directive, so that a reversal keeps its place.
            expect(menu).not.toMatch(/transition:surface\|global/);
            expect(menu).not.toMatch(/\s(?:in|out):[a-z]/);
        });

        it("comes from the rail, 6 px to its left, through the variables the transition reads", () => {
            const style = menu.slice(menu.indexOf("<style>"));
            const origin = /\.office-menu \{[^}]*--k-enter-x: (-?\d+px);\s*--k-enter-y: (-?\d+px);/.exec(style);

            expect(origin?.slice(1)).toEqual(["-6px", "0px"]);
        });
    });

    describe("the side panel", () => {
        const frame = read("Konclui/Shell/components/Frame.svelte");

        it("arrives and leaves through the surface transition, on the card directly under its {#if}", () => {
            expect(frame).toMatch(/import \{ surface \} from "\.\.\/\.\.\/\.\.\/Utils\/surfaceTransition";/);
            // Directly under the block that closes it: only there does Svelte keep the card, and what is in it, for the exit.
            expect(frame).toMatch(/\{#if panelOpen\}\s*<aside\s[^>]*class="side-panel"[^>]*\btransition:surface\b/);
        });

        it("keeps one entrance: no class that arrives too, no `|global`, no pair of in: and out: on the card", () => {
            const card = /<aside\s[^>]*>/.exec(frame)?.[0] ?? "";

            expect(card).not.toMatch(/(?<![-\w])k-enter(?![-\w])/);
            expect(card).not.toMatch(/transition:surface\|global/);
            expect(card).not.toMatch(/\s(?:in|out):[a-z]/);
            // The card does not hold the entrance's timing any more: the transition has its own.
            expect(frame.slice(frame.indexOf("<style>"))).not.toMatch(/--k-enter-(?:dur|ease)/);
        });

        it("fades its content, and only that, when it swaps between its views: --k-dur-fast on --k-ease-out-expo", () => {
            const theme = read("../../../libs/tailwind/style/konclui.css");
            const duration = /--k-dur-fast:\s*(\d+)ms;/.exec(theme)?.[1];
            const curve = /--k-ease-out-expo:\s*cubic-bezier\(([^)]*)\);/.exec(theme)?.[1];

            // An `in:` on a box keyed on the view: local, so it plays on a swap and not when the card or the shell appears.
            expect(frame).toMatch(/\{#key contentKey\}\s*<div class="content" in:swap>/);
            expect(/const SWAP_FADE_MS = (\d+);/.exec(frame)?.[1]).toBe(duration);
            expect(/const swapEasing = cubicBezier\(([^)]*)\);/.exec(frame)?.[1].replace(/\s/g, "")).toBe(
                curve?.replace(/\s/g, ""),
            );
        });
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
