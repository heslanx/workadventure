import { derived, get } from "svelte/store";
import BrowserAudioInterruptedToast from "../Components/Toasts/BrowserAudioInterruptedToast.svelte";
import BrowserNoSoundInfoToast from "../Components/Toasts/BrowserNoSoundInfoToast.svelte";
import TextToast from "../Components/Toasts/TextToast.svelte";
import { LL } from "../../i18n/i18n-svelte";
import { uplinkCapNoticeStore } from "../WebRtc/UplinkCap";
import { audioInterruptedStore } from "./AudioInterruptedStore";
import { audioPlaybackStore } from "./AudioPlaybackStore";
import type { ToastSourceDefinition } from "./ToastStore";

const AUDIO_INTERRUPTED_TOAST_ID = "audio-interrupted-toast";
const AUDIO_PLAYBACK_TOAST_ID = "audio-playback-toast";
const UPLINK_CAP_TOAST_ID = "uplink-cap-toast";
const UPLINK_CAP_TOAST_DURATION_MS = 8000;

export function getToastSources(): ToastSourceDefinition[] {
    return [
        {
            source: derived(audioInterruptedStore, ($audioInterruptedStore) =>
                $audioInterruptedStore ? { component: BrowserAudioInterruptedToast, props: {} } : undefined,
            ),
            uuid: AUDIO_INTERRUPTED_TOAST_ID,
        },
        {
            source: derived(audioPlaybackStore, ($audioPlaybackStore) =>
                $audioPlaybackStore.size > 0 ? { component: BrowserNoSoundInfoToast, props: {} } : undefined,
            ),
            uuid: AUDIO_PLAYBACK_TOAST_ID,
        },
        {
            // The text is read when the notice is raised: a toast closed by the user stays closed until the notice
            // goes down and up again, and a source that also followed the locale would reopen it when that changes.
            source: derived(uplinkCapNoticeStore, ($uplinkCapNoticeStore) =>
                $uplinkCapNoticeStore
                    ? {
                          component: TextToast,
                          props: {
                              message: get(LL).warning.uplinkCapped(),
                              theme: "secondary",
                              duration: UPLINK_CAP_TOAST_DURATION_MS,
                          },
                      }
                    : undefined,
            ),
            uuid: UPLINK_CAP_TOAST_ID,
        },
    ];
}
