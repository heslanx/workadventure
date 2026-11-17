import { get, writable, type Readable } from "svelte/store";
import { DEFAULT_PANE, paneFrom, type PaneId } from "../domain/panes";

export interface PreferencesState {
    readonly open: boolean;
    readonly pane: PaneId;
}

const state = writable<PreferencesState>({ open: false, pane: DEFAULT_PANE });

/** The control that had the focus when the dialog opened: it gets the focus back when the dialog closes. */
let opener: HTMLElement | undefined;

/** Whether the preferences dialog is open, and on which section. */
export const preferencesStore: Readable<PreferencesState> = { subscribe: state.subscribe };

/** The focused control, when there is one: the page itself is no control to give the focus back to. */
function focusedControl(): HTMLElement | undefined {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : undefined;
}

/**
 * Opens the preferences dialog on a section (an id of `PANES`, or an alias such as "microphone"), or switches the
 * open dialog to it. Unlike upstream's `showMenuItem`, it never closes the dialog.
 *
 * `from` is the control that gets the focus back on close. Pass the clicked button: Safari does not focus a
 * button on click, so the focused element alone would be the page.
 */
export function openPreferences(pane?: string, from?: HTMLElement): void {
    if (!get(state).open) opener = from ?? focusedControl();
    state.set({ open: true, pane: paneFrom(pane) });
}

export function showPane(pane: PaneId): void {
    state.update((current) => ({ ...current, pane }));
}

/** Closes the dialog and gives the focus back to the control that opened it. */
export function closePreferences(): void {
    if (!get(state).open) return;
    state.update((current) => ({ ...current, open: false }));
    const target = opener;
    opener = undefined;
    if (target?.isConnected) target.focus();
}
