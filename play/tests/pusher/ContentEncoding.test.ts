import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { buffer } from "node:stream/consumers";
import http from "node:http";
import zlib from "node:zlib";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { negotiateEncoding, parseAcceptEncoding, sendDocument } from "../../src/pusher/services/ContentEncoding";

describe("parseAcceptEncoding", () => {
    it("reads the quality of each coding and defaults it to 1", () => {
        const qualities = parseAcceptEncoding("gzip, BR;q=0.5 , identity;q=0, *;q=0.1");
        expect(Object.fromEntries(qualities)).toEqual({ gzip: 1, br: 0.5, identity: 0, "*": 0.1 });
    });

    it.each(["abc", "", "-1", "1e1", "0x1"])("reads the unreadable quality %j as a refusal", (quality) => {
        expect(parseAcceptEncoding(`gzip;q=${quality}`).get("gzip")).toBe(0);
    });

    it("reads a quality written with more than three decimals, and clamps one above 1", () => {
        expect(parseAcceptEncoding("br;q=0.0000").get("br")).toBe(0);
        expect(parseAcceptEncoding("br;q=0.50000").get("br")).toBe(0.5);
        expect(parseAcceptEncoding("br;q=7").get("br")).toBe(1);
    });
});

describe("negotiateEncoding", () => {
    it.each([
        ["br, gzip", "br"],
        ["gzip, deflate, br", "br"],
        ["gzip", "gzip"],
        ["x-gzip", "gzip"],
        ["br", "br"],
        ["gzip;q=1, br;q=0.5", "gzip"],
        ["gzip;q=0.5, br;q=0.5", "br"],
        ["gzip;q=0, br", "br"],
        ["*", "br"],
        ["*;q=0.5, br;q=0", "gzip"],
        ["br;q=0.5, gzip;q=abc", "br"],
    ])("answers %j with %j", (header, expected) => {
        expect(negotiateEncoding(header)).toBe(expected);
    });

    it.each([
        [undefined],
        [""],
        ["identity"],
        ["deflate, zstd"],
        ["br;q=0, gzip;q=0"],
        ["br;q=0.0000, gzip;q=-1"],
        ["*;q=0"],
        ["gzip;q=0, *;q=0"],
    ])("sends the file as it is for %j", (header) => {
        expect(negotiateEncoding(header)).toBeUndefined();
    });

    it("only picks a coding that is available", () => {
        expect(negotiateEncoding("br, gzip", ["gzip"])).toBe("gzip");
        expect(negotiateEncoding("br", ["gzip"])).toBeUndefined();
    });
});

interface RawResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

async function get(port: number, path: string, headers: Record<string, string>): Promise<RawResponse> {
    // node:http never decodes a body, unlike fetch.
    const req = http.get({ port, path, headers });
    const [res] = (await once(req, "response")) as [http.IncomingMessage];
    const body = await buffer(res);
    return { status: res.statusCode ?? 0, headers: res.headers, body };
}

describe("sendDocument", () => {
    const servers: http.Server[] = [];
    afterEach(() => {
        servers.splice(0).forEach((server) => server.close());
    });

    const page = `<html><body>${"<p>WorkAdventure page</p>".repeat(500)}</body></html>`;

    async function serve(compress?: boolean, body = page): Promise<number> {
        const app = express();
        app.get("/", async (req, res) => {
            res.set("Cache-Control", "no-cache").type("html");
            await sendDocument(req, res, body, { compress });
        });
        const server = await new Promise<http.Server>((resolve) => {
            const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
        });
        servers.push(server);
        return (server.address() as AddressInfo).port;
    }

    it("compresses the page with the coding the client prefers and keeps the headers of the plain page", async () => {
        const port = await serve();

        const br = await get(port, "/", { "Accept-Encoding": "gzip, br" });
        expect(br.headers["content-encoding"]).toBe("br");
        expect(zlib.brotliDecompressSync(br.body).toString()).toBe(page);
        expect(br.headers["content-type"]).toBe("text/html; charset=utf-8");
        expect(br.headers["cache-control"]).toBe("no-cache");
        expect(br.headers.vary).toContain("Accept-Encoding");
        expect(br.body.length).toBeLessThan(page.length / 10);

        const gz = await get(port, "/", { "Accept-Encoding": "gzip" });
        expect(gz.headers["content-encoding"]).toBe("gzip");
        expect(zlib.gunzipSync(gz.body).toString()).toBe(page);
    });

    it("sends the page as it is when the client accepts no coding of ours", async () => {
        const port = await serve();

        const refusals = [undefined, "identity", "br;q=0, gzip;q=0"];
        const responses = await Promise.all(
            refusals.map((acceptEncoding) =>
                get(port, "/", acceptEncoding ? { "Accept-Encoding": acceptEncoding } : {}),
            ),
        );
        for (const plain of responses) {
            expect(plain.headers["content-encoding"]).toBeUndefined();
            expect(plain.headers.vary).toContain("Accept-Encoding");
            expect(plain.body.toString()).toBe(page);
        }
    });

    it("never compresses a page when asked not to", async () => {
        const port = await serve(false);

        const response = await get(port, "/", { "Accept-Encoding": "br, gzip" });
        expect(response.headers["content-encoding"]).toBeUndefined();
        expect(response.body.toString()).toBe(page);
    });

    it("sends a page that would not shrink as it is", async () => {
        const port = await serve(true, "<p>x</p>");

        const response = await get(port, "/", { "Accept-Encoding": "br" });
        expect(response.headers["content-encoding"]).toBeUndefined();
        expect(response.body.toString()).toBe("<p>x</p>");
    });
});
