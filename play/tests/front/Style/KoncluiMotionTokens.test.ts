import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    SPRING_SURFACE,
    SPRING_SURFACE_MS,
    SPRING_TURN,
    SPRING_TURN_MS,
    cubicBezier,
    linearCss,
    springEasing,
} from "../../../src/front/Utils/spring";
import {
    SURFACE_EXIT_MS,
    SURFACE_ORIGIN_DEFAULT,
    SURFACE_SHEET_CURVE,
} from "../../../src/front/Utils/surfaceTransition";

/**
 * The motion tokens and utilities of libs/tailwind/style/konclui.css, read as text (nothing renders here), against the
 * code that has to agree with them: the generator of the `linear()` springs (Utils/spring.ts) and the transition that
 * runs the same motion in JS (Utils/surfaceTransition.ts). Nobody can change one side without the other.
 */

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const theme = readFileSync(resolve(repository, "libs/tailwind/style/konclui.css"), "utf8");

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
const withoutLinear = "@layer theme @supports not (transition-timing-function: linear(0, 1))";
const reducedMotion = `${utilities} @media (prefers-reduced-motion: reduce)`;

/** A declaration's value with its whitespace collapsed, from the rule whose selector is exactly `selector`. */
function declared(context: string, selector: string, property: string): string | undefined {
    return rules
        .find((rule) => rule.context === context && rule.selector === selector)
        ?.declarations.get(property)
        ?.replace(/\s+/g, " ");
}

const token = (property: string): string | undefined =>
    rules
        .find((rule) => rule.context === "@layer theme" && rule.selector === ':root, [data-theme="default"]')
        ?.declarations.get(property)
        ?.replace(/\s+/g, " ");

const fallback = (property: string): string | undefined =>
    rules
        .find((rule) => rule.context === withoutLinear && rule.selector === ':root, [data-theme="default"]')
        ?.declarations.get(property)
        ?.replace(/\s+/g, " ");

/** A `linear()` text with every space gone: the stylesheet breaks it over lines, the generator does not. */
const compact = (text: string | undefined): string => (text ?? "").replace(/\s+/g, "");

/** The four numbers of a `cubic-bezier()`. */
function bezierOf(text: string | undefined): [number, number, number, number] {
    const numbers = /^cubic-bezier\(([^)]*)\)$/
        .exec(text ?? "")?.[1]
        ?.split(",")
        .map(Number);
    if (numbers?.length !== 4) throw new Error(`not a cubic-bezier(): ${text}`);
    return [numbers[0], numbers[1], numbers[2], numbers[3]];
}

/** The largest distance between two easings over the whole of their progress. */
function worstDistance(a: (progress: number) => number, b: (progress: number) => number): number {
    let worst = 0;
    for (let step = 0; step <= 1000; step++) worst = Math.max(worst, Math.abs(a(step / 1000) - b(step / 1000)));
    return worst;
}

describe("the spring tokens", () => {
    it("hold the linear() text that the generator writes for each spring, so neither is edited alone", () => {
        expect(compact(token("--k-ease-spring"))).toBe(compact(linearCss(SPRING_SURFACE, SPRING_SURFACE_MS)));
        expect(compact(token("--k-ease-spring-turn"))).toBe(compact(linearCss(SPRING_TURN, SPRING_TURN_MS)));
    });

    it("pair each with the duration of its spring", () => {
        expect(token("--k-dur-spring")).toBe(`${SPRING_SURFACE_MS}ms`);
        expect(token("--k-dur-spring-turn")).toBe(`${SPRING_TURN_MS}ms`);
    });

    it("give a browser without linear() the cubic-bezier that follows the spring, within 1.2 % and 2.5 % of its travel", () => {
        const surface = bezierOf(fallback("--k-ease-spring"));
        const turn = bezierOf(fallback("--k-ease-spring-turn"));

        expect(worstDistance(cubicBezier(...surface), springEasing(SPRING_SURFACE, SPRING_SURFACE_MS))).toBeLessThan(
            0.012,
        );
        expect(worstDistance(cubicBezier(...turn), springEasing(SPRING_TURN, SPRING_TURN_MS))).toBeLessThan(0.025);
    });

    it("keep the fallback where it can win: after the tokens it replaces, in the same layer and selector", () => {
        const order = rules.map((rule) => `${rule.context} | ${rule.selector}`);
        const main = order.indexOf(`@layer theme | :root, [data-theme="default"]`);
        const supports = order.indexOf(`${withoutLinear} | :root, [data-theme="default"]`);

        expect(main).toBeGreaterThanOrEqual(0);
        expect(supports).toBeGreaterThan(main);
    });

    it("are 0.01 ms under reduced motion, as is every duration the theme declares", () => {
        const durations = [
            ...(rules.find((rule) => rule.context === "@layer theme")?.declarations.keys() ?? []),
        ].filter((name) => name.startsWith("--k-dur-"));
        const reduced = `@layer theme @media (prefers-reduced-motion: reduce)`;

        expect(durations).toEqual(expect.arrayContaining(["--k-dur-spring", "--k-dur-spring-turn"]));
        for (const name of durations) {
            expect(declared(reduced, ':root, [data-theme="default"]', name), name).toBe("0.01ms");
        }
    });

    it("declare the slow-motion multiplier at 1, which a surface's own transition reads", () => {
        expect(token("--k-motion-scale")).toBe("1");
    });
});

describe("what the JS transition shares with the stylesheet", () => {
    it("exits over --k-dur-normal on the curve of --k-ease-sheet", () => {
        expect(token("--k-dur-normal")).toBe(`${SURFACE_EXIT_MS}ms`);
        expect(token("--k-ease-sheet")).toBe(`cubic-bezier(${SURFACE_SHEET_CURVE.join(", ")})`);
    });

    it("comes from the origin .k-enter comes from by default: 6 px below, 2 % small", () => {
        const from = `${utilities} @keyframes k-enter`;

        expect(declared(from, "from", "transform")).toBe(
            `translate(var(--k-enter-x, ${SURFACE_ORIGIN_DEFAULT.x}px), var(--k-enter-y, ${SURFACE_ORIGIN_DEFAULT.y}px))`,
        );
        expect(declared(from, "from", "scale")).toBe(`var(--k-enter-scale, ${SURFACE_ORIGIN_DEFAULT.scale})`);
    });
});

describe("the press and the lift", () => {
    const idle = '[aria-disabled="true"]';

    it("give by the individual scale property, in the press timing, so no transform of a surface is touched", () => {
        expect(declared(utilities, ".k-press, .k-lift", "transition")).toBe(
            "scale var(--k-dur-press) var(--k-ease-out-expo)",
        );
        expect(declared(utilities, `.k-press:active:not(${idle}), .k-lift:active:not(${idle})`, "scale")).toBe(
            "var(--k-press-scale, 0.985)",
        );
    });

    it("rise 2 % under a pointer only where there is a pointer to hover, and not for a control that cannot act", () => {
        expect(declared(`${utilities} @media (hover: hover)`, `.k-lift:hover:not(${idle})`, "scale")).toBe(
            "var(--k-lift-scale, 1.02)",
        );
        expect(rules.filter((rule) => rule.selector.startsWith(".k-lift:hover") && rule.context === utilities)).toEqual(
            [],
        );
    });

    it("keep the fill and drop the scale under reduced motion", () => {
        expect(declared(reducedMotion, ".k-press, .k-lift", "transition")).toBe("none");
        expect(declared(reducedMotion, `.k-press:active:not(${idle}), .k-lift:active:not(${idle})`, "scale")).toBe(
            "none",
        );
        expect(declared(`${reducedMotion} and (hover: hover)`, `.k-lift:hover:not(${idle})`, "scale")).toBe("none");
    });
});

describe("the turn", () => {
    it("rotates on the chevron's spring, closed at -90deg and upright when open", () => {
        expect(declared(utilities, ".k-turn", "rotate")).toBe("var(--k-turn-closed, -90deg)");
        expect(declared(utilities, ".k-turn", "transition")).toBe(
            "rotate var(--k-dur-spring-turn) var(--k-ease-spring-turn)",
        );
        expect(declared(utilities, '.k-turn.is-open, [aria-expanded="true"] > .k-turn', "rotate")).toBe("0deg");
    });

    it("is upright at once under reduced motion", () => {
        expect(declared(reducedMotion, ".k-turn", "transition")).toBe("none");
    });
});

describe("the disclosure", () => {
    it("opens by the row of a one-row grid, 0fr to 1fr, on the surface spring", () => {
        expect(declared(utilities, ".k-disclosure", "display")).toBe("grid");
        expect(declared(utilities, ".k-disclosure", "grid-template-rows")).toBe("0fr");
        expect(declared(utilities, ".k-disclosure", "transition")).toBe(
            "grid-template-rows var(--k-dur-spring) var(--k-ease-spring)",
        );
        expect(declared(utilities, ".k-disclosure.is-open", "grid-template-rows")).toBe("1fr");
    });

    it("clips its body, and hides it from the focus and from a reader once the row has shut", () => {
        expect(declared(utilities, ".k-disclosure-body", "min-height")).toBe("0");
        expect(declared(utilities, ".k-disclosure-body", "overflow")).toBe("hidden");
        expect(declared(utilities, ".k-disclosure-body", "visibility")).toBe("hidden");
        // Visible after the row has closed, and at once on opening.
        expect(declared(utilities, ".k-disclosure-body", "transition")).toBe(
            "visibility 0s linear var(--k-dur-spring)",
        );
        expect(declared(utilities, ".k-disclosure.is-open > .k-disclosure-body", "visibility")).toBe("visible");
        expect(declared(utilities, ".k-disclosure.is-open > .k-disclosure-body", "transition-delay")).toBe("0s");
    });

    it("is open or shut at once under reduced motion", () => {
        expect(declared(reducedMotion, ".k-disclosure, .k-disclosure-body", "transition")).toBe("none");
    });
});

describe("the glide", () => {
    const hover = `${utilities} @media (hover: hover)`;

    it("stacks the list in a context of its own, so the pill is under the rows and over the surface", () => {
        expect(declared(utilities, ".k-glide", "isolation")).toBe("isolate");
        expect(declared(utilities, ":where(.k-glide)", "position")).toBe("relative");
        expect(declared(hover, ".k-glide-pill", "z-index")).toBe("-1");
        expect(declared(hover, ".k-glide-pill", "pointer-events")).toBe("none");
    });

    it("moves the pill by translate, on the surface spring, and fades it on the fast token", () => {
        expect(declared(hover, ".k-glide-pill", "translate")).toBe("var(--k-glide-x, 0px) var(--k-glide-y, 0px)");
        const transition = declared(hover, ".k-glide-pill", "transition") ?? "";
        expect(transition).toContain("translate var(--k-dur-spring) var(--k-ease-spring)");
        expect(transition).toContain("opacity var(--k-dur-fast)");
        expect(declared(hover, ".k-glide-pill.is-shown", "opacity")).toBe("1");
    });

    it("exists only where there is a hover: the pill is not drawn anywhere else", () => {
        expect(declared(utilities, ".k-glide-pill", "display")).toBe("none");
        expect(declared(hover, ".k-glide-pill", "display")).toBe("block");
    });

    it("takes the row's own hover fill away only while the pill is there, and never from a pressed or idle one", () => {
        const own = rules.find((rule) => rule.context === hover && rule.selector.startsWith(".k-glide-on"));

        expect(own?.selector).toContain(":is(.k-menu-row, .k-control):hover:not(");
        expect(own?.selector).toContain('[aria-disabled="true"]');
        expect(own?.selector).toContain('[aria-pressed="true"]');
        expect(own?.declarations.get("background")).toBe("transparent");
    });

    it("jumps under reduced motion, and is an outline where the system forces its colours", () => {
        expect(declared(reducedMotion, ".k-glide-pill", "transition")).toBe("none");
        const forced = `${utilities} @media (forced-colors: active)`;
        expect(declared(forced, ".k-glide-pill", "outline")).toBe("2px solid Highlight");
        expect(declared(forced, ".k-glide-pill", "background")).toBe("transparent");
    });
});
