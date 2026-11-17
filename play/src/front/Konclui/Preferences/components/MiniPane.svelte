<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { allowPictureInPictureStore, pictureInPictureSupportedStore } from "../../../Stores/PeerStore";
    import { isInRemoteConversation } from "../../../Stores/StreamableCollectionStore";
    import { openMiniModeNow, setAllowPictureInPicture } from "../stores/miniSettings";
    import { closePreferences } from "../stores/preferencesStore";
    import PrefRow from "./PrefRow.svelte";
    import PrefToggle from "./PrefToggle.svelte";

    // The desktop app opens its mini window at any time; a browser needs a conversation to show in it.
    const desktopWindows = window.WAD?.desktop ? window.WAD.windows : undefined;
    // Why "open now" cannot act: a browser without picture-in-picture, or no conversation to show yet.
    let openNowUnavailable = $derived.by(() => {
        if (desktopWindows !== undefined) return undefined;
        if (!$pictureInPictureSupportedStore) return $LL.konclui.preferences.mini.openNowUnsupported();
        if (!$isInRemoteConversation) return $LL.konclui.preferences.mini.openNowUnavailable();
        return undefined;
    });
</script>

<p class="k-pref-lead">{$LL.konclui.preferences.mini.lead()}</p>
<div class="k-pref-group">
    <PrefToggle
        title={$LL.konclui.preferences.mini.automatic()}
        hint={$LL.konclui.preferences.mini.automaticHint()}
        checked={$allowPictureInPictureStore}
        onchange={setAllowPictureInPicture}
    />
</div>
<PrefRow
    title={$LL.konclui.preferences.mini.openNow()}
    hint={$LL.konclui.preferences.mini.openNowHint()}
    unavailable={openNowUnavailable}
    onclick={() => {
        closePreferences();
        openMiniModeNow();
    }}
/>
