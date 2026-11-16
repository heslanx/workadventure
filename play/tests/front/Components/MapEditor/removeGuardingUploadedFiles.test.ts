import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AreaDataProperty, EntityDataProperty } from "@workadventure/map-editor";

const openModal = vi.hoisted(() => vi.fn());
vi.mock("@wa-modals", () => ({ modals: { open: openModal, close: vi.fn() } }));
vi.mock("../../../../src/front/Chat/Components/ConfirmDialog.svelte", () => ({ default: "ConfirmDialog" }));
vi.mock("../../../../src/front/Components/Toasts/UndoToast.svelte", () => ({ default: "UndoToast" }));
const addToast = vi.hoisted(() => vi.fn());
const addWarningMessage = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/front/Stores/ToastStoreSingleton", () => ({ toastStore: { addToast } }));
vi.mock("../../../../src/front/Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage } }));
vi.mock("../../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        default: readable({
            chat: { confirm: { failed: () => "This didn't work. Try again." } },
            mapEditor: {
                undo: {
                    action: () => "Undo",
                    unavailable: () => "This change can no longer be undone here. Redo it by hand.",
                },
                uploadedFileDeletion: {
                    message: () => "The file is deleted from the map storage too.",
                    warning: () => "Undo cannot restore an uploaded file. You would have to upload it again.",
                },
            },
        }),
    };
});

import { offerUndo, removeGuardingUploadedFiles } from "../../../../src/front/Components/MapEditor/offerUndo";

type Properties = ReadonlyArray<AreaDataProperty | EntityDataProperty>;

const uploadedDocument = [{ id: "p1", type: "openFile", name: "brief.pdf" }] as unknown as Properties;
const uploadedSound = [{ id: "p2", type: "playAudio", audioName: "bell.mp3" }] as unknown as Properties;
const linkOnly = [{ id: "p3", type: "openWebsite", link: "https://example.org" }] as unknown as Properties;

type ConfirmProps = {
    heading: string;
    message: string;
    warning: string;
    confirmLabel: string;
    danger: boolean;
    onConfirm: () => Promise<void>;
};

function guard(properties: Properties) {
    const remove = vi.fn(() => Promise.resolve());
    const removeWithUndo = vi.fn(() => Promise.resolve());
    removeGuardingUploadedFiles({
        properties,
        heading: "Delete “Desk” and its uploaded file?",
        confirmLabel: "Delete",
        remove,
        removeWithUndo,
    });
    return { remove, removeWithUndo };
}

function openedDialog(): ConfirmProps {
    expect(openModal).toHaveBeenCalledTimes(1);
    return openModal.mock.calls[0][1] as ConfirmProps;
}

describe("removeGuardingUploadedFiles", () => {
    beforeEach(() => {
        openModal.mockReset();
        addWarningMessage.mockReset();
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it.each([
        ["an uploaded document", uploadedDocument],
        ["an uploaded sound", uploadedSound],
    ])("asks before removing what holds %s, and removes nothing yet", (_label, properties) => {
        const { remove, removeWithUndo } = guard(properties);

        expect(openModal).toHaveBeenCalledWith("ConfirmDialog", expect.anything());
        expect(remove).not.toHaveBeenCalled();
        expect(removeWithUndo).not.toHaveBeenCalled();
    });

    it("states that Undo cannot restore the uploaded file, on a dangerous action", () => {
        guard(uploadedDocument);
        const dialog = openedDialog();

        expect(dialog.heading).toBe("Delete “Desk” and its uploaded file?");
        expect(dialog.warning).toMatch(/Undo cannot restore an uploaded file/);
        expect(dialog.confirmLabel).toBe("Delete");
        expect(dialog.danger).toBe(true);
    });

    it("runs the captured removal once on confirm, without an Undo", async () => {
        const { remove, removeWithUndo } = guard(uploadedDocument);

        await openedDialog().onConfirm();

        expect(remove).toHaveBeenCalledTimes(1);
        expect(removeWithUndo).not.toHaveBeenCalled();
    });

    it("lets a failed removal reach the dialog, which keeps it open and says so", async () => {
        const remove = vi.fn(() => Promise.reject(new Error("map storage unreachable")));
        removeGuardingUploadedFiles({
            properties: uploadedDocument,
            heading: "Remove this property and its uploaded file?",
            confirmLabel: "Remove",
            remove,
            removeWithUndo: vi.fn(),
        });

        await expect(openedDialog().onConfirm()).rejects.toThrow("map storage unreachable");
    });

    it("keeps the reversible path: nothing uploaded removes at once, with its Undo", () => {
        const { remove, removeWithUndo } = guard(linkOnly);

        expect(openModal).not.toHaveBeenCalled();
        expect(removeWithUndo).toHaveBeenCalledTimes(1);
        expect(remove).not.toHaveBeenCalled();
    });

    it("treats an upload field left empty as nothing uploaded", () => {
        const { removeWithUndo } = guard([{ id: "p4", type: "openFile", name: "" }] as unknown as Properties);

        expect(openModal).not.toHaveBeenCalled();
        expect(removeWithUndo).toHaveBeenCalledTimes(1);
    });

    it("runs the removal once when confirm is invoked twice, even after it succeeded", async () => {
        let finish: () => void = () => {};
        const remove = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        );
        removeGuardingUploadedFiles({
            properties: uploadedDocument,
            heading: "Delete “Desk” and its uploaded file?",
            confirmLabel: "Delete",
            remove,
            removeWithUndo: vi.fn(),
        });
        const { onConfirm } = openedDialog();

        const first = onConfirm();
        const second = onConfirm();
        await Promise.resolve();
        finish();
        await Promise.all([first, second]);
        await onConfirm();

        expect(remove).toHaveBeenCalledTimes(1);
    });

    it("allows a deliberate retry after the removal failed, including a synchronous throw", async () => {
        const remove = vi
            .fn<() => Promise<void>>()
            .mockImplementationOnce(() => {
                throw new Error("map storage unreachable");
            })
            .mockResolvedValueOnce(undefined);
        removeGuardingUploadedFiles({
            properties: uploadedDocument,
            heading: "Delete “Desk” and its uploaded file?",
            confirmLabel: "Delete",
            remove,
            removeWithUndo: vi.fn(),
        });
        const { onConfirm } = openedDialog();

        await expect(onConfirm()).rejects.toThrow("map storage unreachable");
        await onConfirm();

        expect(remove).toHaveBeenCalledTimes(2);
    });

    it("reports a confirmed removal that fails after Cancel closed the dialog, in a warning that stays", async () => {
        let fail: (error: Error) => void = () => {};
        const remove = vi
            .fn<() => Promise<void>>()
            .mockImplementationOnce(
                () =>
                    new Promise<void>((_resolve, reject) => {
                        fail = reject;
                    }),
            )
            .mockResolvedValueOnce(undefined);
        removeGuardingUploadedFiles({
            properties: uploadedDocument,
            heading: "Delete “Desk” and its uploaded file?",
            confirmLabel: "Delete",
            remove,
            removeWithUndo: vi.fn(),
        });
        const { onConfirm } = openedDialog();

        const confirming = onConfirm();
        const dialogSaw = expect(confirming).rejects.toThrow("map storage unreachable");
        expect(addWarningMessage).not.toHaveBeenCalled();
        fail(new Error("map storage unreachable"));
        await dialogSaw;

        expect(addWarningMessage).toHaveBeenCalledWith("This didn't work. Try again.", { closable: true });
        await onConfirm();
        expect(remove).toHaveBeenCalledTimes(2);
    });

    it.each([
        ["rejects", () => Promise.reject(new Error("offline"))],
        [
            "throws",
            () => {
                throw new Error("offline");
            },
        ],
    ])("reports a reversible removal that %s in a warning that stays", async (_label, removeWithUndo) => {
        removeGuardingUploadedFiles({
            properties: linkOnly,
            heading: "unused",
            confirmLabel: "unused",
            remove: vi.fn(),
            removeWithUndo,
        });

        await vi.waitFor(() =>
            expect(addWarningMessage).toHaveBeenCalledWith("This didn't work. Try again.", {
                closable: true,
            }),
        );
    });
});

describe("offerUndo", () => {
    beforeEach(() => {
        addToast.mockReset();
        addWarningMessage.mockReset();
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("reports an Undo that fails in a warning that stays", async () => {
        offerUndo("Object “Desk” deleted", () => Promise.reject(new Error("offline")));
        const { onAction } = addToast.mock.calls[0][1] as { onAction: () => void };

        onAction();

        await vi.waitFor(() =>
            expect(addWarningMessage).toHaveBeenCalledWith(
                "This change can no longer be undone here. Redo it by hand.",
                { closable: true },
            ),
        );
    });
});
