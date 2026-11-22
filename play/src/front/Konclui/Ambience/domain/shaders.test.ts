import { describe, expect, it } from "vitest";
import * as glsl from "./shaders";

// GLSL ES 1.00 reserved words (spec §3.6) and built-in names a shader must not reuse as identifiers. A shader that does
// not compile draws the whole map black.
const RESERVED = [
    "asm",
    "class",
    "union",
    "enum",
    "typedef",
    "template",
    "this",
    "packed",
    "goto",
    "switch",
    "default",
    "inline",
    "noinline",
    "volatile",
    "public",
    "static",
    "extern",
    "external",
    "interface",
    "flat",
    "long",
    "short",
    "double",
    "half",
    "fixed",
    "unsigned",
    "superp",
    "input",
    "output",
    "hvec2",
    "hvec3",
    "hvec4",
    "dvec2",
    "dvec3",
    "dvec4",
    "fvec2",
    "fvec3",
    "fvec4",
    "sampler1D",
    "sampler3D",
    "sampler1DShadow",
    "sampler2DShadow",
    "sampler2DRect",
    "sampler3DRect",
    "sampler2DRectShadow",
    "sizeof",
    "cast",
    "namespace",
    "using",
    "sample",
    "filter",
    "texture",
];

describe("shaders", () => {
    describe.each(Object.entries(glsl))("%s", (_name, source) => {
        it("uses no reserved word as a name", () => {
            const code = source.replace(/\/\/.*$/gm, "");
            for (const word of RESERVED) {
                expect(code, word).not.toMatch(
                    new RegExp(`\\b${word}\\s*[(=;,\\[]|\\b(float|vec[234]|int|bool)\\s+${word}\\b`),
                );
            }
        });

        it("declares every uniform it reads once", () => {
            const declared = [...source.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]);
            expect(new Set(declared).size, "a uniform declared twice").toBe(declared.length);
        });
    });

    /** The uniform vectors a shader declares, as a GPU that gives each uniform its own register counts them. */
    function uniformVectors(source: string): number {
        const sizes: Partial<Record<string, number>> = {
            float: 1,
            int: 1,
            bool: 1,
            vec2: 1,
            vec3: 1,
            vec4: 1,
            ivec2: 1,
            ivec4: 1,
            mat2: 2,
            mat3: 3,
            mat4: 4,
        };
        let vectors = 0;
        for (const [, type, , length] of source.matchAll(/^uniform\s+(\w+)\s+(\w+)(?:\[(\d+)\])?\s*;/gm)) {
            if (type.startsWith("sampler")) continue;
            vectors += (sizes[type] ?? 1) * (length ? Number(length) : 1);
        }
        return vectors;
    }

    // WebGL 1 promises a fragment shader 16 vectors; the limit that matters is the weakest GPU this office meets: ANGLE
    // over D3D9 gives 221 (plans/decor/001). POST keeps 9 below it for the driver's own constants.
    const POST_VECTOR_LIMIT = 212;

    it(`keeps POST under ${POST_VECTOR_LIMIT} uniform vectors (some GPUs give a fragment shader 221)`, () => {
        const vectors = uniformVectors(glsl.POST);
        expect(vectors, `POST declares ${vectors} uniform vectors`).toBeLessThanOrEqual(POST_VECTOR_LIMIT);
    });

    it("spends at most 12 of those vectors on the night-lit code (the shader had 197 before it)", () => {
        const added = glsl.POST.split("\n")
            .filter((line) => line.includes("@night-lit") && line.startsWith("uniform"))
            .join("\n");
        expect(uniformVectors(added)).toBeLessThanOrEqual(12);
        expect(uniformVectors(glsl.POST) - uniformVectors(added), "the day shader's own vectors").toBe(197);
    });

    describe("the night-lit code of POST (the people's rim light, the props' bevel)", () => {
        /** POST without what is marked `@night-lit` (a line) or between `@night-lit-begin` and `@night-lit-end`. */
        function withoutNightLit(source: string): string {
            const kept: string[] = [];
            let marked = false;
            for (const line of source.split("\n")) {
                if (line.includes("@night-lit-begin")) marked = true;
                else if (line.includes("@night-lit-end")) marked = false;
                else if (!marked && !line.includes("@night-lit")) kept.push(line);
            }
            return kept.join("\n");
        }

        /** The marked blocks, each as its lines. */
        function markedBlocks(source: string): string[][] {
            const blocks: string[][] = [];
            let current: string[] | undefined;
            for (const line of source.split("\n")) {
                if (line.includes("@night-lit-begin")) current = [];
                else if (line.includes("@night-lit-end") && current) {
                    blocks.push(current);
                    current = undefined;
                } else current?.push(line);
            }
            return blocks;
        }

        // A 53-bit string hash (cyrb53): a test of a domain file reads no file and imports no hash from Node.
        function hash(text: string): string {
            let h1 = 0xdeadbeef;
            let h2 = 0x41c6ce57;
            for (let i = 0; i < text.length; i++) {
                const ch = text.charCodeAt(i);
                h1 = Math.imul(h1 ^ ch, 2654435761);
                h2 = Math.imul(h2 ^ ch, 1597334677);
            }
            h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
            h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
            return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
        }

        // The hash of POST as it was before the night-lit code (commit 2a86b2565, 11,265 characters). If this fails
        // because the day look was changed on purpose, put the new hash here: that is a decision about every pixel of
        // the day, not about the night.
        const DAY_POST_HASH = "c717582383ee5";

        it("leaves the shader, without that code, exactly as it was: the day's pixels are the old shader's", () => {
            expect(hash(withoutNightLit(glsl.POST))).toBe(DAY_POST_HASH);
        });

        it("runs none of it unless uNight is above 0.02 and the preview is on", () => {
            expect(glsl.POST).toContain("bool nightLit = uNight > 0.02 && uRimOn > 0.5;");
            const blocks = markedBlocks(glsl.POST);
            expect(blocks).toHaveLength(3);
            for (const block of blocks) {
                // a statement of a block is a declaration with a plain initial value, a comment, or behind nightLit
                const statements = block.map((line) => line.trim()).filter((line) => line && !line.startsWith("//"));
                let depth = 0;
                for (const line of statements) {
                    const opens = (line.match(/{/g) ?? []).length;
                    const closes = (line.match(/}/g) ?? []).length;
                    if (depth === 0) {
                        const guarded = line.startsWith("if (nightLit");
                        const plain = /^(bool|vec2|vec3|vec4|float)\s/.test(line) && !line.includes("texture2D");
                        expect(guarded || plain, `an unguarded statement in a night-lit block: ${line}`).toBe(true);
                    }
                    depth += opens - closes;
                }
            }
        });

        // Seen failing with `!onPerson` taken out of the bevel's condition (the prop's normal then lights the pixels of a
        // person standing in front of it), and with the ellipse taken out of the rim (the box's corners are floor).
        it("does not bevel a person's pixel with the normal of the prop behind them, and keeps the rim to the body's ellipse", () => {
            const bevel = glsl.POST.split("\n").find((line) => line.includes("if (nightLit && hasNormal"));
            expect(bevel).toContain("&& !onPerson");
            const rim = glsl.POST.split("\n").find((line) => line.includes("facing *="));
            expect(rim, "the rim is cut to the ellipse inscribed in the people's box").toContain(
                "step(1.0, dot(avN, avN))",
            );
        });

        // DERIVED from the source, not a GPU count (none was taken: glslc compiles for Vulkan and takes no GLSL ES 1.00):
        // what the night-lit code costs a pixel at most, by what it can run. The people's loop is bounded by uPeople's own
        // length, and it adds two texture fetches (the normal, and the pixel toward the lamps) to a shader of many.
        it("adds at most two texture fetches and one loop of eight to the pass, all behind nightLit", () => {
            const code = markedBlocks(glsl.POST).flat().join("\n");
            expect(code.match(/texture2D\(/g) ?? []).toHaveLength(2);
            expect(code.match(/for \(int i = 0; i < (\d+); i\+\+\)/g) ?? []).toEqual(["for (int i = 0; i < 8; i++)"]);
            expect(glsl.POST).toContain("uniform vec4 uPeople[8];");
        });

        it("reads the normal texture only behind nightLit, and only when there is one", () => {
            const reads = glsl.POST.split("\n").filter((line) => line.includes("texture2D(uNormals"));
            expect(reads).toHaveLength(1);
            const block = markedBlocks(glsl.POST).find((lines) => lines.some((line) => line.includes("uNormals")));
            const at = block?.findIndex((line) => line.includes("texture2D(uNormals")) ?? -1;
            expect(block?.slice(0, at).some((line) => line.trim() === "if (nightLit) {")).toBe(true);
            // with no normal map the pass binds another picture to the sampler: it must never be read as normals
            expect(block?.[at].trim().startsWith("if (uNormalsOn > 0.5)")).toBe(true);
        });
    });
});
