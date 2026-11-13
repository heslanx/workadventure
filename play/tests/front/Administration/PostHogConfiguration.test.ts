import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import Mustache from "mustache";
import type { PostHogConfig } from "@posthog/types";

function configuration(): Partial<PostHogConfig> {
    const template = readFileSync("index.html", "utf8");
    const html = Mustache.render(template, {
        posthogApiKey: "public-test-token",
        posthogUrl: "https://eu.i.posthog.com",
        posthogReplayDisabled: false,
        posthogReplaySampleRate: 0.1,
        posthogContext: JSON.stringify({ service: "browser", environment: "test", release: "validation" }),
    });
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((match) =>
        match[1].includes("posthog.init"),
    )?.[1];
    if (!script) throw new Error("PostHog initialization not rendered");
    const init = vi.fn();
    const posthog = { __SV: 1, init };
    runInNewContext(script, { posthog, window: { posthog }, document: {}, URL });
    return init.mock.calls[0][1];
}

describe("rendered PostHog initialization", () => {
    it("enables errors and vitals with masked replay and no media or network payloads", () => {
        const config = configuration();
        expect(config.capture_exceptions).toMatchObject({
            capture_unhandled_errors: true,
            capture_unhandled_rejections: true,
            capture_console_errors: false,
        });
        expect(config.capture_performance).toEqual({ web_vitals: true, network_timing: false });
        expect(config.session_recording).toMatchObject({
            maskAllInputs: true,
            maskTextSelector: "*",
            recordBody: false,
            recordHeaders: false,
            sampleRate: 0.1,
            captureCanvas: { recordCanvas: false },
        });
        expect(config.session_recording?.blockSelector).toContain("canvas");
        const request = {
            name: "https://play.test/world?token=private#secret",
            duration: 0,
            entryType: "navigation",
            startTime: 0,
        };
        const maskRequest = config.session_recording?.maskCapturedNetworkRequestFn;
        if (!maskRequest) throw new Error("Missing replay URL sanitizer");
        expect(maskRequest(request)?.name).toBe("https://play.test/world");
    });

    it("scrubs nested properties before events leave the page", () => {
        const config = configuration();
        if (typeof config.before_send !== "function") throw new Error("Missing event sanitizer");
        const event = config.before_send({
            uuid: "validation-event",
            event: "$exception",
            properties: {
                email: "person@example.org",
                $current_url: "https://play.test/world?token=private#secret",
                nested: { token: "private", message: "Bearer private person@example.org" },
            },
        });
        expect(event?.properties).toEqual({
            service: "browser",
            environment: "test",
            release: "validation",
            $current_url: "https://play.test/world",
            nested: { message: "Bearer [redacted] [email]" },
        });
    });
});
