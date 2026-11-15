/**
 * Keyboard activation for elements that carry a button-like role (`role="button"`, `role="tab"`...) without being a
 * native `<button>`: Enter or Space runs `action`, like a click would. Keys from nested controls are ignored so a
 * focused child (an input, an inner button) keeps its own behaviour.
 */
export function activateOnEnterOrSpace(event: KeyboardEvent, action: () => void): void {
    if (event.target !== event.currentTarget) {
        return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
        return;
    }
    event.preventDefault();
    action();
}
