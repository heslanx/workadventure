<script lang="ts">
    import { gameManager } from "../../Phaser/Game/GameManager";
    import LL from "../../../i18n/i18n-svelte";
    import { navChat } from "../Stores/ChatStore";
    interface Props {
        searchActive: boolean;
    }

    let { searchActive = false }: Props = $props();
    const gameScene = gameManager.getCurrentGameScene();
    const userWorldCount = gameScene.worldUserCounter;
    // navChat.switchToUserList() is a no-op when the world disables both lists, so only offer the door when it opens.
    const canOpenUserList = gameScene.room.isChatOnlineListEnabled || gameScene.room.isChatDisconnectedListEnabled;
</script>

{#snippet count()}
    <span
        class="text-xs aspect-square min-w-5 h-5 px-1 border border-solid border-success flex items-center justify-center font-bold rounded"
    >
        {$userWorldCount}
    </span>
    <span class="text-xs font-bold">{$userWorldCount === 1 ? $LL.chat.userOnline() : $LL.chat.usersOnline()}</span>
{/snippet}

<!-- From the conversations, the count is a door to the list of the people it counts. -->
{#if $navChat.key === "chat" && canOpenUserList}
    <button
        type="button"
        class="hit-area m-0 px-1 py-0.5 flex items-center justify-center gap-1 text-success space-x-1.5 bg-transparent border-0 rounded cursor-pointer hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white {searchActive
            ? 'hidden'
            : ''}"
        onclick={() => navChat.switchToUserList()}
    >
        {@render count()}
    </button>
{:else}
    <div class="flex items-center justify-center gap-1 text-success space-x-1.5 {searchActive ? 'hidden' : ''}">
        {@render count()}
    </div>
{/if}
