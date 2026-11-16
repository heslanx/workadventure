import type { Attachment } from "svelte/attachments";

/** A notice never goes away in less than this once the pointer or the focus has left it. */
const MIN_REMAINING_AFTER_PAUSE_MS = 1000;

/**
 * Attachment for a transient notice that carries information: it calls `onDismiss` after `durationMs`, but the
 * countdown is held while the pointer is over the element or the keyboard focus is inside it, so the notice is never
 * removed while somebody is reading it or reaching for its buttons (WCAG 2.2.1). ToastContainer does the same for
 * the toasts of the toast stack.
 */
export function autoDismiss(durationMs: number, onDismiss: () => void): Attachment<HTMLElement> {
    return (element) => {
        let remainingMs = durationMs;
        let startedAt = 0;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let isHovered = false;
        let hasFocusInside = false;

        const start = (): void => {
            startedAt = Date.now();
            timeout = setTimeout(() => {
                timeout = undefined;
                onDismiss();
            }, remainingMs);
        };

        const pause = (): void => {
            if (timeout === undefined) return;
            clearTimeout(timeout);
            timeout = undefined;
            remainingMs = Math.max(remainingMs - (Date.now() - startedAt), MIN_REMAINING_AFTER_PAUSE_MS);
        };

        const sync = (): void => {
            if (isHovered || hasFocusInside) {
                pause();
            } else if (timeout === undefined) {
                start();
            }
        };

        const onPointerEnter = (): void => {
            isHovered = true;
            sync();
        };
        const onPointerLeave = (): void => {
            isHovered = false;
            sync();
        };
        const onFocusIn = (): void => {
            hasFocusInside = true;
            sync();
        };
        const onFocusOut = (event: FocusEvent): void => {
            if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
            hasFocusInside = false;
            sync();
        };

        start();
        element.addEventListener("pointerenter", onPointerEnter);
        element.addEventListener("pointerleave", onPointerLeave);
        element.addEventListener("focusin", onFocusIn);
        element.addEventListener("focusout", onFocusOut);

        return () => {
            clearTimeout(timeout);
            element.removeEventListener("pointerenter", onPointerEnter);
            element.removeEventListener("pointerleave", onPointerLeave);
            element.removeEventListener("focusin", onFocusIn);
            element.removeEventListener("focusout", onFocusOut);
        };
    };
}
