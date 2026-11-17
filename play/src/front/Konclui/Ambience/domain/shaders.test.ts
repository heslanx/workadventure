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

    it("keeps POST under 212 uniform vectors (some GPUs give a fragment shader 221)", () => {
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
        for (const [, type, , length] of glsl.POST.matchAll(/^uniform\s+(\w+)\s+(\w+)(?:\[(\d+)\])?\s*;/gm)) {
            if (type.startsWith("sampler")) continue;
            vectors += (sizes[type] ?? 1) * (length ? Number(length) : 1);
        }
        expect(vectors, `POST declares ${vectors} uniform vectors`).toBeLessThanOrEqual(212);
    });
});
