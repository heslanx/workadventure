import type { Attachment } from "svelte/attachments";

/**
 * A pill under the rows of a list that follows the pointer, or the keyboard focus, from row to row: one element moved
 * by `translate`, not a fill painted on each row. Use it as `{@attach glide({ item: ".k-menu-row" })}` on the
 * container, which carries `.k-glide` (libs/tailwind/style/konclui.css); that stylesheet draws and moves the pill.
 *
 * What it does, and why it is this small:
 * - Two listeners on the container, `pointerover` and `focusin`, for every row: rows come and go with the state of
 *   the list, and a listener per row would have to follow them.
 * - It reads where a row is with `offsetTop`, `offsetLeft`, `offsetWidth` and `offsetHeight` and writes four custom
 *   properties on the pill. Those are layout values: the scale a press puts on a row, and the transform a surface
 *   enters with, do not change them. The container is the rows' offset parent (`.k-glide` is `position: relative`),
 *   and a scrolling container scrolls the pill with its rows.
 * - The pill is hidden on `pointerleave`, when the focus leaves the container, and over a row that cannot act. It shows
 *   again at the row under the pointer without sliding in from where it was: only the move from one row to the next
 *   is a glide. Over what is between the rows (a gap, a title, a divider) it stays where it is, so that the pointer
 *   crossing from one row to the next glides and does not fade out and in.
 * - On a device without hover it does nothing: no pill, no listener, and `.k-glide-on` is not set, so every row keeps
 *   its own hover fill. A touch on a laptop that has both is not a hover either.
 */

export interface GlideOptions {
    /** A selector for what the pill moves between. A row under the pointer or the focus is matched with `closest`. */
    item: string;
}

/** Set on the container while the pill exists: the stylesheet then takes the rows' own hover fill away. */
const ACTIVE_CLASS = "k-glide-on";

export const glide =
    ({ item }: GlideOptions): Attachment<HTMLElement> =>
    (container) => {
        const view = container.ownerDocument.defaultView;
        if (view === null || typeof view.matchMedia !== "function" || !view.matchMedia("(hover: hover)").matches) {
            return undefined;
        }

        const pill = container.ownerDocument.createElement("div");
        pill.className = "k-glide-pill";
        pill.setAttribute("aria-hidden", "true");
        container.append(pill);
        container.classList.add(ACTIVE_CLASS);

        let shown = false;

        function hide(): void {
            pill.classList.remove("is-shown");
            shown = false;
        }

        function show(target: HTMLElement): void {
            // The first place after hiding is taken at once, with the transition off, and the pill fades in there.
            if (!shown) pill.style.transition = "none";
            pill.style.setProperty("--k-glide-x", `${target.offsetLeft}px`);
            pill.style.setProperty("--k-glide-y", `${target.offsetTop}px`);
            pill.style.setProperty("--k-glide-w", `${target.offsetWidth}px`);
            pill.style.setProperty("--k-glide-h", `${target.offsetHeight}px`);
            if (!shown) {
                // Without a read between them, the browser would merge the position and the end of "no transition".
                pill.getBoundingClientRect();
                pill.style.transition = "";
            }
            pill.classList.add("is-shown");
            shown = true;
        }

        /** The row an event happened in, whether or not it can act; undefined for what is not a row of this list. */
        function rowOf(target: EventTarget | null): HTMLElement | undefined {
            const row = target instanceof Element ? target.closest<HTMLElement>(item) : null;
            return row !== null && container.contains(row) ? row : undefined;
        }

        /** A row that cannot act has no hover to follow. */
        const canAct = (row: HTMLElement): boolean => row.getAttribute("aria-disabled") !== "true";

        function onpointerover(event: PointerEvent): void {
            if (event.pointerType === "touch") return;
            const row = rowOf(event.target);
            // The gap between two rows, a title and a divider belong to the list, not to a row, and a pointer crossing
            // from one row to the next goes over them first. Hiding there would make the pill fade out and in again at
            // every row: it stays where it was, and `pointerleave` is what hides it when the pointer leaves the list.
            if (row === undefined) return;
            if (canAct(row)) show(row);
            else hide();
        }

        function onfocusin(event: FocusEvent): void {
            const row = rowOf(event.target);
            // A row that the keyboard focused, not one that a press or a script did: the pill is the hover, and a
            // menu that opens on its first row would otherwise show that row as hovered under no pointer.
            if (row !== undefined && canAct(row) && row.matches(":focus-visible")) show(row);
        }

        function onfocusout(event: FocusEvent): void {
            if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return;
            hide();
        }

        container.addEventListener("pointerover", onpointerover);
        container.addEventListener("pointerleave", hide);
        container.addEventListener("focusin", onfocusin);
        container.addEventListener("focusout", onfocusout);

        return () => {
            container.removeEventListener("pointerover", onpointerover);
            container.removeEventListener("pointerleave", hide);
            container.removeEventListener("focusin", onfocusin);
            container.removeEventListener("focusout", onfocusout);
            container.classList.remove(ACTIVE_CLASS);
            pill.remove();
        };
    };
