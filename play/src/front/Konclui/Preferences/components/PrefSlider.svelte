<script lang="ts">
    interface Props {
        title: string;
        hint?: string;
        /** From 0 to 1. */
        value: number;
        step?: number;
        /** Called while the slider moves, for a setting that follows it live. */
        oninput?: (value: number) => void;
        /** Called once the slider is released. */
        onchange: (value: number) => void;
    }

    let { title, hint, value, step = 0.05, oninput, onchange }: Props = $props();
    const id = $props.id();
    // The value under the thumb while it moves; the setting's own value otherwise.
    let moving: number | undefined = $state(undefined);
    let percent = $derived(Math.round((moving ?? value) * 100));
</script>

<div class="k-pref-item k-pref-stack">
    <span class="k-pref-text">
        <b id="{id}-title">{title}</b>
        {#if hint}<small id="{id}-hint">{hint}</small>{/if}
    </span>
    <span class="k-pref-range">
        <input
            type="range"
            min="0"
            max="1"
            {step}
            value={moving ?? value}
            aria-labelledby="{id}-title"
            aria-describedby={hint ? `${id}-hint` : undefined}
            aria-valuetext="{percent}%"
            style:--k-pref-fill="{percent}%"
            oninput={(event) => {
                moving = Number(event.currentTarget.value);
                oninput?.(moving);
            }}
            onchange={(event) => {
                onchange(Number(event.currentTarget.value));
                moving = undefined;
            }}
        />
        <output aria-hidden="true">{percent}%</output>
    </span>
</div>
