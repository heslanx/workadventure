<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        // Omit for the design system's bare `.btn` look. Note `contrast` is NOT the same thing:
        // it layers on hover/disabled rules, and combined with ghost the design system's own
        // `.btn-ghost.btn-contrast` ends in `text-danger`, turning the button red.
        variant?: "primary" | "secondary" | "contrast" | "neutral" | "danger" | "warning" | "success" | "light";
        appearance?: "filled" | "border" | "ghost";
        size?: "xs" | "sm" | "lg";
        square?: boolean;
        inlineBlock?: boolean;
        // Renders an <a> instead of a <button>, for links that look like buttons.
        href?: string;
        type?: "button" | "submit" | "reset";
        disabled?: boolean;
        // Why the button is disabled, in one line that points to the fix. With it (or with disabledReasonId) the
        // button stays focusable (aria-disabled), a click does nothing, and the line shows under the button.
        disabledReason?: string;
        // The id of a line the caller already shows near the button, to explain it without repeating it.
        disabledReasonId?: string;
        dataTestId?: string;
        class?: string;
        onclick?: (event: MouseEvent) => void;
        // Bind to get the rendered element, e.g. as a floating-UI anchor.
        element?: HTMLElement;
        icon?: Snippet;
        notification?: Snippet;
        children?: Snippet;
        [key: string]: unknown;
    }

    let {
        variant = undefined,
        appearance = "filled",
        size = undefined,
        square = false,
        inlineBlock = false,
        href = undefined,
        type = "button",
        disabled = false,
        disabledReason = undefined,
        disabledReasonId = undefined,
        dataTestId = undefined,
        class: className = "",
        onclick = undefined,
        element = $bindable(),
        icon,
        notification,
        children,
        ...rest
    }: Props = $props();

    // Spread rather than `data-testid={dataTestId}`: an explicit attribute would win over
    // {...rest} and clobber a caller-supplied data-testid with undefined.
    let testIdAttr = $derived(dataTestId ? { "data-testid": dataTestId } : {});

    const ownReasonId = $props.id();
    let explained = $derived(disabled && Boolean(disabledReason || disabledReasonId));
    let reasonId = $derived(disabledReasonId ?? (disabledReason ? ownReasonId : undefined));
    // Set after {...rest}, so it has to carry a caller's own aria-describedby when there is no reason to add.
    let callerDescribedBy = $derived(
        typeof rest["aria-describedby"] === "string" ? rest["aria-describedby"] : undefined,
    );

    // preventDefault also stops the submit of a form, including the implicit one from Enter in a field.
    function guardedClick(event: MouseEvent): void {
        if (explained) {
            event.preventDefault();
            return;
        }
        onclick?.(event);
    }

    // The design system's label colours miss 4.5:1 on some variants: white on the danger, success and warning fills
    // (1.6 to 3.1:1), on a hovered secondary fill (4.0:1) and on neutral (3.7:1), and secondary or neutral text on a
    // dark surface (2.7 and 3.9:1). These utilities sit in a later layer than its rules, so they win. They are spelled
    // out in full because Tailwind's scanner has to find them in the source.
    let contrastClasses = $derived.by(() => {
        if (appearance === "filled") {
            if (variant === "secondary") return href ? "hover:bg-secondary-800" : "enabled:hover:bg-secondary-800";
            if (variant === "danger" || variant === "success" || variant === "warning") {
                return "text-contrast-900 [&_.btn-label]:text-contrast-900";
            }
            if (variant === "neutral") {
                const hover = href ? "hover:bg-neutral-600" : "enabled:hover:bg-neutral-600";
                return `text-contrast-900 [&_.btn-label]:text-contrast-900 ${hover}`;
            }
            return "";
        }
        if (variant === "secondary") return "text-secondary-300 [&_.btn-label]:text-secondary-300";
        if (variant === "neutral") return "text-neutral-500 [&_.btn-label]:text-neutral-500";
        return "";
    });

    // Interpolating is safe here: every entry is a static design-system `@layer components`
    // rule, not a utility that Tailwind's scanner has to find in the source.
    let classes = $derived(
        [
            "btn",
            variant && `btn-${variant}`,
            appearance === "border" && "btn-border",
            appearance === "ghost" && "btn-ghost",
            square && "btn-square",
            inlineBlock && "btn-inline-block",
            size && `btn-${size}`,
            explained && "opacity-50",
            contrastClasses,
            className,
        ]
            .filter(Boolean)
            .join(" "),
    );
</script>

{#snippet body()}
    {#if icon}
        <!-- btn-icon is only self-center: flex keeps an inline svg out of the .btn line box. -->
        <span class="btn-icon flex items-center">{@render icon()}</span>
    {/if}
    {#if children}
        <span class="btn-label">{@render children()}</span>
    {/if}
    {#if notification}
        {@render notification()}
    {/if}
{/snippet}

{#if href}
    <a
        bind:this={element}
        {...rest}
        {...testIdAttr}
        {href}
        class={classes}
        aria-disabled={disabled || undefined}
        {onclick}
    >
        {@render body()}
    </a>
{:else}
    <button
        bind:this={element}
        {...rest}
        {...testIdAttr}
        {type}
        class={classes}
        disabled={disabled && !explained}
        aria-disabled={explained || undefined}
        aria-describedby={explained ? reasonId : callerDescribedBy}
        onclick={guardedClick}
    >
        {@render body()}
    </button>
    {#if explained && disabledReason && !disabledReasonId}
        <p
            id={ownReasonId}
            class="m-0 basis-full text-xs opacity-80"
            data-testid={dataTestId ? `${dataTestId}-disabled-reason` : undefined}
        >
            {disabledReason}
        </p>
    {/if}
{/if}
