import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// jsdom resolves neither calc() nor the cascade of a compiled Svelte style, so the zoom column's placement is checked on
// the source. The dock stack stands at the map's bottom edge with 14 px of padding below the dock (Dock.svelte).
describe("Frame: the map zoom column and the dock", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Frame.svelte"), "utf8");
    const style = source.slice(source.indexOf("<style>") + "<style>".length, source.indexOf("</style>"));
    const column = ':global([data-testid="actions-explorer"])';

    // Every rule whose selector names the zoom column, with the media query it sits in. A walk over the braces, with the
    // comments dropped first: no string in the style holds a brace.
    function columnRules(): Array<{ media: string | undefined; selector: string; body: string }> {
        const rules: Array<{ media: string | undefined; selector: string; body: string }> = [];
        const preludes: string[] = [];
        let text = "";
        for (const character of style.replace(/\/\*[\s\S]*?\*\//g, "")) {
            if (character === "{") {
                preludes.push(text.trim());
                text = "";
            } else if (character === "}") {
                const selector = preludes.pop() ?? "";
                const media = preludes.find((prelude) => prelude.startsWith("@media"))?.replace(/^@media\s*/, "");
                if (selector.includes(column)) rules.push({ media, selector, body: text });
                text = "";
            } else {
                text += character;
            }
        }
        return rules;
    }

    function bottomOf(media: string | undefined, selectorPart: string): string | undefined {
        const rule = columnRules().find(
            (candidate) =>
                candidate.media === media && candidate.selector.split(",").some((part) => part.trim() === selectorPart),
        );
        return rule ? /(?:^|[;\s])bottom:\s*([^;]+);/.exec(rule.body)?.[1].trim() : undefined;
    }

    it("stands the column on the dock's line, 14 px above the map's edge", () => {
        expect(bottomOf(undefined, `.konclui ${column}`)).toBe("calc(var(--frame-gap) + 14px)");
    });

    it("lifts the column 8 px above the dock stack beside an open panel, where the two would meet", () => {
        expect(bottomOf("(max-width: 1023px)", `.konclui.panel-open ${column}`)).toBe(
            "calc(var(--frame-gap) + var(--konclui-dock-stack-height, 76px) + 8px)",
        );
    });

    it("lifts the column 8 px above the dock stack on a phone", () => {
        expect(bottomOf("(max-width: 767px)", `.konclui ${column}`)).toBe(
            "calc(var(--konclui-dock-stack-height, 76px) + 8px)",
        );
    });

    it("does not draw the column on a phone while the sheet covers the map, and draws it again when the sheet closes", () => {
        const hidden = columnRules().find(
            (rule) =>
                rule.media === "(max-width: 767px)" &&
                rule.selector.split(",").some((part) => part.trim() === `.konclui.panel-open ${column}`),
        );

        // display: none takes it out of the tab order as well as out of sight; the rule is on `.panel-open`, which the
        // frame drops as the sheet closes, and it is inside the phone query so a wide screen keeps the column.
        expect(hidden?.body).toMatch(/(?:^|[;\s])display:\s*none;/);
        expect(hidden?.body).not.toMatch(/bottom:/);
        expect(
            columnRules()
                .filter((rule) => /display:\s*none/.test(rule.body))
                .map((rule) => rule.media),
        ).toEqual(["(max-width: 767px)"]);
    });
});

describe("Frame: the people sheet on a phone", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Frame.svelte"), "utf8");
    const style = source.slice(source.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");
    const phone = style.slice(style.indexOf("@media (max-width: 767px)"));

    it("stops above the whole dock stack, by the height the dock publishes, not above one row of it", () => {
        const rule = /\.side-panel\s*\{([^}]*)\}/.exec(phone)?.[1] ?? "";

        expect(/inset:\s*([^;]+);/.exec(rule)?.[1].trim()).toBe(
            "58px 8px calc(var(--konclui-dock-stack-height, 76px) + 6px)",
        );
    });

    it("keeps a floor under its height, for a short window with the chips and a wrapped dock", () => {
        const rule = /\.side-panel\s*\{([^}]*)\}/.exec(phone)?.[1] ?? "";

        expect(/min-height:\s*([^;]+);/.exec(rule)?.[1].trim()).toBe("144px");
    });
});
