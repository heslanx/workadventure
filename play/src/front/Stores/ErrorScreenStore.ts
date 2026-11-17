import { writable } from "svelte/store";
import type { ErrorApiErrorData, ErrorApiRetryData, ErrorApiUnauthorizedData } from "@workadventure/messages";
import {
    ErrorScreenMessage,
    isErrorApiErrorData,
    isErrorApiRetryData,
    isErrorApiUnauthorizedData,
} from "@workadventure/messages";
import { isAxiosError } from "axios";

import { ApiError } from "./Errors/ApiError";

/**
 * An error raised in the browser (not sent by the server). The error screen shows a translated, plain-language
 * message for it, and keeps the technical text behind "Show details" for support.
 */
export type ClientErrorKind = "generic" | "network";

export type ErrorScreenState = ErrorScreenMessage & {
    clientErrorKind?: ClientErrorKind;
    technicalDetails?: string;
};

function clientError(
    code: string,
    kind: ClientErrorKind,
    technicalDetails: string,
    images: Partial<Pick<ErrorScreenMessage, "image" | "imageLogo">> = {},
): ErrorScreenState {
    return {
        ...ErrorScreenMessage.fromPartial({ ...images, type: "error", code }),
        clientErrorKind: kind,
        technicalDetails,
    };
}

/**
 * A store that contains one error of type WAError to be displayed.
 */
function createErrorScreenStore() {
    const { subscribe, set } = writable<ErrorScreenState | undefined>(undefined);

    return {
        subscribe,
        setError: (e: ErrorScreenMessage): void => {
            set(e);
        },
        setErrorFromApi: (e: ErrorApiErrorData | ErrorApiRetryData | ErrorApiUnauthorizedData): void => {
            const errorApiErrorData = isErrorApiErrorData.safeParse(e);
            if (errorApiErrorData.success) {
                const error = errorApiErrorData.data;

                set({
                    type: "error",
                    code: error.code,
                    title: error.title,
                    subtitle: error.subtitle,
                    details: error.details,
                    image: error.image,
                    imageLogo: error.imageLogo,
                    timeToRetry: undefined,
                    buttonTitle: undefined,
                    canRetryManual: undefined,
                    urlToRedirect: undefined,
                });
                return;
            }
            const errorApiRetryData = isErrorApiRetryData.safeParse(e);
            if (errorApiRetryData.success) {
                const error = errorApiRetryData.data;
                set({
                    type: "retry",
                    code: error.code,
                    title: error.title,
                    subtitle: error.subtitle,
                    details: error.details,
                    image: error.image,
                    imageLogo: error.imageLogo,
                    timeToRetry: error.timeToRetry,
                    buttonTitle: error.buttonTitle ?? undefined,
                    canRetryManual: error.canRetryManual,
                    urlToRedirect: undefined,
                });
                return;
            }
            const errorApiUnauthorizedData = isErrorApiUnauthorizedData.safeParse(e);
            if (errorApiUnauthorizedData.success) {
                const error = errorApiUnauthorizedData.data;
                set({
                    type: "unauthorized",
                    code: error.code,
                    title: error.title,
                    subtitle: error.subtitle,
                    details: error.details,
                    image: error.image,
                    imageLogo: error.imageLogo,
                    timeToRetry: undefined,
                    buttonTitle: error.buttonTitle ?? undefined,
                    canRetryManual: undefined,
                    urlToRedirect: undefined,
                });
                return;
            }
            throw new Error("This should never happen.");
        },
        /**
         * Turns an exception into an error.
         */
        setException: (error: unknown): void => {
            console.error(error);
            if (error instanceof Error) {
                console.error("Stacktrace: ", error.stack);
            }

            if (typeof error === "string" || error instanceof String) {
                set(
                    clientError("INTERNAL_ERROR", "generic", error.toString(), {
                        image: "/resources/icons/new_version.png",
                    }),
                );
                return;
            }
            if (isAxiosError(error) && error.response) {
                // Axios HTTP error
                // client received an error response (5xx, 4xx)
                console.error("Axios error. Request:", error.request, " - Response: ", error.response);

                set(
                    clientError(
                        "HTTP_ERROR",
                        "generic",
                        `HTTP ${error.response.status} (${String(
                            error.response.data ? error.response.data : error.response.statusText,
                        )}) ${error.config?.url ?? ""}`,
                    ),
                );
                return;
            }
            if (isAxiosError(error)) {
                // Axios HTTP error
                // client never received a response, or request never left
                console.error("Axios error. No full HTTP response received. Request to URL:", error.config?.url);
                set(clientError("NETWORK_ERROR", "network", error.message));
                return;
            }
            if (error instanceof ApiError) {
                const errorApi = error.errorApiData;
                const { status: _exhaustiveCheck, ...errorApiWithoutStatus } = errorApi;

                switch (errorApiWithoutStatus.type) {
                    case "error":
                    case "redirect": {
                        set(ErrorScreenMessage.fromPartial(errorApiWithoutStatus));
                        return;
                    }
                    case "retry":
                    case "unauthorized": {
                        set(
                            ErrorScreenMessage.fromPartial({
                                ...errorApiWithoutStatus,
                                buttonTitle: errorApiWithoutStatus.buttonTitle ?? undefined,
                            }),
                        );
                        return;
                    }
                    default: {
                        // @ts-ignore Typescript compiler is lost because of the removal of the status field.
                        const _exhaustiveCheck: never = errorApi;
                        throw new Error("This should never happen.");
                    }
                }
                return;
            }
            if (error instanceof Error) {
                // Error
                set(clientError("INTERNAL_ERROR", "generic", `${error.name}. ${error.message}`));
                return;
            }
            // Something that is not an Error was thrown (an event, a plain object...). Rethrowing it would leave the
            // user with no error screen at all, and an unhandled rejection in the caller.
            set(clientError("INTERNAL_ERROR", "generic", String(error)));
        },
        delete: () => {
            set(undefined);
        },
    };
}

export const errorScreenStore = createErrorScreenStore();
