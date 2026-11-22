import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import zlib from "node:zlib";
import { resolveConfig } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    BROTLI_QUALITY_LARGE,
    BROTLI_QUALITY_SMALL,
    brotliQualityFor,
    defaultConcurrency,
    formatSummary,
    LARGE_FILE_BYTES,
    MIN_COMPRESSIBLE_BYTES,
    precompressDirectory,
    precompressPlugin,
} from "../../vite/precompress";

const text = (word: string, size = 4000) => word.repeat(Math.ceil(size / word.length));

describe("precompressDirectory", () => {
    let directory: string;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "precompress-"));
        fs.mkdirSync(path.join(directory, "assets"));
    });
    afterEach(() => {
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const write = (name: string, content: string | Buffer) => {
        const file = path.join(directory, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return file;
    };
    const exists = (name: string) => fs.existsSync(path.join(directory, name));

    it("writes a Brotli and a gzip sibling that decode to the original for every compressible type", async () => {
        const files: Record<string, string> = {
            "assets/index-a1.js": text("export const a = 1;\n"),
            "assets/index-a1.css": text(".a{color:red}\n"),
            "assets/index-a1.js.map": text('{"version":3,"mappings":"AAAA"}'),
            "static/data.json": text('{"k":"v"},'),
            "static/icon.svg": text("<svg><path d='M0 0'/></svg>"),
            "static/feed.xml": text("<a><b/></a>"),
            "index.html": text("<p>hello</p>"),
            "robots.txt": text("User-agent: *\n"),
        };
        for (const [name, content] of Object.entries(files)) {
            write(name, content);
        }
        const wasm = Buffer.concat([Buffer.from([0, 97, 115, 109]), Buffer.alloc(5000, 3)]);
        write("assets/module.wasm", wasm);

        const summary = await precompressDirectory(directory);

        for (const [name, content] of Object.entries(files)) {
            expect(
                zlib.brotliDecompressSync(fs.readFileSync(path.join(directory, name + ".br"))).toString(),
                name,
            ).toBe(content);
            expect(zlib.gunzipSync(fs.readFileSync(path.join(directory, name + ".gz"))).toString(), name).toBe(content);
        }
        expect(
            zlib.brotliDecompressSync(fs.readFileSync(path.join(directory, "assets/module.wasm.br"))).equals(wasm),
        ).toBe(true);
        expect(summary.files).toBe(Object.keys(files).length + 1);
        expect(summary.br.kept).toBe(summary.files);
        expect(summary.gzip.kept).toBe(summary.files);
        expect(summary.br.bytesAfter).toBeLessThan(summary.br.bytesBefore / 5);
        expect(summary.br.bytesAfter).toBeLessThanOrEqual(summary.gzip.bytesAfter);
        expect(formatSummary(summary)).toMatch(/^\[precompress\] 9 files, .*br 9 kept.*gzip 9 kept/);
    });

    it("leaves the types that are already compressed alone", async () => {
        const blobs = ["a.png", "a.jpg", "a.jpeg", "a.webp", "a.gif", "a.woff2", "a.mp3", "a.wav", "a.mp4", "a.ico"];
        for (const name of blobs) {
            // Highly repetitive on purpose: only the extension may keep these out.
            write(`static/${name}`, Buffer.alloc(8000, 1));
        }

        const summary = await precompressDirectory(directory);

        expect(summary.files).toBe(0);
        for (const name of blobs) {
            expect(exists(`static/${name}.br`), name).toBe(false);
            expect(exists(`static/${name}.gz`), name).toBe(false);
        }
    });

    it("skips a file below the size threshold", async () => {
        write("assets/tiny.js", "a".repeat(MIN_COMPRESSIBLE_BYTES - 1));
        write("assets/limit.js", "a".repeat(MIN_COMPRESSIBLE_BYTES));

        await precompressDirectory(directory);

        expect(exists("assets/tiny.js.br")).toBe(false);
        expect(exists("assets/tiny.js.gz")).toBe(false);
        expect(exists("assets/limit.js.br")).toBe(true);
    });

    it("keeps no sibling that is not smaller than the original, and removes a stale one", async () => {
        // Random bytes do not compress: both codings come out larger than the original.
        write("assets/random.json", randomBytes(3000));
        write("assets/random.json.br", "left by an older build");

        const summary = await precompressDirectory(directory);

        expect(exists("assets/random.json.br")).toBe(false);
        expect(exists("assets/random.json.gz")).toBe(false);
        expect(summary.br.kept).toBe(0);
        expect(summary.br.bytesAfter).toBe(summary.br.bytesBefore);
    });

    it("removes the siblings of a file that has shrunk below the size threshold since an earlier run", async () => {
        write("assets/shrunk.js", "a".repeat(MIN_COMPRESSIBLE_BYTES - 1));
        // Smaller than the original, so the server would send them if they stayed.
        write("assets/shrunk.js.br", "old");
        write("assets/shrunk.js.gz", "old");

        await precompressDirectory(directory);

        expect(exists("assets/shrunk.js.br")).toBe(false);
        expect(exists("assets/shrunk.js.gz")).toBe(false);
        expect(exists("assets/shrunk.js")).toBe(true);
    });

    it("gives the siblings the modification time of the original", async () => {
        const file = write("assets/app.js", text("let a = 1;\n"));
        const when = new Date("2026-01-02T03:04:05.000Z");
        fs.utimesSync(file, when, when);

        await precompressDirectory(directory);

        expect(fs.statSync(file + ".br").mtime.toISOString()).toBe(when.toISOString());
        expect(fs.statSync(file + ".gz").mtime.toISOString()).toBe(when.toISOString());
    });

    it("can run twice on the same output without compressing a sibling", async () => {
        write("assets/app.js", text("let a = 1;\n"));

        await precompressDirectory(directory);
        const second = await precompressDirectory(directory);

        expect(second.files).toBe(1);
        expect(exists("assets/app.js.br.br")).toBe(false);
        expect(exists("assets/app.js.gz.gz")).toBe(false);
        expect(fs.readdirSync(path.join(directory, "assets")).sort()).toEqual(["app.js", "app.js.br", "app.js.gz"]);
    });
});

describe("the cost of the build step", () => {
    it("gives the slow Brotli quality to the files a visitor needs on the way in, and a cheaper one to the heavy ones", () => {
        expect(brotliQualityFor(".js", 200 * 1024)).toBe(BROTLI_QUALITY_SMALL);
        expect(brotliQualityFor(".css", LARGE_FILE_BYTES - 1)).toBe(BROTLI_QUALITY_SMALL);
        expect(brotliQualityFor(".js", LARGE_FILE_BYTES)).toBe(BROTLI_QUALITY_LARGE);
        expect(brotliQualityFor(".wasm", 11 * 1024 * 1024)).toBe(BROTLI_QUALITY_LARGE);
        // Only devtools and Sentry read a source map, whatever its size.
        expect(brotliQualityFor(".map", 10 * 1024)).toBe(BROTLI_QUALITY_LARGE);
        expect(BROTLI_QUALITY_LARGE).toBeLessThan(BROTLI_QUALITY_SMALL);
    });

    it("still decodes to the original when the cheaper quality is used", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "precompress-large-"));
        try {
            const content = Buffer.from(text("export const row = [1, 2, 3];\n", LARGE_FILE_BYTES + 10));
            fs.writeFileSync(path.join(directory, "big.js"), content);

            await precompressDirectory(directory);

            expect(zlib.brotliDecompressSync(fs.readFileSync(path.join(directory, "big.js.br"))).equals(content)).toBe(
                true,
            );
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("never runs more files at once than the libuv threadpool has threads or the machine has processors", () => {
        expect(defaultConcurrency(undefined, 16)).toBe(4);
        expect(defaultConcurrency("", 16)).toBe(4);
        expect(defaultConcurrency("2", 16)).toBe(2);
        expect(defaultConcurrency("64", 16)).toBe(16);
        expect(defaultConcurrency("64", 2)).toBe(2);
        expect(defaultConcurrency("nonsense", 16)).toBe(4);
        expect(defaultConcurrency("0", 1)).toBe(1);
    });
});

describe("precompressPlugin", () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "precompress-plugin-"));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("writes the siblings into the output folder Vite resolved, and only there", async () => {
        const outDirectory = path.join(root, "dist/public");
        fs.mkdirSync(path.join(outDirectory, "assets"), { recursive: true });
        fs.writeFileSync(path.join(outDirectory, "assets/app-1.js"), text("let a = 1;\n"));
        fs.writeFileSync(path.join(root, "outside.js"), text("let b = 2;\n"));
        vi.spyOn(console, "info").mockImplementation(() => {});
        const plugin = precompressPlugin();

        const configResolved = plugin.configResolved as (config: unknown) => void;
        configResolved({ root, build: { outDir: "./dist/public" } });
        const writeBundle = plugin.writeBundle as { order: string; handler: () => Promise<void> };
        await writeBundle.handler();

        expect(fs.existsSync(path.join(outDirectory, "assets/app-1.js.br"))).toBe(true);
        expect(fs.existsSync(path.join(outDirectory, "assets/app-1.js.gz"))).toBe(true);
        expect(fs.existsSync(path.join(root, "outside.js.br"))).toBe(false);
        expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[precompress\] 1 files/));
        // After the other plugins' own writeBundle, so that the output is complete when it is read.
        expect(writeBundle.order).toBe("post");
    });

    it("is part of the production build of vite.config.ts and absent from the dev server", async () => {
        const inline = { configFile: path.resolve(__dirname, "../../vite.config.ts"), logLevel: "silent" } as const;

        const build = await resolveConfig(inline, "build", "production");
        const serve = await resolveConfig(inline, "serve", "development");

        const names = (config: { plugins: readonly { name: string }[] }) => config.plugins.map((plugin) => plugin.name);
        expect(names(build)).toContain("workadventure-precompress");
        expect(names(serve)).not.toContain("workadventure-precompress");
    });
});
