import { describe, expect, it } from "vitest";
import {
    INITIAL_FOCUS,
    elapsedParts,
    focusChip,
    focusEffective,
    nextFocus,
    type FocusEvent,
    type FocusState,
} from "./focus";

const MINUTE = 60_000;
const SEATED: FocusState = { seated: true, phase: "idle", since: undefined };
const FOCUSED: FocusState = { seated: true, phase: "focused", since: 1_000 };
const ENDED: FocusState = { seated: true, phase: "ended", since: undefined };

describe("nextFocus", () => {
    const cases: readonly [string, FocusState, FocusEvent, FocusState][] = [
        ["sitting only offers focus", INITIAL_FOCUS, { type: "seat", seated: true }, SEATED],
        ["starting needs a seat", INITIAL_FOCUS, { type: "start", at: 5 }, INITIAL_FOCUS],
        ["starting at a seat runs focus from that moment", SEATED, { type: "start", at: 5 }, { ...FOCUSED, since: 5 }],
        ["starting again keeps the first start time", FOCUSED, { type: "start", at: 99 }, FOCUSED],
        ["ending stops the running focus and forgets its start", FOCUSED, { type: "end" }, ENDED],
        ["ending when nothing runs changes nothing", SEATED, { type: "end" }, SEATED],
        ["resuming after an end starts a new run", ENDED, { type: "start", at: 7 }, { ...FOCUSED, since: 7 }],
        ["standing up ends a running focus", FOCUSED, { type: "seat", seated: false }, INITIAL_FOCUS],
        ["standing up forgets an ended focus", ENDED, { type: "seat", seated: false }, INITIAL_FOCUS],
        ["standing up while standing changes nothing", INITIAL_FOCUS, { type: "seat", seated: false }, INITIAL_FOCUS],
        ["sitting again while seated keeps the running focus", FOCUSED, { type: "seat", seated: true }, FOCUSED],
    ];

    it.each(cases)("%s", (_name, state, event, expected) => {
        expect(nextFocus(state, event)).toEqual(expected);
    });

    it("returns the very same state when an event changes nothing, so a caller can skip the update", () => {
        expect(nextFocus(FOCUSED, { type: "start", at: 99 })).toBe(FOCUSED);
        expect(nextFocus(INITIAL_FOCUS, { type: "seat", seated: false })).toBe(INITIAL_FOCUS);
        expect(nextFocus(SEATED, { type: "end" })).toBe(SEATED);
    });

    it("never starts focus by itself: no seat event alone leaves the idle phase", () => {
        const afterSitting = nextFocus(INITIAL_FOCUS, { type: "seat", seated: true });

        expect(afterSitting.phase).toBe("idle");
        expect(focusEffective(afterSitting, false)).toBe(false);
    });
});

describe("focusEffective", () => {
    it.each([
        ["running and not talking", FOCUSED, false, true],
        ["running while in a conversation", FOCUSED, true, false],
        ["only offered", SEATED, false, false],
        ["ended by the user", ENDED, false, false],
        ["standing", INITIAL_FOCUS, false, false],
    ] as const)("%s", (_name, state, inConversation, expected) => {
        expect(focusEffective(state, inConversation)).toBe(expected);
    });
});

describe("elapsedParts", () => {
    const since = 1_000_000;

    it.each([
        ["no time at all", 0, { kind: "now" }],
        ["just under a minute", 59_999, { kind: "now" }],
        ["one minute", MINUTE, { kind: "minutes", minutes: 1 }],
        ["a minute and a half", 90_000, { kind: "minutes", minutes: 1 }],
        ["59 minutes", 59 * MINUTE, { kind: "minutes", minutes: 59 }],
        ["an hour sharp", 60 * MINUTE, { kind: "hours", hours: 1, minutes: 0 }],
        ["an hour and five minutes", 65 * MINUTE, { kind: "hours", hours: 1, minutes: 5 }],
        ["two hours and 59 minutes", 179 * MINUTE, { kind: "hours", hours: 2, minutes: 59 }],
    ] as const)("%s", (_name, duration, expected) => {
        expect(elapsedParts(since, since + duration)).toEqual(expected);
    });

    it("takes a clock that went back as no time at all", () => {
        expect(elapsedParts(since, since - 5 * MINUTE)).toEqual({ kind: "now" });
    });
});

describe("focusChip", () => {
    it.each([
        ["standing", INITIAL_FOCUS, false, { kind: "hidden" }],
        ["seated, nothing started: the offer", SEATED, false, { kind: "offer" }],
        ["running: how long", FOCUSED, false, { kind: "active", elapsed: { kind: "minutes", minutes: 2 } }],
        ["ended while still seated: the way back", ENDED, false, { kind: "ended" }],
        ["in a conversation the call indicator has the place", FOCUSED, true, { kind: "hidden" }],
        ["in a conversation, even the offer waits", SEATED, true, { kind: "hidden" }],
    ] as const)("%s", (_name, state, inConversation, expected) => {
        expect(focusChip(state, inConversation, 1_000 + 2 * MINUTE)).toEqual(expected);
    });
});
