import { derived, writable, type Readable } from "svelte/store";
import { isInActiveConversationStore } from "../../../Stores/StreamableCollectionStore";
import {
    INITIAL_FOCUS,
    focusChip,
    focusEffective,
    nextFocus,
    type FocusChip,
    type FocusEvent,
    type FocusState,
} from "../domain/focus";

// Focus is kept here and nowhere else: the chip draws it, the map's vignette reads it, and the seat extension feeds
// the seat. Nothing here touches the availability status or the media stores, by design (see domain/focus.ts).

const state = writable<FocusState>(INITIAL_FOCUS);
let current = INITIAL_FOCUS;

function dispatch(event: FocusEvent): void {
    const next = nextFocus(current, event);
    // An event that changes nothing must not wake every subscriber.
    if (next === current) return;
    current = next;
    state.set(next);
}

/** Tells focus whether the player sits on a seat of the office. Standing up ends the focus. */
export function publishSeat(seated: boolean): void {
    dispatch({ type: "seat", seated });
}

/** Starts the focus, or resumes one the user ended. Does nothing unless the player is seated. */
export function startFocus(): void {
    dispatch({ type: "start", at: Date.now() });
}

export function endFocus(): void {
    dispatch({ type: "end" });
}

/** Whether focus shapes what the user sees now: it runs and the user is not in a conversation. */
export const focusActiveStore: Readable<boolean> = derived(
    [state, isInActiveConversationStore],
    ([focus, inConversation]) => focusEffective(focus, inConversation),
);

/**
 * What the chip shows. While a focus runs, the time is read again every 20 seconds by a timeout that arms the next
 * one, so nothing ticks while the chip is idle, hidden or has no subscriber. The chip shows whole minutes, so reading
 * more often would only repaint; the delay is a literal because the architecture test cannot read a named one.
 */
export const focusChipStore: Readable<FocusChip> = derived(
    [state, isInActiveConversationStore],
    ([focus, inConversation], set: (chip: FocusChip) => void) => {
        set(focusChip(focus, inConversation, Date.now()));
        if (focus.phase !== "focused" || inConversation) return;
        let timer: ReturnType<typeof setTimeout>;
        const refresh = (): void => {
            set(focusChip(focus, inConversation, Date.now()));
            timer = setTimeout(refresh, 20_000);
        };
        timer = setTimeout(refresh, 20_000);
        return () => clearTimeout(timer);
    },
    { kind: "hidden" },
);
