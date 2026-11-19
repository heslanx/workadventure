import { get } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { localUserStore } from "../../../Connection/LocalUserStore";
import {
    audioManagerFileStore,
    audioManagerVisibilityStore,
    audioManagerVolumeStore,
    bubbleSoundStore,
} from "../../../Stores/AudioManagerStore";
import { volumeProximityDiscussionStore } from "../../../Stores/PeerStore";
import { playOnSelectedOutput } from "../../../WebRtc/AudioOutputManager";
import { savedSetting } from "./savedSetting";

// The sound settings, written the way upstream's settings and music player write them (SettingsSubMenu.svelte,
// AudioManager.svelte, ChatSettings.svelte).

type BubbleSound = "ding" | "wobble";

export function setVoicesVolume(volume: number): void {
    analyticsClient.trackAdminEvent("settings.audio_volume.opened");
    localUserStore.setVolumeProximityDiscussion(volume);
    volumeProximityDiscussionStore.set(volume);
}

/** The map music's volume from 0 to 1, 0 while it is muted. */
export function musicVolume(): number {
    return get(audioManagerVolumeStore).muted ? 0 : localUserStore.getAudioPlayerVolume();
}

/** Sets the map music's volume; moving it unmutes the music, as the music player's own slider does. */
export function setMusicVolume(volume: number): void {
    audioManagerVolumeStore.setVolume(volume);
    localUserStore.setAudioPlayerVolume(volume);
    audioManagerVolumeStore.setMuted(false);
    localUserStore.setAudioPlayerMuted(false);
}

export const lowerMusicWhileTalking = savedSetting(
    () => localUserStore.getDecreaseAudioPlayerVolumeWhileTalking(),
    (on: boolean) => {
        analyticsClient.trackAdminEvent("settings.decrease_audio_volume.changed", { value: on ? "true" : "false" });
        localUserStore.setDecreaseAudioPlayerVolumeWhileTalking(on);
        audioManagerVolumeStore.setDecreaseWhileTalking(on);
    },
);

export const blockMapAudio = savedSetting(
    () => localUserStore.getBlockAudio(),
    (on: boolean) => {
        if (on) {
            audioManagerFileStore.unloadAudio();
            audioManagerVisibilityStore.set("disabledBySettings");
        }
        localUserStore.setBlockAudio(on);
    },
);

export const bubbleSound = savedSetting<BubbleSound>(
    () => localUserStore.getBubbleSound(),
    (sound) => {
        localUserStore.setBubbleSound(sound);
        bubbleSoundStore.set(sound);
    },
);

/** Upstream's sound picker previews at this volume (SoundSelect.svelte). */
export const BUBBLE_PREVIEW_VOLUME = 0.2;

/** Plays a bubble sound once, as upstream's sound picker previews it: quietly, on the chosen speaker. */
export function previewBubbleSound(sound: BubbleSound): void {
    const audio = new Audio(`/resources/objects/webrtc-in-${sound}.mp3`);
    audio.volume = BUBBLE_PREVIEW_VOLUME;
    playOnSelectedOutput(audio).catch((error: unknown) =>
        console.error("[konclui] preferences: bubble sound preview", error),
    );
}

export const chatSounds = savedSetting(
    () => localUserStore.getChatSounds(),
    (on: boolean) => localUserStore.setChatSounds(on),
);
