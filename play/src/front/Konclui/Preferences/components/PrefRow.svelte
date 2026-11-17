<script lang="ts">
    import { IconChevronRight } from "@wa-icons";

    interface Props {
        title: string;
        hint?: string;
        onclick: () => void;
        /** An action that ends something, such as logging out. */
        danger?: boolean;
        /** Why the action cannot run now: the row stays focusable, says so in place of the hint, and does nothing. */
        unavailable?: string;
    }

    let { title, hint, onclick, danger = false, unavailable }: Props = $props();
    let note = $derived(unavailable ?? hint);
</script>

<button
    type="button"
    class="k-pref-row"
    class:danger
    aria-disabled={unavailable === undefined ? undefined : "true"}
    onclick={() => {
        if (unavailable === undefined) onclick();
    }}
>
    <span class="k-pref-text">
        <b>{title}</b>
        {#if note}<small>{note}</small>{/if}
    </span>
    <IconChevronRight font-size="16" aria-hidden="true" />
</button>
