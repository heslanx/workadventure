<script lang="ts">
    import type { Snippet } from "svelte";

    interface Option {
        value: string;
        label: string;
    }

    interface Props {
        title: string;
        hint?: string;
        value: string;
        options: readonly Option[];
        onchange: (value: string) => void;
        /** Why the choice cannot change now: the list stays focusable and keeps its value. */
        unavailable?: string;
        /** A control beside the list, such as a button that plays the chosen sound. */
        children?: Snippet;
    }

    let { title, hint, value, options, onchange, unavailable, children }: Props = $props();
    const id = $props.id();
    let note = $derived(unavailable ?? hint);

    function change(event: Event & { currentTarget: HTMLSelectElement }): void {
        if (unavailable !== undefined) {
            event.currentTarget.value = value;
            return;
        }
        onchange(event.currentTarget.value);
    }
</script>

<div class="k-pref-item">
    <span class="k-pref-text">
        <b id="{id}-title">{title}</b>
        {#if note}<small id="{id}-hint">{note}</small>{/if}
    </span>
    <select
        class="k-pref-select"
        aria-labelledby="{id}-title"
        aria-describedby={note ? `${id}-hint` : undefined}
        aria-disabled={unavailable === undefined ? undefined : "true"}
        {value}
        onchange={change}
    >
        {#each options as option (option.value)}
            <option value={option.value}>{option.label}</option>
        {/each}
    </select>
    {@render children?.()}
</div>
