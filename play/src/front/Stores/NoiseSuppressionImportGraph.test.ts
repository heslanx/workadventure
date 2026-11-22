import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Noise suppression is off for a user who never chose it, and while it is off none of its assets may be requested: the
 * model and the worklet belong to @workadventure/noise-suppression, which only NoiseSuppressionTransformer imports, and
 * the controller reaches that file through a dynamic import. A static import of either, from anywhere, pulls the package
 * into the entry chunk and fails here.
 */

const playSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const selfPath = fileURLToPath(import.meta.url);
const transformerPath = join(playSrc, "front/WebRtc/NoiseSuppression/NoiseSuppressionTransformer.ts");
const controllerPath = join(playSrc, "front/Stores/NoiseSuppressionController.ts");

/** The specifiers a file imports at load time: `import type`, `export type` and `import("...")` are not among them. */
function staticImportSpecifiers(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const specifiers: string[] = [];
    const fromPattern = /^\s*(?:import|export)\s+(?!type\b)[^;'"]*?\bfrom\s*["']([^"']+)["']/gm;
    const sideEffectPattern = /^\s*import\s*["']([^"']+)["']/gm;
    for (const pattern of [fromPattern, sideEffectPattern]) {
        for (const match of withoutComments.matchAll(pattern)) {
            specifiers.push(match[1]);
        }
    }
    return specifiers;
}

function isNoiseSuppressionEntry(specifier: string): boolean {
    return (
        specifier.startsWith("@workadventure/noise-suppression") ||
        /(^|\/)NoiseSuppressionTransformer(\.ts)?$/.test(specifier)
    );
}

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return entry.name === "i18n" || entry.name === "node_modules" ? [] : sourceFiles(path);
        }
        const isCode = /\.(ts|svelte)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name);
        return isCode && path !== selfPath ? [path] : [];
    });
}

describe("staticImportSpecifiers", () => {
    it("sees value imports, multi-line imports, re-exports and side-effect imports", () => {
        const source = [
            'import { a } from "./a";',
            "import {",
            "    b,",
            "    type C,",
            '} from "@workadventure/noise-suppression/deepfilternet";',
            'export * from "./d";',
            'import "./e";',
        ].join("\n");

        expect(staticImportSpecifiers(source)).toEqual([
            "./a",
            "@workadventure/noise-suppression/deepfilternet",
            "./d",
            "./e",
        ]);
    });

    it("skips type-only imports, dynamic imports and comments", () => {
        const source = [
            'import type { A } from "./a";',
            'export type { B } from "./b";',
            'const c = await import("./c");',
            '// import { d } from "./d";',
            '/* import { e } from "./e"; */',
        ].join("\n");

        expect(staticImportSpecifiers(source)).toEqual([]);
    });
});

// Reading every source file takes a while on a loaded machine: once for the three tests below
describe("noise suppression import graph", { timeout: 60_000 }, () => {
    let specifiersByFile: Map<string, string[]>;

    beforeAll(() => {
        specifiersByFile = new Map(
            sourceFiles(playSrc).map((path) => [path, staticImportSpecifiers(readFileSync(path, "utf8"))]),
        );
    });

    it("is imported statically by no file but the transformer itself", () => {
        const offenders = [...specifiersByFile]
            .filter(([path, specifiers]) => path !== transformerPath && specifiers.some(isNoiseSuppressionEntry))
            .map(([path]) => relative(playSrc, path));

        expect(offenders).toEqual([]);
    });

    it("is reached through a dynamic import in the controller", () => {
        const controller = readFileSync(controllerPath, "utf8");

        expect(controller).toContain('import("../WebRtc/NoiseSuppression/NoiseSuppressionTransformer")');
    });

    it("keeps the package in the transformer, the only file the dynamic import has to reach", () => {
        const packageImporters = [...specifiersByFile]
            .filter(([, specifiers]) =>
                specifiers.some((value) => value.startsWith("@workadventure/noise-suppression")),
            )
            .map(([path]) => relative(playSrc, path));

        expect(packageImporters).toEqual(["front/WebRtc/NoiseSuppression/NoiseSuppressionTransformer.ts"]);
    });
});
