// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { readable } from "svelte/store";
import type { ChatMessage, ChatMessageContent } from "../../../Connection/ChatConnection";
import MessageFile from "./MessageFile.svelte";

vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable: r } = await import("svelte/store");
    // Every key reads as its own path.
    const path = (keys: string[]): unknown =>
        new Proxy(() => keys.join("."), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    const LL = r(path([]));
    return { default: LL, LL, locale: r("en-US") };
});
// The offer to accept a file is shown while there is no URL: it is not what these tests look at.
vi.mock("./MessageAttachmentOffer.svelte", () => ({ default: () => ({}) }));

describe("MessageFile", () => {
    let target: HTMLElement;
    let component: ReturnType<typeof mount> | undefined;

    const url = "https://matrix.example.test/_matrix/client/v1/media/download/example.test/abc";
    const content = readable<ChatMessageContent>({ body: "report.pdf", url });

    function render(isMyMessage: boolean) {
        // The component reads one field of the message: whose it is.
        const message = { isMyMessage } as unknown as ChatMessage;
        component = mount(MessageFile, {
            target,
            props: { content, message },
        });
        flushSync();
    }

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) {
            await unmount(mounted);
        }
        target.remove();
    });

    // For a URL of another origin the browser ignores download and navigates the page, which fires beforeunload.
    it("opens the link that saves the file of somebody else in its own tab", () => {
        render(false);

        const link = target.querySelector("a");
        expect(link?.getAttribute("href")).toBe(url);
        expect(link?.getAttribute("download")).toBe("report.pdf");
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("offers no link to save one's own file", () => {
        render(true);

        expect(target.querySelector("a")).toBeNull();
        expect(target.querySelector("[target]")).toBeNull();
        expect(target.textContent).toContain("report.pdf");
    });
});
