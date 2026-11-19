<script lang="ts">
    import { asError } from "catch-unknown";
    import ActionBarButton from "../../../Components/ActionBar/ActionBarButton.svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { isInsidePersonalAreaStore, personalAreaDataStore } from "../../../Stores/PersonalDeskStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { walkToDesk } from "../stores/deskCommands";
    import { IconDesk } from "@wa-icons";

    // The dock's "my desk", as the reference keeps it beside the other actions of the place. It exists only for a user
    // who has a desk: a button for a desk that is not there would be a dead control. At the desk it stays focusable,
    // dimmed, and says why it does nothing (the ActionBarButton's blocked reason), as the profile menu's row does.
    function goToDesk(): void {
        walkToDesk().catch((error: unknown) => {
            console.error("[konclui] focus: could not walk to the desk", asError(error));
            warningMessageStore.addWarningMessage($LL.actionbar.personalDesk.errorMoving(), { closable: true });
        });
    }
</script>

{#if $personalAreaDataStore}
    <ActionBarButton
        onclick={goToDesk}
        classList="group/btn-personal-desk"
        tooltipTitle={$LL.actionbar.personalDesk.label()}
        ariaLabel={$LL.actionbar.personalDesk.label()}
        state={$isInsidePersonalAreaStore ? "disabled" : "normal"}
        blockedReason={$LL.actionbar.blocked.alreadyAtDesk()}
        dataTestId="go-to-personal-desk-button"
    >
        <IconDesk font-size="20" aria-hidden="true" />
    </ActionBarButton>
{/if}
