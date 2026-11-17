<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { invitePreferencesStore } from "../../../Stores/InvitePreferencesStore";
    import { inviteLink } from "../domain/mediaChoices";
    import {
        reportLinkCopied,
        setInviteChoosesEntry,
        setInviteEntry,
        setInviteWalksToMe,
    } from "../stores/generalSettings";
    import { playerPosition, startPositionNames } from "../stores/gameCommands";
    import PrefSection from "./PrefSection.svelte";
    import PrefSelect from "./PrefSelect.svelte";
    import PrefToggle from "./PrefToggle.svelte";

    // The office link, with the options of upstream's invite (GuestSubMenu.svelte): the entrance the guest arrives
    // by and a walk to where the user stands. The link is built when copied, so it carries the position of that moment.

    const id = $props.id();
    let t = $derived($LL.konclui.preferences.general);
    const entries = startPositionNames();
    let copyState: "idle" | "copied" | "failed" = $state("idle");
    let shownLink = $state("");
    let field: HTMLInputElement | undefined = $state();
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    let entry = $derived(
        entries.includes($invitePreferencesStore.entryPoint) ? $invitePreferencesStore.entryPoint : (entries[0] ?? ""),
    );

    function currentLink(): string {
        // Upstream names the entrance whenever the map has start positions: the saved one, or the map's first.
        return inviteLink(window.location, {
            entryPoint: entries.length > 0 ? entry : undefined,
            walkTo: $invitePreferencesStore.walkAutomatically ? playerPosition() : undefined,
        });
    }

    async function copy(): Promise<void> {
        shownLink = currentLink();
        try {
            await navigator.clipboard.writeText(shownLink);
            reportLinkCopied();
            copyState = "copied";
            clearTimeout(resetTimer);
            // The confirmation stays 5 s, as upstream's copy button keeps it.
            resetTimer = setTimeout(() => {
                copyState = "idle";
            }, 5000);
        } catch (error: unknown) {
            console.error("[konclui] preferences: could not copy the office link", error);
            copyState = "failed";
            // The link stays in the field, focused and selected, for the keyboard copy.
            await tick();
            field?.focus();
            field?.select();
        }
    }

    onDestroy(() => clearTimeout(resetTimer));
</script>

<PrefSection title={t.invite()}>
    <div class="k-pref-item k-pref-stack">
        <span class="k-pref-text">
            <b id="{id}-copy">{t.copyLink()}</b>
            <small id="{id}-copy-hint" role="status">
                {copyState === "copied" ? t.copied() : copyState === "failed" ? t.copyFailed() : t.copyLinkHint()}
            </small>
        </span>
        <button
            type="button"
            class="k-pref-button"
            aria-describedby="{id}-copy-hint"
            onclick={() => {
                copy().catch((error: unknown) => console.error(error));
            }}>{t.copy()}</button
        >
        {#if copyState === "failed"}
            <input
                bind:this={field}
                class="k-pref-field"
                type="text"
                readonly
                value={shownLink}
                aria-label={t.link()}
            />
        {/if}
    </div>
    <PrefToggle
        title={t.walkToMe()}
        hint={t.walkToMeHint()}
        checked={$invitePreferencesStore.walkAutomatically}
        onchange={setInviteWalksToMe}
    />
    {#if entries.length > 1}
        <PrefToggle
            title={t.chooseEntry()}
            hint={t.chooseEntryHint()}
            checked={$invitePreferencesStore.showZoneSelect}
            onchange={setInviteChoosesEntry}
        />
        {#if $invitePreferencesStore.showZoneSelect}
            <PrefSelect
                title={t.entry()}
                value={entry}
                options={entries.map((name) => ({ value: name, label: name }))}
                onchange={setInviteEntry}
            />
        {/if}
    {/if}
</PrefSection>
