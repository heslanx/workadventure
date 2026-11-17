<script lang="ts">
    import CopyIcon from "../Icons/CopyIcon.svelte";
    import ExternalLinkIcon from "../Icons/ExternalLinkIcon.svelte";
    import XIcon from "../Icons/XIcon.svelte";
    import type { CoWebsite } from "../../WebRtc/CoWebsite/CoWebsite";
    import LoaderIcon from "../Icons/LoaderIcon.svelte";
    import PopUpCopyUrl from "../PopUp/PopUpCopyUrl.svelte";
    import { popupStore } from "../../Stores/PopupStore";
    import { toastStore } from "../../Stores/ToastStoreSingleton";
    import TextToast from "../Toasts/TextToast.svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { scriptUtils } from "../../Api/ScriptUtils";

    interface Props {
        coWebsite: CoWebsite;
        isLoading?: boolean;
        active?: boolean;
        onclick?: () => void;
        onclose?: () => void;
        oncopy?: () => void;
    }

    let { coWebsite, isLoading = false, active = false, onclick, onclose, oncopy }: Props = $props();

    function closeTab() {
        onclose?.();
        analyticsClient.closeCowebsite();
    }

    function select() {
        onclick?.();
        analyticsClient.trackAdminEvent("cowebsite.switched");
    }

    /**
     * The URL a human should get: a co-website may hold an embed-only link (Klaxoon's
     * `from=embedded`, Google's embed form), which is not what you want to paste into a
     * browser or hand to a colleague.
     */
    function baseUrl(): string {
        return scriptUtils.getWebsiteUrl(coWebsite.getUrl().toString());
    }

    function copyUrl() {
        const url = baseUrl();

        // "Copied" only once the browser accepted it; a refused clipboard gets its own message.
        navigator.clipboard
            .writeText(url)
            .then(() => {
                analyticsClient.trackAdminEvent("cowebsite.link_copied");
                oncopy?.();
                popupStore.addPopup(PopUpCopyUrl, {}, "popupCopyUrl");
            })
            .catch((error: unknown) => {
                console.error("Could not copy the co-website URL", error);
                toastStore.addToast(TextToast, { message: $LL.notification.copyFailed(), theme: "error" });
            });
    }

    function openInNewTab() {
        const url = baseUrl();

        window.open(url, "_blank");
        analyticsClient.trackAdminEvent("cowebsite.opened_in_new_tab");
        if (coWebsite.shouldCloseOnOpenInNewTab()) closeTab();
    }
</script>

<!-- The tab is the select button only: the copy, open and close actions are its siblings, not nested in it. -->
<div
    class="text h-full flex items-center px-2 rounded transition-all hover:stroke-white {active
        ? 'text-contrast bg-white hover:bg-white/90 tab justify-between' // translate-y-2 rounded-b-none for animation but not working inside dropdown
        : 'text-white bg-white/10 hover:bg-white/20 tab'}"
>
    <button
        type="button"
        role="tab"
        aria-selected={active}
        class="flex items-center grow min-w-0 h-full text-start cursor-pointer"
        onclick={select}
    >
        {#if !isLoading}
            <img draggable="false" src={coWebsite.getIcon()} alt="" class="h-6 w-6 bg-black rounded-lg align-middle" />
        {:else}
            <div class="h-6 w-6 animate-pulse rounded-sm {active ? 'bg-contrast/10' : 'bg-white/20'}">
                <LoaderIcon
                    size="24"
                    color1={active ? "stroke-contrast" : "stroke-white"}
                    color2={active ? "stroke-contrast" : "stroke-white"}
                />
            </div>
        {/if}

        <div class="p-2 grow text-ellipsis overflow-hidden">
            <div
                class="bold leading-3 text-ellipsis pb-1 pt-1 max-w-[150px] whitespace-nowrap overflow-hidden {active
                    ? 'fill-white'
                    : ''}"
                title={coWebsite.getTitle()}
            >
                {#if !isLoading}
                    {coWebsite.getTitle()}
                {:else}
                    <div
                        class="w-[100px] h-2 animate-pulse rounded-sm {active ? 'bg-contrast/10' : 'bg-white/20'}"
                    ></div>
                {/if}
            </div>
            {#if !coWebsite.getHideUrl()}
                <div class="text-xxs opacity-70 text-ellipsis max-w-[150px] whitespace-nowrap overflow-hidden">
                    {#if !isLoading}
                        {coWebsite.getUrl()}
                    {:else}
                        <div
                            class="w-[150px] h-1 mt-1 animate-pulse rounded-sm {active
                                ? 'bg-contrast/10'
                                : 'bg-white/20'}"
                        ></div>
                    {/if}
                </div>
            {/if}
        </div>
    </button>

    <div class="flex gap-0.5">
        {#if !coWebsite.getHideUrl()}
            <button
                type="button"
                aria-label={$LL.menu.invite.copy()}
                class="group {active
                    ? 'hover:bg-contrast/10'
                    : 'hover:bg-white/10'} transition-all aspect-ratio h-8 w-8 rounded flex items-center justify-center"
                onclick={(event) => {
                    event.stopPropagation();
                    copyUrl();
                }}
            >
                <CopyIcon
                    height="h-6"
                    width="w-6"
                    strokeColor={active ? "stroke-contrast" : "stroke-white"}
                    hover={active ? "" : ""}
                />
            </button>
        {/if}
        {#if !coWebsite.getHideUrl()}
            <button
                type="button"
                aria-label={$LL.chat.imagePreview.openInNewTab()}
                class="group {active
                    ? 'hover:bg-contrast/10'
                    : 'hover:bg-white/10'} transition-all aspect-ratio h-8 w-8 rounded flex items-center justify-center"
                onclick={(event) => {
                    event.stopPropagation();
                    openInNewTab();
                }}
            >
                <ExternalLinkIcon
                    height="h-6"
                    width="w-6"
                    strokeColor={active ? "stroke-contrast" : "stroke-white"}
                    hover={active ? "" : ""}
                />
            </button>
        {/if}
        {#if coWebsite.isClosable() === true}
            <button
                type="button"
                aria-label={$LL.cowebsite.close()}
                class="group {active
                    ? 'hover:bg-contrast/10'
                    : 'hover:bg-white/10'} transition-all aspect-ratio h-8 w-8 rounded flex items-center justify-center"
                onclick={(event) => {
                    event.stopPropagation();
                    closeTab();
                }}
            >
                <XIcon
                    height="h-6"
                    width="w-6"
                    strokeColor={active ? "stroke-contrast" : "stroke-white"}
                    hover={active ? "" : ""}
                />
            </button>
        {/if}
    </div>
</div>

<style>
    .tab {
        width: 300px;
    }

    @media (max-width: 768px) {
        .tab {
            width: 220px;
            padding-right: 1.5rem;
        }
    }
</style>
