import { get, writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { WorkAdventureComponent } from "../../types/component";
import { createToastStore } from "./ToastStore";
import type { ToastInput } from "./ToastStore";

const SourceToast = (() => undefined) as unknown as WorkAdventureComponent;

describe("ToastStore close button on a source toast", () => {
    it("hides the source toast until the source emits a new value", () => {
        const store = createToastStore();
        const source = writable<ToastInput | undefined>({ component: SourceToast, props: { message: "First" } });
        store.registerToastSource(source, undefined, "source-toast");

        store.removeToast("source-toast");

        expect(get(store).has("source-toast")).toBe(false);

        source.set({ component: SourceToast, props: { message: "Second" } });

        expect(get(store).get("source-toast")?.props).toEqual({ message: "Second", toastUuid: "source-toast" });
    });

    it("shows the source toast again after the source clears and comes back", () => {
        const store = createToastStore();
        const source = writable<ToastInput | undefined>({ component: SourceToast });
        store.registerToastSource(source, undefined, "source-toast");

        store.removeToast("source-toast");
        source.set(undefined);
        source.set({ component: SourceToast });

        expect(get(store).has("source-toast")).toBe(true);
    });

    it("shows the same toast object again after the source clears and re-emits it", () => {
        const store = createToastStore();
        const input: ToastInput = { component: SourceToast };
        const source = writable<ToastInput | undefined>(input);
        store.registerToastSource(source, undefined, "source-toast");

        store.removeToast("source-toast");
        expect(get(store).has("source-toast")).toBe(false);

        source.set(undefined);
        source.set(input);

        expect(get(store).has("source-toast")).toBe(true);
    });

    it("still calls onRemove when a source toast is closed", () => {
        const store = createToastStore();
        const onRemove = vi.fn();
        store.registerToastSource(writable<ToastInput | undefined>({ component: SourceToast }), { onRemove }, "x");

        store.removeToast("x");

        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(get(store).has("x")).toBe(false);
    });
});
