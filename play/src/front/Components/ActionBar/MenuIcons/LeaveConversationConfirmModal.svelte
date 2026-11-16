<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import Popup from "../../Modal/Popup.svelte";
    import Button from "../../UI/Button.svelte";
    import { modals } from "@wa-modals";

    interface Props {
        isOpen: boolean;
        /** Runs after the dialog closed, only when the user confirmed that they leave the room. */
        onconfirm: () => void;
    }

    let { isOpen, onconfirm }: Props = $props();
</script>

<Popup {isOpen}>
    {#snippet title()}
        <h1>{$LL.actionbar.leaveConversationConfirm.title()}</h1>
    {/snippet}
    {#snippet content()}
        <p class="w-full text-center" data-testid="leave-conversation-confirm-message">
            {$LL.actionbar.leaveConversationConfirm.message()}
        </p>
    {/snippet}
    {#snippet action()}
        <!-- Cancel comes first: it takes the focus when the dialog opens, so Enter never leaves the room by accident. -->
        <Button class="flex-1" dataTestId="leave-conversation-cancel" onclick={() => modals.close()}>
            {$LL.actionbar.cancel()}
        </Button>
        <Button
            variant="danger"
            class="flex-1"
            dataTestId="leave-conversation-confirm"
            onclick={() => {
                modals.close();
                onconfirm();
            }}
        >
            {$LL.actionbar.leaveConversationConfirm.confirm()}
        </Button>
    {/snippet}
</Popup>
