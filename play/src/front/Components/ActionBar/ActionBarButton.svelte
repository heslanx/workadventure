<script lang="ts">
    import type { Snippet } from "svelte";
    import { getContext } from "svelte";
    import type { Action } from "svelte/action";
    import HelpTooltip from "../Tooltip/HelpTooltip.svelte";
    import { helpTextDisabledStore } from "../../Stores/MenuStore";

    interface Props {
        label?: string;
        tooltipTitle?: string;
        tooltipDesc?: string;
        disabledHelp?: boolean;
        tooltipDelay?: number;
        state?: "normal" | "active" | "forbidden" | "live" | "disabled" | "disabledForbidden";
        // Held off by the user's status (busy, away...): a dimmed icon, a dot of this status color, no click...
        statusDot?: string;
        // ...unless a click ends what holds it (away mode).
        statusDotClickable?: boolean;
        // Why a disabled or held-off button does nothing, in one line that points to the way out. With it the
        // button stays focusable (aria-disabled) and a click or Enter shows this line instead of being swallowed.
        blockedReason?: string;
        // The name of an icon-only button (a menu row is named by its text).
        ariaLabel?: string;
        // On/off state of a toggle (camera, microphone), so the state is not told by the background colour alone.
        pressed?: boolean;
        dataTestId?: string;
        classList?: string;
        hideIconInActionBar?: boolean;
        bgColor?: string;
        textColor?: string;
        isGradient?: boolean;
        hasImage?: boolean;
        action?: Action;
        onclick?: (event: MouseEvent) => void;
        onkeydown?: (event: KeyboardEvent) => void;
        onmouseenter?: (event: MouseEvent) => void;
        onmouseleave?: (event: MouseEvent) => void;
        media?: string;
        desc?: string;
        tooltipShortcuts?: string[];
        boldLabel?: boolean;
        wrapperDiv?: HTMLElement;
        // By default, the button will have a rounded corner on the left if it is the first of a div.
        // This behaviour can be overridden by setting the "first" prop to true or false explicitly.
        // Used for the responsive menu items.
        first?: boolean;
        // By default, the button will have a rounded corner on the right if it is the last of a div.
        // This behaviour can be overridden by setting the "last" prop to true or false explicitly.
        // Used for the responsive menu items.
        last?: boolean;
        // Can be used to force the context. If not set, the context is deduced from the "inMenu" Svelte context.
        context?: "actionBar" | "menu";
        children?: Snippet;
        tooltip?: Snippet;
        end?: Snippet;
    }

    let {
        label = undefined,
        tooltipTitle = "",
        tooltipDesc = "",
        disabledHelp = false,
        tooltipDelay = 500,
        state: buttonState = "normal",
        statusDot = undefined,
        statusDotClickable = false,
        blockedReason = undefined,
        ariaLabel = undefined,
        pressed = undefined,
        dataTestId = undefined,
        classList = "group",
        hideIconInActionBar = false,
        bgColor = undefined,
        textColor = undefined,
        isGradient = false,
        hasImage = true,
        action = () => {},
        onclick = undefined,
        onkeydown = undefined,
        onmouseenter = undefined,
        onmouseleave = undefined,
        media = "",
        desc = "",
        tooltipShortcuts = [],
        boldLabel = false,
        wrapperDiv = $bindable(),
        first = undefined,
        last = undefined,
        context = undefined,
        children,
        tooltip,
        end,
    }: Props = $props();

    let isInMenu = $derived(context !== undefined ? context === "menu" : getContext("inMenu"));
    // In the desktop mini window's header: smaller buttons without the bar around them, and the browser's own
    // tooltip, as the help tooltip does not fit such a small window.
    const compact = getContext("compactActionBar") === true;
    let heldOff = $derived(statusDot !== undefined && !statusDotClickable);
    // Red fills take white text from the theme; darkLabel is for the green live state.
    let darkLabel = $derived(
        buttonState === "forbidden" || buttonState === "disabledForbidden" || buttonState === "live",
    );
    // An icon-only button is named by its tooltip title when nothing else names it.
    let accessibleName = $derived(ariaLabel ?? (label ? undefined : tooltipTitle || undefined));
    // The help tooltip's text, without its video or image and the text that goes with them.
    let nativeTitle = $derived((media ? tooltipTitle : [tooltipTitle, desc].filter(Boolean).join("\n")) || ariaLabel);

    let helpActive = $state(false);

    let blocked = $derived(buttonState === "disabled" || buttonState === "disabledForbidden" || heldOff);
    let explained = $derived(blocked && Boolean(blockedReason));
    // A click on an explained button is still a response: it keeps the pointer cursor.
    let blockedCursor = $derived(blockedReason ? "cursor-pointer" : "cursor-not-allowed");
    const reasonId = $props.id();
    let reasonRequested = $state(false);
    let reasonShown = $derived(explained && reasonRequested);

    function handleClick(event: MouseEvent) {
        if (blocked) {
            if (blockedReason) {
                helpActive = false;
                reasonRequested = true;
            }
            return;
        }
        helpActive = false;
        onclick?.(event);
    }

    let styleVars = $derived(
        [bgColor ? `--bg-color: ${bgColor};` : "", textColor ? `--text-color: ${textColor};` : ""]
            .filter(Boolean)
            .join(" "),
    );
</script>

{#if !isInMenu}
    <div
        class={[
            "relative pointer-events-auto",
            classList,
            !compact && [
                "bg-contrast/80 backdrop-blur py-2 ps-1 pe-1 group-[.invisible]/visibilitychecker:px-2",
                {
                    "first-of-type:rounded-s-lg first-of-type:ps-2": first === undefined,
                    "last-of-type:rounded-e-lg last-of-type:pe-2": last === undefined,
                    "rounded-s-lg ps-2": first === true,
                    "rounded-e-lg pe-2": last === true,
                },
            ],
        ]}
        use:action
        style={styleVars}
        bind:this={wrapperDiv}
    >
        <button
            type="button"
            class="{compact ? 'h-9' : 'h-12 @sm/actions:h-10 @xl/actions:h-12'} p-1 m-0 rounded relative
                    {buttonState === 'disabled' ? `opacity-50 ${blockedCursor}` : ''}
                    {buttonState === 'disabledForbidden' ? `bg-danger opacity-70 ${blockedCursor}` : ''}
                    {heldOff ? blockedCursor : ''}
                    {buttonState === 'normal' && !isGradient && !heldOff ? 'hover:bg-white/10 cursor-pointer' : ''}
                    {buttonState === 'active' ? 'bg-secondary hover:bg-secondary-800 cursor-pointer' : ''}
                    {buttonState === 'forbidden' ? 'bg-danger hover:bg-danger-600 cursor-pointer' : ''}
                    {buttonState === 'live' ? 'bg-success hover:bg-success-600 cursor-pointer' : ''}
                    {!label
                ? compact
                    ? 'w-9'
                    : 'w-12 @sm/actions:w-10 @xl/actions:w-12'
                : 'px-4 text-base @sm/actions:text-sm @xl/actions:text-base whitespace-nowrap'}
                {isGradient ? 'gradient overflow-hidden font-bold' : ''}
                {bgColor && !isGradient ? 'bg-[var(--bg-color)]' : ''}
                {textColor ? 'text-[var(--text-color)]' : darkLabel ? 'text-contrast-900' : 'text-neutral-100'}
                    flex items-center justify-center gap-2 select-none"
            disabled={blocked && !blockedReason}
            aria-disabled={explained || undefined}
            aria-describedby={explained ? reasonId : undefined}
            aria-label={accessibleName}
            aria-pressed={pressed}
            title={compact ? nativeTitle : undefined}
            onclick={(event) => {
                event.preventDefault();
                handleClick(event);
            }}
            {onkeydown}
            onfocus={() => (reasonRequested = explained)}
            onblur={() => (reasonRequested = false)}
            onmouseenter={(event) => {
                helpActive = true;
                reasonRequested = explained;
                onmouseenter?.(event);
            }}
            onmouseleave={(event) => {
                helpActive = false;
                reasonRequested = false;
                onmouseleave?.(event);
            }}
            data-testid={dataTestId}
        >
            {#if !hideIconInActionBar}
                {#if statusDot}
                    <span class="flex opacity-50">{@render children?.()}</span>
                    <span
                        class="absolute top-1 end-1 h-2 w-2 rounded-full"
                        aria-hidden="true"
                        style:background-color={statusDot}
                        data-testid="status-dot"
                    ></span>
                {:else}
                    {@render children?.()}
                {/if}
            {/if}
            {#if label}<span class={boldLabel ? "font-bold" : ""}>{label}</span>{/if}
        </button>
        {#if explained}
            <!-- Read with the button (aria-describedby); shown on hover, focus, click or Enter. -->
            <span
                id={reasonId}
                class={reasonShown
                    ? "absolute top-full start-0 z-10 mt-1 w-max max-w-64 rounded bg-contrast px-2 py-1 text-xs text-white shadow-lg"
                    : "sr-only"}
                data-testid={dataTestId ? `${dataTestId}-blocked-reason` : undefined}
            >
                {blockedReason}
            </span>
        {/if}
        {#if !compact && !reasonShown && helpActive && !$helpTextDisabledStore && !disabledHelp && (tooltipTitle || tooltipDesc || tooltip)}
            <HelpTooltip
                title={tooltipTitle}
                helpMedia={media}
                {desc}
                shortcuts={tooltipShortcuts}
                delayBeforeAppear={tooltipDelay}
            >
                {@render tooltip?.()}
            </HelpTooltip>
        {/if}
    </div>
{:else}
    <button
        class="group flex p-2 gap-2 mb-1 items-center hover:bg-white/10 transition-all cursor-pointer font-bold text-sm text-neutral-100 w-full pointer-events-auto text-start rounded select-none
                    {(buttonState === 'disabled' && !blockedReason) || statusDot ? 'opacity-50' : ''}
                    {buttonState === 'disabled' || heldOff ? blockedCursor : ''}
                    {buttonState === 'disabledForbidden' ? `bg-danger opacity-70 ${blockedCursor}` : ''}
                    {buttonState === 'active' && !isGradient
            ? 'bg-secondary hover:bg-secondary-800 cursor-pointer'
            : ''}
                    {buttonState === 'forbidden' ? 'bg-danger hover:bg-danger-600 cursor-pointer' : ''}
                    {buttonState === 'live' ? 'bg-success hover:bg-success-600 cursor-pointer' : ''}
                    {isGradient ? 'gradient overflow-hidden' : ''}
                    {bgColor && !isGradient ? 'bg-[var(--bg-color)]' : ''}
                    {textColor ? 'text-[var(--text-color)]' : darkLabel ? 'text-contrast-900' : 'text-neutral-100'}
                    {isGradient ? 'relative' : ''}"
        use:action
        aria-disabled={explained || undefined}
        aria-pressed={pressed}
        onclick={handleClick}
        {onkeydown}
        {onmouseenter}
        {onmouseleave}
        style={styleVars}
        data-testid={dataTestId}
        bind:this={wrapperDiv}
    >
        {#if hasImage}
            <div
                class="transition-all w-6 h-6 aspect-square text-center flex items-center justify-center {explained &&
                buttonState === 'disabled'
                    ? 'opacity-50'
                    : ''}"
            >
                {@render children?.()}
            </div>
        {/if}
        <div class="flex flex-col min-w-0">
            <div
                class="text-start h-6 leading-4 flex items-center text-nowrap {explained && buttonState === 'disabled'
                    ? 'opacity-50'
                    : ''}"
            >
                {label ?? tooltipTitle ?? ""}
                {@render end?.()}
            </div>
            {#if explained}
                <!-- In a menu row the reason is always on show, under the label (and part of the row's name). -->
                <span
                    class="text-xs font-normal text-white/80 text-wrap leading-4"
                    data-testid={dataTestId ? `${dataTestId}-blocked-reason` : undefined}
                >
                    {blockedReason}
                </span>
            {/if}
        </div>
    </button>
{/if}

<style>
    .gradient:before {
        content: "";
        z-index: -1;
        position: absolute;
        top: 0;
        inset-inline-start: 0;
        width: 100%;
        height: 200%;
        border-radius: 100%;
        filter: blur(20px);
        /*background-color: #cdb012;*/
        background-color: var(--bg-color);
        opacity: 0.7;
        transition: all 0.5s ease-in-out;
    }

    .gradient:hover:before {
        opacity: 1;
        border-radius: 10%;
    }

    .gradient {
        border: 1px solid rgb(from var(--bg-color) r g b / 0.3);
        transition: all 0.2s ease-in-out;
    }
</style>
