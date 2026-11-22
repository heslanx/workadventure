<script lang="ts">
    import ActionBarButton from "../ActionBarButton.svelte";
    import EmojiIcon from "../../Icons/EmojiIcon.svelte";
    import EmojiSubMenu from "../EmojiSubMenu.svelte";
    import { activeSecondaryZoneActionBarStore, openedMenuStore } from "../../../Stores/MenuStore";
    import LL from "../../../../i18n/i18n-svelte";
    import { createFloatingUiActions } from "../../../Utils/svelte-floatingui";

    let wrapperDiv: HTMLElement | undefined = $state(undefined);

    // The button that opens the menu, which is where the focus goes back to when the keyboard closes it. In a menu the
    // wrapper is the button itself.
    function focusOpener(): void {
        const opener = wrapperDiv instanceof HTMLButtonElement ? wrapperDiv : wrapperDiv?.querySelector("button");
        opener?.focus();
    }

    function toggleEmojiPicker() {
        if ($activeSecondaryZoneActionBarStore === "emote") {
            activeSecondaryZoneActionBarStore.set(undefined);
        } else {
            activeSecondaryZoneActionBarStore.set("emote");
            openedMenuStore.closeAll();
        }
    }

    const [floatingUiRef, floatingUiContent, arrowAction] = createFloatingUiActions(
        {
            placement: "bottom-start",
            //strategy: 'fixed',
        },
        8,
    );
</script>

<ActionBarButton
    onclick={() => {
        toggleEmojiPicker();
    }}
    classList="group/btn-emoji"
    tooltipTitle={$LL.actionbar.help.emoji.title()}
    state={$activeSecondaryZoneActionBarStore === "emote" ? "active" : "normal"}
    dataTestId="emoji-btn"
    action={floatingUiRef}
    bind:wrapperDiv
    media="./static/Videos/Smileys.mp4"
    desc={$LL.actionbar.help.emoji.desc()}
>
    <EmojiIcon
        height="h-5"
        width="w-5"
        strokeWidth="2"
        strokeColor={$activeSecondaryZoneActionBarStore === "emote"
            ? "stroke-contrast fill-white"
            : "stroke-white fill-transparent"}
        hover="group-hover/btn-emoji:fill-white"
    />
</ActionBarButton>
{#if $activeSecondaryZoneActionBarStore === "emote"}
    <!-- As wide as its content and no wider than the screen less the gutter (the floating position keeps 5 px, the
         padding makes it 8 on a phone): the menu does not take its width from the room left of its anchor. -->
    <div use:floatingUiContent class="absolute w-max max-w-[calc(100vw-10px)] max-sm:px-[3px]">
        <EmojiSubMenu {arrowAction} returnFocus={focusOpener} />
    </div>
{/if}
