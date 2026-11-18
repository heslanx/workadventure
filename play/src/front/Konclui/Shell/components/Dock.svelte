<script lang="ts">
    import { onMount } from "svelte";
    import { SvelteMap } from "svelte/reactivity";
    import { get, type Writable } from "svelte/store";
    import { chatVisibilityStore } from "../../../Stores/ChatStore";
    import { silentStore } from "../../../Stores/MediaStore";
    import {
        inExternalServiceStore,
        myCameraStore,
        myMicrophoneStore,
        proximityMeetingStore,
    } from "../../../Stores/MyMediaStore";
    import { mediaSettingsOpenStore, rightActionBarMenuItems } from "../../../Stores/MenuStore";
    import { screenSharingAvailableStore } from "../../../Stores/ScreenSharingStore";
    import { isInRemoteConversation } from "../../../Stores/StreamableCollectionStore";
    import { pictureInPictureSupportedStore } from "../../../Stores/PeerStore";
    import ContextualMenuItems from "../../../Components/ActionBar/MenuIcons/ContextualMenuItems.svelte";
    import MicrophoneMenuItem from "../../../Components/ActionBar/MenuIcons/MicrophoneMenuItem.svelte";
    import CameraMenuItem from "../../../Components/ActionBar/MenuIcons/CameraMenuItem.svelte";
    import ScreenSharingMenuItem from "../../../Components/ActionBar/MenuIcons/ScreenSharingMenuItem.svelte";
    import PictureInPictureMenuItem from "../../../Components/ActionBar/MenuIcons/PictureInPictureMenuItem.svelte";
    import ProfileMenu from "../../../Components/ActionBar/MenuIcons/ProfileMenu.svelte";
    import ChatMenuItem from "../../../Components/ActionBar/MenuIcons/ChatMenuItem.svelte";
    import CloseChatMenuItem from "../../../Components/ActionBar/MenuIcons/CloseChatMenuItem.svelte";
    import MediaSettingsList from "../../../Components/ActionBar/MediaSettingsList/MediaSettingsList.svelte";
    import SilentBlock from "../../../Components/ActionBar/SilentBlock.svelte";
    import CallIndicator from "../../Presence/components/CallIndicator.svelte";
    import { navChat } from "../../../Chat/Stores/ChatStore";
    import { shellRoomStore } from "../stores/shellStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { IconChevronUp } from "@wa-icons";

    onMount(() => {
        const previous = new SvelteMap<Writable<boolean>, boolean>();
        const unsubscribe = rightActionBarMenuItems.subscribe((items) => {
            for (const item of items) {
                if (!previous.has(item.fallsInBurgerMenuStore)) {
                    previous.set(item.fallsInBurgerMenuStore, get(item.fallsInBurgerMenuStore));
                }
                item.fallsInBurgerMenuStore.set(true);
            }
        });
        return () => {
            unsubscribe();
            for (const [store, value] of previous) store.set(value);
        };
    });
</script>

<div class="dock-stack">
    <!-- The stack is anchored to the bottom, so the chip rises above the dock and moves nothing else. -->
    <CallIndicator />
    <div class="dock" role="group" aria-label={$LL.konclui.dockLabel()} data-testid="konclui-dock">
        <!-- The reference's order: who you are, what others hear and see of you, then what you do. -->
        <!-- The profile menu draws its own button, with its name, state and keys: the wrapper only sizes it. -->
        <div class="dock-profile">
            <ProfileMenu showContextualMenuItems={false} />
        </div>
        <div class="dock-controls">
            {#if !$inExternalServiceStore && $proximityMeetingStore && $myMicrophoneStore}
                <MicrophoneMenuItem />
            {/if}
            <button
                class="media-settings"
                type="button"
                aria-label={$LL.konclui.mediaSettings()}
                aria-expanded={$mediaSettingsOpenStore}
                data-testid="media-settings-toggle-button"
                onclick={(event) => {
                    // The panel closes on a click outside it: this click must not reach it as the first one.
                    event.stopPropagation();
                    event.preventDefault();
                    mediaSettingsOpenStore.set(!$mediaSettingsOpenStore);
                }}><IconChevronUp font-size="16" /></button
            >
            {#if !$inExternalServiceStore && $myCameraStore}
                <CameraMenuItem />
            {/if}
            {#if $screenSharingAvailableStore}
                <ScreenSharingMenuItem />
            {/if}
            {#if $isInRemoteConversation && $pictureInPictureSupportedStore}
                <PictureInPictureMenuItem />
            {/if}
            <ContextualMenuItems />
            {#if !$chatVisibilityStore}
                <ChatMenuItem chatEnabledInAdmin={$shellRoomStore?.isChatEnabled ?? false} last />
            {:else if $navChat.key === "users"}
                <!-- The panel shows the people list: the button moves it to the conversation instead of closing it. -->
                <ChatMenuItem
                    chatEnabledInAdmin={$shellRoomStore?.isChatEnabled ?? false}
                    last
                    onclick={() => chatVisibilityStore.set(true)}
                />
            {:else}
                <CloseChatMenuItem />
            {/if}
        </div>
        {#if $mediaSettingsOpenStore}
            <MediaSettingsList onclose={() => mediaSettingsOpenStore.set(false)} />
        {/if}
    </div>
    {#if $silentStore}
        <SilentBlock />
    {/if}
</div>

<style>
    .dock-stack {
        position: absolute;
        bottom: 0;
        inset-inline: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        padding: 0 8px 14px;
        box-sizing: border-box;
    }
    .dock {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        position: relative;
        width: max-content;
        max-width: 100%;
        min-height: 48px;
        padding: 6px;
        border-radius: var(--k-radius-surface);
        /* The chrome material (konclui.css): flat and opaque, the same fill as every surface over the map. */
        border: 1px solid var(--k-chrome-border);
        background: var(--k-chrome);
        -webkit-backdrop-filter: var(--k-chrome-backdrop);
        backdrop-filter: var(--k-chrome-backdrop);
        box-shadow: var(--k-chrome-shadow);
        box-sizing: border-box;
        color: var(--k-fg);
        pointer-events: auto;
    }
    .dock-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }
    .dock-controls > :global(div) {
        padding: 0;
        background: transparent;
        backdrop-filter: none;
    }
    .dock-controls :global(button[data-testid]),
    .media-settings {
        width: 36px;
        height: 36px;
        min-width: 36px;
        border-radius: 10px;
        padding: 4px;
        margin: 0;
    }
    .dock-controls :global(button > svg) {
        width: 18px;
        height: 18px;
    }
    .media-settings {
        display: flex;
        align-items: center;
        justify-content: center;
        color: inherit;
        background: transparent;
        border: 0;
        cursor: pointer;
    }
    .media-settings:hover {
        background: var(--k-hover);
    }
    /* The reference's chevron beside the microphone: a narrow button that opens the media settings. */
    .dock-controls .media-settings {
        width: 22px;
        min-width: 22px;
        color: var(--k-fg-2);
    }
    /*
     * Off is shown by the slashed icon and the button's name, as in the reference: no red fill, which read as an error
     * on a dock where off is the usual state. A device that cannot turn on keeps upstream's dimmed look.
     */
    .dock-controls :global(button.bg-danger) {
        background: transparent;
        color: var(--k-fg);
    }
    .dock-controls :global(button.bg-danger:hover) {
        background: var(--k-hover);
    }
    .dock-profile {
        flex: 0 0 auto;
        border-radius: 10px;
    }
    .dock-profile :global([data-testid="action-user"] > div) {
        height: 36px;
        padding: 0;
        background: transparent;
        backdrop-filter: none;
    }
    .dock-profile :global(.profile-menu-burger-icon) {
        display: none !important;
    }
    .dock-profile :global(.profile-menu-full) {
        display: flex !important;
        padding: 0;
        gap: 0;
    }
    .dock-profile :global(.profile-menu-full > div:not(:first-child)) {
        display: none;
    }
    .dock-profile :global(.profile-menu-full > div:first-child) {
        width: 36px;
        height: 36px;
        padding: 0;
    }
    .dock :global([data-testid="media-settings-panel"]) {
        top: auto;
        bottom: calc(100% + 10px);
    }
    .dock-profile :global([role="button"]:focus-visible),
    .dock :global(button:focus-visible) {
        outline: 2px solid var(--k-accent);
        outline-offset: 2px;
    }
    /*
     * A phone keeps the 36px buttons, so the dock stays on one row, and widens what a finger can hit to 42x44.
     * Only a button that is positioned takes the wider area: on any other one it would cover an ancestor instead.
     */
    @media (max-width: 767px) {
        .media-settings {
            position: relative;
        }
        /* A finger needs the full button: the narrow chevron is for a pointer. */
        .dock-controls .media-settings {
            width: 36px;
            min-width: 36px;
        }
        .dock-controls :global(button.relative[data-testid]::after),
        .media-settings::after {
            content: "";
            position: absolute;
            inset: -4px -3px;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .dock :global(*) {
            animation-duration: 0s !important;
            transition-duration: 0s !important;
        }
    }
</style>
