<script lang="ts">
    import { get } from "svelte/store";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { walkNoticeStore } from "../stores/presenceCommands";

    // What the shell says about the walk the people panel started ("going to Ana", or that it could not ask). It is drawn
    // twice. The shell holds one live region that stays on the page while the shell does, so the words are announced
    // even when the sheet that started the walk has closed over the map (`live`). The panel shows the same words to the
    // eye, hidden from assistive technology so that nothing is read twice. A notice still in the store when the panel
    // opens was said of an earlier walk (a phone closes the sheet as the walk starts, and the notice outlives it for a few
    // seconds): the eye is not shown it again, only a notice raised while the panel is open.
    let { live = false }: { live?: boolean } = $props();

    const carried = get(walkNoticeStore);
    let notice = $derived(!live && $walkNoticeStore === carried ? undefined : $walkNoticeStore);
    let text = $derived(
        notice === undefined
            ? ""
            : notice.kind === "going"
              ? $LL.konclui.peopleList.going({ name: notice.name })
              : $LL.konclui.peopleList.goFailed({ name: notice.name }),
    );
</script>

{#if live}
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-walk-notice-live>{text}</p>
{:else}
    <p class="walk" aria-hidden="true" data-walk-notice>{text}</p>
{/if}

<style>
    .walk {
        min-height: 1.5em;
        margin: 0 18px 12px;
        color: var(--k-fg-2);
        font-size: 13px;
        line-height: 1.5;
    }
</style>
