import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { createChatConnectionFailureStore } from "./ChatConnectionFailureStore";

describe("createChatConnectionFailureStore", () => {
    const first = new Date("2026-11-15T14:02:00Z");
    const second = new Date("2026-11-15T14:04:00Z");
    const third = new Date("2026-11-15T14:05:00Z");

    it("remembers an outage once the connection is back", () => {
        const store = createChatConnectionFailureStore();
        store.recordFailure(first);
        store.recordRecovery(third);

        expect(get(store)).toEqual({ failedAt: first, recoveredAt: third });
    });

    it("keeps the start of an ongoing outage when a retry fails again", () => {
        const store = createChatConnectionFailureStore();
        store.recordFailure(first);
        store.recordFailure(second);

        expect(get(store)).toEqual({ failedAt: first, recoveredAt: undefined });
    });

    it("starts a new outage after a recovery", () => {
        const store = createChatConnectionFailureStore();
        store.recordFailure(first);
        store.recordRecovery(second);
        store.recordFailure(third);

        expect(get(store)).toEqual({ failedAt: third, recoveredAt: undefined });
    });

    it("ignores a recovery with no outage before it, and forgets on dismiss", () => {
        const store = createChatConnectionFailureStore();
        store.recordRecovery(first);
        expect(get(store)).toBeUndefined();

        store.recordFailure(first);
        store.recordRecovery(second);
        store.recordRecovery(third);
        expect(get(store)?.recoveredAt).toBe(second);

        store.dismiss();
        expect(get(store)).toBeUndefined();
    });
});
