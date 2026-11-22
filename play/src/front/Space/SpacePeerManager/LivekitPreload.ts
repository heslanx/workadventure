import type { Readable, Unsubscriber } from "svelte/store";
import { preloadLivekitClient } from "../../Livekit/LivekitClientLoader";

/**
 * How many people in a space start the fetch of livekit-client. A guess tied to a setting the front cannot read: the
 * back moves a bubble to LiveKit above MAX_USERS_FOR_WEBRTC, which is 4 when unset (the back's default) and 3 in
 * .env.template (so in dev and CI). The fetch of about 125 KB of Brotli started at three therefore has two joins to
 * finish before LiveKit takes over with the default, and only one with the template value. It is a head start, not a
 * promise: a space that goes to LiveKit without growing (a recording, a megaphone, a user whose encoders cannot keep
 * up) waits for the fetch when the invitation arrives.
 *
 * Cost: a deployment with no LiveKit server downloads the chunk at three people and never uses it, since the front
 * has no signal of LiveKit being available before an invitation arrives.
 */
export const LIVEKIT_PRELOAD_USER_COUNT = 3;

/**
 * Starts the fetch of livekit-client once the space holds {@link LIVEKIT_PRELOAD_USER_COUNT} users. Stop it with the
 * returned function. The fetch is requested at most once per call, and a loader that already has it ignores the request.
 */
export function watchSpaceSizeForLivekitPreload(
    usersStore: Readable<ReadonlyMap<string, unknown>>,
    preload: () => void = preloadLivekitClient,
): Unsubscriber {
    let requested = false;
    return usersStore.subscribe((users) => {
        if (requested || users.size < LIVEKIT_PRELOAD_USER_COUNT) {
            return;
        }
        requested = true;
        preload();
    });
}
