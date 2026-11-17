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
    import { navChat } from "../../../Chat/Stores/ChatStore";
    import { shellRoomStore } from "../stores/shellStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { IconSettings } from "@wa-icons";

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
    <div class="dock" role="group" aria-label={$LL.konclui.dockLabel()} data-testid="konclui-dock">
        <div class="dock-controls">
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
            <ContextualMenuItems />
            {#if !$inExternalServiceStore && $proximityMeetingStore && $myMicrophoneStore}
                <MicrophoneMenuItem />
            {/if}
            {#if !$inExternalServiceStore && $myCameraStore}
                <CameraMenuItem />
            {/if}
            {#if $screenSharingAvailableStore}
                <ScreenSharingMenuItem />
            {/if}
            {#if $isInRemoteConversation && $pictureInPictureSupportedStore}
                <PictureInPictureMenuItem />
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
                }}><IconSettings font-size="18" /></button
            >
        </div>
        <!-- The profile menu draws its own button, with its name, state and keys: the wrapper only sizes it. -->
        <div class="dock-profile">
            <ProfileMenu showContextualMenuItems={false} />
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
        border: 1px solid var(--k-glass-border, var(--k-border-subtle));
        box-shadow: var(--k-glass-shadow, 0 4px 12px #0003);
        box-sizing: border-box;
        color: var(--k-fg);
        pointer-events: auto;
        /* The glass sits on ::before, behind the buttons and inside the dock's own stacking context. A filter on
           the dock itself would also become the backdrop root of the blur that its popovers and tooltips draw,
           and the containing block of any fixed descendant. */
        isolation: isolate;
    }
    .dock::before {
        content: "";
        position: absolute;
        /* Under the translucent border too, so the rim does not show a ring of unblurred map. */
        inset: -1px;
        z-index: -1;
        border-radius: var(--k-radius-surface);
        background: var(--k-glass);
        -webkit-backdrop-filter: var(--k-glass-backdrop);
        backdrop-filter: var(--k-glass-backdrop);
        box-shadow: var(--k-glass-edge, none);
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
        background: #ffffff1a;
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
