import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buffer } from "node:stream/consumers";
import zlib from "node:zlib";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("../../src/pusher/services/AdminService", () => ({
    adminService: { getCapabilities: () => Promise.resolve({}) },
}));
vi.mock("../../src/pusher/services/MetaTagsBuilder", () => ({
    MetaTagsBuilder: class {
        getRedirectUrl = () => Promise.resolve(undefined);
        getMeta = () => Promise.resolve({ favIcons: [{ src: "/icon.png" }] });
        getMapDetails = () => Promise.resolve(undefined);
    },
}));

import { FrontController } from "../../src/pusher/controllers/FrontController";
import type { FrontAssets } from "../../src/pusher/services/FrontAssets";

const template = `<html><body>${"<p>WorkAdventure page</p>".repeat(300)}<p>{{ url }}</p><script>window.token = "{{ authToken }}"</script></body></html>`;

async function send(
    port: number,
    method: "GET" | "POST",
    requestPath: string,
    headers: Record<string, string>,
    body?: string,
) {
    // node:http never decodes a body, unlike fetch.
    const req = http.request({ port, method, path: requestPath, headers });
    req.end(body);
    const [res] = (await once(req, "response")) as [http.IncomingMessage];
    return { status: res.statusCode ?? 0, headers: res.headers, body: await buffer(res) };
}

describe("FrontController: the page it renders for each visitor", () => {
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
        const app = express();
        app.use(express.urlencoded({ extended: false }));
        const frontAssets: FrontAssets = { getIndexTemplate: () => template, registerStaticRoutes: () => {} };
        new FrontController(app, frontAssets);
        server = await new Promise<http.Server>((resolve) => {
            const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
        });
        port = (server.address() as AddressInfo).port;
    });

    afterEach(() => {
        server.close();
    });

    it("compresses the page for a client that accepts Brotli, and keeps it uncacheable", async () => {
        const response = await send(port, "GET", "/_/global/example.test/map.json", { "Accept-Encoding": "br, gzip" });

        expect(response.status).toBe(200);
        expect(response.headers["content-encoding"]).toBe("br");
        expect(response.headers.vary).toContain("Accept-Encoding");
        expect(response.headers["cache-control"]).toBe("no-cache");
        expect(response.headers["content-type"]).toContain("text/html");
        const html = zlib.brotliDecompressSync(response.body).toString();
        expect(html).toContain("WorkAdventure page");
        // Rendered per request: Mustache escapes the slashes of the URL it put in the page.
        expect(html).toContain("global&#x2F;example.test&#x2F;map.json");
    });

    it("sends the page as it is to a client that accepts no coding", async () => {
        const response = await send(port, "GET", "/_/global/example.test/map.json", {});

        expect(response.headers["content-encoding"]).toBeUndefined();
        expect(response.headers.vary).toContain("Accept-Encoding");
        expect(response.body.toString()).toContain("WorkAdventure page");
    });

    it("does not compress a page that carries the auth token, whatever the client accepts", async () => {
        const form = "authToken=secret-token-value";
        const response = await send(
            port,
            "POST",
            "/_/global/example.test/map.json",
            {
                "Accept-Encoding": "br, gzip",
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": String(form.length),
            },
            form,
        );

        expect(response.status).toBe(200);
        expect(response.headers["content-encoding"]).toBeUndefined();
        expect(response.body.toString()).toContain('window.token = "secret-token-value"');
    });
});
