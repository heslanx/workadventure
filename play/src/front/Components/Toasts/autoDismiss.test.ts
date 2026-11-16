// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDismiss } from "./autoDismiss";

describe("autoDismiss", () => {
    let element: HTMLElement;
    let button: HTMLButtonElement;
    let onDismiss: () => void;
    let detach: (() => void) | undefined;

    function attach(durationMs: number): void {
        const cleanup = autoDismiss(durationMs, onDismiss)(element);
        detach = typeof cleanup === "function" ? cleanup : undefined;
    }

    beforeEach(() => {
        vi.useFakeTimers();
        element = document.createElement("div");
        button = document.createElement("button");
        element.append(button);
        document.body.append(element);
        onDismiss = vi.fn();
    });

    afterEach(() => {
        detach?.();
        detach = undefined;
        element.remove();
        vi.useRealTimers();
    });

    it("dismisses the notice once its duration has passed", () => {
        attach(5000);

        vi.advanceTimersByTime(4999);
        expect(onDismiss).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("keeps the notice while the pointer is over it", () => {
        attach(5000);

        vi.advanceTimersByTime(3000);
        element.dispatchEvent(new Event("pointerenter"));
        vi.advanceTimersByTime(60_000);

        expect(onDismiss).not.toHaveBeenCalled();
    });

    it("gives the time that was left once the pointer leaves", () => {
        attach(5000);

        vi.advanceTimersByTime(3000);
        element.dispatchEvent(new Event("pointerenter"));
        vi.advanceTimersByTime(60_000);
        element.dispatchEvent(new Event("pointerleave"));

        // 2 seconds were left, which is more than the 1 second minimum.
        vi.advanceTimersByTime(1999);
        expect(onDismiss).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("never leaves less than a second to read after the pointer leaves", () => {
        attach(5000);

        vi.advanceTimersByTime(4900);
        element.dispatchEvent(new Event("pointerenter"));
        element.dispatchEvent(new Event("pointerleave"));

        vi.advanceTimersByTime(999);
        expect(onDismiss).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("keeps the notice while the keyboard focus is inside it", () => {
        attach(5000);

        button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        vi.advanceTimersByTime(60_000);

        expect(onDismiss).not.toHaveBeenCalled();
    });

    it("holds the countdown while focus moves between elements of the notice", () => {
        attach(5000);
        const other = document.createElement("button");
        element.append(other);

        button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        button.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: other }));
        vi.advanceTimersByTime(60_000);

        expect(onDismiss).not.toHaveBeenCalled();
    });

    it("resumes the countdown when the focus leaves the notice", () => {
        attach(5000);

        button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        button.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        vi.advanceTimersByTime(5000);

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss a notice that was detached first", () => {
        attach(5000);

        detach?.();
        detach = undefined;
        vi.advanceTimersByTime(60_000);

        expect(onDismiss).not.toHaveBeenCalled();
    });
});
