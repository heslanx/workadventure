import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The fitness test of the Konclui context. It reads the source tree and fails when upstream reaches into the
 * context, a layer imports against the layer table of `AGENTS.md`, the context polls or observes the whole page,
 * swallows an error or adds a barrel, or a domain imports another one against the domain graph.
 *
 * It skips its own path: its needles are literals in a file that is part of the context.
 */

const contextDir = dirname(fileURLToPath(import.meta.url));
const playSrc = resolve(contextDir, "../..");
const tailwindStyle = resolve(playSrc, "../../libs/tailwind/style");
const selfPath = fileURLToPath(import.meta.url);

/**
 * Direct imports each domain may make; every path through these edges is allowed too. `Shell` composes the other
 * domains, so nothing imports it, and `Preferences` is the leaf every domain may read.
 */
const domainEdges: Readonly<Record<string, readonly string[]>> = {
    Shell: ["Presence", "Expression", "Identity", "Notifications", "Ambience", "OfficeMenu", "Focus"],
    Presence: ["Rooms", "Workplace"],
    Workplace: ["Preferences"],
    Focus: ["Workplace", "Preferences"],
    Rooms: ["Preferences"],
    Expression: ["Rooms", "Preferences"],
    Identity: ["Rooms", "Preferences"],
    Notifications: ["Rooms", "Preferences"],
    Ambience: ["Rooms", "Preferences"],
    OfficeMenu: ["Preferences"],
    Preferences: [],
};

/** Upstream modules a domain layer may read types from, relative to `play/src/front`. */
const pureUpstreamTypeModules = ["Stores/CoWebsiteLayout"];

const layers = new Set(["domain", "stores", "components", "phaser"]);

interface SourceFile {
    readonly path: string;
    readonly text: string;
}

interface ImportReference {
    readonly specifier: string;
    readonly typeOnly: boolean;
}

function reachable(from: string): Set<string> {
    const seen = new Set<string>();
    const pending = [...(domainEdges[from] ?? [])];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        if (seen.has(next)) continue;
        seen.add(next);
        pending.push(...(domainEdges[next] ?? []));
    }
    return seen;
}

function importsOf(text: string): ImportReference[] {
    const references: ImportReference[] = [];
    for (const match of text.matchAll(
        /(?:^|[;\s])(?:import|export)\s+(type\s+)?(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/g,
    )) {
        references.push({ specifier: match[2], typeOnly: match[1] !== undefined });
    }
    for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
        references.push({ specifier: match[1], typeOnly: false });
    }
    for (const match of text.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
        references.push({ specifier: match[1], typeOnly: false });
    }
    return references;
}

function isInside(path: string, directory: string): boolean {
    return path === directory || path.startsWith(directory + sep);
}

function withoutExtension(path: string): string {
    return path.replace(/\.(ts|js|svelte|css)$/, "");
}

function domainOf(path: string): string | undefined {
    if (!isInside(path, contextDir)) return undefined;
    const [domain, ...rest] = relative(contextDir, path).split(sep);
    return rest.length > 0 && domain in domainEdges ? domain : undefined;
}

/** The layer of a file in a domain folder, from its path alone, so a cross-domain target has one too. */
function layerOf(path: string): string | undefined {
    if (!isInside(path, contextDir)) return undefined;
    const [, layer, ...rest] = relative(contextDir, path).split(sep);
    return rest.length > 0 && layers.has(layer) ? layer : undefined;
}

/** The context folder of a file when `domainEdges` does not list it; root files such as the integration have none. */
function unlistedFolderOf(path: string): string | undefined {
    if (!isInside(path, contextDir)) return undefined;
    const [folder, ...rest] = relative(contextDir, path).split(sep);
    return rest.length > 0 && !(folder in domainEdges) ? folder : undefined;
}

function isComponent(specifier: string, target: string | undefined): boolean {
    if (specifier.endsWith(".svelte")) return true;
    if (target === undefined) return false;
    // Only the Svelte tree counts upstream: `Phaser/Components` holds Phaser classes a `phaser/` layer may import.
    return layerOf(target) === "components" || isInside(target, join(playSrc, "front", "Components"));
}

/** A `phaser/` layer file of any domain, or upstream's Phaser tree: the scene internals components may not import. */
function isPhaser(target: string): boolean {
    return layerOf(target) === "phaser" || isInside(target, join(playSrc, "front", "Phaser"));
}

/**
 * The top-level arguments of the call whose opening parenthesis is at `open`, or undefined when it never closes.
 * Brackets and commas inside strings and comments do not count; regex literals and nested templates are not parsed.
 */
function callArguments(text: string, open: number): string[] | undefined {
    const callArgs: string[] = [];
    let depth = 0;
    let start = open + 1;
    for (let index = open; index < text.length; index++) {
        const char = text[index];
        if (char === '"' || char === "'" || char === "`") {
            for (index++; index < text.length && text[index] !== char; index++) {
                if (text[index] === "\\") index++;
            }
        } else if (char === "/" && text[index + 1] === "/") {
            while (index < text.length && text[index] !== "\n") index++;
        } else if (char === "/" && text[index + 1] === "*") {
            const end = text.indexOf("*/", index + 2);
            if (end === -1) return undefined;
            index = end + 1;
        } else if ("([{".includes(char)) {
            depth++;
        } else if (")]}".includes(char)) {
            depth--;
            if (depth === 0) return [...callArgs, text.slice(start, index)];
        } else if (char === "," && depth === 1) {
            callArgs.push(text.slice(start, index));
            start = index + 1;
        }
    }
    return undefined;
}

/**
 * How many `setTimeout` calls lack an integer literal delay of 1000 ms or more. The delay is the second argument;
 * a missing one is 0 ms, and a named or computed one cannot be read here, so both count.
 */
function countShortTimeouts(text: string): number {
    let count = 0;
    for (const match of text.matchAll(/\bsetTimeout\s*\(/g)) {
        const delay = callArguments(text, match.index + match[0].length - 1)?.[1]?.trim() ?? "";
        if (!/^\d[\d_]*$/.test(delay) || Number(delay.replace(/_/g, "")) < 1000) count++;
    }
    return count;
}

/** Every rule violation in `files`, one readable line each. */
function findViolations(files: readonly SourceFile[]): string[] {
    const violations: string[] = [];
    const integration = join(contextDir, "integration");
    const entry = join(playSrc, "svelte.ts");

    for (const file of files) {
        const name = relative(playSrc, file.path);
        const inContext = isInside(file.path, contextDir);
        const domain = domainOf(file.path);
        const layer = layerOf(file.path);
        const unlistedFolder = unlistedFolderOf(file.path);

        if (unlistedFolder !== undefined) {
            violations.push(`rule 5: ${name} is in ${unlistedFolder}, which is not a domain in domainEdges`);
        }

        for (const { specifier, typeOnly } of importsOf(file.text)) {
            const target = specifier.startsWith(".") ? resolve(dirname(file.path), specifier) : undefined;

            if (!inContext && target !== undefined && isInside(target, contextDir)) {
                if (!(file.path === entry && withoutExtension(target) === integration)) {
                    violations.push(`rule 1: ${name} imports ${specifier}`);
                }
            }

            if (layer === "domain") {
                const testRunner = specifier === "vitest" && file.path.endsWith(".test.ts");
                const pureType =
                    typeOnly &&
                    target !== undefined &&
                    pureUpstreamTypeModules.includes(withoutExtension(relative(join(playSrc, "front"), target)));
                const allowed =
                    target === undefined
                        ? specifier === "zod" || testRunner
                        : pureType || (layerOf(target) === "domain" && !specifier.endsWith(".svelte"));
                if (!allowed) violations.push(`rule 2: domain file ${name} imports ${specifier}`);
            }

            if ((layer === "stores" || layer === "phaser") && isComponent(specifier, target)) {
                violations.push(`rule 2: ${layer} file ${name} imports the component ${specifier}`);
            }

            if (layer === "components" && target !== undefined && isPhaser(target)) {
                violations.push(`rule 2: component file ${name} imports the Phaser layer ${specifier}`);
            }

            const targetDomain = target === undefined ? undefined : domainOf(target);
            if (domain !== undefined && targetDomain !== undefined && targetDomain !== domain) {
                if (!reachable(domain).has(targetDomain)) {
                    violations.push(`rule 5: ${domain} may not import ${targetDomain} (${name} -> ${specifier})`);
                }
            }
        }

        if (layer === "domain" && /\b(window|document)\s*[.[]/.test(file.text)) {
            violations.push(`rule 2: domain file ${name} touches window or document`);
        }

        if (inContext) {
            if (file.text.includes("MutationObserver")) violations.push(`rule 3: ${name} uses MutationObserver`);
            if (file.text.includes("setInterval(")) violations.push(`rule 3: ${name} uses setInterval`);
            const shortTimeouts = countShortTimeouts(file.text);
            if (shortTimeouts > 0) {
                violations.push(`rule 3: ${name} sets ${shortTimeouts} timeout(s) without a literal delay >= 1000 ms`);
            }
            if (
                /catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(file.text) ||
                /\.catch\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|undefined)\s*\)/.test(file.text)
            ) {
                violations.push(`rule 6: ${name} swallows an error in an empty catch`);
            }
            if (basename(file.path) === "index.ts") violations.push(`rule 7: ${name} is a barrel index file`);
        }

        if (isInside(file.path, playSrc) && (file.text.includes("window.__k") || file.text.includes("data-k-"))) {
            violations.push(`rule 4: ${name} uses the overlay flag protocol`);
        }
    }
    return violations;
}

function readTree(directory: string): SourceFile[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return readTree(path);
        if (!/\.(ts|svelte|css)$/.test(entry.name) || path === selfPath) return [];
        return [{ path, text: readFileSync(path, "utf8") }];
    });
}

const at = (path: string, text: string): SourceFile => ({ path: join(playSrc, path), text });

describe("Konclui architecture", () => {
    it("holds for the source tree", () => {
        const files = [...readTree(playSrc), ...readTree(tailwindStyle)];
        expect(files.some((file) => file.path === join(contextDir, "integration.ts"))).toBe(true);
        expect(findViolations(files)).toEqual([]);
    });

    it("lets only the entry point import the integration", () => {
        expect(
            findViolations([at("svelte.ts", 'import { installKonclui } from "./front/Konclui/integration";')]),
        ).toEqual([]);
        expect(
            findViolations([
                at("front/Components/App.svelte", 'import Frame from "../Konclui/Shell/components/Frame.svelte";'),
            ]),
        ).toHaveLength(1);
        expect(findViolations([at("svelte.ts", 'import "./front/Konclui/Shell/stores/shellStore";')])).toHaveLength(1);
    });

    it("keeps domain layers pure", () => {
        const domainFile = "front/Konclui/Shell/domain/example.ts";
        expect(
            findViolations([at(domainFile, 'import type { ViewportBounds } from "../../../Stores/CoWebsiteLayout";')]),
        ).toEqual([]);
        expect(findViolations([at(domainFile, 'import { writable } from "svelte/store";')])).toHaveLength(1);
        expect(
            findViolations([at(domainFile, 'import { chatVisibilityStore } from "../../../Stores/ChatStore";')]),
        ).toHaveLength(1);
        expect(findViolations([at(domainFile, "const width = window.innerWidth;")])).toHaveLength(1);
    });

    it("lets a domain layer import only domain files, zod and the test runner", () => {
        const domainFile = "front/Konclui/Shell/domain/example.ts";
        const domainTest = "front/Konclui/Shell/domain/example.test.ts";
        expect(findViolations([at(domainFile, 'import { z } from "zod";')])).toEqual([]);
        expect(findViolations([at(domainFile, 'import { other } from "./other";')])).toEqual([]);
        expect(findViolations([at(domainFile, 'import { theme } from "../../Preferences/domain/theme";')])).toEqual([]);
        expect(findViolations([at(domainTest, 'import { expect, it } from "vitest";')])).toEqual([]);
        expect(findViolations([at(domainFile, 'import { vi } from "vitest";')])).toHaveLength(1);
        expect(
            findViolations([at(domainFile, 'import { shellActiveStore } from "../stores/shellStore";')]),
        ).toHaveLength(1);
        expect(findViolations([at(domainFile, 'import type { Seat } from "../phaser/Seat";')])).toHaveLength(1);
        expect(findViolations([at(domainFile, 'import { installKonclui } from "../../integration";')])).toHaveLength(1);
        expect(findViolations([at(domainFile, 'import { IconSettings } from "@wa-icons";')])).toHaveLength(1);
        expect(findViolations([at(domainFile, 'import { Subject } from "rxjs";')])).toHaveLength(1);
    });

    it("keeps components out of the stores and phaser layers", () => {
        const storeFile = "front/Konclui/Shell/stores/example.ts";
        const phaserFile = "front/Konclui/Workplace/phaser/example.ts";
        expect(findViolations([at(storeFile, 'import Frame from "../components/Frame.svelte";')])).toHaveLength(1);
        expect(findViolations([at(storeFile, 'import { dockItems } from "../components/dockItems";')])).toHaveLength(1);
        expect(
            findViolations([at(storeFile, 'import { helper } from "../../../Components/ActionBar/helper";')]),
        ).toHaveLength(1);
        expect(findViolations([at(phaserFile, 'import Seat from "../components/Seat.svelte";')])).toHaveLength(1);
        expect(findViolations([at(storeFile, 'import { isShellEnabled } from "../domain/roomMetadata";')])).toEqual([]);
        expect(findViolations([at(phaserFile, 'import { seatStore } from "../stores/seatStore";')])).toEqual([]);
        expect(findViolations([at(phaserFile, 'import { Loader } from "../../../Phaser/Components/Loader";')])).toEqual(
            [],
        );
        expect(
            findViolations([
                at("front/Konclui/Shell/components/Example.svelte", 'import Dock from "./Dock.svelte";'),
                at("front/Phaser/Game/Example.ts", 'import Help from "../../Components/Help.svelte";'),
            ]),
        ).toEqual([]);
    });

    it("keeps components off the Phaser layer, theirs and upstream's", () => {
        const component = "front/Konclui/Preferences/components/Example.svelte";
        const componentTest = "front/Konclui/Preferences/components/Example.test.ts";
        expect(findViolations([at(component, 'import { openWokaEditor } from "../phaser/gameActions";')])).toHaveLength(
            1,
        );
        expect(
            findViolations([at(componentTest, 'import { gameActions } from "../phaser/gameActions";')]),
        ).toHaveLength(1);
        expect(
            findViolations([at(component, 'import { gameManager } from "../../../Phaser/Game/GameManager";')]),
        ).toHaveLength(1);
        expect(
            findViolations([at(component, 'import type { GameScene } from "../../../Phaser/Game/GameScene";')]),
        ).toHaveLength(1);
        expect(findViolations([at(component, 'import { openWokaEditor } from "../stores/gameCommands";')])).toEqual([]);
        expect(
            findViolations([at(component, 'import { gameSceneStore } from "../../../Stores/GameSceneStore";')]),
        ).toEqual([]);
    });

    it("rejects polling, page observers, empty catches and the overlay flags", () => {
        const contextFile = "front/Konclui/Shell/stores/example.ts";
        expect(findViolations([at(contextFile, "new MutationObserver(update);")])).toHaveLength(1);
        expect(findViolations([at(contextFile, "setInterval(update, 5000);")])).toHaveLength(1);
        expect(findViolations([at(contextFile, "setTimeout(update, 250);")])).toHaveLength(1);
        expect(findViolations([at(contextFile, "setTimeout(update, 1500);")])).toEqual([]);
        expect(findViolations([at(contextFile, "try { run(); } catch {}")])).toHaveLength(1);
        expect(findViolations([at(contextFile, "load().catch(() => {});")])).toHaveLength(1);
        expect(findViolations([at("front/Components/App.svelte", "<div data-k-shell></div>")])).toHaveLength(1);
    });

    it("reads a timeout delay from the second argument of the call", () => {
        const contextFile = "front/Konclui/Shell/stores/example.ts";
        const short = (text: string) => findViolations([at(contextFile, text)]);
        expect(short("setTimeout(() => {\n    update();\n}, 250);")).toHaveLength(1);
        expect(short("setTimeout(() => {\n    update();\n}, 1500);")).toEqual([]);
        expect(short("window.setTimeout(() => { a(); }, 0);")).toHaveLength(1);
        expect(short("setTimeout(update);")).toHaveLength(1);
        expect(short("setTimeout(update, DELAY_MS);")).toHaveLength(1);
        expect(short("setTimeout(update, 1_000);")).toEqual([]);
        expect(short("setTimeout(() => foo(a, 5), 5000);")).toEqual([]);
        expect(short("setTimeout(update, 2000, 5);")).toEqual([]);
        expect(short("setTimeout(update, 250, 5000);")).toHaveLength(1);
        expect(short('setTimeout(() => log("),"), 250);')).toHaveLength(1);
        expect(short('setTimeout(() => log("),"), 1500);')).toEqual([]);
        expect(short("setTimeout(() => {\n    // 1) wait, then refresh\n    update();\n}, 1500);")).toEqual([]);
        expect(short("resetTimeout(update);")).toEqual([]);
    });

    it("rejects barrel index files", () => {
        expect(
            findViolations([at("front/Konclui/Shell/stores/index.ts", 'export * from "./shellStore";')]),
        ).toHaveLength(1);
        expect(findViolations([at("front/Stores/index.ts", 'export * from "./ChatStore";')])).toEqual([]);
    });

    it("follows the domain graph", () => {
        expect(findViolations([at("front/Konclui/Shell/stores/a.ts", 'import "../../Preferences/stores/b";')])).toEqual(
            [],
        );
        expect(
            findViolations([at("front/Konclui/Workplace/stores/a.ts", 'import "../../Rooms/stores/b";')]),
        ).toHaveLength(1);
        expect(findViolations([at("front/Konclui/Rooms/stores/a.ts", 'import "../../Shell/stores/b";')])).toHaveLength(
            1,
        );
        expect(findViolations([at("front/Konclui/Billing/stores/a.ts", "export const a = 1;")])).toHaveLength(1);
        expect(findViolations([at("front/Konclui/integration.ts", "export const a = 1;")])).toEqual([]);
    });
});
