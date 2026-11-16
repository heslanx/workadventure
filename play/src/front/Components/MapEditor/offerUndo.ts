import { get } from "svelte/store";
import type { AreaDataProperty, EntityDataProperty } from "@workadventure/map-editor";
import LL from "../../../i18n/i18n-svelte";
import { toastStore } from "../../Stores/ToastStoreSingleton";
import { warningMessageStore } from "../../Stores/ErrorStore";
import UndoToast from "../Toasts/UndoToast.svelte";

/**
 * The map storage deletes the file a property uploaded (a document, a sound) as soon as that property goes, whether it
 * was removed alone or with the object or area that held it. Putting the property back would only bring a link to a
 * file that no longer exists, so such a removal is not offered an Undo it could not honour.
 */
export function holdsUploadedFile(properties: ReadonlyArray<AreaDataProperty | EntityDataProperty>): boolean {
    return properties.some(
        (property) =>
            (property.type === "openFile" && Boolean(property.name)) ||
            (property.type === "playAudio" && Boolean(property.audioName)),
    );
}

/**
 * A map editor change that takes one gesture and loses something (a trashed object, a removed property) says what
 * happened and offers the way back in a toast. `undo` returns false when the change cannot be reverted any more
 * (something else changed in between): the person is told so instead of getting a button that does nothing.
 */
export function offerUndo(message: string, undo: () => boolean | Promise<boolean>): void {
    toastStore.addToast(UndoToast, {
        message,
        actionLabel: get(LL).mapEditor.undo.action(),
        onAction: () => {
            Promise.resolve(undo())
                .then((undone) => {
                    if (!undone) {
                        warningMessageStore.addWarningMessage(get(LL).mapEditor.undo.unavailable(), {
                            closable: true,
                        });
                    }
                })
                .catch((error: unknown) => console.error("Could not undo the map editor change", error));
        },
    });
}
