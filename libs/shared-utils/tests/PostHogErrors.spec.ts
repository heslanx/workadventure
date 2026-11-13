import { createServer } from "node:http";
import { once } from "node:events";
import { gunzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { captureBackendException, isPostHogErrorsActive, startPostHogErrors } from "../src/Observability/PostHogErrors";
import { clearDrainableServices, runDrains } from "../src/ShutdownDrains";

afterEach(() => {
    vi.unstubAllEnvs();
    clearDrainableServices();
});

it("flushes one sanitized exception before shutdown without creating a person profile", async () => {
    const payloads: string[] = [];
    const collector = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
            const body = Buffer.concat(chunks);
            payloads.push((req.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body).toString("utf8"));
            res.setHeader("content-type", "application/json");
            res.end("{}");
        });
    });
    collector.listen(0, "127.0.0.1");
    await once(collector, "listening");
    try {
        const address = collector.address();
        if (!address || typeof address === "string") throw new Error("Collector failed to bind");
        vi.stubEnv("POSTHOG_API_KEY", "project-token");
        vi.stubEnv("POSTHOG_URL", `http://127.0.0.1:${address.port}`);
        vi.stubEnv("OBSERVABILITY_RELEASE", "merge-validation");
        expect(isPostHogErrorsActive()).toBe(false);
        startPostHogErrors("test");
        expect(isPostHogErrorsActive()).toBe(true);
        const error = new TypeError(
            "Bearer private-token user@example.org\nAuthorization: Basic synthetic-basic\nCookie: session=synthetic-session; other=synthetic-cookie",
            { cause: new Error("token=synthetic-cause") },
        );
        captureBackendException(error);
        captureBackendException(error);
        await runDrains(3000);
        const batches = payloads.map(
            (payload) => JSON.parse(payload) as { batch?: { event: string; properties: Record<string, unknown> }[] },
        );
        const exceptions = batches
            .flatMap((batch) => batch.batch ?? [])
            .filter((event) => event.event === "$exception");
        expect(exceptions).toHaveLength(1);
        expect(exceptions[0].properties).toMatchObject({
            service: "test",
            release: "merge-validation",
            $process_person_profile: false,
            $exception_list: [
                expect.objectContaining({ type: "TypeError" }),
                expect.objectContaining({ type: "Error" }),
            ],
        });
        expect(payloads.join()).not.toContain("private-token");
        expect(payloads.join()).not.toContain("user@example.org");
        expect(payloads.join()).not.toMatch(/synthetic-(?:basic|session|cookie|cause)/);
        expect(isPostHogErrorsActive()).toBe(false);
        expect(process.listeners("uncaughtExceptionMonitor")).not.toContain(captureBackendException);
    } finally {
        await runDrains(3000);
        await new Promise<void>((resolve, reject) => {
            collector.close((error) => (error ? reject(error) : resolve()));
        });
    }
}, 10_000);
