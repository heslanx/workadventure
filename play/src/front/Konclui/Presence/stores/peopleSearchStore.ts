import { writable, type Readable } from "svelte/store";

const query = writable("");

/** What the user typed in the people search. The panel clears it when it closes. */
export const peopleQueryStore: Readable<string> = { subscribe: query.subscribe };

export function setPeopleQuery(text: string): void {
    query.set(text);
}

const focusRequested = writable(false);

/**
 * Whether something asked for the focus on the search field: the rail's search button and the shortcut. The request
 * outlives the panel being closed, so a panel that opens for it takes the focus as soon as it is drawn; the panel
 * clears it, taken or not, when it closes.
 */
export const searchFocusRequestStore: Readable<boolean> = { subscribe: focusRequested.subscribe };

export function requestSearchFocus(): void {
    focusRequested.set(true);
}

export function clearSearchFocusRequest(): void {
    focusRequested.set(false);
}
