<script lang="ts">
    import { preferencesStore } from "../stores/preferencesStore";
    import PreferencesDialog from "./PreferencesDialog.svelte";
</script>

{#if $preferencesStore.open}
    <PreferencesDialog pane={$preferencesStore.pane} />
{/if}
