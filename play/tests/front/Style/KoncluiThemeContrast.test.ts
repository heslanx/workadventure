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

    describe("chrome over the map", () => {
        const themeLayer = "@layer theme";
        const moreContrast = "@layer theme @media (prefers-contrast: more)";

        /** The rule in the given at-rules whose selector list holds the given compound, e.g. `.bg-contrast\/80`. */
        function ruleWith(context: string, fragment: string): Rule {
            const rule = rules.find(
                (candidate) =>
                    candidate.context === context &&
                    candidate.selectors.some((selector) => selector.includes(fragment)),
            );
            if (rule === undefined) throw new Error(`${context} has no rule for ${fragment}`);
            return rule;
        }

        const chrome = (): Rgb => token("--k-chrome");
        const chromeHover = (): Rgb =>
            color(ruleWith(hover, ".hover\\:bg-white\\/10").declarations.get("background-color") ?? "");

        it("is one flat, opaque material in every mode, with no backdrop filter", () => {
            const declarations = rules.flatMap((rule) =>
                [...rule.declarations].filter(([name]) => name === "--k-chrome" || name === "--k-chrome-backdrop"),
            );

            expect(declarations.length).toBeGreaterThan(0);
            for (const [name, value] of declarations) {
                if (name === "--k-chrome") expect(value).toMatch(/^#[0-9a-f]{6}$/i);
                else expect(value).toBe("none");
            }
            expect(declared(themeLayer, ":root", "--k-chrome")).toBe("#03051a");
            expect(declared(themeLayer, ":root", "--k-chrome-border")).toBe("var(--k-border)");
            expect(declared(themeLayer, ":root", "--k-chrome-shadow")).toBe("var(--k-shadow)");
        });

        it("leaves no glass behind: no glass token, no refraction filter", () => {
            expect([...tokens.keys()].filter((name) => name.startsWith("--k-glass"))).toEqual([]);
            expect(theme).not.toContain("k-glass-refract");
            for (const file of ["Konclui/Shell/components/Frame.svelte", "Konclui/Shell/components/Dock.svelte"]) {
                const source = readFileSync(resolve(front, file), "utf8");
                expect(source).not.toMatch(/k-glass|feDisplacementMap|blur\(/);
                expect(source).toContain("background: var(--k-chrome);");
                expect(source).toContain("var(--k-chrome-shadow)");
            }
        });

        /** The CSS specificity of one selector: `:where()` counts nothing, `:is()` and `:not()` their heaviest argument. */
        function specificity(selector: string): [number, number, number] {
            const total: [number, number, number] = [0, 0, 0];
            let index = 0;
            while (index < selector.length) {
                const rest = selector.slice(index);
                const functional = /^:(where|is|not)\(/.exec(rest);
                if (functional) {
                    const open = index + functional[0].length - 1;
                    let depth = 0;
                    let close = open;
                    for (; close < selector.length; close++) {
                        if (selector[close] === "(") depth++;
                        if (selector[close] === ")" && --depth === 0) break;
                    }
                    if (functional[1] !== "where") {
                        const heaviest = splitSelectors(selector.slice(open + 1, close))
                            .map(specificity)
                            .reduce((a, b) => (a.join() >= b.join() ? a : b));
                        for (const level of [0, 1, 2] as const) total[level] += heaviest[level];
                    }
                    index = close + 1;
                    continue;
                }
                const simple =
                    /^(#[\w-]+|\.(?:\\.|[\w-])+|\[[^\]]*\]|::[\w-]+|:[\w-]+|[a-zA-Z][\w-]*|\*|\s+|[>+~])/.exec(rest);
                if (!simple) throw new Error(`Cannot weigh ${rest}`);
                const [token] = simple;
                if (token.startsWith("#")) total[0]++;
                else if (/^(\.|\[|:[^:])/.test(token)) total[1]++;
                else if (/^(::|[a-zA-Z])/.test(token)) total[2]++;
                index += token.length;
            }
            return total;
        }

        const read = (file: string): string => readFileSync(resolve(front, file), "utf8");
        const staticChrome = (): Rule => ruleWith(utilities, ".bg-contrast\\/80");
        const moreContrastUtilities = "@layer utilities @media (prefers-contrast: more)";

        it.each([".bg-contrast\\/50", ".bg-contrast\\/80", ".bg-contrast\\/90"])(
            "paints %s with the chrome, drops its blur and stays at (0,1,0)",
            (utility) => {
                const rule = ruleWith(utilities, utility);
                const selector = rule.selectors.find((candidate) => candidate.includes(utility)) ?? "";

                expect(rule.declarations.get("background-color")).toBe("var(--k-chrome)");
                expect(rule.declarations.get("backdrop-filter")).toBe("var(--k-chrome-backdrop)");
                expect(rule.declarations.get("-webkit-backdrop-filter")).toBe("var(--k-chrome-backdrop)");
                // At (0,1,0) Tailwind's (0,2,0) hover and state variants still win over the static fill.
                expect(specificity(selector)).toEqual([0, 1, 0]);
                expect(selector).not.toContain(":hover");
            },
        );

        it("keeps the hover to the opaque contrast in its own rule, gated like Tailwind's hovers", () => {
            const rule = ruleWith(hover, ".hover\\:bg-contrast\\/100");

            expect(rule.declarations.get("background-color")).toBe("var(--k-chrome)");
            expect(rule.selectors).toHaveLength(1);
            expect(specificity(rule.selectors[0] ?? "")).toEqual([0, 2, 0]);
            expect(staticChrome().selectors.join(",")).not.toContain("bg-contrast\\/100");
        });

        it("lets a white or color fill on the same element win over a stray contrast fill", () => {
            const selector = staticChrome().selectors.find((candidate) => candidate.includes(".bg-contrast\\/80"));

            for (const fill of [".bg-white", ".bg-primary", ".bg-secondary", ".bg-danger", ".bg-success"]) {
                expect(selector).toMatch(new RegExp(`:where\\(\\s*:not\\([^)]*\\${fill}[\\s,)]`));
            }
            // The active co-website tab is white with navy ink; a contrast fill on it would hide the ink.
            const tab = read("Components/EmbedScreens/CoWebsiteTab.svelte");
            const active = /'text-contrast bg-white[^']*'/.exec(tab)?.[0] ?? "";
            expect(active).toBe("'text-contrast bg-white hover:bg-white/90 tab justify-between'");
        });

        it("maps only the chrome over the map: not the side panel, not the wells of a dialog", () => {
            const scoped = [staticChrome(), ruleWith(hover, ".hover\\:bg-contrast\\/100")].map(
                // Prettier may break the list across lines, so compare without the padding inside parentheses.
                (rule) =>
                    (rule.selectors.find((candidate) => candidate.includes("bg-contrast")) ?? "")
                        .replace(/\(\s+/g, "(")
                        .replace(/\s+\)/g, ")"),
            );

            for (const selector of scoped) {
                expect(selector).toContain(":where(:not([data-konclui-panel] *, .bg-contrast\\/95 *))");
            }
            expect(read("Konclui/Shell/components/Frame.svelte")).toMatch(
                /<aside[^>]*class="side-panel"[^>]*data-konclui-panel/,
            );
        });

        it("lifts the contrast fills inside the side panel to the next elevation, so they stay visible", () => {
            const rule = ruleWith(utilities, ":where([data-konclui-panel])");

            expect(rule.declarations.get("background-color")).toBe("var(--k-elevated)");
            expect(contrast(token("--k-elevated"), token("--k-card"))).toBeGreaterThan(1.1);
            expect(contrast(token("--k-fg"), token("--k-elevated"))).toBeGreaterThanOrEqual(4.5);
            expect(contrast(token("--k-fg-muted"), token("--k-elevated"))).toBeGreaterThanOrEqual(4.5);
        });

        it("keeps the dialogs and scene cards out of the chrome", () => {
            const chromeSelectors = staticChrome()
                .selectors.join(",")
                .replace(/:where\(:not\([^)]*\)\)/g, "");

            expect(chromeSelectors).not.toContain("bg-contrast\\/95");
            expect(chromeSelectors).not.toContain("k-card");
            for (const step of [
                "WelcomeStep",
                "CompleteStep",
                "PictureInPictureStep",
                "LockBubbleStep",
                "ScreenSharingStep",
                "MovementStep",
                "CommunicationStep",
            ]) {
                expect(read(`Components/Onboarding/Steps/${step}.svelte`)).toContain(
                    'class="bg-contrast/95 backdrop-blur-lg rounded-lg',
                );
            }
            expect(read("Chat/Components/MatrixPeerProfileDebugModal.svelte")).toContain("rounded-lg bg-contrast/95");
            const companion = read("Components/SelectCompanion/SelectCompanionScene.svelte");
            expect(companion).toContain("fixed bottom-0 w-full bg-(--k-card)");
            expect(companion).not.toContain("bg-contrast/80");
        });

        it.each([".hover\\:bg-white\\/10", ".hover\\:bg-white\\/30", ".group-hover\\:bg-white\\/10"])(
            "moves the %s hover to the one chrome hover",
            (utility) => {
                expect(ruleWith(hover, utility).declarations.get("background-color")).toBe("var(--k-hover)");
            },
        );

        it("matches any descendant of a hovered group, as Tailwind's group-hover does", () => {
            const selector = ruleWith(hover, ".group-hover\\:bg-white\\/10").selectors.find((candidate) =>
                candidate.includes(".group-hover"),
            );

            expect(selector).toBe(".group:hover .group-hover\\:bg-white\\/10");
        });

        it("leaves a filled control and a tinted resting fill on their own hover step", () => {
            const selector = ruleWith(hover, ".hover\\:bg-white\\/10").selectors.find((candidate) =>
                candidate.includes(".hover\\:bg-white\\/10"),
            );

            for (const fill of [
                ".bg-primary",
                ".bg-secondary",
                ".bg-danger",
                ".bg-success",
                ".bg-white\\/10",
                ".bg-white\\/20",
            ]) {
                expect(selector).toMatch(new RegExp(`:not\\([^)]*${fill.replace(/[.\\/]/g, "\\$&")}[\\s,)]`));
            }
        });

        it("gives the top-level chrome surfaces the dock's fill, rim and shadow", () => {
            const rule = ruleWith(utilities, ".k-chrome");

            expect(rule.selectors).toEqual([".k-chrome"]);
            expect(rule.declarations.get("background-color")).toBe("var(--k-chrome)");
            expect(rule.declarations.get("backdrop-filter")).toBe("var(--k-chrome-backdrop)");
            expect(rule.declarations.get("-webkit-backdrop-filter")).toBe("var(--k-chrome-backdrop)");
            expect(rule.declarations.get("box-shadow")).toMatch(
                /^inset 0 0 0 1px var\(--k-chrome-border\),\s*var\(--k-chrome-shadow\)$/,
            );
        });

        it.each<[file: string, surface: string, count: number]>([
            ["Components/ActionsMenu/ExplorerMenu.svelte", "k-chrome rounded-lg pointer-events-auto p-2", 1],
            ["Components/Cowebsites/ImageCowebsiteComponent.svelte", "k-chrome rounded-lg pointer-events-auto p-2", 1],
            ["Components/MapEditor/MapEditorSideBar.svelte", "p-2 k-chrome rounded-lg flex flex-col gap-2", 2],
            ["Components/Menu/Menu.svelte", "p-2 rounded-lg k-chrome flex", 2],
            ["Components/ActionBar/MenuIcons/ProfileMenuContent.svelte", "k-chrome rounded-lg p-1 w-56", 1],
            ["Components/ActionBar/MediaSettingsList/MediaSettingsList.svelte", "k-chrome rounded-lg w-64", 1],
            ["Components/ActionBar/MenuIcons/MapSubMenu.svelte", "absolute k-chrome rounded-lg", 1],
            ["Components/ActionBar/MenuIcons/ParticipantMenuItem.svelte", "absolute k-chrome rounded-lg", 1],
            ["Components/ActionBar/MenuIcons/AppsMenuItem.svelte", "k-chrome rounded-lg p-1", 1],
            ["Components/ActionBar/EmojiSubMenu.svelte", "k-chrome transition-all rounded-lg", 1],
            ["Components/Video/ActionMediaBox.svelte", "k-chrome rounded-lg", 1],
        ])("%s draws its surface with the chrome material", (file, surface, count) => {
            const source = read(file);

            expect(source.split(surface)).toHaveLength(count + 1);
            // No second, translucent material: no dialog fill and no blur on a chrome surface.
            expect(source).not.toMatch(/k-chrome[^"]*(bg-contrast\/95|backdrop-blur)/);
            expect(source).not.toMatch(/before:bg-contrast\/95/);
        });

        it("draws no rim on each mapped fill when more contrast is asked for: joined segments would show seams", () => {
            expect(() => ruleWith(moreContrastUtilities, ".bg-contrast\\/80")).toThrow();
        });

        it("keeps a panel fill nested in another panel fill visible with the hover step", () => {
            const nested = rules.find(
                (rule) =>
                    rule.context === utilities &&
                    rule.selectors.some((selector) => (selector.match(/bg-contrast\\\/80/g) ?? []).length === 2),
            );

            expect(nested?.declarations.get("background-color")).toBe("var(--k-hover)");
            expect(contrast(token("--k-hover"), token("--k-elevated"))).toBeGreaterThan(1.1);
            expect(contrast(token("--k-fg-muted"), token("--k-hover"))).toBeGreaterThanOrEqual(4.5);
        });

        it("gives every tooltip the chrome fill and no blur", () => {
            const tooltip = ruleWith(utilities, ".before\\:bg-contrast\\/80::before");

            expect(tooltip.declarations.get("background-color")).toBe("var(--k-chrome)");
            expect(tooltip.declarations.get("backdrop-filter")).toBe("var(--k-chrome-backdrop)");
            expect(specificity(".before\\:bg-contrast\\/80::before")).toEqual([0, 1, 1]);
            for (const file of ["Components/Util/Tooltip.svelte", "Components/Tooltip/HelpTooltip.svelte"]) {
                const source = read(file);
                expect(source).toContain("before:bg-contrast/80");
                expect(source).not.toContain("before:backdrop-blur");
            }
            for (const [file, count] of [
                ["Components/ActionsMenu/ExplorerMenu.svelte", 4],
                ["Components/Cowebsites/ImageCowebsiteComponent.svelte", 3],
            ] as const) {
                const source = read(file);
                expect(
                    source.match(
                        /group-hover:opacity-100 group-hover:right-11 group-focus-visible:opacity-100 group-focus-visible:right-11 absolute bg-contrast\/90 text-sm/g,
                    ),
                ).toHaveLength(count);
                expect(source).not.toContain("backdrop-blur");
            }
            expect(read("Components/ActionBar/ActionBarButton.svelte")).toContain("rounded bg-contrast/90 px-2 py-1");
        });

        it.each<[ink: string, value: () => Rgb]>([
            ["the theme's text", () => token("--k-fg")],
            ["upstream's white labels and icons", () => white],
            ["the muted text", () => token("--k-fg-muted")],
        ])("keeps %s readable on the chrome and on its hover", (_ink, value) => {
            expect(contrast(value(), chrome())).toBeGreaterThanOrEqual(4.5);
            expect(contrast(value(), chromeHover())).toBeGreaterThanOrEqual(4.5);
        });

        it("keeps the mint of a selected tool visible on the chrome", () => {
            expect(contrast(token("--k-accent"), chrome())).toBeGreaterThanOrEqual(3);
        });

        it("draws a rim of at least 3:1 around the chrome when more contrast is asked for", () => {
            const rim = color(declared(moreContrast, ":root", "--k-chrome-border"));

            expect(contrast(rim, chrome())).toBeGreaterThanOrEqual(3);
        });

        it("gives the zoom controls and the map editor tools the chrome geometry", () => {
            const explorer = read("Components/ActionsMenu/ExplorerMenu.svelte");
            const image = read("Components/Cowebsites/ImageCowebsiteComponent.svelte");

            // `rounded-lg` is the 16 px surface radius, `rounded` the 8 px inner one, `p-2` the 8 px padding.
            expect(theme).toMatch(/--radius-lg: 16px;/);
            expect(theme).toMatch(/--radius: 8px;/);
            expect(explorer.match(/min-h-7 min-w-7 p-2 rounded hover:bg-white\/30/g)).toHaveLength(4);
            expect(image.match(/min-h-7 min-w-7 p-2 rounded hover:bg-white\/30/g)).toHaveLength(3);
        });
    });
});
