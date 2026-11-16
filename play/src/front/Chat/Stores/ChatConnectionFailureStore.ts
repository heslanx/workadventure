import { writable } from "svelte/store";

/**
 * Where the first attempt to open the chat connection stands. "ready" only means a connection object exists: a
 * Matrix connection that opened but cannot sync reports that through its own connectionStatus ("ON_ERROR").
 */
export type ChatConnectionAttemptStatus = "connecting" | "retrying" | "failed" | "ready";

export interface ChatConnectionFailure {
    failedAt: Date;
    recoveredAt: Date | undefined;
}

/**
 * Remembers the last chat outage after it is over, so the chat panel can say it happened instead of acting as if
 * the connection had always been fine.
 */
export function createChatConnectionFailureStore() {
    const { subscribe, update, set } = writable<ChatConnectionFailure | undefined>(undefined);

    return {
        subscribe,
        /** Keeps the start of an ongoing outage: a failed retry does not move it. */
        recordFailure(at: Date = new Date()): void {
            update((failure) =>
                failure && failure.recoveredAt === undefined ? failure : { failedAt: at, recoveredAt: undefined },
            );
        },
        recordRecovery(at: Date = new Date()): void {
            update((failure) =>
                failure && failure.recoveredAt === undefined ? { ...failure, recoveredAt: at } : failure,
            );
        },
        dismiss(): void {
            set(undefined);
        },
    };
}

export const chatConnectionFailureStore = createChatConnectionFailureStore();
