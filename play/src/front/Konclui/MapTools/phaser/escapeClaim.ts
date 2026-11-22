import { get } from "svelte/store";
import { actionsMenuStore } from "../../../Stores/ActionsMenuStore";
import { emoteMenuStore } from "../../../Stores/EmoteStore";
import { activeSecondaryZoneActionBarStore, menuVisiblilityStore } from "../../../Stores/MenuStore";

/** Fields where Escape belongs to the field: a button, a link or a menu item never uses it. */
const TEXT_ENTRY_SELECTOR = [
    "textarea",
    "select",
    'input:not([type="button"], [type="submit"], [type="reset"], [type="checkbox"], [type="radio"], [type="image"])',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="combobox"]',
    '[role="spinbutton"]',
].join(", ");

/**
 * Whether the Escape key goes to a field the player types in: the walk is left alone then, as the field has the key.
 *
 * Only a field counts. A button, the Cancel walk tool or the emote opener keeps the focus after a click or a Tab, and
 * the player who then double clicks the floor must still end that walk with Escape.
 */
export function isEscapeForTextEntry(event: KeyboardEvent): boolean {
    // A web component (the emoji picker) shows its inner field as itself to a listener on the window: the path knows it.
    const innermost = typeof event.composedPath === "function" ? event.composedPath()[0] : undefined;
    for (const target of [innermost, event.target]) {
        if (target instanceof Element && target.closest(TEXT_ENTRY_SELECTOR) !== null) return true;
    }
    return false;
}

/**
 * Whether a surface that closes on Escape is open: the key closes it and nothing more. Those surfaces listen on the
 * window and do not mark the key as handled (`preventDefault`), and wherever the focus is, so the target and the
 * `defaultPrevented` flag do not tell. It is read when the key is pressed, as the surface has already closed itself
 * by the time the scene reads the key on the next frame.
 *
 * `OfficeMenu`, the preferences dialog and the shell's side panels mark the key themselves, and need no entry here.
 */
export function isEscapeForOpenSurface(): boolean {
    return (
        get(menuVisiblilityStore) ||
        get(emoteMenuStore) ||
        get(actionsMenuStore) !== undefined ||
        // The same store also holds the audio panel, which the map opens by itself when its sound starts and which
        // no key closes: only the emote bar takes the Escape.
        get(activeSecondaryZoneActionBarStore) === "emote"
    );
}
