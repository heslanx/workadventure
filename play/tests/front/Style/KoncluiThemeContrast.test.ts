import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The contrast contract of the Konclui theme. The theme turns `secondary` into a light mint and `danger` into a dark
 * red, so the white marks and navy labels that upstream pairs with those fills stop being readable. Nothing here
 * renders CSS: the theme and the call sites are read as text, the tokens are resolved, and each ink is checked
 * against the fill under it with the WCAG formula (4.5:1 for text, 3:1 for icons and state marks).
 */

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const theme = readFileSync(resolve(repository, "libs/tailwind/style/konclui.css"), "utf8");
const front = resolve(repository, "play/src/front");

type Rgb = readonly [number, number, number];

interface Rule {
    /** The at-rules around the rule, outermost first, e.g. `@layer utilities @media (hover: hover)`. */
    context: string;
    selectors: string[];
    declarations: Map<string, string>;
}

function splitSelectors(list: string): string[] {
    const selectors: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of list) {
        if (char === "(") depth++;
        if (char === ")") depth--;
        if (char === "," && depth === 0) {
            selectors.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }
    selectors.push(current.trim());
    return selectors;
}

function addDeclaration(rule: Rule, text: string): void {
    const colon = text.indexOf(":");
    if (colon > 0) rule.declarations.set(text.slice(0, colon).trim(), text.slice(colon + 1).trim());
}

/** The style rules of a stylesheet whose style rules do not nest, as the theme is written. */
function parseRules(css: string): Rule[] {
    const rules: Rule[] = [];
    const atRules: string[] = [];
    let rule: Rule | undefined;
    let pending = "";
    for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
        if (char === "{") {
            const head = pending.replace(/\s+/g, " ").trim();
            if (head.startsWith("@")) {
                atRules.push(head);
            } else {
                rule = { context: atRules.join(" "), selectors: splitSelectors(head), declarations: new Map() };
                rules.push(rule);
            }
            pending = "";
        } else if (char === "}") {
            if (rule) addDeclaration(rule, pending);
            else atRules.pop();
            rule = undefined;
            pending = "";
        } else if (char === ";") {
            if (rule) addDeclaration(rule, pending);
            pending = "";
        } else {
            pending += char;
        }
    }
    return rules;
}

const rules = parseRules(theme);
const tokens = new Map<string, string>();
for (const rule of rules) {
    for (const [name, value] of rule.declarations) {
        if (name.startsWith("--")) tokens.set(name, value);
    }
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
    const amplitude = saturation * Math.min(lightness, 1 - lightness);
    const channel = (offset: number): number => {
        const k = (offset + hue / 30) % 12;
        return 255 * (lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return [channel(0), channel(8), channel(4)];
}

/** A color as the theme writes it: a hex, the design system's `H S% L%` triplet, or a reference to a token. */
function color(value: string): Rgb {
    const [, reference = ""] = /^(?:hsl\()?var\((--[\w-]+)\)\)?$/.exec(value) ?? [];
    if (reference) {
        const token = tokens.get(reference);
        if (token === undefined) throw new Error(`The theme does not define ${reference}`);
        return color(token);
    }
    const [, hex = ""] = /^#([0-9a-f]{6})$/i.exec(value) ?? [];
    if (hex) {
        const packed = parseInt(hex, 16);
        return [packed >> 16, (packed >> 8) & 255, packed & 255];
    }
    const [, hue = "", saturation = "", lightness = ""] = /^([\d.]+) ([\d.]+)% ([\d.]+)%$/.exec(value) ?? [];
    if (hue) return hslToRgb(Number(hue), Number(saturation) / 100, Number(lightness) / 100);
    throw new Error(`Not a color the theme can hold: ${value}`);
}

const token = (name: string): Rgb => color(`var(${name})`);

/** What the theme declares for a selector, inside the given at-rules. */
function declared(context: string, selector: string, property: string): string {
    const rule = rules.find((candidate) => candidate.context === context && candidate.selectors.includes(selector));
    const value = rule?.declarations.get(property);
    if (value === undefined) throw new Error(`${context} sets no ${property} for ${selector}`);
    return value;
}

function luminance(rgb: Rgb): number {
    const linear = (channel: number): number => {
        const unit = channel / 255;
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

function contrast(first: Rgb, second: Rgb): number {
    const [a, b] = [luminance(first), luminance(second)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** A translucent color as it shows over an opaque one. */
function over(top: Rgb, alpha: number, below: Rgb): Rgb {
    const mix = (index: 0 | 1 | 2): number => alpha * top[index] + (1 - alpha) * below[index];
    return [mix(0), mix(1), mix(2)];
}

const white: Rgb = [255, 255, 255];
const black: Rgb = [0, 0, 0];
// The design system's `neutral-100`, which the theme does not move.
const neutral100: Rgb = [249, 250, 251];

const utilities = "@layer utilities";
const components = "@layer components";
const hover = "@layer utilities @media (hover: hover)";

describe("Konclui theme contrast", () => {
    describe("marks on the mint fill", () => {
        it.each<[mark: string, context: string, selector: string, property: string, minimum: number]>([
            ["the text of a mint badge", utilities, ":is(.bg-primary, .bg-secondary):not(button, a)", "color", 4.5],
            ["white text set on a child", utilities, ":is(.bg-primary, .bg-secondary) > .text-white", "color", 4.5],
            ["a white icon stroke", utilities, ":is(.bg-primary, .bg-secondary) .stroke-white", "stroke", 3],
            ["the knob of a checked switch", components, ".peer:checked ~ .input-switch::after", "background-color", 3],
            [
                "the dot of a checked radio",
                components,
                ".peer:checked ~ .input-radio-light::after",
                "background-color",
                3,
            ],
        ])("%s is readable on the fill and on its hover step", (_mark, context, selector, property, minimum) => {
            const ink = color(declared(context, selector, property));

            expect(contrast(ink, token("--secondary"))).toBeGreaterThanOrEqual(minimum);
            expect(contrast(ink, token("--secondary-800"))).toBeGreaterThanOrEqual(minimum);
        });
    });

    describe("marks on the danger and success fills", () => {
        it.each([".bg-danger.text-contrast-900", ".bg-danger .text-contrast-900"])(
            "navy text asked for on the danger fill becomes light (%s)",
            (selector) => {
                const ink = color(declared(utilities, selector, "color"));

                expect(contrast(ink, token("--danger"))).toBeGreaterThanOrEqual(4.5);
            },
        );

        it("keeps a hovered danger fill in the red family, under a readable label and icon", () => {
            const fill = color(declared(hover, ".hover\\:bg-danger-600:hover", "background-color"));
            const dockLabel = color(declared(utilities, ".bg-danger.text-contrast-900", "color"));
            const menuLabel = color(
                declared(hover, ".hover\\:bg-danger-600:hover .group-hover\\:text-contrast-900", "color"),
            );

            expect(fill).toEqual(token("--danger-800"));
            expect(contrast(dockLabel, fill)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(menuLabel, fill)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(white, fill)).toBeGreaterThanOrEqual(3);
        });

        it("keeps a hovered success fill in the green family, under a readable label and icon", () => {
            const fill = color(declared(hover, ".hover\\:bg-success-600:hover", "background-color"));

            expect(fill).toEqual(token("--success-800"));
            expect(contrast(token("--contrast-900"), fill)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(white, fill)).toBeGreaterThanOrEqual(3);
        });

        it("leaves the -600 steps to the design system, where they are light text on navy", () => {
            expect(tokens.has("--danger-600")).toBe(false);
            expect(tokens.has("--success-600")).toBe(false);
        });
    });

    describe("keyboard focus", () => {
        it("draws a mint ring around a focused design-system button, visible on the navy page", () => {
            const outline = declared(components, ".btn:focus-visible", "outline");
            const [, width = "", style = "", ringColor = ""] = /^(\d+)px (\w+) (.+)$/.exec(outline) ?? [];

            expect(Number(width)).toBeGreaterThanOrEqual(2);
            expect(style).toBe("solid");
            expect(contrast(color(ringColor), token("--k-page"))).toBeGreaterThanOrEqual(3);
            expect(contrast(color(ringColor), token("--k-card"))).toBeGreaterThanOrEqual(3);
        });
    });

    describe("fills declared in components", () => {
        interface Site {
            file: string;
            /** The fill and ink the component must declare together. */
            classes: string;
            /** The class the pair replaces, when leaving it in place would undo the pair. */
            replaced?: string;
            pairs: () => [ink: Rgb, fill: Rgb, minimum: number][];
        }

        const sites: Site[] = [
            {
                file: "Chat/Components/Room/Message.svelte",
                classes: "bg-secondary-1100/90 rounded-br-none",
                // The text, links and attachments are white and the time is white at 85%, over any backdrop.
                pairs: () =>
                    [black, white].flatMap((backdrop): [Rgb, Rgb, number][] => {
                        const bubble = over(token("--secondary-1100"), 0.9, backdrop);
                        return [
                            [white, bubble, 4.5],
                            [over(white, 0.85, bubble), bubble, 4.5],
                        ];
                    }),
            },
            {
                file: "Components/Video/UserName.svelte",
                classes: "bg-secondary/90 text-contrast-900",
                pairs: () => [
                    [token("--contrast-900"), over(token("--secondary"), 0.9, black), 4.5],
                    [token("--contrast-900"), over(token("--secondary"), 0.9, white), 4.5],
                ],
            },
            {
                file: "Components/PopUp/Recording/RecordingContextMenuContent.svelte",
                classes: "bg-secondary hover:bg-secondary-800 cursor-pointer",
                pairs: () => {
                    const ink = color(declared(utilities, ".bg-secondary:is(button, a)", "color"));
                    return [
                        [ink, token("--secondary"), 4.5],
                        [ink, token("--secondary-800"), 4.5],
                    ];
                },
            },
            {
                file: "Components/Video/ScreenAnnotationToolbar.svelte",
                classes: "aria-pressed:bg-secondary aria-pressed:text-contrast-900 aria-pressed:hover:bg-secondary-800",
                pairs: () => [
                    [token("--contrast-900"), token("--secondary"), 3],
                    [token("--contrast-900"), token("--secondary-800"), 3],
                ],
            },
            {
                file: "Components/Video/ScreenAnnotationToolbar.svelte",
                // Up to the closing quote: the pressed toggle keeps the light ink of every toolbar button.
                classes: '{baseButton} aria-pressed:bg-danger aria-pressed:hover:bg-danger-800"',
                pairs: () => [
                    [neutral100, token("--danger"), 3],
                    [neutral100, token("--danger-800"), 3],
                ],
            },
            {
                file: "Chat/Components/Room/MessageInputBar.svelte",
                classes: '"bg-secondary/10 ring-1 ring-inset ring-secondary"',
                replaced: "class:bg-secondary-800",
                // The tile sits on the `bg-contrast/50` panel of the chat; its description is white at 60%.
                pairs: () =>
                    [token("--k-card"), black].flatMap((backdrop): [Rgb, Rgb, number][] => {
                        const tile = over(token("--secondary"), 0.1, over(token("--contrast"), 0.5, backdrop));
                        return [
                            [white, tile, 4.5],
                            [over(white, 0.6, tile), tile, 4.5],
                            [token("--secondary"), tile, 3],
                        ];
                    }),
            },
            {
                file: "Components/Video/PictureInPicture/DesktopMeetingBar.svelte",
                classes: "'translate-x-4 bg-contrast-900'",
                pairs: () => [[token("--contrast-900"), token("--secondary"), 3]],
            },
        ];

        it.each(sites)("$file pairs $classes with readable ink", ({ file, classes, replaced, pairs }) => {
            const source = readFileSync(resolve(front, file), "utf8");

            expect(source).toContain(classes);
            if (replaced !== undefined) expect(source).not.toContain(replaced);
            for (const [ink, fill, minimum] of pairs()) {
                expect(contrast(ink, fill)).toBeGreaterThanOrEqual(minimum);
            }
        });
    });
});
