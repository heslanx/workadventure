<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { ENABLE_OPENID } from "../../../Enum/EnvironmentVariable";
    import { profileAvailable, SubMenusInterface, userIsConnected } from "../../../Stores/MenuStore";
    import { logout, nameIsEditable, openUpstreamMenu } from "../stores/generalSettings";
    import { closePreferences } from "../stores/preferencesStore";
    import { openCompanionEditor, openNameEditor, openWokaEditor } from "../stores/gameCommands";
    import PrefRow from "./PrefRow.svelte";
    import PrefSection from "./PrefSection.svelte";

    let t = $derived($LL.konclui.preferences.profile);
    // An OpenID name policy can force the account's name: then there is no name to edit (ProfileMenuContent.svelte).
    const nameShown = nameIsEditable();

    /** Closes the dialog, then opens the editor: each editor is a screen of its own. */
    function leaveFor(open: () => void): () => void {
        return () => {
            closePreferences();
            open();
        };
    }
</script>

<PrefSection title={t.you()}>
    {#if nameShown}
        <PrefRow title={t.name()} hint={t.nameHint()} onclick={leaveFor(openNameEditor)} />
    {/if}
    <PrefRow title={t.avatar()} hint={t.avatarHint()} onclick={leaveFor(openWokaEditor)} />
    <PrefRow title={t.companion()} hint={t.companionHint()} onclick={leaveFor(openCompanionEditor)} />
</PrefSection>
{#if $profileAvailable || (ENABLE_OPENID && $userIsConnected)}
    <PrefSection title={t.account()}>
        {#if $profileAvailable}
            <PrefRow
                title={t.accountDetails()}
                hint={t.accountDetailsHint()}
                onclick={leaveFor(() => openUpstreamMenu(SubMenusInterface.profile))}
            />
        {/if}
        {#if ENABLE_OPENID && $userIsConnected}
            <PrefRow title={t.logout()} hint={t.logoutHint()} danger onclick={logout} />
        {/if}
    </PrefSection>
{/if}
