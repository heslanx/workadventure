import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The standard of menus and controls over the map (docs/konclui-migration/ui-contracts.md), as the stylesheets
 * declare it. Nothing renders here: the rules are read as text, inside the at-rules around them. The expected values
 * are the measured dock and office menu, not the stylesheet's own.
 */

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const theme = readFileSync(resolve(repository, "libs/tailwind/style/konclui.css"), "utf8");
const style = readFileSync(resolve(repository, "play/src/front/style/style.css"), "utf8");
const icons = readFileSync(resolve(repository, "play/src/front/Components/Icons.ts"), "utf8");

interface Rule {
    context: string;
    selector: string;
    declarations: Map<string, string>;
}

/** The style rules of a stylesheet that does not nest style rules, with the at-rules around each one. */
function parseRules(css: string): Rule[] {
    const rules: Rule[] = [];
    const atRules: string[] = [];
    let rule: Rule | undefined;
    let pending = "";
    const declare = (): void => {
        const colon = pending.indexOf(":");
        if (rule && colon > 0) rule.declarations.set(pending.slice(0, colon).trim(), pending.slice(colon + 1).trim());
        pending = "";
    };
    for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
        if (char === "{") {
            const head = pending.replace(/\s+/g, " ").trim();
            if (head.startsWith("@")) atRules.push(head);
            else rules.push((rule = { context: atRules.join(" "), selector: head, declarations: new Map() }));
            pending = "";
        } else if (char === "}") {
            if (rule) declare();
            else atRules.pop();
            rule = undefined;
            pending = "";
        } else if (char === ";") {
            declare();
        } else {
            pending += char;
        }
    }
    return rules;
}

const rules = parseRules(theme);
const utilities = "@layer utilities";
const timelines = "@layer utilities @supports (animation-timeline: scroll())";

function declared(context: string, selector: string, property: string): string | undefined {
    return rules
        .find((rule) => rule.context === context && rule.selector === selector)
        ?.declarations.get(property)
        ?.replace(/\s+/g, " ");
}

describe("menus and controls over the map", () => {
    it("gives the dock's control radius a token", () => {
        expect(declared("@layer theme", ':root, [data-theme="default"]', "--k-radius-control")).toBe("10px");
        expect(declared(utilities, ".k-control", "border-radius")).toBe("var(--k-radius-control)");
    });

    it.each([
        [".k-menu-row", "min-height", "44px"],
        [".k-menu-row", "padding", "0 12px"],
        [".k-menu-row", "gap", "12px"],
        [".k-menu-row", "border-radius", "var(--k-radius-inner)"],
        [".k-menu-title", "font-size", "12px"],
        [".k-menu-title", "font-weight", "600"],
        [".k-menu-title", "text-transform", "none"],
        [".k-menu-lead", "width", "18px"],
        [".k-menu-lead", "height", "18px"],
        [".k-divider", "background-color", "var(--k-border-subtle)"],
        [".k-control", "width", "36px"],
        [".k-control", "height", "36px"],
    ])("%s sets %s to %s", (selector, property, value) => {
        expect(declared(utilities, selector, property)).toBe(value);
    });

    it("sizes the glyph of a lead, a control and a mark to 18 px, not by font-size", () => {
        const selector = ":is(.k-menu-lead, .k-control) > :is(svg, img), .k-menu-mark";

        expect(declared(utilities, selector, "width")).toBe("18px");
        expect(declared(utilities, selector, "height")).toBe("18px");
    });

    it("draws the selected control with the dock's mint fill and dark ink", () => {
        expect(declared(utilities, '.k-control[aria-pressed="true"]', "background")).toBe("var(--k-accent)");
        expect(declared(utilities, '.k-control[aria-pressed="true"]', "color")).toBe("var(--k-on-accent)");
    });

    it("widens the control's hit area to 42x44 on a phone, as the dock does", () => {
        expect(declared(`${utilities} @media (max-width: 767px)`, ".k-control::after", "inset")).toBe("-4px -3px");
    });

    it("turns the wide side of the hit area in a column, so controls 6 px apart never overlap", () => {
        const phone = `${utilities} @media (max-width: 767px)`;

        // 3 px above and below each 36 px control: 6 px of gap is shared, none of it twice.
        expect(declared(phone, ".k-control-column .k-control::after", "inset")).toBe("-3px -4px");
    });

    it("keeps the pressed control readable when forced colours remove its fill", () => {
        const forced = `${utilities} @media (forced-colors: active)`;

        expect(declared(forced, '.k-control[aria-pressed="true"]', "outline")).toBe("2px solid Highlight");
        expect(declared(forced, '.k-control[aria-pressed="true"]', "outline-offset")).toBe("-2px");
    });

    it("fades a scroll edge only where scroll timelines exist", () => {
        const masks = rules.filter(
            (rule) => rule.declarations.has("mask-image") && rule.declarations.get("mask-image") !== "none",
        );

        expect(masks.map((rule) => rule.selector)).toEqual([".k-scroll-y", ".k-scroll-x", ".k-scroll-x:dir(rtl)"]);
        for (const rule of masks) expect(rule.context).toBe(timelines);
        expect(declared(timelines, ".k-scroll-y", "animation-timeline")).toBe("scroll(self block)");
    });

    it("fades nothing until the scroll timeline moves the edges: both start at 0px", () => {
        expect(theme).toMatch(/@property --k-fade-start \{[^}]*initial-value: 0px;/);
        expect(theme).toMatch(/@property --k-fade-end \{[^}]*initial-value: 0px;/);
    });

    it("fades the top only once scrolled and the bottom only until the end", () => {
        const at = (offset: string, property: string): string | undefined =>
            declared("@keyframes k-scroll-fade", offset, property);

        expect([at("0%", "--k-fade-start"), at("0%", "--k-fade-end")]).toEqual(["0px", "24px"]);
        expect([at("100%", "--k-fade-start"), at("100%", "--k-fade-end")]).toEqual(["24px", "0px"]);
    });

    it("keeps the fade on the scroll range under reduced motion", () => {
        expect(
            declared(
                `${timelines} @media (prefers-reduced-motion: reduce)`,
                ".k-scroll-y, .k-scroll-x",
                "animation-duration",
            ),
        ).toBe("auto !important");
    });

    it("gives the vertical scroller the Konclui scrollbar, outside the layers that chat.css outranks", () => {
        expect(declared(utilities, ".k-scroll-y", "scrollbar-color")).toBe("var(--k-border-strong) transparent");
        expect(declared(utilities, ".k-scroll-y", "overscroll-behavior")).toBe("contain");
        expect(declared("", ".k-scroll-y::-webkit-scrollbar-thumb", "background-color")).toBe("var(--k-border-strong)");
    });

    it("gives the media popover's .scrollable-content the same scrollbar", () => {
        const [rule = ""] = /\.scrollable-content \{[\s\S]*?\n\}/.exec(style) ?? [];

        expect(rule).toContain("scrollbar-color: var(--k-border-strong) transparent;");
        expect(rule).toContain("overscroll-behavior: contain;");
        expect(rule).toMatch(/&::-webkit-scrollbar-thumb \{\s*background-color: var\(--k-border-strong\);/);
        expect(rule).not.toContain("#928ebb");
    });

    it("exports the outline headphones glyph", () => {
        expect(icons).toContain('export { default as IconHeadphones } from "~icons/tabler/headphones";');
    });
});
