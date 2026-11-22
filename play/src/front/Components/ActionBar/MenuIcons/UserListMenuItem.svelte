<script lang="ts">
    import { navChat } from "../../../Chat/Stores/ChatStore";
    import UsersIcon from "../../Icons/UsersIcon.svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { activeSubMenuStore, menuVisiblilityStore } from "../../../Stores/MenuStore";
    import { chatVisibilityStore } from "../../../Stores/ChatStore";
    import { gameManager } from "../../../Phaser/Game/GameManager";

    interface Props {
        state?: "normal" | "active" | "forbidden" | "disabled";
    }

    let { state: buttonState = "normal" }: Props = $props();

    function toggleUserList() {
        if (!$chatVisibilityStore) {
            menuVisiblilityStore.set(false);
            activeSubMenuStore.activateByIndex(0);
        }
        chatVisibilityStore.set(!$chatVisibilityStore);
        navChat.switchToUserList();
    }

    // The chat connection starts once the scene is playable and the browser is idle, or when the panel is opened. An
    // attempt that has not started ("idle") accepts the click: opening the panel is what starts it, and the panel
    // shows a loader until it is up. A failed attempt opens the panel too, which explains the failure and offers
    // Retry. The button stays usable while the panel is open, so the player can close it whatever the attempt does.
    const chatConnectionAttemptStore = gameManager.chatConnectionAttemptStore;
    let chatAvailable = $derived(
        $chatConnectionAttemptStore === "ready" ||
            $chatConnectionAttemptStore === "failed" ||
            $chatConnectionAttemptStore === "idle" ||
            $chatVisibilityStore,
    );
</script>

<ActionBarButton
    onclick={toggleUserList}
    classList="group/btn-users hidden @sm/actions:flex"
    tooltipTitle={$LL.actionbar.help.users.title()}
    desc={$LL.actionbar.help.users.desc()}
    state={chatAvailable ? buttonState : "disabled"}
    blockedReason={chatAvailable ? undefined : $LL.actionbar.blocked.chatConnecting()}
    dataTestId="user-list-button"
    disabledHelp={false}
    media="./static/Videos/UserList.mp4"
    tooltipShortcuts={["u"]}
>
    <UsersIcon height="h-5" width="w-5" strokeWidth="2" />
</ActionBarButton>
