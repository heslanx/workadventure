// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRawSnippet, mount, unmount } from "svelte";
import PassThroughFrame from "./PassThroughFrame.svelte";

describe("PassThroughFrame", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent, { outro: false });
        target.replaceChildren();
    });

    function mountFrame() {
        const children = createRawSnippet(() => ({
            render: () => '<div id="app-content">the app</div>',
        }));
        component = mount(PassThroughFrame, { target, props: { children }, intro: false });
    }

    it("gives the app the full window, because the page root has no height of its own", () => {
        mountFrame();

        const wrapper = target.firstElementChild;

        expect(wrapper?.classList.contains("h-dvh")).toBe(true);
        expect(wrapper?.classList.contains("w-dvw")).toBe(true);
    });

    it("renders the app inside the window-sized wrapper and nothing else", () => {
        mountFrame();

        const wrapper = target.firstElementChild;

        expect(target.children).toHaveLength(1);
        expect(wrapper?.querySelector("#app-content")?.textContent).toBe("the app");
    });
});
