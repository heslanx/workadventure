import * as fs from "fs";
import * as http from "http";
import type { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { brotliDecompressSync, gunzipSync } from "zlib";
import { S3ServiceException, type S3 } from "@aws-sdk/client-s3";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DiskFileSystem } from "../../Upload/DiskFileSystem";
import { S3FileSystem } from "../../Upload/S3FileSystem";
import type { FileSystemInterface } from "../../Upload/FileSystemInterface";
import { mime } from "../../Services/Mime";
import { compressFiles, negotiateEncoding } from "../Compression";

vi.mock("../../Services/MapListService", () => ({
    MapListService: { CACHE_NAME: "__cache.json" },
}));
vi.mock("../../Services/S3Client", () => ({
    s3UploadConcurrencyLimit: vi.fn(),
}));

/** A map-like JSON of ~300 KB: several chunks on the way, and something to compress. */
const tmj = Buffer.from(
    JSON.stringify({
        layers: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `layer-${i % 7}`, data: [i, i + 1, i + 2] })),
    }),
);
const small = Buffer.from('{"tiny":true}');
// Not a real PNG: the middleware must not look inside, only at the type.
const png = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));

const files: Record<string, Buffer> = {
    "map/office.tmj": tmj,
    "map/office.wam": tmj,
    "map/tiny.json": small,
    "map/logo.png": png,
};

interface RawResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

function request(
    port: number,
    urlPath: string,
    headers: Record<string, string> = {},
    method = "GET",
): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
        // `fetch` would decode the body for us; the bytes on the wire are what is under test.
        const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () =>
                resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
            );
        });
        req.on("error", reject);
        req.end();
    });
}

function diskBackend(): { fileSystem: FileSystemInterface; cleanup: () => void } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "map-storage-compression-"));
    for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
        fs.writeFileSync(path.join(directory, name), content);
    }
    return {
        fileSystem: new DiskFileSystem(directory),
        cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
    };
}

function s3Backend(): { fileSystem: FileSystemInterface; cleanup: () => void } {
    class NoSuchKey extends Error {}
    const getObject = vi.fn((input: { Key: string; IfNoneMatch?: string }) => {
        const content = files[input.Key];
        if (!content) {
            return Promise.reject(new NoSuchKey());
        }
        // What S3 does: a strong ETag, and a 304 for a matching If-None-Match.
        const etag = `"md5-${content.length}"`;
        if (input.IfNoneMatch === etag) {
            return Promise.reject(
                new S3ServiceException({ name: "Unknown", $fault: "client", $metadata: { httpStatusCode: 304 } }),
            );
        }
        const pieces: Buffer[] = [];
        for (let offset = 0; offset < content.length; offset += 16384) {
            pieces.push(content.subarray(offset, offset + 16384));
        }
        return Promise.resolve({
            Body: Readable.from(pieces),
            ContentLength: content.length,
            ContentType: "application/octet-stream",
            ETag: etag,
        });
    });
    return { fileSystem: new S3FileSystem({ getObject } as unknown as S3, "bucket"), cleanup: () => undefined };
}

describe.each([
    // The disk back end answers a Range request itself (206); the S3 back end has never implemented Range and answers 200.
    { name: "disk", create: diskBackend, rangeStatus: 206 },
    { name: "S3", create: s3Backend, rangeStatus: 200 },
])("compressFiles on the $name back end", ({ create, rangeStatus }) => {
    let port = 0;
    let server: http.Server;
    let cleanup: () => void;

    beforeAll(() => {
        const backend = create();
        cleanup = backend.cleanup;
        const app = express();
        app.use(compressFiles, (req, res, next) => {
            res.set("Cache-Control", "public, s-maxage=10");
            backend.fileSystem.serveStaticFile(decodeURIComponent(req.path.slice(1)), res, next);
        });
        server = app.listen(0);
        port = (server.address() as AddressInfo).port;
    });
    afterAll(() => {
        server.close();
        cleanup();
    });

    it("sends Brotli when the client accepts it, and the decompressed body is the file", async () => {
        const res = await request(port, "/map/office.tmj", { "Accept-Encoding": "gzip, br" });

        expect(res.status).toBe(200);
        expect(res.headers["content-encoding"]).toBe("br");
        expect(res.headers["vary"]).toContain("Accept-Encoding");
        expect(res.headers["content-length"]).toBeUndefined();
        expect(res.headers["content-type"]).toContain("application/json");
        expect(res.headers["cache-control"]).toBe("public, s-maxage=10");
        expect(res.headers["etag"]).toMatch(/^W\//);
        expect(res.body.length).toBeLessThan(tmj.length / 4);
        expect(brotliDecompressSync(res.body).equals(tmj)).toBe(true);
    });

    it("sends gzip to a client that only accepts gzip", async () => {
        const res = await request(port, "/map/office.tmj", { "Accept-Encoding": "gzip" });

        expect(res.headers["content-encoding"]).toBe("gzip");
        expect(res.headers["content-length"]).toBeUndefined();
        expect(gunzipSync(res.body).equals(tmj)).toBe(true);
    });

    it("sends the file as it is, with its length, when the client accepts no encoding", async () => {
        const res = await request(port, "/map/office.tmj");

        expect(res.headers["content-encoding"]).toBeUndefined();
        // Even an identity answer depends on Accept-Encoding: a shared cache must not mix them up.
        expect(res.headers["vary"]).toContain("Accept-Encoding");
        expect(res.headers["content-length"]).toBe(String(tmj.length));
        expect(res.body.equals(tmj)).toBe(true);
    });

    it.each([
        ["br;q=0, gzip", "gzip"],
        ["gzip;q=0.5, br;q=0.1", "gzip"],
        ["*", "br"],
        ["*;q=0, gzip", "gzip"],
        ["gzip;q=0, br;q=0", undefined],
        ["identity", undefined],
        ["deflate", undefined],
    ])("negotiates %s", async (acceptEncoding, expected) => {
        const res = await request(port, "/map/office.tmj", { "Accept-Encoding": acceptEncoding });

        expect(res.status).toBe(200);
        expect(res.headers["content-encoding"]).toBe(expected);
        const decoded =
            expected === "br" ? brotliDecompressSync(res.body) : expected === "gzip" ? gunzipSync(res.body) : res.body;
        expect(decoded.equals(tmj)).toBe(true);
    });

    it("compresses a .wam, which is JSON, like a .tmj", async () => {
        const res = await request(port, "/map/office.wam", { "Accept-Encoding": "br" });

        expect(res.headers["content-encoding"]).toBe("br");
        expect(brotliDecompressSync(res.body).equals(tmj)).toBe(true);
    });

    it("answers 304 to a conditional request made with the ETag of a compressed answer", async () => {
        const first = await request(port, "/map/office.tmj", { "Accept-Encoding": "br" });
        const etag = first.headers["etag"];
        expect(etag).toBeDefined();

        const second = await request(port, "/map/office.tmj", {
            "Accept-Encoding": "br",
            "If-None-Match": etag ?? "",
        });

        expect(second.status).toBe(304);
        expect(second.body.length).toBe(0);
        expect(second.headers["vary"]).toContain("Accept-Encoding");
        expect(second.headers["content-encoding"]).toBeUndefined();
    });

    it("leaves a Range request alone: no encoding, the bytes asked for (or the whole file where Range is unsupported)", async () => {
        const res = await request(port, "/map/office.tmj", { "Accept-Encoding": "br", Range: "bytes=0-9" });

        expect(res.status).toBe(rangeStatus);
        expect(res.headers["content-encoding"]).toBeUndefined();
        expect(res.body.equals(rangeStatus === 206 ? tmj.subarray(0, 10) : tmj)).toBe(true);
    });

    it("leaves a PNG alone", async () => {
        const res = await request(port, "/map/logo.png", { "Accept-Encoding": "br, gzip" });

        expect(res.status).toBe(200);
        expect(res.headers["content-encoding"]).toBeUndefined();
        expect(res.headers["vary"]).toBeUndefined();
        expect(res.headers["content-length"]).toBe(String(png.length));
        expect(res.body.equals(png)).toBe(true);
    });

    it("leaves a file too small to gain anything alone, but still varies", async () => {
        const res = await request(port, "/map/tiny.json", { "Accept-Encoding": "br" });

        expect(res.headers["content-encoding"]).toBeUndefined();
        expect(res.headers["vary"]).toContain("Accept-Encoding");
        expect(res.body.equals(small)).toBe(true);
    });

    it("answers HEAD with the headers of the compressed GET and no body", async () => {
        const get = await request(port, "/map/office.tmj", { "Accept-Encoding": "br" });
        const head = await request(port, "/map/office.tmj", { "Accept-Encoding": "br" }, "HEAD");

        expect(head.status).toBe(200);
        expect(head.body.length).toBe(0);
        expect(head.headers["content-encoding"]).toBe("br");
        expect(head.headers["etag"]).toBe(get.headers["etag"]);
        expect(head.headers["vary"]).toContain("Accept-Encoding");
    });

    it("does not touch a 404", async () => {
        const res = await request(port, "/map/missing.json", { "Accept-Encoding": "br" });

        expect(res.status).toBe(404);
        expect(res.headers["content-encoding"]).toBeUndefined();
        expect(res.headers["vary"]).toBeUndefined();
    });

    it("compresses once when the middleware sits on several routes of the same request", async () => {
        const backend = create();
        const app = express();
        app.use(compressFiles);
        app.use(compressFiles, (req, res, next) => {
            backend.fileSystem.serveStaticFile(req.path.slice(1), res, next);
        });
        const twice = app.listen(0);
        try {
            const res = await request((twice.address() as AddressInfo).port, "/map/office.tmj", {
                "Accept-Encoding": "br",
            });
            expect(brotliDecompressSync(res.body).equals(tmj)).toBe(true);
        } finally {
            twice.close();
            backend.cleanup();
        }
    });
});

describe("negotiateEncoding", () => {
    it.each([
        [undefined, undefined],
        ["", undefined],
        ["br", "br"],
        ["gzip, deflate, br", "br"],
        ["BR;Q=0.4, gzip;q=0.8", "gzip"],
        ["br;q=0", undefined],
        ["gzip;q=oops", "gzip"],
    ])("%s gives %s", (header, expected) => {
        expect(negotiateEncoding(header)).toBe(expected);
    });
});

describe("map file types", () => {
    it("are served as a type the middleware compresses", () => {
        for (const name of [
            "a.tmj",
            "a.wam",
            "a.json",
            "a.mjs",
            "a.js",
            "a.css",
            "a.html",
            "a.svg",
            "a.xml",
            "a.txt",
        ]) {
            expect(mime.getType(name), name).toBeTruthy();
        }
    });
});
