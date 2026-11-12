<script lang="ts">
    import { onMount } from "svelte";
    import { SvelteMap } from "svelte/reactivity";
    import { get, type Writable } from "svelte/store";
    import { currentRoomStore } from "../../Stores/CurrentRoomStore";
    import { chatVisibilityStore } from "../../Stores/ChatStore";
    import { silentStore } from "../../Stores/MediaStore";
    import {
        inExternalServiceStore,
        myCameraStore,
        myMicrophoneStore,
        proximityMeetingStore,
    } from "../../Stores/MyMediaStore";
    import { mediaSettingsOpenStore, openedMenuStore, rightActionBarMenuItems } from "../../Stores/MenuStore";
    import { screenSharingAvailableStore } from "../../Stores/ScreenSharingStore";
    import { isInRemoteConversation } from "../../Stores/StreamableCollectionStore";
    import { pictureInPictureSupportedStore } from "../../Stores/PeerStore";
    import ContextualMenuItems from "../ActionBar/MenuIcons/ContextualMenuItems.svelte";
    import MicrophoneMenuItem from "../ActionBar/MenuIcons/MicrophoneMenuItem.svelte";
    import CameraMenuItem from "../ActionBar/MenuIcons/CameraMenuItem.svelte";
    import ScreenSharingMenuItem from "../ActionBar/MenuIcons/ScreenSharingMenuItem.svelte";
    import PictureInPictureMenuItem from "../ActionBar/MenuIcons/PictureInPictureMenuItem.svelte";
    import ProfileMenu from "../ActionBar/MenuIcons/ProfileMenu.svelte";
    import ChatMenuItem from "../ActionBar/MenuIcons/ChatMenuItem.svelte";
    import CloseChatMenuItem from "../ActionBar/MenuIcons/CloseChatMenuItem.svelte";
    import MediaSettingsList from "../ActionBar/MediaSettingsList/MediaSettingsList.svelte";
    import SilentBlock from "../ActionBar/SilentBlock.svelte";
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

    function openProfileWithKeyboard(event: KeyboardEvent) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openedMenuStore.toggle("profileMenu");
        }
    }
</script>

<div class="dock-stack">
    <div class="dock" role="group" aria-label="Controles do escritório" data-testid="konclui-dock">
        <div class="dock-controls">
            {#if !$chatVisibilityStore}
                <ChatMenuItem chatEnabledInAdmin={$currentRoomStore?.isChatEnabled ?? false} last />
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
                aria-label="Configurações de câmera e microfone"
                aria-expanded={$mediaSettingsOpenStore}
                data-testid="media-settings-toggle-button"
                onclick={() => mediaSettingsOpenStore.set(!$mediaSettingsOpenStore)}
                ><IconSettings font-size="18" /></button
            >
        </div>
        <div
            class="dock-profile"
            role="button"
            tabindex="0"
            aria-label="Abrir perfil"
            aria-expanded={$openedMenuStore === "profileMenu"}
            onkeydown={openProfileWithKeyboard}
        >
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
        border-radius: 16px;
        border: 1px solid #2d3746;
        background: var(--office-glass);
        box-shadow: 0 4px 12px #0003;
        box-sizing: border-box;
        color: var(--office-fg);
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
    .dock-profile:focus-visible,
    .dock :global(button:focus-visible) {
        outline: 2px solid var(--office-accent);
        outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
        .dock :global(*) {
            animation-duration: 0s !important;
            transition-duration: 0s !important;
        }
    }
</style>
