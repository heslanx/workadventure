import fs from "node:fs";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import zlib from "node:zlib";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { precompressedStatic, resolveInsideRoot } from "../../src/pusher/services/PrecompressedStatic";

interface RawResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

async function request(
    port: number,
    requestPath: string,
    headers: Record<string, string> = {},
    method = "GET",
): Promise<RawResponse> {
    // node:http sends the path untouched and never decodes a body, unlike fetch.
    const req = http.request({ port, path: requestPath, headers, method });
    req.end();
    const [res] = (await once(req, "response")) as [http.IncomingMessage];
    const body = await buffer(res);
    return { status: res.statusCode ?? 0, headers: res.headers, body };
}

const script = "export const answer = 42; // " + "WorkAdventure ".repeat(400);
const stylesheet = ".a { color: red; } /* " + "x".repeat(2000) + " */";
const data = JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ i, name: "row " + i })) });
const ORIGINAL_TIME = new Date("2026-01-02T03:04:05.000Z");
const SIBLING_TIME = new Date("2026-06-07T08:09:10.000Z");
const secret = "SECRET-OUTSIDE-THE-ROOT ".repeat(100);

describe("precompressedStatic", () => {
    let directory: string;
    let root: string;
    const servers: http.Server[] = [];

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "precompressed-static-"));
        root = path.join(directory, "public");
        fs.mkdirSync(path.join(root, "assets"), { recursive: true });
        // Written as the build does: the original and a smaller sibling per coding.
        // The siblings are given another modification time than the original, as a copy of the output that does not
        // keep times would: the answer must still carry the original's Last-Modified.
        const withSiblings = (file: string, content: string) => {
            fs.writeFileSync(file, content);
            fs.writeFileSync(file + ".br", zlib.brotliCompressSync(content));
            fs.writeFileSync(file + ".gz", zlib.gzipSync(content));
            fs.utimesSync(file, ORIGINAL_TIME, ORIGINAL_TIME);
            fs.utimesSync(file + ".br", SIBLING_TIME, SIBLING_TIME);
            fs.utimesSync(file + ".gz", SIBLING_TIME, SIBLING_TIME);
        };
        withSiblings(path.join(root, "assets/app-abc123.js"), script);
        withSiblings(path.join(root, "assets/app-abc123.css"), stylesheet);
        withSiblings(path.join(root, "assets/data.json"), data);
        // A file with no sibling.
        fs.writeFileSync(path.join(root, "assets/alone.js"), script);
        // An image: not compressible, so a stray sibling must be ignored.
        fs.writeFileSync(path.join(root, "assets/logo.png"), Buffer.alloc(3000, 7));
        fs.writeFileSync(path.join(root, "assets/logo.png.br"), Buffer.alloc(10, 1));
        // A sibling that is not smaller than its original.
        fs.writeFileSync(path.join(root, "assets/big-sibling.js"), "tiny();");
        fs.writeFileSync(path.join(root, "assets/big-sibling.js.br"), "this sibling is longer than its original");
        // A file outside the served root, with a sibling.
        withSiblings(path.join(directory, "secret.js"), secret);
    });

    afterEach(() => {
        servers.splice(0).forEach((server) => server.close());
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const options = { etag: true, maxAge: "1y", immutable: true } as const;

    async function listen(app: express.Express): Promise<number> {
        const server = await new Promise<http.Server>((resolve) => {
            const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
        });
        servers.push(server);
        return (server.address() as AddressInfo).port;
    }

    /** The application of FrontAssets: the build mounted on /assets, then a handler for what nobody served. */
    function serveWith(handlerFactory: typeof precompressedStatic | typeof express.static): Promise<number> {
        const app = express();
        app.use("/assets", handlerFactory(path.join(root, "assets"), options));
        app.use((_req, res) => {
            res.status(418).send("not served by the static handler");
        });
        return listen(app);
    }

    it("serves Brotli when the client accepts it, with the original's type and the original's cache headers", async () => {
        const port = await serveWith(precompressedStatic);
        const reference = await serveWith(express.static);

        const response = await request(port, "/assets/app-abc123.js", { "Accept-Encoding": "gzip, br" });
        const original = await request(reference, "/assets/app-abc123.js");

        expect(response.status).toBe(200);
        expect(response.headers["content-encoding"]).toBe("br");
        expect(zlib.brotliDecompressSync(response.body).toString()).toBe(script);
        expect(response.headers["content-length"]).toBe(String(response.body.length));
        expect(response.body.length).toBeLessThan(script.length / 4);
        expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
        expect(response.headers["content-type"]).toBe(original.headers["content-type"]);
        expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
        expect(response.headers["cache-control"]).toBe(original.headers["cache-control"]);
        expect(response.headers["last-modified"]).toBe(ORIGINAL_TIME.toUTCString());
        expect(response.headers["last-modified"]).toBe(original.headers["last-modified"]);
        // A Range request is answered from the original file, so a coded answer does not invite one.
        expect(response.headers["accept-ranges"]).toBe("none");
        expect(response.headers.vary).toBe("Accept-Encoding");
        // The answer must not carry a second Cache-Control or Content-Encoding.
        expect(response.headers["content-encoding"]).not.toContain(",");
    });

    it("serves gzip to a client that does not accept Brotli, and Brotli when both are rated the same", async () => {
        const port = await serveWith(precompressedStatic);

        const gzip = await request(port, "/assets/app-abc123.js", { "Accept-Encoding": "gzip, deflate" });
        expect(gzip.headers["content-encoding"]).toBe("gzip");
        expect(zlib.gunzipSync(gzip.body).toString()).toBe(script);

        const rated = await request(port, "/assets/app-abc123.js", { "Accept-Encoding": "br;q=0.4, gzip;q=0.9" });
        expect(rated.headers["content-encoding"]).toBe("gzip");

        const both = await request(port, "/assets/app-abc123.js", { "Accept-Encoding": "gzip, br" });
        expect(both.headers["content-encoding"]).toBe("br");
    });

    it("sends the file as it is when no coding is accepted, and still says that the answer varies", async () => {
        const port = await serveWith(precompressedStatic);
        const refusals: Record<string, string>[] = [
            {},
            { "Accept-Encoding": "identity" },
            { "Accept-Encoding": "br;q=0, gzip;q=0" },
            { "Accept-Encoding": "deflate" },
        ];

        const responses = await Promise.all(refusals.map((headers) => request(port, "/assets/app-abc123.js", headers)));
        for (const response of responses) {
            expect(response.status).toBe(200);
            expect(response.headers["content-encoding"]).toBeUndefined();
            expect(response.body.toString()).toBe(script);
            expect(response.headers.vary).toBe("Accept-Encoding");
            expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
        }
    });

    it("answers HEAD with the headers of the GET and no body", async () => {
        const port = await serveWith(precompressedStatic);
        const headers = { "Accept-Encoding": "br" };

        const get = await request(port, "/assets/app-abc123.js", headers);
        const head = await request(port, "/assets/app-abc123.js", headers, "HEAD");

        expect(head.status).toBe(200);
        expect(head.body.length).toBe(0);
        expect(head.headers["content-encoding"]).toBe("br");
        expect(head.headers["content-length"]).toBe(get.headers["content-length"]);
        expect(head.headers.etag).toBe(get.headers.etag);
        expect(head.headers.vary).toBe("Accept-Encoding");
    });

    it("leaves a Range request to express.static: the original bytes, uncompressed", async () => {
        const port = await serveWith(precompressedStatic);

        const response = await request(port, "/assets/app-abc123.js", {
            "Accept-Encoding": "br, gzip",
            Range: "bytes=7-16",
        });

        expect(response.status).toBe(206);
        expect(response.headers["content-encoding"]).toBeUndefined();
        expect(response.headers["accept-ranges"]).toBe("bytes");
        expect(response.headers["content-range"]).toBe(`bytes 7-16/${script.length}`);
        expect(response.body.toString()).toBe(script.slice(7, 17));
        expect(response.headers.vary).toBe("Accept-Encoding");
    });

    it("gives each coding its own ETag and answers a matching If-None-Match with 304", async () => {
        const port = await serveWith(precompressedStatic);
        const url = "/assets/app-abc123.js";

        const br = await request(port, url, { "Accept-Encoding": "br" });
        const gzip = await request(port, url, { "Accept-Encoding": "gzip" });
        const identity = await request(port, url);

        const etags = [br.headers.etag, gzip.headers.etag, identity.headers.etag];
        expect(etags.every((etag) => etag?.startsWith("W/") || etag?.startsWith('"'))).toBe(true);
        expect(new Set(etags).size).toBe(3);

        const revalidated = await request(port, url, {
            "Accept-Encoding": "br",
            "If-None-Match": br.headers.etag ?? "",
        });
        expect(revalidated.status).toBe(304);
        expect(revalidated.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

        const otherCoding = await request(port, url, {
            "Accept-Encoding": "gzip",
            "If-None-Match": br.headers.etag ?? "",
        });
        expect(otherCoding.status).toBe(200);
        expect(zlib.gunzipSync(otherCoding.body).toString()).toBe(script);
    });

    it("never gives two codings of one file the same ETag, even with the same size and modification time", async () => {
        const file = path.join(root, "assets/twins.js");
        fs.writeFileSync(file, "x".repeat(500));
        fs.writeFileSync(file + ".br", Buffer.alloc(40, 1));
        fs.writeFileSync(file + ".gz", Buffer.alloc(40, 2));
        const when = new Date("2026-01-02T03:04:05.000Z");
        for (const sibling of [file, file + ".br", file + ".gz"]) {
            fs.utimesSync(sibling, when, when);
        }
        const port = await serveWith(precompressedStatic);

        const [br, gzip] = await Promise.all([
            request(port, "/assets/twins.js", { "Accept-Encoding": "br" }),
            request(port, "/assets/twins.js", { "Accept-Encoding": "gzip" }),
        ]);

        expect(br.headers["content-encoding"]).toBe("br");
        expect(gzip.headers["content-encoding"]).toBe("gzip");
        expect(br.headers["content-length"]).toBe(gzip.headers["content-length"]);
        expect(br.headers.etag).not.toBe(gzip.headers.etag);
    });

    it("types every coded file like its original and keeps the query string working", async () => {
        const port = await serveWith(precompressedStatic);
        const reference = await serveWith(express.static);

        const files = ["app-abc123.css", "data.json", "app-abc123.js"];
        const pairs = await Promise.all(
            files.map(async (file) => ({
                coded: await request(port, `/assets/${file}?v=1`, { "Accept-Encoding": "br" }),
                original: await request(reference, `/assets/${file}`),
            })),
        );
        for (const { coded, original } of pairs) {
            expect(coded.headers["content-encoding"]).toBe("br");
            expect(coded.headers["content-type"]).toBe(original.headers["content-type"]);
            expect(zlib.brotliDecompressSync(coded.body).toString()).toBe(original.body.toString());
        }
    });

    it("serves files without a sibling, with an unusable sibling, or of an incompressible type untouched", async () => {
        const port = await serveWith(precompressedStatic);
        const headers = { "Accept-Encoding": "br, gzip" };

        const alone = await request(port, "/assets/alone.js", headers);
        expect(alone.headers["content-encoding"]).toBeUndefined();
        expect(alone.headers.vary).toBeUndefined();
        expect(alone.body.toString()).toBe(script);

        const larger = await request(port, "/assets/big-sibling.js", headers);
        expect(larger.headers["content-encoding"]).toBeUndefined();
        expect(larger.body.toString()).toBe("tiny();");

        const image = await request(port, "/assets/logo.png", headers);
        expect(image.headers["content-encoding"]).toBeUndefined();
        expect(image.body.length).toBe(3000);
    });

    it("does not touch the answer for a path no file matches", async () => {
        const port = await serveWith(precompressedStatic);

        const missing = await request(port, "/assets/nothing-here.js", { "Accept-Encoding": "br" });
        expect(missing.status).toBe(418);

        const sibling = await request(port, "/assets/app-abc123.js.br", { "Accept-Encoding": "br" });
        // The sibling is an ordinary file for express.static: no content coding is announced on its own URL.
        expect(sibling.headers["content-encoding"]).toBeUndefined();
    });

    it("lets express.static handle what is not a GET or a HEAD", async () => {
        const port = await serveWith(precompressedStatic);

        const post = await request(port, "/assets/app-abc123.js", { "Accept-Encoding": "br" }, "POST");
        expect(post.status).toBe(418);
        expect(post.headers["content-encoding"]).toBeUndefined();
    });

    it("never reaches a file outside the root, whatever way the dots are written", async () => {
        const port = await serveWith(precompressedStatic);
        const attacks = [
            "/assets/../../secret.js",
            "/assets/..%2f..%2fsecret.js",
            "/assets/%2e%2e/%2e%2e/secret.js",
            "/assets/%2E%2E%2F%2E%2E%2Fsecret.js",
            "/assets/..%5c..%5csecret.js",
            "/assets/%2e%2e%2f%2e%2e%2fsecret.js%00.js",
            "/assets/app-abc123.js/../../../secret.js",
            "/assets/..%252f..%252fsecret.js",
        ];

        const responses = await Promise.all(
            attacks.map((attack) => request(port, attack, { "Accept-Encoding": "br, gzip" })),
        );
        for (const [index, response] of responses.entries()) {
            const attack = attacks[index];
            expect(response.headers["content-encoding"], attack).toBeUndefined();
            expect(response.body.toString(), attack).not.toContain("SECRET-OUTSIDE-THE-ROOT");
            expect(zlibSafe(response.body), attack).not.toContain("SECRET-OUTSIDE-THE-ROOT");
        }
    });

    it("does not serve hidden files", async () => {
        fs.writeFileSync(path.join(root, "assets/.hidden.js"), script);
        fs.writeFileSync(path.join(root, "assets/.hidden.js.br"), zlib.brotliCompressSync(script));
        const port = await serveWith(precompressedStatic);

        const response = await request(port, "/assets/.hidden.js", { "Accept-Encoding": "br" });
        expect(response.headers["content-encoding"]).toBeUndefined();
        expect(response.body.toString()).not.toContain("WorkAdventure");
    });

    it("falls back to the original when the sibling disappears before it is read", async () => {
        const port = await serveWith(precompressedStatic);
        // A directory in place of the sibling: stat says it is not a file, so the original is served.
        fs.rmSync(path.join(root, "assets/data.json.br"));
        fs.mkdirSync(path.join(root, "assets/data.json.br"));

        const response = await request(port, "/assets/data.json", { "Accept-Encoding": "br" });
        expect(response.status).toBe(200);
        expect(response.headers["content-encoding"]).toBeUndefined();
        expect(response.body.toString()).toBe(data);
    });
});

function zlibSafe(body: Buffer): string {
    for (const decode of [zlib.brotliDecompressSync, zlib.gunzipSync]) {
        try {
            return decode(body).toString();
        } catch {
            // Not that coding.
        }
    }
    return "";
}

describe("resolveInsideRoot", () => {
    const root = path.resolve("/srv/public");

    it("maps a plain path into the root", () => {
        expect(resolveInsideRoot(root, "/assets/app.js")).toBe(path.join(root, "assets/app.js"));
        expect(resolveInsideRoot(root, "/dir%20name/a%2Bb.js")).toBe(path.join(root, "dir name/a+b.js"));
    });

    it.each([
        "/../etc/passwd",
        "/%2e%2e/etc/passwd",
        "/a/%2E%2E/b.js",
        "/a/./b.js",
        "/a%5cb.js",
        "/a%00.js",
        "/%E0%A4%A",
        "/.env",
        "/",
        "",
    ])("refuses %j", (requestPath) => {
        expect(resolveInsideRoot(root, requestPath)).toBeUndefined();
    });
});
