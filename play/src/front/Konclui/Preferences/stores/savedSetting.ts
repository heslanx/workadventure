import { derived, writable, type Readable } from "svelte/store";

/** A setting some other owner saves: its saved value, kept live, and the way the dialog writes it. */
export interface SavedSetting<T> extends Readable<T> {
    set(value: T): void;
}

/**
 * A setting saved by an upstream owner (`localUserStore`, a room default), as a store.
 *
 * The value is never kept here. It is read from the owner again for each first subscriber, because upstream's own
 * screens may have changed it since, and after each write made through this setting, so a pane shows what was saved
 * and not what was asked. A change made elsewhere while a pane is subscribed is not seen until the next such read.
 * The read also follows a write that throws: a composite write may have saved before it failed, and what is shown
 * must match what is saved.
 */
export function savedSetting<T>(read: () => T, write: (value: T) => void): SavedSetting<T> {
    const writes = writable(0);
    const saved = derived(writes, () => read());
    return {
        subscribe: saved.subscribe,
        set(value) {
            try {
                write(value);
            } finally {
                writes.update((count) => count + 1);
            }
        },
    };
}
