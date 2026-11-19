import { get, writable, type Readable } from "svelte/store";

const open = writable(false);

/** The control that opened the menu: it gets the focus back when the menu closes by the keyboard or a choice. */
let opener: HTMLElement | undefined;

/** Whether the office menu is open. */
export const officeMenuOpenStore: Readable<boolean> = { subscribe: open.subscribe };

/**
 * Opens the menu. `from` is the control that gets the focus back: pass the clicked button, because Safari does not
 * focus a button on click.
 */
export function openOfficeMenu(from?: HTMLElement): void {
    if (!get(open)) opener = from;
    open.set(true);
}

/** Opens the menu, or closes it when it is open; a press on the logo that opened it closes it. */
export function toggleOfficeMenu(from?: HTMLElement): void {
    if (get(open)) {
        closeOfficeMenu({ returnFocus: true });
        return;
    }
    openOfficeMenu(from);
}

/** Whether a node is the control that opened the menu or inside it: a press there is the toggle's, not an outside one. */
export function isOfficeMenuOpener(node: Node): boolean {
    return opener?.contains(node) ?? false;
}

/**
 * Closes the menu. When the menu closes because of what the user did inside it (Esc, Tab, a row), the row that had
 * the focus goes away with it, so the focus goes back to the control that opened it; a press somewhere else leaves
 * the focus where that press put it. Returns the control that opened the menu.
 */
export function closeOfficeMenu({ returnFocus }: { returnFocus: boolean }): HTMLElement | undefined {
    if (!get(open)) return undefined;
    open.set(false);
    const from = opener;
    opener = undefined;
    if (returnFocus && from?.isConnected) from.focus();
    return from;
}
