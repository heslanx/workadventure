<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { volumeProximityDiscussionStore } from "../../../Stores/PeerStore";
    import {
        musicVolume,
        previewBubbleSound,
        setBlockMapAudio,
        setBubbleSound,
        setChatSounds,
        setLowerMusicWhileTalking,
        setMusicVolume,
        setVoicesVolume,
        type BubbleSound,
    } from "../stores/soundSettings";
    import PrefSection from "./PrefSection.svelte";
    import PrefSelect from "./PrefSelect.svelte";
    import PrefSlider from "./PrefSlider.svelte";
    import PrefToggle from "./PrefToggle.svelte";
    import { IconUnMute } from "@wa-icons";

    let music = $state(musicVolume());
    let lowerMusic = $state(localUserStore.getDecreaseAudioPlayerVolumeWhileTalking());
    let blockAudio = $state(localUserStore.getBlockAudio());
    let bubble = $state<BubbleSound>(localUserStore.getBubbleSound());
    let chatSounds = $state(localUserStore.getChatSounds());

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
        checked={lowerMusic}
        onchange={(on) => {
            lowerMusic = on;
            setLowerMusicWhileTalking(on);
        }}
    />
    <PrefToggle
        title={t.blockAudio()}
        hint={t.blockAudioHint()}
        checked={blockAudio}
        onchange={(on) => {
            blockAudio = on;
            setBlockMapAudio(on);
        }}
    />
</PrefSection>
<PrefSection title={t.alerts()}>
    <PrefSelect
        title={t.bubble()}
        value={bubble}
        options={[
            { value: "ding", label: t.ding() },
            { value: "wobble", label: t.wobble() },
        ]}
        onchange={(value) => {
            if (value !== "ding" && value !== "wobble") return;
            bubble = value;
            setBubbleSound(value);
        }}
    >
        <button
            type="button"
            class="k-pref-play"
            aria-label={t.playBubble()}
            title={t.playBubble()}
            onclick={() => previewBubbleSound(bubble)}><IconUnMute font-size="16" aria-hidden="true" /></button
        >
    </PrefSelect>
    <PrefToggle
        title={t.chatSounds()}
        hint={t.chatSoundsHint()}
        checked={chatSounds}
        onchange={(on) => {
            chatSounds = on;
            setChatSounds(on);
        }}
    />
</PrefSection>
