import type { Component } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactionsMenuExtension } from "./ReactionsMenuPort";

describe("the reactions menu port", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function loadPort() {
        return await import("./ReactionsMenuPort");
    }

    const extension = (name: string): ReactionsMenuExtension => ({
        section: (() => undefined) as unknown as Component,
        describeReaction: () => name,
    });

    it("holds nothing until an extension registers, which leaves the reactions menu as it is", async () => {
        const { reactionsMenuExtension } = await loadPort();

        expect(get(reactionsMenuExtension)).toBeUndefined();
    });

    it("holds the extension that registered, and tells its subscribers", async () => {
        const { reactionsMenuExtension, registerReactionsMenu } = await loadPort();
        const seen: Array<string | undefined> = [];
        const unsubscribe = reactionsMenuExtension.subscribe((value) => seen.push(value?.describeReaction("a", 1)));

        registerReactionsMenu(extension("first"));
        unsubscribe();

        expect(seen).toEqual([undefined, "first"]);
    });

    it("lets a later registration replace the earlier one", async () => {
        const { reactionsMenuExtension, registerReactionsMenu } = await loadPort();

        registerReactionsMenu(extension("first"));
        registerReactionsMenu(extension("second"));

        expect(get(reactionsMenuExtension)?.describeReaction("a", 1)).toBe("second");
    });
});
