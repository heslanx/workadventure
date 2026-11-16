<script lang="ts">
    import { liveAnnouncementStore } from "../Stores/LiveAnnouncementStore";
</script>

<!-- Always mounted so the region exists before its first announcement. The keyed node is re-created for
     each announcement, so the same sentence twice in a row is still read. -->
<div class="sr-only" aria-live="polite" aria-atomic="true" data-testid="live-announcer">
    {#if $liveAnnouncementStore}
        {#key $liveAnnouncementStore.id}
            <span>{$liveAnnouncementStore.text}</span>
        {/key}
    {/if}
</div>
