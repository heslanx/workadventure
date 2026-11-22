// @vitest-environment jsdom
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/svelte", () => sentryMock);
vi.mock("../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        default: readable({ camera: { webrtc: { error: () => "Video cannot reach some people." } } }),
    };
});

import { errorStore, warningMessageStore } from "../Stores/ErrorStore";
import { LivekitClientLoadError } from "./LivekitClientLoader";
import { reportLivekitClientLoadFailure } from "./LivekitClientLoadFailure";

describe("reportLivekitClientLoadFailure", () => {
    const message = "Video cannot reach some people.";

    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        for (const warning of get(warningMessageStore)) {
            warningMessageStore.removeWarningMessage(warning.id ?? "");
        }
        for (const error of get(errorStore)) {
            errorStore.clearMessageById(error.id ?? "");
        }
        // errorStore messages added without an id cannot be cleared by id: clear the closable ones too
        errorStore.clearClosableMessages();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        sentryMock.captureException.mockClear();
    });

    const loadError = () => new LivekitClientLoadError(new TypeError("Failed to fetch dynamically imported module"));

    it("warns the user and sends the cause to Sentry on the first failure, while a retry is coming", () => {
        const error = loadError();

        reportLivekitClientLoadFailure(error, { attempt: 1, retryAfterMs: 5000 });

        expect(get(warningMessageStore).map((warning) => warning.message)).toContain(message);
        expect(get(errorStore).map((entry) => entry.message)).not.toContain(message);
        expect(sentryMock.captureException).toHaveBeenCalledExactlyOnceWith(error);
    });

    it("does not tell Sentry again about the following failures of the same streak", () => {
        reportLivekitClientLoadFailure(loadError(), { attempt: 2, retryAfterMs: 15000 });
        reportLivekitClientLoadFailure(loadError(), { attempt: 3, retryAfterMs: undefined });

        expect(sentryMock.captureException).not.toHaveBeenCalled();
    });

    it("leaves a message that does not expire once no retry is left, so that the user knows to reload", () => {
        vi.useFakeTimers();

        reportLivekitClientLoadFailure(loadError(), { attempt: 3, retryAfterMs: undefined });
        vi.advanceTimersByTime(10 * 60 * 1000);

        expect(get(errorStore).map((entry) => entry.message)).toContain(message);
    });
});
