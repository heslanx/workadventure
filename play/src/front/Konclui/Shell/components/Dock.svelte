<script lang="ts">
    import { onMount } from "svelte";
    import { SvelteMap } from "svelte/reactivity";
    import { get, type Writable } from "svelte/store";
    import { chatVisibilityStore } from "../../../Stores/ChatStore";
    import { audioManagerVisibilityStore } from "../../../Stores/AudioManagerStore";
    import { bottomActionBarVisibilityStore } from "../../../Stores/BottomActionBarStore";
    import { currentPlayerGroupLockStateStore } from "../../../Stores/CurrentPlayerGroupStore";
    import { currentPlayerLockableAreasStore } from "../../../Stores/CurrentPlayerAreaLockStore";
    import { followStateStore } from "../../../Stores/FollowStore";
    import { gameSceneStore } from "../../../Stores/GameSceneStore";
    import { requestedMegaphoneStore } from "../../../Stores/MegaphoneStore";
    import { onboardingStore } from "../../../Stores/OnboardingStore";
    import { raiseHandAvailableStore } from "../../../Stores/RaiseHandAvailabilityStore";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { inLivekitStore, silentStore } from "../../../Stores/MediaStore";
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
    import AppsMenuItem from "../../../Components/ActionBar/MenuIcons/AppsMenuItem.svelte";
    import EmojiMenuItem from "../../../Components/ActionBar/MenuIcons/EmojiMenuItem.svelte";
    import FollowMenuItem from "../../../Components/ActionBar/MenuIcons/FollowMenuItem.svelte";
    import LockDiscussionMenuItem from "../../../Components/ActionBar/MenuIcons/LockDiscussionMenuItem.svelte";
    import MegaphoneMenuItem from "../../../Components/ActionBar/MenuIcons/MegaphoneMenuItem.svelte";
    import MusicMenuItem from "../../../Components/ActionBar/MenuIcons/MusicMenuItem.svelte";
    import RaiseHandMenuItem from "../../../Components/ActionBar/MenuIcons/RaiseHandMenuItem.svelte";
    import RecordingMenuItem from "../../../Components/ActionBar/MenuIcons/RecordingMenuItem.svelte";
    import { createRecordingMenuStateStore } from "../../../Components/ActionBar/MenuIcons/RecordingMenuUtils";
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
    import AmbientSoundButton from "../../Focus/components/AmbientSoundButton.svelte";
    import DeskButton from "../../Focus/components/DeskButton.svelte";
    import FocusChip from "../../Focus/components/FocusChip.svelte";
    import { navChat } from "../../../Chat/Stores/ChatStore";
    import { shellRoomStore } from "../stores/shellStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { IconChevronUp } from "@wa-icons";

    // The place's own actions are drawn here, one by one, and not through upstream's ContextualMenuItems: that block
    // is one run (music, reactions, apps, follow, lock...), and the dock needs the reactions before the conversation
    // and the rest after the desk, in the DOM, so the tab order is the order on screen. The conditions below are
    // ContextualMenuItems' own: a test keeps the two lists of controls the same.
    // Upstream reads these once, when the bar is built, and so does the dock. Without a scene there is no space to
    // record in, so the control is not shown (it could not act).
    const recordingMenuState = (() => {
        const scene = get(gameSceneStore);
        if (scene === undefined) return undefined;
        const recording = get(shellRoomStore)?.recording;
        return createRecordingMenuStateStore(scene.spaceRegistry, {
            canStartRecording: localUserStore.isLogged() && recording?.buttonState === "enabled",
            isUserLoggedIn: localUserStore.isLogged(),
            roomButtonState: recording?.buttonState,
        });
    })();

    let dockElement = $state<HTMLElement>();
    let stackElement = $state<HTMLElement>();

    /** The chip leaves while it holds the key focus: the profile button is the control that owns the user's state. */
    function focusProfile(): void {
        dockElement?.querySelector<HTMLElement>('.dock-profile [role="button"]')?.focus();
    }

    // The map's action messages stand on the bottom edge (upstream's popup stack): the stack's height is published so they
    // can stand above the dock and its chips and not over them. One element is observed, and the property is removed
    // with the dock.
    onMount(() => {
        const stack = stackElement;
        if (stack === undefined) return;
        const root = document.documentElement;
        const publish = (): void => {
            root.style.setProperty("--konclui-dock-stack-height", `${stack.getBoundingClientRect().height}px`);
        };
        const observer = new ResizeObserver(publish);
        observer.observe(stack);
        publish();
        return () => {
            observer.disconnect();
            root.style.removeProperty("--konclui-dock-stack-height");
        };
    });

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

<div class="dock-stack" bind:this={stackElement}>
    <!-- The stack is anchored to the bottom, so the chip rises above the dock and moves nothing else. -->
    <CallIndicator />
    <FocusChip returnFocus={focusProfile} />
    <div
        class="dock"
        role="group"
        aria-label={$LL.konclui.dockLabel()}
        data-testid="konclui-dock"
        bind:this={dockElement}
    >
        <!-- The reference's order: who you are, what others hear and see of you, then what you do. -->
        <!-- The profile menu draws its own button, with its name, state and keys: the wrapper only sizes it. -->
        <div class="dock-profile">
            <ProfileMenu showContextualMenuItems={false} />
        </div>
        <div class="dock-controls">
            <!-- The reference's order, which is also the DOM order (the tab order follows what is seen): you, what
                 others hear and see of you, then the reaction, the conversation and your desk, and the rest of the
                 place's tools (the sound, the lock, the follow). -->
            <div class="dock-devices">
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
            </div>
            <EmojiMenuItem />
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
            <DeskButton />
            <!-- The ambient sound toggle is always there (upstream's music button is only while a track plays), and it
                 is the control that turns the sounds back on: while the settings have them off, upstream's music
                 buttons would only repeat that, so they are not drawn. -->
            <AmbientSoundButton />
            {#if $audioManagerVisibilityStore !== "hidden" && $audioManagerVisibilityStore !== "disabledBySettings"}
                <MusicMenuItem />
            {/if}
            <AppsMenuItem />
            {#if ($bottomActionBarVisibilityStore && !$inLivekitStore) || $followStateStore !== "off"}
                <FollowMenuItem />
            {/if}
            {#if $currentPlayerLockableAreasStore.length > 0 || ($bottomActionBarVisibilityStore && !$inLivekitStore && $currentPlayerGroupLockStateStore !== undefined) || $onboardingStore === "lockBubble"}
                <LockDiscussionMenuItem />
            {/if}
            {#if recordingMenuState !== undefined && $recordingMenuState?.shouldDisplayButton}
                <RecordingMenuItem {recordingMenuState} />
            {/if}
            {#if $requestedMegaphoneStore}
                <MegaphoneMenuItem />
            {/if}
            {#if !$inExternalServiceStore && $raiseHandAvailableStore}
                <RaiseHandMenuItem />
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
    .dock-devices {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    /* The wrappers a button draws around itself: the dock is their surface, so they keep neither fill nor padding.
       Only the dock's own children are meant: a popup the buttons open (reactions, apps) keeps its own surface. */
    .dock-controls > :global(div:has(> button)),
    .dock-devices > :global(div:has(> button)) {
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
    /* !important: during a call upstream's .profile-menu-force-burger rules (ProfileMenu.svelte) are !important too, and
       only an !important rule of higher specificity beats them. The dock keeps the full button in a call. */
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
    /* The dock sits on the bottom edge: the reason a button gives for doing nothing opens above it, not below. */
    .dock-controls :global([data-testid$="-blocked-reason"]) {
        top: auto;
        bottom: calc(100% + 4px);
        margin-top: 0;
        max-width: min(16rem, calc(100vw - 24px));
    }
    /*
     * The reason opens from the start edge of its button. The last buttons of the dock stand in the right part of the
     * screen, where a reason that wide would run off it: theirs opens from the end edge, toward the middle. A phone
     * centers it on the dock instead (below).
     */
    @media (min-width: 768px) {
        .dock-controls > :global(div:nth-last-child(-n + 6)) :global([data-testid$="-blocked-reason"]) {
            inset-inline: auto 0;
        }
    }
    /*
     * The upstream stack of the map's action messages (MainLayout.svelte) stands on the bottom edge, where the dock is.
     * While the dock is on the page it stands above the dock and its chips: Dock publishes the stack's height.
     */
    :global(body:has([data-testid="konclui-dock"]) .popups) {
        margin-bottom: calc(var(--konclui-dock-stack-height, 76px) + 8px);
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
        /*
         * A reason is anchored to its button, which on a phone can be near the right edge: it would run off the screen.
         * A button that is giving a reason stops being the anchor, so the reason is placed against the dock, centered
         * and no wider than the dock.
         */
        .dock-controls :global(div:has(> [data-testid$="-blocked-reason"])) {
            position: static;
        }
        .dock-controls :global([data-testid$="-blocked-reason"]) {
            inset-inline: 0;
            margin-inline: auto;
            max-width: calc(100% - 12px);
        }
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
        /* !important: the standard reduced-motion reset must also win over the upstream buttons' own animation and
           transition rules, whatever their specificity. */
        .dock :global(*) {
            animation-duration: 0s !important;
            transition-duration: 0s !important;
        }
    }
</style>
