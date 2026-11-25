<script lang="ts">
    import { untrack } from "svelte";
    import { preferencesStore } from "../stores/preferencesStore";
    import PreferencesDialog from "./PreferencesDialog.svelte";

    let dialog = $state<ReturnType<typeof PreferencesDialog>>();
    let open = $derived($preferencesStore.open);

    // The dialog stays in the page for the length of its exit, and a dialog opened again in that time is the same one,
    // still mounted. Its own effects are paused until its exit ends, so it cannot see that it was opened again: the
    // host, which is not paused, gives it the focus. A first opening has no dialog yet, and the dialog takes the focus
    // as it is mounted.
    $effect(() => {
        if (open) untrack(() => dialog?.focusTab());
    });
</script>

{#if $preferencesStore.open}
    <PreferencesDialog bind:this={dialog} pane={$preferencesStore.pane} />
{/if}
