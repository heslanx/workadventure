<script lang="ts">
    import { get } from "svelte/store";
    import { refreshPromptStore } from "../Stores/RefreshPromptStore";
    import { liveAnnouncementStore } from "../Stores/LiveAnnouncementStore";
    import { focusTrap } from "../Utils/focusTrap";
    import { LL } from "../../i18n/i18n-svelte";
    import Button from "./UI/Button.svelte";

    let timeToRefreshSeconds = $state($refreshPromptStore?.timeToRefresh ?? 30);
    // "Not now" turns the full-screen prompt into a small banner and stops the automatic reload: from then on the
    // page refreshes only when the user chooses to.
    let postponed = $state(false);

    const idPrefix = $props.id();
    const titleId = `${idPrefix}-title`;
    const descriptionId = `${idPrefix}-description`;
    const countdownId = `${idPrefix}-countdown`;

    function refresh() {
        window.location.reload();
    }

    function postpone() {
        postponed = true;
        liveAnnouncementStore.announce(get(LL).refreshPrompt.postponedMessage());
    }

    $effect(() => {
        if (postponed) return;
        const interval = setInterval(() => {
            if (timeToRefreshSeconds <= 0) {
                clearInterval(interval);
                refresh();
            } else {
                timeToRefreshSeconds--;
            }
        }, 1000);
        return () => clearInterval(interval);
    });

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            postpone();
        }
    }
</script>

{#if postponed}
    <div
        class="fixed bottom-4 left-1/2 z-[10000] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-white/20 bg-contrast/95 px-4 py-3 text-white shadow-lg backdrop-blur pointer-events-auto"
        data-testid="refresh-prompt-banner"
    >
        <p class="m-0 text-sm">{$LL.refreshPrompt.postponedMessage()}</p>
        <Button variant="light" size="sm" class="shrink-0" dataTestId="refresh-prompt-refresh" onclick={refresh}>
            {$LL.refreshPrompt.refresh()}
        </Button>
    </div>
{:else}
    <div class="grid place-items-center h-dvh refresh min-w-full w-screen bg-contrast">
        <div
            class="px-10 py-80 flex items-center flex-col gap-4 text-center max-w-3xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby="{descriptionId} {countdownId}"
            tabindex="-1"
            onkeydown={onKeyDown}
            use:focusTrap
            data-testid="refresh-prompt"
        >
            <p id={titleId} class="m-0 text-3xl" data-testid="refresh-prompt-title">
                {$LL.mapEditor.map.refreshPrompt()}
            </p>
            <p id={descriptionId} class="m-0 text-base text-white/80">{$LL.refreshPrompt.reason()}</p>
            <!-- Not a live region: a number that changes every second would be read out every second. The dialog
                 states the delay once, when it opens. -->
            <p
                id={countdownId}
                class="m-0 text-base text-white/80"
                aria-live="off"
                data-testid="refresh-prompt-countdown"
            >
                {$LL.refreshPrompt.countdown({ seconds: timeToRefreshSeconds })}
            </p>
            <!-- "Not now" comes first so it takes the focus: the safe choice is the default one. -->
            <div class="flex flex-wrap justify-center gap-3 pt-2">
                <Button
                    variant="light"
                    appearance="border"
                    class="min-h-11 px-3"
                    dataTestId="refresh-prompt-not-now"
                    onclick={postpone}
                >
                    {$LL.refreshPrompt.notNow()}
                </Button>
                <Button variant="light" class="min-h-11 px-3" dataTestId="refresh-prompt-refresh" onclick={refresh}>
                    {$LL.refreshPrompt.refresh()}
                </Button>
            </div>
        </div>
    </div>
{/if}

<style>
    .refresh {
        pointer-events: auto;
        color: white;
        z-index: 10000 !important;
        position: absolute !important;
        font-family: "Roboto", sans-serif;
    }
</style>
