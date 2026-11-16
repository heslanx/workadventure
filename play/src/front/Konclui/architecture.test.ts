import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The fitness test of the Konclui context (architecture §4.1). It reads the source tree and fails when upstream
 * reaches into the context, a domain layer stops being pure, the context polls or observes the whole page, or
 * a domain imports another one against the domain graph.
 *
 * It skips its own path: its needles are literals in a file that is part of the context.
 */

const contextDir = dirname(fileURLToPath(import.meta.url));
const playSrc = resolve(contextDir, "../..");
const tailwindStyle = resolve(playSrc, "../../libs/tailwind/style");
const selfPath = fileURLToPath(import.meta.url);

/** Direct imports each domain may make; every path through these edges is allowed too (architecture §1.2). */
const domainEdges: Readonly<Record<string, readonly string[]>> = {
    Shell: ["Presence", "Expression", "Identity", "Notifications", "Ambience"],
    Presence: ["Rooms", "Workplace"],
    Workplace: ["Preferences"],
    Rooms: ["Preferences"],
    Expression: ["Rooms", "Preferences"],
    Identity: ["Rooms", "Preferences"],
    Notifications: ["Rooms", "Preferences"],
    Ambience: ["Rooms", "Preferences"],
    Preferences: [],
};

/** Upstream modules a domain layer may read types from, relative to `play/src/front`. */
const pureUpstreamTypeModules = ["Stores/CoWebsiteLayout"];

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

/** Every rule violation in `files`, one readable line each. */
function findViolations(files: readonly SourceFile[]): string[] {
    const violations: string[] = [];
    const integration = join(contextDir, "integration");
    const entry = join(playSrc, "svelte.ts");

    for (const file of files) {
        const name = relative(playSrc, file.path);
        const inContext = isInside(file.path, contextDir);
        const domain = domainOf(file.path);
        const inDomainLayer = domain !== undefined && file.path.includes(`${sep}domain${sep}`);

        for (const { specifier, typeOnly } of importsOf(file.text)) {
            const target = specifier.startsWith(".") ? resolve(dirname(file.path), specifier) : undefined;

            if (!inContext && target !== undefined && isInside(target, contextDir)) {
                if (!(file.path === entry && withoutExtension(target) === integration)) {
                    violations.push(`rule 1: ${name} imports ${specifier}`);
                }
            }

            if (inDomainLayer) {
                const framework = /^(svelte|phaser)(\/|$)/.test(specifier) || specifier.endsWith(".svelte");
                const upstreamTarget =
                    target !== undefined && !isInside(target, contextDir)
                        ? relative(join(playSrc, "front"), target)
                        : "";
                const pureType = typeOnly && pureUpstreamTypeModules.includes(withoutExtension(upstreamTarget));
                if (framework || (upstreamTarget !== "" && !pureType)) {
                    violations.push(`rule 2: domain file ${name} imports ${specifier}`);
                }
            }

            const targetDomain = target === undefined ? undefined : domainOf(target);
            if (domain !== undefined && targetDomain !== undefined && targetDomain !== domain) {
                if (!reachable(domain).has(targetDomain)) {
                    violations.push(`rule 5: ${domain} may not import ${targetDomain} (${name} -> ${specifier})`);
                }
            }
        }

        if (inDomainLayer && /\b(window|document)\s*[.[]/.test(file.text)) {
            violations.push(`rule 2: domain file ${name} touches window or document`);
        }

        if (inContext) {
            if (file.text.includes("MutationObserver")) violations.push(`rule 3: ${name} uses MutationObserver`);
            if (file.text.includes("setInterval(")) violations.push(`rule 3: ${name} uses setInterval`);
            for (const match of file.text.matchAll(/setTimeout\([^;]*?,\s*(\d+)\s*\)/g)) {
                if (Number(match[1]) < 1000) violations.push(`rule 3: ${name} sets a ${match[1]} ms timeout`);
            }
            if (
                /catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(file.text) ||
                /\.catch\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|undefined)\s*\)/.test(file.text)
            ) {
                violations.push(`rule 6: ${name} swallows an error in an empty catch`);
            }
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
    });
});
