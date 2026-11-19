<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { volumeProximityDiscussionStore } from "../../../Stores/PeerStore";
    import {
        blockMapAudio,
        bubbleSound,
        chatSounds,
        lowerMusicWhileTalking,
        musicVolume,
        previewBubbleSound,
        setMusicVolume,
        setVoicesVolume,
    } from "../stores/soundSettings";
    import PrefSection from "./PrefSection.svelte";
    import PrefSelect from "./PrefSelect.svelte";
    import PrefSlider from "./PrefSlider.svelte";
    import PrefToggle from "./PrefToggle.svelte";
    import { IconUnMute } from "@wa-icons";

    let music = $state(musicVolume());

    let t = $derived($LL.konclui.preferences.sounds);
</script>

<PrefSection title={t.volumes()}>
    <PrefSlider
        title={t.voices()}
        hint={t.voicesHint()}
        value={$volumeProximityDiscussionStore}
        onchange={setVoicesVolume}
    />
    <PrefSlider
        title={t.music()}
        hint={t.musicHint()}
        value={music}
        oninput={setMusicVolume}
        onchange={(volume) => {
            setMusicVolume(volume);
            music = volume;
        }}
    />
</PrefSection>
<PrefSection title={t.mapMusic()}>
    <PrefToggle
        title={t.lowerMusic()}
        hint={t.lowerMusicHint()}
        checked={$lowerMusicWhileTalking}
        onchange={(on) => lowerMusicWhileTalking.set(on)}
    />
    <PrefToggle
        title={t.blockAudio()}
        hint={t.blockAudioHint()}
        checked={$blockMapAudio}
        onchange={(on) => blockMapAudio.set(on)}
    />
</PrefSection>
<PrefSection title={t.alerts()}>
    <PrefSelect
        title={t.bubble()}
        value={$bubbleSound}
        options={[
            { value: "ding", label: t.ding() },
            { value: "wobble", label: t.wobble() },
        ]}
        onchange={(value) => {
            if (value !== "ding" && value !== "wobble") return;
            bubbleSound.set(value);
        }}
    >
        <button
            type="button"
            class="k-pref-play"
            aria-label={t.playBubble()}
            title={t.playBubble()}
            onclick={() => previewBubbleSound($bubbleSound)}><IconUnMute font-size="16" aria-hidden="true" /></button
        >
    </PrefSelect>
    <PrefToggle
        title={t.chatSounds()}
        hint={t.chatSoundsHint()}
        checked={$chatSounds}
        onchange={(on) => chatSounds.set(on)}
    />
</PrefSection>
