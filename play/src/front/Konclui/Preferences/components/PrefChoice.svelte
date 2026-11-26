<script lang="ts">
    import { indexAfter } from "../domain/panes";

    interface Option {
        value: string;
        label: string;
        /** Why the option cannot be chosen now; it stays focusable and says so. */
        unavailable?: string;
    }

    interface Props {
        title: string;
        hint?: string;
        options: readonly Option[];
        value: string | undefined;
        onchange: (value: string) => void;
        /**
         * The chosen option was chosen again, by a click, a tap, Space or Enter (never by the arrows, which move to
         * another option). Without it, choosing the chosen option again does nothing.
         */
        onreselect?: () => void;
        /** A problem with the last change, shown in place of the hint until the next one. */
        error?: string;
    }

    let { title, hint, options, value, onchange, onreselect, error }: Props = $props();
    let note = $derived(error ?? hint);
    const id = $props.id();
    let buttons: HTMLButtonElement[] = $state([]);

    let checkedIndex = $derived(options.findIndex((option) => option.value === value));
    // One stop in the tab order: the chosen option, or the first one while none is chosen.
    let tabStop = $derived(checkedIndex === -1 ? 0 : checkedIndex);

    function choose(index: number): void {
        const option = options[index];
        if (option === undefined || option.unavailable !== undefined || option.value === value) return;
        onchange(option.value);
    }

    // The chosen option, when choosing it again is heard: it acts, so it carries the note that says how.
    function chosenAgain(index: number): boolean {
        return onreselect !== undefined && index === checkedIndex && options[index]?.unavailable === undefined;
    }

    function activate(index: number): void {
        if (chosenAgain(index)) {
            onreselect?.();
            return;
        }
        choose(index);
    }

    function keydown(event: KeyboardEvent, index: number): void {
        const next = indexAfter(index, event.key, options.length);
        if (next === undefined) return;
        event.preventDefault();
        buttons[next]?.focus();
        choose(next);
    }
</script>

<div class="k-pref-item k-pref-stack">
    <span class="k-pref-text">
        <b id="{id}-title">{title}</b>
        {#if note}<small id="{id}-hint" class:k-pref-error={error !== undefined}>{note}</small>{/if}
    </span>
    <div
        class="k-pref-seg"
        role="radiogroup"
        aria-labelledby="{id}-title"
        aria-describedby={note ? `${id}-hint` : undefined}
    >
        {#each options as option, index (option.value)}
            <button
                bind:this={buttons[index]}
                type="button"
                role="radio"
                aria-checked={index === checkedIndex}
                aria-disabled={option.unavailable === undefined ? undefined : "true"}
                aria-describedby={chosenAgain(index) && note ? `${id}-hint` : undefined}
                title={option.unavailable}
                tabindex={index === tabStop ? 0 : -1}
                onclick={() => activate(index)}
                onkeydown={(event) => keydown(event, index)}
            >
                {option.label}
            </button>
        {/each}
    </div>
</div>
