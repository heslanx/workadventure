import { v4 } from "uuid";
import { ConcatenateMapStore, MapStore } from "@workadventure/store-utils";
import { derived, writable } from "svelte/store";
import type { Readable, Unsubscriber } from "svelte/store";
import type { WorkAdventureComponent, WorkAdventureComponentProps } from "../../types/component";

export interface Toast {
    component: WorkAdventureComponent;
    props: WorkAdventureComponentProps;
}

export interface ToastInput {
    component: WorkAdventureComponent;
    props?: WorkAdventureComponentProps;
}

export interface ToastSourceOptions {
    onRemove?: () => void;
}

export interface ToastSourceDefinition {
    source: Readable<ToastInput | undefined>;
    options?: ToastSourceOptions;
    uuid?: string;
}

export function createToastStore(initialSources: ToastSourceDefinition[] = []) {
    const innerStore = new MapStore<string, Toast>();
    const combinedStore = new ConcatenateMapStore<string, Toast>();
    const sourceOptions = new Map<string, ToastSourceOptions>();
    // A source toast closed by the user stays hidden until its source emits a different value.
    const sourceDismissers = new Map<string, () => void>();

    combinedStore.addStore(innerStore);

    const store = {
        subscribe: combinedStore.subscribe.bind(combinedStore),
        addToast: (toast: WorkAdventureComponent, props: WorkAdventureComponentProps, uuid?: string): void => {
            const toastUuid = uuid ?? v4();
            innerStore.set(toastUuid, {
                component: toast,
                props: {
                    ...props,
                    toastUuid,
                },
            });
        },
        registerToastSource: (
            source: Readable<ToastInput | undefined>,
            options?: ToastSourceOptions,
            uuid?: string,
        ): Unsubscriber => {
            const toastUuid = uuid ?? v4();
            // Bumped on dismiss so the derived store recomputes; the dismissed value resets when the source clears.
            const dismissTick = writable(0);
            let dismissedInput: ToastInput | undefined;
            let currentInput: ToastInput | undefined;
            const sourceStore = derived([source, dismissTick], ([toastInput]) => {
                currentInput = toastInput;
                if (toastInput === undefined) {
                    dismissedInput = undefined;
                }
                const toasts = new Map<string, Toast>();
                if (toastInput !== undefined && toastInput !== dismissedInput) {
                    toasts.set(toastUuid, {
                        component: toastInput.component,
                        props: {
                            ...toastInput.props,
                            toastUuid,
                        },
                    });
                }
                return toasts;
            });

            if (options !== undefined) {
                sourceOptions.set(toastUuid, options);
            }
            sourceDismissers.set(toastUuid, () => {
                dismissedInput = currentInput;
                dismissTick.update((tick) => tick + 1);
            });
            combinedStore.addStore(sourceStore);

            return () => {
                combinedStore.removeStore(sourceStore);
                sourceOptions.delete(toastUuid);
                sourceDismissers.delete(toastUuid);
            };
        },
        removeToast: (uuid: string): void => {
            innerStore.delete(uuid);
            sourceDismissers.get(uuid)?.();
            sourceOptions.get(uuid)?.onRemove?.();
        },
    };

    for (const { source, options, uuid } of initialSources) {
        store.registerToastSource(source, options, uuid);
    }

    return store;
}
