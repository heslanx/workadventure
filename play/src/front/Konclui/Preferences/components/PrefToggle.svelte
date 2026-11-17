<script lang="ts">
    interface Props {
        title: string;
        hint?: string;
        checked: boolean;
        onchange: (on: boolean) => void;
        /** Why the switch cannot act now: it stays focusable, says so in place of the hint, and does nothing. */
        unavailable?: string;
        /** A problem with the last change, shown in place of the hint until the next one. */
        error?: string;
    }

    let { title, hint, checked, onchange, unavailable, error }: Props = $props();
    const id = $props.id();
    let note = $derived(unavailable ?? error ?? hint);
</script>

<div class="k-pref-item">
    <span class="k-pref-text">
        <b id="{id}-title">{title}</b>
        {#if note}<small id="{id}-hint" class:k-pref-error={error !== undefined && unavailable === undefined}
                >{note}</small
            >{/if}
    </span>
    <button
        type="button"
        class="k-pref-switch"
        role="switch"
        aria-checked={checked}
        aria-labelledby="{id}-title"
        aria-describedby={note ? `${id}-hint` : undefined}
        aria-disabled={unavailable === undefined ? undefined : "true"}
        onclick={() => {
            if (unavailable === undefined) onchange(!checked);
        }}><i aria-hidden="true"></i></button
    >
</div>
