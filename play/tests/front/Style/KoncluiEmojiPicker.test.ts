import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The emoji picker in the Konclui theme. The picker is upstream's `emoji-picker-element`: a web component that is a
 * light panel unless the system asks for the dark scheme, and whose own dark colors are not the chrome's. The theme
 * sets its documented custom properties on the element, which outrank the `:host` rules in its shadow tree. Nothing
 * renders here: the rule is read from the stylesheet, its tokens are resolved, and the pairs of ink and fill that the
 * picker draws are checked with the WCAG formula. That the panel looks dark is for a browser to confirm.
 */

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const theme = readFileSync(resolve(repository, "libs/tailwind/style/konclui.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
);
const picker = readFileSync(resolve(repository, "node_modules/emoji-picker-element/picker.js"), "utf8");

function block(selector: string): Map<string, string> {
    const start = theme.search(new RegExp(`(^|\\n)\\s*${selector}\\s*\\{`));
    if (start < 0) throw new Error(`The theme has no ${selector} rule`);
    const body = theme.slice(theme.indexOf("{", start) + 1, theme.indexOf("}", start));
    const declarations = new Map<string, string>();
    for (const declaration of body.split(";")) {
        const colon = declaration.indexOf(":");
        if (colon > 0) declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
    return declarations;
}

function token(name: string): string {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(theme);
    if (match?.[1] === undefined) throw new Error(`The theme does not define ${name}`);
    return match[1].trim();
}

function rgb(value: string): readonly [number, number, number] {
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    if (reference?.[1]) return rgb(token(reference[1]));
    const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
    if (hex === undefined) throw new Error(`Not a hex color: ${value}`);
    const packed = parseInt(hex, 16);
    return [packed >> 16, (packed >> 8) & 255, packed & 255];
}

function luminance([red, green, blue]: readonly [number, number, number]): number {
    const linear = (channel: number): number => {
        const unit = channel / 255;
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrast(first: string, second: string): number {
    const [a, b] = [luminance(rgb(first)), luminance(rgb(second))];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("the emoji picker in the Konclui theme", () => {
    const rule = block("emoji-picker");

    it("is the dark chrome whatever the system's color scheme: its colors come from the tokens, set on the element", () => {
        expect(rule.get("color-scheme")).toBe("dark");
        expect(rule.get("--background")).toBe("var(--k-chrome)");
        expect(rule.get("--border-color")).toBe("var(--k-chrome-border)");
        expect(rule.get("--indicator-color")).toBe("var(--k-accent)");
        expect(rule.get("--outline-color")).toBe("var(--k-accent)");
        expect(rule.get("--button-hover-background")).toBe("var(--k-hover)");
        expect(rule.get("--button-active-background")).toBe("var(--k-elevated)");
        expect(rule.get("--input-font-color")).toBe("var(--k-fg)");
        expect(rule.get("--input-placeholder-color")).toBe("var(--k-fg-muted)");
        expect(rule.get("--category-font-color")).toBe("var(--k-fg)");
    });

    it("sets every color property the picker's light theme sets, so none is left light", () => {
        // The properties its `:host` rule gives a color in the light scheme: a missing one would stay light.
        const light = /:host,:host\(\.light\)\{([^}]*)\}/.exec(picker)?.[1];
        expect(light).toBeDefined();
        const lightProperties = [...(light as string).matchAll(/(--[\w-]+):/g)].map((match) => match[1]);

        expect(lightProperties.length).toBeGreaterThan(5);
        for (const property of lightProperties) expect(rule.has(property), property).toBe(true);
    });

    it("names only colors made of the theme's tokens, none of its own", () => {
        for (const [property, value] of rule) {
            if (property === "color-scheme") continue;
            expect(value, property).toMatch(/^var\(--k-[\w-]+\)$/);
        }
    });

    it.each<[ink: string, fill: string, minimum: number]>([
        ["--input-font-color", "--background", 4.5],
        ["--category-font-color", "--background", 4.5],
        ["--input-placeholder-color", "--background", 4.5],
        ["--indicator-color", "--background", 3],
        ["--outline-color", "--background", 3],
        ["--input-border-color", "--background", 1.5],
        ["--input-font-color", "--button-hover-background", 4.5],
        ["--input-font-color", "--button-active-background", 4.5],
    ])("keeps %s readable on %s", (ink, fill, minimum) => {
        expect(contrast(rule.get(ink) as string, rule.get(fill) as string)).toBeGreaterThanOrEqual(minimum);
    });
});
