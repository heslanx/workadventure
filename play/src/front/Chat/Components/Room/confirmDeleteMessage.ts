import { get } from "svelte/store";
import LL from "../../../../i18n/i18n-svelte";
import ConfirmDialog from "../ConfirmDialog.svelte";
import { decodeHtmlEntities } from "../../decodeHtmlEntities";
import { modals } from "@wa-modals";

const EXCERPT_MAX_LENGTH = 60;

/** The start of a message, on one line, so the dialog names what goes away. */
function toExcerpt(text: string | undefined): string {
    const oneLine = decodeHtmlEntities(text ?? "")
        .replace(/\s+/g, " ")
        .trim();
    return oneLine.length > EXCERPT_MAX_LENGTH ? `${oneLine.slice(0, EXCERPT_MAX_LENGTH - 1)}…` : oneLine;
}

/**
 * Asks before deleting something for everyone; a failure stays in the popup. Matrix redaction cannot be reverted,
 * so the dialog names the message and says it is final instead of offering an Undo.
 */
export function confirmDelete(kind: "message" | "poll", remove: () => Promise<void>, body?: string): void {
    const confirm = get(LL).chat.confirm;
    const excerpt = kind === "message" ? toExcerpt(body) : "";
    modals.open(ConfirmDialog, {
        heading:
            kind === "message"
                ? excerpt
                    ? confirm.deleteMessageNamedTitle({ excerpt })
                    : confirm.deleteMessageTitle()
                : confirm.deletePollTitle(),
        message: kind === "message" ? confirm.deleteMessageMessage() : confirm.deletePollMessage(),
        warning: confirm.cannotUndo(),
        confirmLabel: confirm.delete(),
        danger: true,
        onConfirm: remove,
    });
}
