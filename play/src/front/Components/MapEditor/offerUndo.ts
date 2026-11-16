import { get } from "svelte/store";
import type { AreaDataProperty, EntityDataProperty } from "@workadventure/map-editor";
import LL from "../../../i18n/i18n-svelte";
import { toastStore } from "../../Stores/ToastStoreSingleton";
import { warningMessageStore } from "../../Stores/ErrorStore";
import UndoToast from "../Toasts/UndoToast.svelte";
import ConfirmDialog from "../../Chat/Components/ConfirmDialog.svelte";
import { modals } from "@wa-modals";

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
            const reportUnavailable = () =>
                warningMessageStore.addWarningMessage(get(LL).mapEditor.undo.unavailable(), { closable: true });
            attempt(undo)
                .then((undone) => {
                    if (!undone) {
                        reportUnavailable();
                    }
                })
                .catch((error: unknown) => {
                    console.error("Could not undo the map editor change", error);
                    reportUnavailable();
                });
        },
    });
}

// Async so that a synchronous throw becomes a rejection too.
async function attempt<T>(run: () => T | Promise<T>): Promise<T> {
    return run();
}

function reportRemovalFailure(error: unknown): void {
    console.error("Could not run the map editor removal", error);
    warningMessageStore.addWarningMessage(get(LL).chat.confirm.failed(), { closable: true });
}

/**
 * Runs a map editor removal (an object, an area, a property). When what goes holds an uploaded file, the map storage
 * deletes that file with it and no Undo could bring it back: the person confirms first, with Cancel focused, and only
 * the confirm runs `remove`, at most once unless it failed. Any other removal runs `removeWithUndo` at once and keeps
 * its Undo.
 */
export function removeGuardingUploadedFiles(removal: {
    properties: ReadonlyArray<AreaDataProperty | EntityDataProperty>;
    heading: string;
    confirmLabel: string;
    remove: () => void | Promise<void>;
    removeWithUndo: () => void | Promise<void>;
}): void {
    if (!holdsUploadedFile(removal.properties)) {
        attempt(removal.removeWithUndo).catch(reportRemovalFailure);
        return;
    }
    const translations = get(LL).mapEditor.uploadedFileDeletion;
    let removing: Promise<void> | undefined;
    modals.open(ConfirmDialog, {
        heading: removal.heading,
        message: translations.message(),
        warning: translations.warning(),
        confirmLabel: removal.confirmLabel,
        danger: true,
        onConfirm: () => {
            removing ??= attempt(removal.remove).catch((error: unknown) => {
                removing = undefined;
                // Cancel stays available while the removal runs, so the dialog may be gone when it fails.
                reportRemovalFailure(error);
                throw error;
            });
            return removing;
        },
    });
}
