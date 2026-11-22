import { writable } from "svelte/store";
import { localUserStore } from "../Connection/LocalUserStore";

/**
 * Whether this user agent is WebKit on Apple's terms: Safari, and every browser on iOS (they all run WebKit). The same
 * reading livekit-client makes of a user agent (its getBrowser(): Firefox, then Chrome, then anything that says Safari
 * or AppleWebKit is Safari, "mobile/" meaning iOS), copied so that this module, which loads at start, does not pull
 * livekit-client into the entry. A user agent that none of them recognises is not WebKit.
 */
export function isWebKitUserAgent(userAgent: string): boolean {
    const ua = userAgent.toLowerCase();
    if (/firefox|iceweasel|fxios/.test(ua)) {
        return ua.includes("fxios");
    }
    if (/chrom|crios|crmo/.test(ua)) {
        return ua.includes("crios");
    }
    return /safari|applewebkit/.test(ua);
}

/**
 * Whether the audio output can be chosen with HTMLMediaElement.setSinkId: not on WebKit, and not where the method does
 * not exist. It is livekit-client's supportsAudioOutputSelection(), kept here for the same reason as isWebKitUserAgent,
 * and it never throws on an unknown user agent (unlike isSafari()).
 */
export function supportsAudioOutputSelection(
    userAgent: string | undefined = typeof navigator === "undefined" ? undefined : navigator.userAgent,
    audioFactory: Pick<Document, "createElement"> | null = typeof document === "undefined" ? null : document,
): boolean {
    if (!audioFactory || (userAgent !== undefined && isWebKitUserAgent(userAgent))) {
        return false;
    }
    return "setSinkId" in audioFactory.createElement("audio");
}

/**
 * Whether we choose the audio output at all.
 *
 * Not on WebKit (Safari, every iOS browser): it rejects HTMLMediaElement.setSinkId outside a user gesture
 * (SpeakerSelectionRequiresUserGesture), so every voice joining later would fail to apply the choice and play on the
 * system output anyway. There, voices and interface sounds both follow the system output. livekit-client draws the
 * same line (see supportsAudioOutputSelection), and also rules out browsers without setSinkId.
 */
export const speakerSelectionSupported = supportsAudioOutputSelection();

function createSpeakerSelectedStore() {
    const { subscribe, set } = writable<string | undefined>(
        speakerSelectionSupported ? (localUserStore.getSpeakerDeviceId() ?? undefined) : undefined,
    );
    return {
        subscribe,
        // The single guard every writer goes through: device list, "new device" bubble, menus, error fallback
        set(deviceId: string | undefined) {
            if (speakerSelectionSupported) {
                set(deviceId);
            }
        },
    };
}

/**
 * The new devices worth offering to switch to: outputs only where we choose the output. On Safari, AirPods are still
 * offered for their microphone, and a display or speaker without a microphone is not offered at all.
 */
export function devicesToOffer(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
    return speakerSelectionSupported ? devices : devices.filter((device) => device.kind !== "audiooutput");
}

/**
 * The output voices play on. Always undefined where speaker selection is not supported, so that nothing calls setSinkId.
 *
 * Kept out of MediaStore so that it can be loaded on its own, without MediaStore's import cycles.
 */
export const speakerSelectedStore = createSpeakerSelectedStore();
