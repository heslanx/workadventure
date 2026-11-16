import { derived, writable } from "svelte/store";
import { v4 as uuid } from "uuid";

interface ErrorMessage {
    id: string | undefined;
    closable: boolean; // Whether it can be closed by a user action or not
    message: string | number | boolean | undefined;
}

interface WarningMessage extends ErrorMessage {
    /**
     * How long the warning stays before it removes itself, held while it is hovered or focused (see WarningToast).
     * Undefined: it stays until it is closed.
     */
    durationMs: number | undefined;
}

/** A warning nobody can close removes itself after this long, so it cannot stay on the screen for good. */
const NOT_CLOSABLE_WARNING_DURATION_MS = 10000;

/**
 * A store that contains a list of error messages to be displayed.
 */
function createErrorStore() {
    const { subscribe, update } = writable<ErrorMessage[]>([]);

    return {
        subscribe,
        addErrorMessage: (
            e: string | Error,
            options?: {
                closable?: boolean;
                id?: string;
            },
        ): void => {
            update((messages: ErrorMessage[]) => {
                let message: string;
                if (e instanceof Error) {
                    message = e.message;
                } else {
                    message = e;
                }

                if (!messages.find((errorMessage) => errorMessage.message === message)) {
                    messages.push({
                        message,
                        closable: options?.closable ?? true,
                        id: options?.id,
                    });
                }

                return messages;
            });
        },
        clearMessageById: (id: string): void => {
            update((messages: ErrorMessage[]) => {
                return messages.filter((message) => message.id !== id);
            });
        },
        clearClosableMessages: (): void => {
            update((messages: ErrorMessage[]) => {
                return messages.filter((message) => !message.closable);
            });
        },
    };
}

export const errorStore = createErrorStore();

export const hasClosableMessagesInErrorStore = derived(errorStore, ($errorStore) => {
    const closableMessage = $errorStore.find((errorMessage) => errorMessage.closable);
    return !!closableMessage;
});

function createWarningMessageStore() {
    const { subscribe, update } = writable<WarningMessage[]>([]);

    return {
        subscribe,
        addWarningMessage: (
            e: string | Error,
            options?: {
                closable?: boolean;
                id?: string;
                /** Overrides when the warning goes away by itself. A closable warning stays until it is closed. */
                durationMs?: number;
            },
        ): void => {
            update((messages: WarningMessage[]) => {
                let message: string;
                if (e instanceof Error) {
                    message = e.message;
                } else {
                    message = e;
                }

                const closable = options?.closable ?? true;
                const newWarningMessage: WarningMessage = {
                    message,
                    closable,
                    id: options?.id ?? uuid(),
                    durationMs: options?.durationMs ?? (closable ? undefined : NOT_CLOSABLE_WARNING_DURATION_MS),
                };
                if (
                    !messages.find(
                        (errorMessage) =>
                            errorMessage.message === newWarningMessage.message ||
                            (errorMessage.id != undefined &&
                                newWarningMessage.id != undefined &&
                                errorMessage.id === newWarningMessage.id),
                    )
                ) {
                    messages.push(newWarningMessage);
                }

                return messages;
            });
        },
        removeWarningMessage: (id: string): void => {
            update((messages: WarningMessage[]) => messages.filter((message) => message.id !== id));
        },
    };
}
export const warningMessageStore = createWarningMessageStore();
