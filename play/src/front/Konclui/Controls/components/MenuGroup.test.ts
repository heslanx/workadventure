// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import MenuGroup from "./MenuGroup.svelte";

const children = createRawSnippet(() => ({ render: () => '<button type="button">row</button>' }));

describe("MenuGroup", () => {
    let target: HTMLElement | undefined;
    let mounted: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const current = mounted;
        mounted = undefined;
        if (current) await unmount(current);
        target?.remove();
    });

    it("names the group for assistive technology and shows the title once, in the shared title style", () => {
        target = document.createElement("div");
        document.body.append(target);
        mounted = mount(MenuGroup, { target, props: { title: "Profile", children } });
        flushSync();

        const group = target.querySelector('[role="group"]');
        expect(group?.getAttribute("aria-label")).toBe("Profile");
        const title = group?.querySelector(".k-menu-title");
        expect(title?.textContent).toBe("Profile");
        expect(title?.getAttribute("aria-hidden")).toBe("true");
        expect(group?.querySelectorAll("button")).toHaveLength(1);
    });
});
