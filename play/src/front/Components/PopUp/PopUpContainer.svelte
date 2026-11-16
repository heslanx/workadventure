<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        extraClasses?: string;
        fullContent?: boolean;
        reduceOnSmallScreen?: boolean;
        showButtons?: boolean;
        children?: Snippet;
        buttons?: Snippet;
        onclick?: () => void;
    }

    let {
        extraClasses = "",
        fullContent = false,
        reduceOnSmallScreen = false,
        showButtons = true,
        children,
        buttons,
        onclick,
    }: Props = $props();

    // The game's Interact key (Space) already triggers `onclick`, so only Enter is added for a focused popup.
    function handleKeyDown(event: KeyboardEvent): void {
        if (event.key !== "Enter" || event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        onclick?.();
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
    class="popup-container bg-contrast/95 flex flex-col backdrop-blur-md text-white min-w-60 min-h-20 rounded-lg overflow-hidden transition-all animation responsive z-20 {extraClasses}"
    class:responsive={reduceOnSmallScreen}
    role={onclick ? "button" : undefined}
    tabindex={onclick ? 0 : undefined}
    {onclick}
    onkeydown={onclick ? handleKeyDown : undefined}
>
    <div class="flex items-center p-4 px-10 pointer-events-auto justify-center grow">
        <div class="text-center leading-6 responsive-message {fullContent ? 'w-full' : ''}">
            {@render children?.()}
        </div>
    </div>
    {#if showButtons && buttons}
        <!-- Design-system secondary hover (4.0:1) and danger label (3.1:1) fail 4.5:1: darker hover, dark label. -->
        <div
            class="buttons-wrapper flex items-center justify-center p-2 space-x-2 bg-contrast pointer-events-auto [&_.btn-secondary:hover:enabled]:bg-secondary-800 [&_.btn-danger]:text-contrast-900 [&_.btn-danger_.btn-label]:text-contrast-900"
        >
            {@render buttons()}
        </div>
    {/if}
</div>

<style>
    .animation {
        animation-duration: 0.5s;
        animation-name: slidein;
    }

    @keyframes slidein {
        from {
            opacity: 0;
        }

        to {
            opacity: 1;
        }
    }
</style>
