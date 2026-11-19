import { get } from "svelte/store";
import { invitePreferencesStore } from "../../../Stores/InvitePreferencesStore";
import { inviteLink } from "../../Preferences/domain/mediaChoices";
import { playerPosition, startPositionNames } from "../../Preferences/stores/gameCommands";
import { reportLinkCopied } from "../../Preferences/stores/generalSettings";

/**
 * The office link, built as the preferences dialog's invite builds it (InviteSection.svelte): the entrance the guest
 * arrives by, and a walk to where the user stands when the invite options ask for one. It is built when copied, so it
 * carries the position of that moment.
 */
export function currentOfficeLink(): string {
    const entries = startPositionNames();
    const invite = get(invitePreferencesStore);
    // Upstream names the entrance whenever the map has start positions: the saved one, or the map's first.
    const entry = entries.includes(invite.entryPoint) ? invite.entryPoint : (entries[0] ?? "");
    return inviteLink(window.location, {
        entryPoint: entries.length > 0 ? entry : undefined,
        walkTo: invite.walkAutomatically ? playerPosition() : undefined,
    });
}

/** Copies the office link to the clipboard. It rejects when the browser refuses, and nothing is counted then. */
export async function copyOfficeLink(): Promise<void> {
    await navigator.clipboard.writeText(currentOfficeLink());
    reportLinkCopied();
}
