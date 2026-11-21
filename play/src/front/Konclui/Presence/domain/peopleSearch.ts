/**
 * A name as the search compares it: without accents and without case. NFD splits "ã" into "a" and a combining mark,
 * and the combining marks (U+0300 to U+036F) are dropped, so "joao" finds "João". It is the reference theme's `fold`.
 */
export function foldName(text: string): string {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

/** Whether `name` holds what the user typed. Spaces around the query do not count, and an empty query holds every name. */
export function matchesName(name: string, query: string): boolean {
    const wanted = foldName(query.trim());
    return wanted === "" || foldName(name).includes(wanted);
}

/** The part of a key event the search shortcut reads. */
export interface ShortcutEvent {
    readonly key: string;
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
}

/**
 * Whether the key press asks for the people search: Ctrl+K, or ⌘K on a Mac. With Alt or Shift held it is another
 * shortcut (Firefox's console is Ctrl+Shift+K), and it is left to the browser.
 */
export function isSearchShortcut(event: ShortcutEvent): boolean {
    return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
}

/** What Escape does in the search field: clear what was typed first, and close the panel when there is nothing to clear. */
export function escapeInSearch(query: string): "clear" | "close" {
    return query === "" ? "close" : "clear";
}
