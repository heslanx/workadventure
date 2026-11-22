import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * livekit-client (about 125 KB of Brotli) is a chunk of its own that the entry does not request: it is fetched
 * through the one dynamic import of LivekitClientLoader.ts, when a conversation needs LiveKit. Any module that
 * value-imports it (`import { Room } from "livekit-client"`) puts it back in the entry graph. This test reads the
 * sources and fails when that comes back. Type-only imports are erased and stay allowed. Test files are skipped: they
 * are not part of the bundle.
 *
 * It scans `play/src/front`, where the browser bundle comes from.
 */

const frontDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loaderPath = join(frontDir, "Livekit", "LivekitClientLoader.ts");
const sourceExtensions = [".ts", ".js", ".mjs", ".svelte"];
const livekitSpecifier = /^livekit-client(\/|$)/;

function sourcesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return entry.name === "node_modules" ? [] : sourcesUnder(path);
        }
        const isSource = sourceExtensions.some((extension) => entry.name.endsWith(extension));
        return isSource && !/\.(test|spec)\.[tj]s$/.test(entry.name) ? [path] : [];
    });
}

interface Reference {
    readonly kind: "static value import" | "static value re-export" | "dynamic import" | "require";
    readonly specifier: string;
}

/** Every way a source file can pull livekit-client in, except what the compiler erases (`import type`). */
function livekitReferencesIn(text: string): Reference[] {
    const references: Reference[] = [];
    // import ... from "x" / import "x" / export ... from "x", with their `type` forms told apart
    for (const match of text.matchAll(
        /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([^;"'`]*?\sfrom\s+)?["']([^"']+)["']/g,
    )) {
        const [, keyword, typeKeyword, , specifier] = match;
        if (!livekitSpecifier.test(specifier) || typeKeyword) {
            continue;
        }
        references.push({
            kind: keyword === "import" ? "static value import" : "static value re-export",
            specifier,
        });
    }
    for (const match of text.matchAll(/(?<![\w.])import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
        if (livekitSpecifier.test(match[1])) {
            references.push({ kind: "dynamic import", specifier: match[1] });
        }
    }
    for (const match of text.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
        if (livekitSpecifier.test(match[1])) {
            references.push({ kind: "require", specifier: match[1] });
        }
    }
    return references;
}

describe("livekit-client stays out of the entry graph", () => {
    const sources = sourcesUnder(frontDir).map((path) => ({
        path,
        name: relative(frontDir, path),
        text: readFileSync(path, "utf8"),
    }));

    it("is imported by no module of play/src/front with a static value import", () => {
        const offenders = sources.flatMap(({ name, text }) =>
            livekitReferencesIn(text)
                .filter((reference) => reference.kind !== "dynamic import")
                .map((reference) => `${name}: ${reference.kind} of "${reference.specifier}"`),
        );

        expect(offenders).toEqual([]);
    });

    it("is imported dynamically by the loader and by nothing else", () => {
        const dynamicImporters = sources
            .filter(({ text }) => livekitReferencesIn(text).some((reference) => reference.kind === "dynamic import"))
            .map(({ path }) => path);

        expect(dynamicImporters).toEqual([loaderPath]);
    });

    it("sees what it is meant to catch, and lets the erased forms through", () => {
        expect(livekitReferencesIn('import { Room } from "livekit-client";').map((r) => r.kind)).toEqual([
            "static value import",
        ]);
        expect(livekitReferencesIn('import * as livekit from "livekit-client";').map((r) => r.kind)).toEqual([
            "static value import",
        ]);
        expect(livekitReferencesIn('import "livekit-client";').map((r) => r.kind)).toEqual(["static value import"]);
        expect(
            livekitReferencesIn('import {\n    Track,\n    type Room,\n} from "livekit-client";').map((r) => r.kind),
        ).toEqual(["static value import"]);
        expect(livekitReferencesIn('import { Track } from "livekit-client/core";').map((r) => r.kind)).toEqual([
            "static value import",
        ]);
        expect(livekitReferencesIn('export { Room } from "livekit-client";').map((r) => r.kind)).toEqual([
            "static value re-export",
        ]);
        expect(livekitReferencesIn('const lk = require("livekit-client");').map((r) => r.kind)).toEqual(["require"]);
        expect(livekitReferencesIn('const lk = await import("livekit-client");').map((r) => r.kind)).toEqual([
            "dynamic import",
        ]);

        expect(livekitReferencesIn('import type { Room } from "livekit-client";')).toEqual([]);
        expect(livekitReferencesIn('import type * as LivekitClient from "livekit-client";')).toEqual([]);
        expect(livekitReferencesIn('export type { Room } from "livekit-client";')).toEqual([]);
        expect(livekitReferencesIn('import { Other } from "livekit-server-sdk";')).toEqual([]);
    });
});
