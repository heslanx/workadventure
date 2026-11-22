import { get } from "svelte/store";
import * as Sentry from "@sentry/svelte";
import LL from "../../i18n/i18n-svelte";
import { errorStore, warningMessageStore } from "../Stores/ErrorStore";
import type { LivekitClientLoadError } from "./LivekitClientLoader";
import type { LivekitClientLoadFailureDecision } from "./LivekitClientLoadRetryPolicy";

/**
 * Tells the user that the video conference library could not be fetched, and Sentry why. The conversation cannot
 * start without it: the others may not see or hear the user, so this is a connection error, not a log line. The
 * caller schedules the retry (see LivekitClientLoadRetryPolicy), which is what `decision` carries.
 *
 * - While a retry is coming, the message is a warning that fades like the other media connection warnings.
 * - When the retries are used up, it is an error that stays until the user closes it: nothing else will happen on its
 *   own, and a reload is the fix (a chunk that cannot be fetched is a network problem or a page older than the
 *   deployment).
 * - Sentry hears of the first failure of a streak only: the next ones are the same event seen again.
 *
 * The wording is the one of the other media connection failure ("Video cannot reach some people... Check your network
 * or VPN and reload"): it is what helps here too.
 */
export function reportLivekitClientLoadFailure(
    error: LivekitClientLoadError,
    decision: LivekitClientLoadFailureDecision,
): void {
    const retrying = decision.retryAfterMs !== undefined;
    console.error(
        retrying
            ? "Could not load livekit-client, a new attempt will be made"
            : "Could not load livekit-client, giving up until the page is reloaded",
        error,
    );
    if (decision.attempt === 1) {
        Sentry.captureException(error);
    }
    const message = get(LL).camera.webrtc.error();
    if (retrying) {
        warningMessageStore.addWarningMessage(message);
    } else {
        errorStore.addErrorMessage(message);
    }
}
