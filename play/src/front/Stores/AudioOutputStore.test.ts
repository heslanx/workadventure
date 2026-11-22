// @vitest-environment jsdom
import { supportsAudioOutputSelection as livekitSupportsAudioOutputSelection } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWebKitUserAgent, supportsAudioOutputSelection } from "./AudioOutputStore";

const userAgents: Record<string, { userAgent: string; webKit: boolean }> = {
    "Safari on macOS": {
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
        webKit: true,
    },
    "Safari on an iPad that presents itself as a Mac": {
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
        webKit: true,
    },
    "Safari on an iPhone": {
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
        webKit: true,
    },
    "Chrome on an iPhone": {
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
        webKit: true,
    },
    "Firefox on an iPhone": {
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15",
        webKit: true,
    },
    "Edge on an iPhone": {
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/141.0.3537.71 Mobile/15E148 Safari/605.1.15",
        webKit: true,
    },
    "Chrome on macOS": {
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        webKit: false,
    },
    "Edge on Windows": {
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
        webKit: false,
    },
    "Chrome on Android": {
        userAgent:
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
        webKit: false,
    },
    "Samsung Internet": {
        userAgent:
            "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
        webKit: false,
    },
    "Firefox on Linux": {
        userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
        webKit: false,
    },
    "a user agent nobody recognises": { userAgent: "SomeCrawler/1.0", webKit: false },
    "an empty user agent": { userAgent: "", webKit: false },
};

describe("speaker selection support", () => {
    beforeEach(() => {
        Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
            value: () => Promise.resolve(),
            configurable: true,
        });
    });

    afterEach(() => {
        Reflect.deleteProperty(HTMLMediaElement.prototype, "setSinkId");
        Reflect.deleteProperty(navigator, "userAgent");
        vi.restoreAllMocks();
    });

    describe.each(Object.entries(userAgents))("on %s", (_name, { userAgent, webKit }) => {
        it(`reads the user agent as ${webKit ? "WebKit" : "something else"}`, () => {
            expect(isWebKitUserAgent(userAgent)).toBe(webKit);
        });

        // The copy must not drift from livekit-client's own answer, which decides whether switchActiveDevice throws
        it("answers as livekit-client does", () => {
            Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });

            expect(supportsAudioOutputSelection()).toBe(livekitSupportsAudioOutputSelection());
            expect(supportsAudioOutputSelection()).toBe(!webKit);
        });
    });

    it("is false where setSinkId does not exist, whatever the browser", () => {
        Reflect.deleteProperty(HTMLMediaElement.prototype, "setSinkId");

        expect(supportsAudioOutputSelection(userAgents["Chrome on macOS"].userAgent)).toBe(false);
    });

    it("is false without a document, as on a server", () => {
        expect(supportsAudioOutputSelection(userAgents["Chrome on macOS"].userAgent, null)).toBe(false);
    });
});
