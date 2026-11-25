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

// The loading screen is the one thing in the game element that is as large as the window, and the frame lays the game
// element out before the screen has gone. It stays where it is only if it stands on the window, which the frame's rule
// does by the structure upstream gives it: pinned here, so a change of that markup fails this test and not the page.
describe("Frame: the loading screen over a frame that is laid out", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const read = (relative: string) => readFileSync(join(here, relative), "utf8");
    const style = read("Frame.svelte")
        .slice(read("Frame.svelte").indexOf("<style>"))
        .replace(/\/\*[\s\S]*?\*\//g, "");

    it("stands the loading screen on the window while the frame is laid out", () => {
        const rule = /\.konclui :global\(#game > \.bg-contrast > \.h-dvh\)\s*\{([^}]*)\}/.exec(style)?.[1] ?? "";

        expect(/position:\s*([^;]+);/.exec(rule)?.[1].trim()).toBe("fixed");
    });

    it("matches the markup of the loading screen: a .bg-contrast wrapper in the game overlay around a .h-dvh root", () => {
        const overlay = read("../../../Components/GameOverlay.svelte");
        const loader = read("../../../Components/Loader/LoaderScene.svelte");

        expect(overlay).toMatch(/\{#if \$loaderVisibleStore\}\s*<div class="bg-contrast">\s*<LoaderScene \/>/);
        // The overlay is a direct child of the game element, which is what `#game > .bg-contrast` needs.
        expect(read("../../../Components/App.svelte")).toMatch(
            /<div\s+id="game"[^>]*>\s*\{#if game\}\s*<GameOverlay \{game\} \/>/,
        );
        expect(loader).toMatch(/<div\s+class="absolute [^"]*\bh-dvh\b[^"]*"/);
    });
});

// The side panel floats over the map from 768 px up, and over the canvas a card is the only thing between the pointer and
// the game. jsdom runs no media query and no hit test, so these pin the rules as written.
describe("Frame: the side panel over the map", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "Frame.svelte"), "utf8");
    const style = source.slice(source.indexOf("<style>") + "<style>".length, source.indexOf("</style>"));

    type Rule = { media: string | undefined; selector: string; body: string };
    // Every rule of the style with the media query it sits in: a walk over the braces, with the comments dropped first.
    function rules(): Rule[] {
        const found: Rule[] = [];
        const preludes: string[] = [];
        let text = "";
        for (const character of style.replace(/\/\*[\s\S]*?\*\//g, "")) {
            if (character === "{") {
                preludes.push(text.trim());
                text = "";
            } else if (character === "}") {
                const selector = preludes.pop() ?? "";
                const media = preludes.find((prelude) => prelude.startsWith("@media"))?.replace(/^@media\s*/, "");
                if (text.trim() !== "") found.push({ media, selector, body: text });
                text = "";
            } else {
                text += character;
            }
        }
        return found;
    }
    const ruleFor = (media: string | undefined, selector: string): Rule | undefined =>
        rules().find((rule) => rule.media === media && rule.selector === selector);
    const declaration = (rule: Rule | undefined, property: string): string | undefined =>
        new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(rule?.body ?? "")?.[1].trim();

    // Floats unless the card is in its column: beside a co-website, while the panel is open. A card that leaves is not in
    // a column any more (the frame is no longer `panel-open`), so it floats where the column was.
    const floating = ".konclui:not(.shares-map.panel-open) .side-panel";
    const strip = ".konclui:not(.shares-map) .panel-reserve";

    it("floats the card over the map's start edge, beside the rail, from 768 px up", () => {
        const card = ruleFor("(min-width: 768px)", floating);

        expect(declaration(card, "position")).toBe("absolute");
        expect(declaration(card, "inset-inline-start")).toBe("var(--rail-width)");
        expect(declaration(card, "top")).toBe("var(--frame-gap)");
        expect(declaration(card, "bottom")).toBe("var(--frame-gap)");
        expect(declaration(card, "width")).toBe("calc(var(--panel-width) - var(--frame-gap))");
    });

    it("pads the frame on its end side, where the card's inline offset expects the rail to be, in both directions", () => {
        const frame = ruleFor(undefined, ".konclui");
        const card = ruleFor("(min-width: 768px)", floating);

        expect(declaration(frame, "padding-block")).toBe("var(--frame-gap)");
        expect(declaration(frame, "padding-inline")).toBe("0 var(--frame-gap)");
        expect(declaration(frame, "padding")).toBeUndefined();
        expect(declaration(card, "inset-inline-start")).toBe("var(--rail-width)");
    });

    it("stands the card over the canvas and under the HUD, and does not make it click-through", () => {
        const card = ruleFor("(min-width: 768px)", floating);
        const layout = readFileSync(join(here, "../../../Components/MainLayout.svelte"), "utf8");
        const hudLayer = Number(/id="main-layout"\s+class="[^"]*\bz-(\d+)\b/.exec(layout)?.[1]);

        // A card over the canvas is hit first, so a click on it never reaches the game: Phaser sends a press whose target is
        // not the canvas to POINTER_DOWN_OUTSIDE, which nothing in the game walks on.
        expect(Number.isNaN(hudLayer)).toBe(false);
        // Under the HUD, so that a fullscreen video, a modal with its scrim and a popup centred on the window cover the
        // card as they cover the map; over level 0, where the canvas and Phaser's DOM layer with the name tags are drawn.
        const level = Number(declaration(card, "z-index"));
        expect(level).toBeGreaterThan(0);
        expect(level).toBeLessThan(hudLayer);
        expect(declaration(card, "pointer-events")).toBeUndefined();
        expect(rules().some((rule) => rule.selector.includes(".side-panel") && /pointer-events/.test(rule.body))).toBe(
            false,
        );
    });

    it("keeps the phone's card as a sheet over the map, above the HUD as well", () => {
        const sheet = ruleFor("(max-width: 767px)", ".side-panel");

        expect(declaration(sheet, "position")).toBe("absolute");
        expect(Number(declaration(sheet, "z-index"))).toBeGreaterThan(10);
        expect(declaration(sheet, "pointer-events")).toBeUndefined();
    });

    it("draws the strip under the card only where the card floats, and lets every click through it", () => {
        const base = ruleFor(undefined, ".panel-reserve");
        const drawn = ruleFor("(min-width: 768px)", strip);

        expect(declaration(base, "display")).toBe("none");
        expect(declaration(drawn, "display")).toBe("block");
        expect(declaration(drawn, "pointer-events")).toBe("none");
        expect(declaration(drawn, "inset-inline-start")).toBe("var(--rail-width)");
        expect(declaration(drawn, "width")).toBe("var(--panel-width)");
    });

    it("never animates the strip: a blocker measures it again only on an event of its own", () => {
        const own = rules().filter((rule) => rule.selector.includes(".panel-reserve"));

        expect(own.length).toBeGreaterThan(0);
        for (const rule of own) {
            expect(rule.body).not.toMatch(/animation|transition|transform|opacity/);
        }
        expect(source).not.toMatch(/class="panel-reserve[^"]*k-enter/);
    });

    it("changes no grid column when the panel opens, and only beside a co-website gives it a column", () => {
        const columns = rules().filter((rule) => /grid-template-columns/.test(rule.body));
        const withPanelOpen = columns.filter((rule) => rule.selector.includes("panel-open"));

        expect(columns.filter((rule) => !rule.selector.includes("panel-open")).map((rule) => rule.selector)).toEqual([
            ".konclui",
        ]);
        expect(withPanelOpen.map((rule) => rule.selector)).toEqual([".konclui.panel-open.shares-map"]);
        expect(declaration(withPanelOpen[0], "grid-template-columns")).toBe(
            "var(--rail-width) var(--panel-width) minmax(0, 1fr)",
        );
    });
});

// The card comes and goes through its transition, and the rail's buttons are what the pill and the press act on. jsdom
// resolves neither a media query nor the cascade of a compiled Svelte style: these pin the rules as written.
describe("Frame: the card's exit and the rail's pill", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "Frame.svelte"), "utf8");
    const style = source.slice(source.indexOf("<style>") + "<style>".length, source.indexOf("</style>"));
    const css = style.replace(/\/\*[\s\S]*?\*\//g, "");

    type Rule = { media: string | undefined; selector: string; body: string };
    function rules(): Rule[] {
        const found: Rule[] = [];
        const preludes: string[] = [];
        let text = "";
        for (const character of css) {
            if (character === "{") {
                preludes.push(text.trim());
                text = "";
            } else if (character === "}") {
                const selector = preludes.pop() ?? "";
                const media = preludes.find((prelude) => prelude.startsWith("@media"))?.replace(/^@media\s*/, "");
                if (text.trim() !== "") found.push({ media, selector, body: text });
                text = "";
            } else {
                text += character;
            }
        }
        return found;
    }
    const ruleFor = (media: string | undefined, selector: string): Rule | undefined =>
        rules().find((rule) => rule.media === media && rule.selector === selector);

    it("has no hidden card to come back from: nothing hides the card with display: none", () => {
        expect(
            rules().filter((rule) => rule.selector.includes(".side-panel") && /display:\s*none/.test(rule.body)),
        ).toEqual([]);
        expect(source).not.toMatch(/class:closed/);
    });

    it("gives the card no entrance of its own: the transition on the card is the only one", () => {
        const card = rules().filter((rule) => rule.selector === ".side-panel");

        expect(card.length).toBeGreaterThan(0);
        for (const rule of card) expect(rule.body).not.toMatch(/animation|transition:|--k-enter-dur|--k-enter-ease/);
    });

    it("floats a card that leaves beside a co-website, where its column was, and not on a phone", () => {
        // On a phone the card is a sheet at its own place: the floating rule must not reach it.
        const floating = ruleFor("(min-width: 768px)", ".konclui:not(.shares-map.panel-open) .side-panel");

        expect(floating).toBeDefined();
        expect(rules().filter((rule) => rule.selector.includes("panel-open) .side-panel"))).toHaveLength(1);
        expect(/inset-inline-start:\s*([^;]+);/.exec(floating?.body ?? "")?.[1].trim()).toBe("var(--rail-width)");
        expect(/width:\s*([^;]+);/.exec(floating?.body ?? "")?.[1].trim()).toBe(
            "calc(var(--panel-width) - var(--frame-gap))",
        );
    });

    it("gives the hover fill of the rail only where there is a hover, and only while the pill is not there", () => {
        const hover = ruleFor("(hover: hover)", ".rail:not(:global(.k-glide-on)) button:hover");

        expect(hover?.body).toMatch(/background:\s*var\(--k-elevated\)/);
        // No hover fill outside the media query: a tap on a tablet would leave it behind.
        expect(rules().filter((rule) => /:hover/.test(rule.selector) && rule.media !== "(hover: hover)")).toEqual([]);
    });

    it("keeps the pressed button's fill and colour, whatever the pill does, and gives it an outline in forced colours", () => {
        const pressed = ruleFor(undefined, '.rail button[aria-pressed="true"]');
        const forced = ruleFor("(forced-colors: active)", '.rail button[aria-pressed="true"]:not(:focus-visible)');

        expect(pressed?.body).toMatch(/background:\s*var\(--k-elevated\)/);
        expect(pressed?.body).toMatch(/color:\s*var\(--k-accent\)/);
        expect(forced?.body).toMatch(/outline:\s*2px solid Highlight/);
    });

    it("paints the pill in the rail's own fill and shape", () => {
        const pill = ruleFor(undefined, ".rail :global(.k-glide-pill)");

        expect(pill?.body).toMatch(/background:\s*var\(--k-elevated\)/);
        expect(pill?.body).toMatch(/border-radius:\s*10px/);
    });
});
