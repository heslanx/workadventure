import { readable, type Readable } from "svelte/store";

/**
 * A store that follows `source` but changes at most once every two seconds, for what a screen reader announces: a
 * polite live region reads each change out, so a source that flips several times a second would be a storm.
 *
 * - A change that arrives while nothing was shown for two seconds is shown at once.
 * - Changes that arrive during the cool-down collapse into the latest one, shown when the cool-down ends, and only
 *   if it still differs from what is shown.
 * - A source that turns `undefined` (the chip goes away) is shown at once and does not restart the cool-down: what
 *   is stale must not stay on screen. The next value waits for the cool-down, so a chip that flaps on and off is
 *   announced at most once per cool-down.
 *
 * The cool-down is a fixed literal because the Konclui architecture test reads the delay of every `setTimeout`.
 */
export function throttledStore<T>(
    source: Readable<T | undefined>,
    isSame: (a: T, b: T) => boolean,
): Readable<T | undefined> {
    const isSameValue = (a: T | undefined, b: T | undefined): boolean =>
        a === undefined || b === undefined ? a === b : isSame(a, b);

    return readable<T | undefined>(undefined, (set) => {
        // A store that stopped keeps its last value, which the first reading of this run must replace.
        set(undefined);
        let shown: T | undefined;
        let pending: { readonly value: T } | undefined;
        let cooling = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const apply = (value: T | undefined): void => {
            if (isSameValue(shown, value)) return;
            shown = value;
            set(value);
            if (cooling) return;
            cooling = true;
            timer = setTimeout(() => {
                timer = undefined;
                cooling = false;
                const next = pending;
                pending = undefined;
                if (next !== undefined) apply(next.value);
            }, 2000);
        };

        const unsubscribe = source.subscribe((value) => {
            if (value === undefined) {
                pending = undefined;
                apply(undefined);
            } else if (cooling) {
                pending = { value };
            } else {
                apply(value);
            }
        });
        return () => {
            unsubscribe();
            if (timer !== undefined) clearTimeout(timer);
        };
    });
}
