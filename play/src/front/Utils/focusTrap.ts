import type { Action } from "svelte/action";

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

interface FocusTrapOptions {
    // Keep Tab and Shift+Tab inside the node. Defaults to true.
    cycle?: boolean;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // getClientRects keeps position:fixed elements, which have no offsetParent, and drops display:none ones.
        (element) => element.getClientRects().length > 0,
    );
}

/**
 * Modal dialog focus handling, the same as `Components/Modal/Popup.svelte` does inline: while the node is mounted,
 * focus moves into it (unless it is already inside), Tab and Shift+Tab cycle inside it, and focus goes back to the
 * element that had it before the dialog opened. Give the node `tabindex="-1"` so it can take focus when it holds no
 * focusable element. Escape stays with each dialog, since what closing means differs per dialog.
 * Pass `{ cycle: false }` for a non-modal panel (the game stays usable beside it): focus is not moved in, so the
 * avatar keys keep working, Tab may leave the panel, and focus still comes back to the opener if it went inside.
 */
export const focusTrap: Action<HTMLElement, FocusTrapOptions | undefined> = (node, options) => {
    let cycle = options?.cycle ?? true;
    // The node may live in another window (the desktop mini window), so read focus from its own document.
    const ownerDocument = node.ownerDocument;
    const view = ownerDocument.defaultView;
    const activeAtOpen = ownerDocument.activeElement;
    const opener = view && activeAtOpen instanceof view.HTMLElement ? activeAtOpen : undefined;

    if (cycle && !node.contains(ownerDocument.activeElement)) {
        (getFocusableElements(node)[0] ?? node).focus();
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key !== "Tab" || !cycle) {
            return;
        }
        const elements = getFocusableElements(node);
        if (elements.length === 0) {
            event.preventDefault();
            return;
        }
        const first = elements[0];
        const last = elements[elements.length - 1];
        const active = ownerDocument.activeElement;
        if (event.shiftKey && (active === first || active === node)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    node.addEventListener("keydown", onKeydown);

    return {
        update(newOptions) {
            cycle = newOptions?.cycle ?? true;
        },
        destroy() {
            node.removeEventListener("keydown", onKeydown);
            // Only when focus is still in the dialog (or was dropped to the body as it closed): never pull it away
            // from wherever the user moved it meanwhile.
            const active = ownerDocument.activeElement;
            const focusIsInDialog = active === null || active === ownerDocument.body || node.contains(active);
            if (opener?.isConnected && focusIsInDialog) {
                opener.focus();
            }
        },
    };
};
