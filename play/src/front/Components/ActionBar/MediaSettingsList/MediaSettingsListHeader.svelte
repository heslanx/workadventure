<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";

    interface Props {
        mode?: "settings" | "background";
    }

    let { mode = $bindable<"settings" | "background">() }: Props = $props();

    if (mode === undefined) {
        mode = "settings";
    }

    // Content-sized, so both labels fit the popover side by side; a label longer than its share wraps to a second
    // line inside the 36 px segment rather than running past the rim.
    const segment =
        "flex min-h-9 min-w-0 flex-auto items-center justify-center rounded border-0 px-1.5 py-1 text-center text-sm font-semibold leading-tight text-balance transition-colors";
    const selected = "bg-(--k-hover) text-(--k-fg)";
    const idle = "bg-transparent text-(--k-fg-2) hover:bg-(--k-elevated) hover:text-(--k-fg)";
</script>

<div class="flex shrink-0 gap-0.5 rounded-(--k-radius-control) bg-(--k-card) p-0.5">
    <button
        type="button"
        class="{segment} {mode === 'settings' ? selected : idle}"
        aria-pressed={mode === "settings"}
        onclick={() => {
            mode = "settings";
        }}
    >
        {$LL.actionbar.background.settings()}
    </button>
    <button
        type="button"
        class="{segment} {mode === 'background' ? selected : idle}"
        aria-pressed={mode === "background"}
        data-testid="background-settings-tab"
        onclick={() => {
            mode = "background";
            analyticsClient.trackAdminEvent("settings.background.opened");
        }}
    >
        {$LL.actionbar.background.cameraBackground()}
    </button>
</div>
