<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        variant?: "primary" | "secondary" | "contrast" | "neutral" | "danger" | "warning" | "success" | "light";
        appearance?: "filled" | "border" | "ghost";
        size?: "xs" | "sm" | "lg";
        display?: "inline" | "inline-flex";
        class?: string;
        children?: Snippet;
    }

    let {
        variant = "neutral",
        appearance = "filled",
        size = "sm",
        display = "inline",
        class: className = "",
        children,
    }: Props = $props();

    // White labels miss 4.5:1 on the filled danger, warning and success chips (1.6 to 3.1:1), and a hovered secondary
    // chip is 4.0:1. Spelled out in full because Tailwind's scanner has to find these utilities in the source.
    let contrastClasses = $derived.by(() => {
        if (appearance !== "filled") return "";
        if (variant === "secondary") return "hover:bg-secondary-800";
        if (variant === "danger" || variant === "warning" || variant === "success") {
            return "[&>.chip-label]:text-contrast-900 [&>svg]:stroke-contrast-900";
        }
        return "";
    });

    // Static design-system classes, so interpolation is safe.
    let classes = $derived(
        [
            "chip",
            `chip-${size}`,
            `chip-${variant}`,
            appearance === "border" && "chip-border",
            appearance === "ghost" && "chip-ghost",
            display,
            "items-center rounded-sm",
            contrastClasses,
            className,
        ]
            .filter(Boolean)
            .join(" "),
    );
</script>

<span class={classes}>
    <span class="chip-label inline-flex items-center leading-none">{@render children?.()}</span>
</span>
