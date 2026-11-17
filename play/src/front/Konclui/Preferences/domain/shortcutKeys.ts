// How a keyboard shortcut reads in the dialog. The keys a user can rebind come from upstream's shortcut store
// (ShortcutsStore.ts); this file only names them, as upstream's own shortcut list does (ShortcutSubMenu.svelte).

export interface KeyCombination {
    readonly label: string;
    readonly mod: boolean;
    readonly alt: boolean;
    readonly shift: boolean;
}

export interface KeyNames {
    readonly mac: boolean;
    readonly shift: string;
}

/** The keys of a combination in the order they are pressed: Ctrl or ⌘, Alt or ⌥, Shift, then the key. */
export function combinationKeys(combination: KeyCombination, names: KeyNames): string[] {
    return [
        ...(combination.mod ? [names.mac ? "⌘" : "Ctrl"] : []),
        ...(combination.alt ? [names.mac ? "⌥" : "Alt"] : []),
        ...(combination.shift ? [names.shift] : []),
        combination.label,
    ];
}

/** The movement keys of the user's keyboard: Phaser listens to both sets, a French locale types on AZERTY. */
export function movementKeys(locale: string): readonly string[] {
    return locale.startsWith("fr") ? ["Z", "Q", "S", "D"] : ["W", "A", "S", "D"];
}
