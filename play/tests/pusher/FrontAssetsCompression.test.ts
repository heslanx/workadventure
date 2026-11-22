import fs from "node:fs";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import zlib from "node:zlib";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import { LocalFrontAssets } from "../../src/pusher/services/FrontAssets";

async function get(port: number, requestPath: string, headers: Record<string, string>) {
    // node:http never decodes a body, unlike fetch.
    const req = http.get({ port, path: requestPath, headers });
    const [res] = (await once(req, "response")) as [http.IncomingMessage];
    return { status: res.statusCode ?? 0, headers: res.headers, body: await buffer(res) };
}

const content = (name: string) => `/* ${name} */ ` + "WorkAdventure ".repeat(300);

/** What LocalFrontAssets serves, from a built front: the mounts of FrontAssets.ts, each with its cache duration. */
describe("LocalFrontAssets with a precompressed build", () => {
    let base: string;
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), "front-assets-"));
        const publicDirectory = path.join(base, "dist/public");
        const files = [
            "index.html",
            "assets/app-abc123.js",
            "resources/strings.json",
            "static/images/logo.svg",
            "collections/walls.json",
            "robots.txt",
        ];
        for (const file of files) {
            const target = path.join(publicDirectory, file);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content(file));
            fs.writeFileSync(target + ".br", zlib.brotliCompressSync(content(file)));
            fs.writeFileSync(target + ".gz", zlib.gzipSync(content(file)));
        }
        const app = express();
        new LocalFrontAssets(base).registerStaticRoutes(app);
        server = await new Promise<http.Server>((resolve) => {
            const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
        });
        port = (server.address() as AddressInfo).port;
    });

    afterEach(() => {
        server.close();
        fs.rmSync(base, { recursive: true, force: true });
    });

    // Each mount keeps the cache duration it had before compression existed.
    it.each([
        ["/assets/app-abc123.js", "public, max-age=31536000, immutable"],
        ["/resources/strings.json", "public, max-age=86400"],
        ["/static/images/logo.svg", "public, max-age=86400"],
        ["/collections/walls.json", "public, max-age=86400"],
        ["/robots.txt", "public, max-age=3600"],
    ])("answers %s with the Brotli sibling and the cache header of the plain file", async (url, cacheControl) => {
        const plain = await get(port, url, {});
        const coded = await get(port, url, { "Accept-Encoding": "br, gzip" });

        expect(plain.headers["content-encoding"]).toBeUndefined();
        expect(plain.headers["cache-control"]).toBe(cacheControl);
        expect(plain.headers.vary).toBe("Accept-Encoding");
        expect(coded.status).toBe(200);
        expect(coded.headers["content-encoding"]).toBe("br");
        expect(coded.headers["cache-control"]).toBe(cacheControl);
        expect(coded.headers["content-type"]).toBe(plain.headers["content-type"]);
        expect(zlib.brotliDecompressSync(coded.body).toString()).toBe(plain.body.toString());
    });

    it("answers gzip to a client that does not take Brotli", async () => {
        const coded = await get(port, "/assets/app-abc123.js", { "Accept-Encoding": "gzip" });

        expect(coded.headers["content-encoding"]).toBe("gzip");
        expect(zlib.gunzipSync(coded.body).toString()).toBe(content("assets/app-abc123.js"));
    });
});
