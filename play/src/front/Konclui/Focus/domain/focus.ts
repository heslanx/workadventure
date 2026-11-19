/**
 * Focus mode: a stretch of work at a seat. It is a Konclui state and nothing else. It never writes the user's
 * availability status, because Busy releases the camera and the microphone (MediaHeldByStatus.ts) and reopening them
 * takes seconds, which would break a call. What focus changes is what the user sees: a chip above the dock and the
 * map's darkened edges.
 *
 * It starts from an explicit action, never by itself: sitting down only offers it.
 */

export type FocusPhase = "idle" | "focused" | "ended";

export interface FocusState {
    /** Whether the player sits on a seat of the office, which is what makes focus on offer. */
    readonly seated: boolean;
    readonly phase: FocusPhase;
    /** When the running focus started, in epoch milliseconds; `undefined` unless the phase is `focused`. */
    readonly since: number | undefined;
}

export type FocusEvent =
    | { readonly type: "seat"; readonly seated: boolean }
    | { readonly type: "start"; readonly at: number }
    | { readonly type: "end" };

export const INITIAL_FOCUS: FocusState = { seated: false, phase: "idle", since: undefined };

/**
 * The state after an event. An event that changes nothing returns the same state object, so a caller can tell.
 *
 * Standing up ends everything, a running focus included. Starting needs a seat, and starting again while it runs
 * keeps the first start time, so a double click cannot reset the clock.
 */
export function nextFocus(state: FocusState, event: FocusEvent): FocusState {
    switch (event.type) {
        case "seat":
            if (event.seated === state.seated) return state;
            return event.seated ? { ...state, seated: true } : INITIAL_FOCUS;
        case "start":
            if (!state.seated || state.phase === "focused") return state;
            return { seated: true, phase: "focused", since: event.at };
        case "end":
            if (state.phase !== "focused") return state;
            return { seated: state.seated, phase: "ended", since: undefined };
    }
}

/**
 * Whether focus shapes what the user sees right now. A conversation comes first, as it does at the reference
 * office: while the user talks, the map is not darkened and the chip gives way to the call indicator. The state
 * itself is kept, so focus is back when the conversation ends.
 */
export function focusEffective(state: FocusState, inConversation: boolean): boolean {
    return state.phase === "focused" && !inConversation;
}

/** How long a focus has run, as the chip says it. */
export type Elapsed =
    | { readonly kind: "now" }
    | { readonly kind: "minutes"; readonly minutes: number }
    | { readonly kind: "hours"; readonly hours: number; readonly minutes: number };

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

/** Whole minutes only, so the text changes once a minute: under one is "now", then minutes, then hours and minutes. */
export function elapsedParts(since: number, now: number): Elapsed {
    // A clock that went back is not a negative duration.
    const minutes = Math.max(0, Math.floor((now - since) / MS_PER_MINUTE));
    if (minutes < 1) return { kind: "now" };
    if (minutes < MINUTES_PER_HOUR) return { kind: "minutes", minutes };
    return { kind: "hours", hours: Math.floor(minutes / MINUTES_PER_HOUR), minutes: minutes % MINUTES_PER_HOUR };
}

/** What the chip shows: nothing, the offer, the running focus, or the focus the user ended while still seated. */
export type FocusChip =
    | { readonly kind: "hidden" }
    | { readonly kind: "offer" }
    | { readonly kind: "active"; readonly elapsed: Elapsed }
    | { readonly kind: "ended" };

export function focusChip(state: FocusState, inConversation: boolean, now: number): FocusChip {
    if (!state.seated || inConversation) return { kind: "hidden" };
    switch (state.phase) {
        case "idle":
            return { kind: "offer" };
        case "focused":
            return { kind: "active", elapsed: elapsedParts(state.since ?? now, now) };
        case "ended":
            return { kind: "ended" };
    }
}
