<script lang="ts">
    import type { Snippet } from "svelte";
    import { surface } from "../../../Utils/surfaceTransition";

    // One control of the zoom column, drawn as upstream's own (`ExplorerMenu.svelte`): the shared 36 px control and the
    // label that slides in on hover and on keyboard focus. A tool that cannot act at all is left out of the column by
    // its owner. One that cannot act right now gets a `reason`: it stays on the column and focusable, dimmed
    // (`aria-disabled`, never `disabled`), the label becomes the reason, and a press shows the reason where a screen
    // reader and a touch screen can see it, since neither hovers. The tool comes and goes on the surface transition: its
    // owner draws it in an {#if}, directly around this component, so the button is held, inert, for the exit.
    let {
        label,
        testid,
        onclick,
        reason,
        onblockedpress,
        children,
    }: {
        label: string;
        testid: string;
        onclick: (event: MouseEvent) => void;
        /** Why the tool does nothing now, or `undefined` while it can act. */
        reason?: string | undefined;
        /** Called when the tool is pressed while it has a reason, instead of `onclick`. */
        onblockedpress?: (() => void) | undefined;
        children: Snippet;
    } = $props();

    const reasonId = $props.id();
    let blocked = $derived(reason !== undefined);
    // Set by a press, a hover and the keyboard focus, as the dock's buttons do, and let go on blur and when the pointer
    // leaves. A tool that is free again forgets it, so the next time it is blocked the reason waits for a press.
    let requested = $state(false);
    let shown = $derived(blocked && requested);

    $effect(() => {
        if (!blocked) requested = false;
    });

    function press(event: MouseEvent): void {
        if (blocked) {
            requested = true;
            onblockedpress?.();
            return;
        }
        onclick(event);
    }
</script>

<button
    type="button"
    aria-label={label}
    aria-disabled={blocked ? "true" : undefined}
    aria-describedby={blocked ? reasonId : undefined}
    data-testid={testid}
    class="group k-control k-press"
    transition:surface
    onclick={press}
    onfocus={() => (requested = blocked)}
    onblur={() => (requested = false)}
    onmouseleave={() => (requested = false)}
>
    {@render children()}
    <div
        class="{shown
            ? 'right-11 opacity-100'
            : '-right-60 opacity-0'} group-hover:opacity-100 group-hover:right-11 group-focus-visible:opacity-100 group-focus-visible:right-11 absolute bg-contrast/90 text-sm px-2 py-1 rounded whitespace-nowrap transition-all motion-reduce:transition-none text-white pointer-events-none select-none"
        data-testid="{testid}-label"
    >
        {reason ?? label}
    </div>
    {#if blocked}
        <!-- Read with the control (aria-describedby), also while the label is slid away. -->
        <span id={reasonId} class="sr-only" data-testid="{testid}-reason">{reason}</span>
    {/if}
</button>
