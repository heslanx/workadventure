<script lang="ts">
    import ActionBarButton from "../../../Components/ActionBar/ActionBarButton.svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { blockMapAudio } from "../../Preferences/stores/soundSettings";
    import { IconMute, IconUnMute } from "@wa-icons";

    // The dock's always-present ambient sound toggle, as the reference keeps it: it mutes and unmutes the map's music
    // and sounds through the same setting the sounds pane writes (`blockMapAudio`). Upstream's music button only
    // exists while an area plays a track, so without this the user has no ambient control on the dock. Off is a state,
    // not an error: the button is never red, and `aria-pressed` tells it, with the icon.
    let on = $derived(!$blockMapAudio);
</script>

<ActionBarButton
    onclick={() => blockMapAudio.set(on)}
    classList="group/btn-ambient-sound"
    tooltipTitle={$LL.konclui.ambientSound()}
    ariaLabel={$LL.konclui.ambientSound()}
    pressed={on}
    dataTestId="ambient-sound-button"
>
    {#if on}
        <IconUnMute font-size="20" aria-hidden="true" />
    {:else}
        <IconMute font-size="20" aria-hidden="true" />
    {/if}
</ActionBarButton>
