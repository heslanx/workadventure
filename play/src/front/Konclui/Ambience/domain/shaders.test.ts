import { describe, expect, it } from "vitest";
import * as glsl from "./shaders";
import { textHash as hash } from "./textHash";

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

describe("shaders", () => {
    // the shaders themselves: the strings of the module that hold a main()
    const programs = Object.entries(glsl).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].includes("void main()"),
    );

    describe.each(programs)("%s", (_name, source) => {
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

/** The shade blocks of POST_SHADED, as `[name, lines]`. */
function shadeBlocks(source: string): [string, string[]][] {
    const blocks: [string, string[]][] = [];
    let current: [string, string[]] | undefined;
    for (const line of source.split("\n")) {
        const begin = /@shade-begin (\w+)/.exec(line);
        if (begin) current = [begin[1], []];
        else if (line.includes("@shade-end") && current) {
            blocks.push(current);
            current = undefined;
        } else current?.[1].push(line);
    }
    return blocks;
}

/** POST_SHADED without its shade blocks. */
function withoutShade(source: string): string {
    const kept: string[] = [];
    let marked = false;
    for (const line of source.split("\n")) {
        if (line.includes("@shade-begin")) marked = true;
        else if (line.includes("@shade-end")) marked = false;
        else if (!marked) kept.push(line);
    }
    return kept.join("\n");
}

function vectorsOf(source: string): number {
    let vectors = 0;
    for (const [, type, , length] of source.matchAll(/^uniform\s+(\w+)\s+(\w+)(?:\[(\d+)\])?\s*;/gm)) {
        if (type.startsWith("sampler")) continue;
        const per = type === "mat4" ? 4 : type === "mat3" ? 3 : type === "mat2" ? 2 : 1;
        vectors += per * (length ? Number(length) : 1);
    }
    return vectors;
}

describe("POST_SHADED, the camera pass with cast shadows and light on props and people", () => {
    // The full text of POST. A change to the day or night look, or to an anchor, changes this on purpose: put the new
    // hash here and say so in the commit. (The anchors are comment lines: the day hash below does not move with them.)
    const POST_TEXT_HASH = "188ecb5a34f26a";
    const DAY_POST_HASH = "c717582383ee5";

    it("pins the text of POST, the program the room runs with the flag off", () => {
        expect(hash(glsl.POST)).toBe(POST_TEXT_HASH);
    });

    it("is POST with every shade line and block taken out: the day's code is the same text in both programs", () => {
        expect(withoutShade(glsl.POST_SHADED)).toBe(withoutNightLit(glsl.POST));
        expect(hash(withoutShade(glsl.POST_SHADED))).toBe(DAY_POST_HASH);
    });

    it("has a segment for every anchor of POST and an anchor for every segment", () => {
        const anchors = [...glsl.POST.matchAll(/@night-lit @anchor:(\w+)/g)].map((m) => m[1]);
        expect(anchors.sort()).toEqual([...glsl.SHADE_SEGMENT_NAMES].sort());
        expect(
            shadeBlocks(glsl.POST_SHADED)
                .map(([name]) => name)
                .sort(),
        ).toEqual(anchors);
    });

    it("declares 209 uniform vectors: POST's day 197 and uNormalsOn, uShade, uKey, uKeyShade and the eight of uCrowd", () => {
        const vectors = vectorsOf(glsl.POST_SHADED);
        expect(vectors).toBe(209);
        expect(vectors).toBeLessThanOrEqual(212);
    });

    it("reads the cast and the normals, and no longer declares the legacy rim's uniforms", () => {
        for (const name of ["uCast", "uNormals", "uNormalsOn", "uShade", "uKey", "uKeyShade"]) {
            expect(glsl.POST_SHADED, name).toMatch(new RegExp(`^uniform \\w+ ${name}\\b`, "m"));
        }
        for (const name of ["uPeople", "uPeopleN", "uRimOn", "nightLit"]) {
            expect(glsl.POST_SHADED, name).not.toContain(name);
        }
        // and POST itself keeps them: the legacy preview is still there until the default flips
        expect(glsl.POST).toContain("uniform float uRimOn;");
    });

    it("runs a statement of its blocks only behind shaded, recv, surf, prop or person, or as a plain declaration", () => {
        for (const [name, lines] of shadeBlocks(glsl.POST_SHADED)) {
            if (name === "uniforms" || name === "functions") continue;
            let depth = 0;
            for (const raw of lines) {
                const line = raw.trim();
                const opens = (line.match(/{/g) ?? []).length;
                const closes = (line.match(/}/g) ?? []).length;
                if (depth === 0 && line && !line.startsWith("//")) {
                    const guarded = /^if \((!?(shaded|recv|surf|prop|person|kq|uShade\.x)\b)/.test(line);
                    const plain =
                        /^(bool|vec2|vec3|vec4|float)\s[^=]*=[^;]*;$/.test(line) && !line.includes("texture2D");
                    const open = line === "}";
                    expect(guarded || plain || open, `an unguarded statement of the ${name} block: ${line}`).toBe(true);
                }
                depth += opens - closes;
            }
        }
    });

    // Derived from the source: what the shade code costs a pixel at most. Two fetches on every pixel that is not a
    // person's (the cast, and the normals only when there are some), and a person's pixel adds at most 16 reads of
    // the colour buffer along its row, in two loops with constant bounds.
    it("adds three texture reads and three loops of eight, bounded by constants (two scans and the crowd's list)", () => {
        const code = shadeBlocks(glsl.POST_SHADED)
            .map(([, lines]) => lines.join("\n"))
            .join("\n");
        expect(code.match(/texture2D\(/g) ?? []).toHaveLength(3);
        expect(code.match(/for \(int i = 1; i <= 8; i\+\+\)/g) ?? []).toHaveLength(2);
        expect(code.match(/\bfor \(/g) ?? []).toHaveLength(3);
        expect(code.match(/for \(int i = 0; i < 8; i\+\+\)/g) ?? []).toHaveLength(1); // uCrowd, behind uCrowd[0].z
        expect(code).toMatch(/if \(shaded && uCrowd\[0\]\.z > 0\.5\) \{\s*for \(int i = 0; i < 8; i\+\+\)/);
        // the normals are read only when there are some, the level is full and the pixel is not an unmarked avatar's: level 1 is
        // one tap on every pixel, not two
        expect(code).toContain("if (uNormalsOn > 0.5 && uShade.x > 1.5 && !crowd) nm = texture2D(uNormals");
    });

    // Review of 2026-11-23, seen in the lab: at night the relief only darkened (96 to 97% of what it changed, a prop lost 16% of its
    // brightness) and the lamp-facing side of a sofa was its darkest, because the moon from the upper right won inside the pool and
    // `rel` was read against a flat face when a domed piece has none (its normals average 40 degrees off). The lab's `reliefLit`
    // acceptance is the measure (correlation with the lamp's side, the share not darker); these pin the text that makes it.
    describe("the light on a prop and on a person, as the lab measured it", () => {
        const relief = (): string => {
            const lines = glsl.POST_SHADED.split("\n");
            const from = lines.findIndex((line) => line.includes("@shade-begin relief"));
            const to = lines.findIndex((line, i) => i > from && line.includes("@shade-end"));
            return lines.slice(from, to).join("\n");
        };

        it("reads the band from how far the normal leans to the light, not from a flat face's 1.0", () => {
            const text = relief();
            expect(text).toContain("float tilt = dot(nProp.xy, Ln.xy);");
            expect(text).not.toContain("max(Ln.z, 0.3)");
            expect(text).not.toMatch(/dot\(nProp, Ln\)/);
        });

        it("gives the moon's place to a lamp that reaches the pixel, at night, and never lets the amount fall below the moon's", () => {
            const text = relief();
            expect(text).toContain("bool byLamp = uNight > 0.5 && lampPull > 0.02;");
            expect(text).toContain("vec3 Ls = byLamp ? La : Lk * uKey.w;");
            expect(text).toContain("clamp(lampPull * 4.0, uKey.w, 1.0)");
        });

        it("lights a person from any lamp whose pool or rim reaches them, else from the key, and by a visible amount", () => {
            const text = relief();
            expect(text).toContain("bool lamped = lamps > 0.02;");
            expect(text).toContain("float tl = lamped ? 0.5 + min(lamps, 1.0) * 0.5");
            expect(text).toContain("(b > 0.0 ? 0.36 : 0.24 * b)");
        });

        it("does not take the moon's shadow off a piece because a pool lights it, only a lamp's own shadow (R above 0)", () => {
            const text = glsl.POST_SHADED;
            expect(text).toContain("if (kq > 0.0 && sh.r > 0.0) {");
            expect(text).not.toContain("pool > 0.15");
            expect(text).not.toContain("float give");
        });
    });

    // Review of 2026-11-23: at zoom 1 with the camera half a pixel off, 821 pixels differed from the same picture one pixel along
    // (630 of them the shading's). A lookup that sits exactly on the edge of a pixel is read from its +x, +y side every time.
    describe("pixels on an edge are read the same way every time (nothing swims)", () => {
        it("takes the world position with a small push in the shaded program, for the cast, the normals and the masks", () => {
            expect(glsl.POST_SHADED).toContain("if (uShade.x > 0.5) w = floor(toWorld(uv) + 0.002) + 0.5;");
            // before the masks are read, so every lookup of the pass is of the same pixel
            const lines = glsl.POST_SHADED.split("\n");
            const world = lines.findIndex((line) => line.includes("w = floor(toWorld(uv) + 0.002)"));
            const masks = lines.findIndex((line) => line.includes("texture2D(uMasks, mapUV(w, 1.0))"));
            expect(world).toBeGreaterThan(0);
            expect(world).toBeLessThan(masks);
        });

        it("reads the colour buffer along a person's row with the same push", () => {
            expect(glsl.POST_SHADED).toContain("toScreen(q + 0.002)");
        });

        it("leaves the program with the flag off exactly as it is: no push in POST", () => {
            expect(glsl.POST).not.toContain("0.002");
        });
    });

    // Seen failing with the relief moved into the `total > 0.0` block, after the `illum` multiply, and into the lamp
    // loop: a navy sofa (its luminance under the gate of the lamp light) then ignored the light's direction.
    it("shades the props' albedo before the light multiplies it, outside the lamp block", () => {
        const lines = glsl.POST_SHADED.split("\n");
        const relief = lines.findIndex((line) => line.includes("@shade-begin relief"));
        const multiply = lines.findIndex((line) => line.includes("c.rgb = min(c.rgb * illum, vec3(1.0));"));
        expect(relief).toBeGreaterThan(0);
        expect(relief).toBeLessThan(multiply);
        expect(multiply - relief).toBeLessThan(40);
        // brace depth at the relief: the body of main() only
        let depth = 0;
        const mainAt = lines.findIndex((line) => line.startsWith("void main() {"));
        for (let i = mainAt; i < relief; i++) {
            depth += (lines[i].match(/{/g) ?? []).length - (lines[i].match(/}/g) ?? []).length;
        }
        expect(depth).toBe(1);
        // and the lamp loop's pull is inside the d < 1.0 branch of the loop, after the falloff is known
        const loop = lines.findIndex((line) => line.includes("@shade-begin loop"));
        const falloff = lines.findIndex((line) => line.includes("f = pow(1.0 - d, 1.4);"));
        expect(loop).toBe(falloff + 1);
    });

    // Seen failing with `prop` read from the normals alone: the stripes the owner saw on a rug's border came back.
    it("takes no relief for a rug: a piece with cast alpha 40 is not a prop, whatever the normals say", () => {
        expect(glsl.POST_SHADED).toContain("bool prop = nm.a > 0.5 && !(sh.a > 0.1 && sh.a < 0.25);");
        // and 40 / 255 is a receiver (below 0.25) so a rug still takes shadows, and above 0.1 so it is not the plain floor
        expect(40 / 255).toBeGreaterThan(0.1);
        expect(40 / 255).toBeLessThan(0.25);
    });

    it("makes a person's pixel opaque again at the end, and reads a person only inside the map", () => {
        expect(glsl.POST_SHADED).toContain("if (person) c.a = 1.0;");
        expect(glsl.POST_SHADED).toMatch(
            /bool person = shaded && c\.a < 0\.5 && w\.x > 0\.0 && w\.y > 0\.0 && w\.x < uMap\.x/,
        );
    });

    it("carves a lamp's blocked light before the eight-band quantizer and with the pool's own amber", () => {
        const lines = glsl.POST_SHADED.split("\n");
        const carve = lines.findIndex((line) => line.includes("float blk = sh.r * 1.5 * uNight;"));
        const bands = lines.findIndex((line) => line.includes("float q = floor(sqrt(lit) * 8.0 + 0.5) / 8.0;"));
        expect(carve).toBeGreaterThan(0);
        expect(carve).toBeLessThan(bands);
        // 255, 188, 80 over 255: the colour of every lamp that casts a shadow (AMBER in lights.ts)
        expect(glsl.POST_SHADED).toContain("vec3(1.0, 0.737, 0.314)");
    });

    it("gives a probe context the program without Phaser's template line", () => {
        expect(glsl.POST_SHADED).toContain("#pragma phaserTemplate");
        expect(glsl.forProbe(glsl.POST_SHADED)).not.toContain("#pragma");
        expect(glsl.forProbe(glsl.POST_SHADED)).toContain("void main()");
    });
});
