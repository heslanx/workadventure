// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from "svelte";
import { get, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cameraDetachedStore } from "../../../Stores/CameraStore";
import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
import { stubWebAnimations, type WebAnimationsStub } from "../../../Utils/webAnimationsStub";
import { DESK_ACTION_ID, parseDesks } from "../domain/desk";
import { NOT_WALKING } from "../domain/walk";
import { installMapToolsCommands } from "../stores/mapToolsCommands";
import { publishWalk } from "../stores/walkStore";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
const items = writable(new Map<string, unknown>());
vi.mock("../../../Stores/AdditionalItemsMenuStore", () => ({ getAdditionalMenuItemStore: () => items }));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getLocalUser: () => ({ uuid: "uuid-ana" }) },
}));

const { default: MapTools } = await import("./MapTools.svelte");
const { publishAtDesk, publishDesks } = await import("../stores/deskStore");

describe("MapTools", () => {
    const column = document.createElement("div");
    column.className = "k-control-column";
    let component: ReturnType<typeof mount> | undefined;
    const commands = { centerOnPlayer: vi.fn(), goToDesk: vi.fn(), cancelWalk: vi.fn() };

    beforeEach(() => {
        installMapToolsCommands(commands);
        items.set(new Map([[DESK_ACTION_ID, {}]]));
    });

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        column.replaceChildren();
        column.remove();
        publishWalk(NOT_WALKING);
        publishDesks({ kind: "absent" });
        publishAtDesk(false);
        cameraDetachedStore.set(false);
        mapEditorModeStore.set(false);
        for (const command of Object.values(commands)) command.mockReset();
        vi.restoreAllMocks();
    });

    /** The tools in the column upstream draws: after them, the zoom controls, as buttons of the same kind. */
    function show(): void {
        const zoom = document.createElement("div");
        for (const name of ["zoom-in", "zoom-out"]) {
            const button = document.createElement("button");
            button.className = "k-control";
            button.dataset.testid = name;
            zoom.append(button);
        }
        document.body.append(column);
        column.append(zoom);
        component = mount(MapTools, { target: column, anchor: zoom });
        flushSync();
    }

    const tool = (name: string): HTMLButtonElement | null => column.querySelector(`[data-testid="${name}"]`);
    const toolNames = (): string[] =>
        [...column.querySelectorAll<HTMLElement>("button")]
            .map((button) => button.dataset.testid ?? "")
            .filter((name) => !name.startsWith("zoom"));
    const status = (): string => column.querySelector('[role="status"]')?.textContent ?? "";
    const ownDesk = () => publishDesks(parseDesks({ "chair-4": { uuid: "uuid-ana" } }));

    it("draws no tool when none can act: no walk, no desk, the view on the avatar", () => {
        show();

        expect(toolNames()).toEqual([]);
        expect(status()).toBe("");
    });

    it("draws the cancel control while the player walks, and ends the walk when it is used", () => {
        publishWalk({ walking: true, walkStatus: "going" });
        show();

        expect(tool("map-tool-cancel-walk")?.getAttribute("aria-label")).toBe("konclui.mapTools.cancelWalk");
        tool("map-tool-cancel-walk")?.click();

        expect(commands.cancelWalk).toHaveBeenCalledTimes(1);
    });

    it("takes the cancel control away when the walk ends", () => {
        publishWalk({ walking: true, walkStatus: "going" });
        show();

        publishWalk(NOT_WALKING);
        flushSync();

        expect(tool("map-tool-cancel-walk")).toBeNull();
    });

    it("goes to the desk for a user who has one, and leaves the control out for one who has none", () => {
        show();
        expect(tool("map-tool-go-to-desk")).toBeNull();

        ownDesk();
        flushSync();
        expect(tool("map-tool-go-to-desk")?.getAttribute("aria-label")).toBe("konclui.mapTools.goToMyDesk");
        tool("map-tool-go-to-desk")?.click();

        expect(commands.goToDesk).toHaveBeenCalledTimes(1);
    });

    it("leaves the desk control out until the office script has registered its button, so it never does nothing", () => {
        items.set(new Map());
        ownDesk();
        show();

        expect(tool("map-tool-go-to-desk")).toBeNull();

        items.set(new Map([[DESK_ACTION_ID, {}]]));
        flushSync();
        expect(tool("map-tool-go-to-desk")).not.toBeNull();
    });

    describe("while the user already sits at their desk", () => {
        const sitAtDesk = () => {
            ownDesk();
            publishAtDesk(true);
        };
        const reasonText = (): string => tool("map-tool-go-to-desk-reason")?.textContent ?? "";
        const labelText = (): string => tool("map-tool-go-to-desk-label")?.textContent?.trim() ?? "";

        it("keeps the desk tool on the column, dimmed and focusable, never disabled: a control that cannot act says so", () => {
            sitAtDesk();
            show();

            const desk = tool("map-tool-go-to-desk");
            expect(desk?.getAttribute("aria-disabled")).toBe("true");
            expect(desk?.hasAttribute("disabled")).toBe(false);
            desk?.focus();
            expect(document.activeElement).toBe(desk);
        });

        it("keeps its name, and gives the reason as what slides in beside it and as its description", () => {
            sitAtDesk();
            show();

            const desk = tool("map-tool-go-to-desk");
            expect(desk?.getAttribute("aria-label")).toBe("konclui.mapTools.goToMyDesk");
            expect(labelText()).toBe("konclui.mapTools.alreadyAtDesk");
            expect(reasonText()).toBe("konclui.mapTools.alreadyAtDesk");
            expect(desk?.getAttribute("aria-describedby")).toBe(tool("map-tool-go-to-desk-reason")?.id);
        });

        it("does not walk when it is pressed, and answers at once: the reason shows beside it and a live region says it", () => {
            sitAtDesk();
            show();
            const label = tool("map-tool-go-to-desk-label");
            expect(label?.classList.contains("opacity-0")).toBe(true);

            tool("map-tool-go-to-desk")?.click();
            flushSync();

            expect(commands.goToDesk).not.toHaveBeenCalled();
            expect(label?.classList.contains("opacity-100")).toBe(true);
            expect(label?.classList.contains("opacity-0")).toBe(false);
            expect(status()).toBe("konclui.mapTools.alreadyAtDesk");
        });

        it("hides the reason again when the pointer leaves or the focus does", () => {
            sitAtDesk();
            show();
            const desk = tool("map-tool-go-to-desk");
            const label = tool("map-tool-go-to-desk-label");

            desk?.click();
            flushSync();
            desk?.dispatchEvent(new MouseEvent("mouseleave"));
            flushSync();
            expect(label?.classList.contains("opacity-0")).toBe(true);

            desk?.click();
            flushSync();
            desk?.dispatchEvent(new FocusEvent("blur"));
            flushSync();
            expect(label?.classList.contains("opacity-0")).toBe(true);
        });

        it("keeps the focus where it is when it is pressed, since the tool stays", async () => {
            sitAtDesk();
            show();
            tool("map-tool-go-to-desk")?.focus();

            tool("map-tool-go-to-desk")?.click();
            await tick();

            expect(document.activeElement).toBe(tool("map-tool-go-to-desk"));
        });

        it("takes the reason back when the user stands up, and the tool acts again", () => {
            sitAtDesk();
            show();
            tool("map-tool-go-to-desk")?.click();
            flushSync();

            publishAtDesk(false);
            flushSync();

            const desk = tool("map-tool-go-to-desk");
            expect(desk?.hasAttribute("aria-disabled")).toBe(false);
            expect(desk?.hasAttribute("aria-describedby")).toBe(false);
            expect(tool("map-tool-go-to-desk-reason")).toBeNull();
            expect(labelText()).toBe("konclui.mapTools.goToMyDesk");
            expect(status()).toBe("");
            desk?.click();
            expect(commands.goToDesk).toHaveBeenCalledTimes(1);
        });

        it("does not show an old reason the next time the user sits: it waits for a press", () => {
            sitAtDesk();
            show();
            tool("map-tool-go-to-desk")?.click();
            flushSync();
            publishAtDesk(false);
            flushSync();

            publishAtDesk(true);
            flushSync();

            expect(tool("map-tool-go-to-desk-label")?.classList.contains("opacity-0")).toBe(true);
            expect(status()).toBe("");
        });

        it("leaves the walk's own words in the live region while a walk goes on", () => {
            sitAtDesk();
            show();
            tool("map-tool-go-to-desk")?.click();

            publishWalk({ walking: true, walkStatus: "going" });
            flushSync();

            expect(status()).toBe("konclui.mapTools.walking");
        });

        it("keeps its place in the column, between the cancel and the centre controls", () => {
            publishWalk({ walking: true, walkStatus: "going" });
            sitAtDesk();
            cameraDetachedStore.set(true);
            show();

            expect(toolNames()).toEqual(["map-tool-cancel-walk", "map-tool-go-to-desk", "center-camera-on-player"]);
        });
    });

    it("draws the centre control only while the view is away from the avatar, and brings it back when used", () => {
        show();
        expect(tool("center-camera-on-player")).toBeNull();

        cameraDetachedStore.set(true);
        flushSync();
        tool("center-camera-on-player")?.click();

        expect(commands.centerOnPlayer).toHaveBeenCalledTimes(1);
    });

    it("steps aside for upstream's own centre control in the map editor, where the view is always free", () => {
        cameraDetachedStore.set(true);
        mapEditorModeStore.set(true);
        show();

        expect(tool("center-camera-on-player")).toBeNull();
    });

    it("draws the tools in the order of the column: cancel, desk, centre, above the zoom controls", () => {
        publishWalk({ walking: true, walkStatus: "going" });
        ownDesk();
        cameraDetachedStore.set(true);
        show();

        expect(toolNames()).toEqual(["map-tool-cancel-walk", "map-tool-go-to-desk", "center-camera-on-player"]);
        const buttons = [...column.querySelectorAll("button")];
        expect(buttons.indexOf(tool("center-camera-on-player") as HTMLButtonElement)).toBeLessThan(
            buttons.indexOf(tool("zoom-in") as HTMLButtonElement),
        );
    });

    it("never uses the disabled attribute: a tool that cannot act is not drawn", () => {
        publishWalk({ walking: true, walkStatus: "going" });
        ownDesk();
        cameraDetachedStore.set(true);
        show();

        for (const name of toolNames()) {
            expect(tool(name)?.hasAttribute("disabled")).toBe(false);
        }
    });

    it("says what the walk is doing in a live region, from the controller's throttled status", () => {
        show();

        publishWalk({ walking: true, walkStatus: "going" });
        flushSync();
        expect(status()).toBe("konclui.mapTools.walking");

        publishWalk({ walking: false, walkStatus: "cancelled" });
        flushSync();
        expect(status()).toBe("konclui.mapTools.walkCancelled");

        publishWalk(NOT_WALKING);
        flushSync();
        expect(status()).toBe("");
    });

    it("keeps the live region out of the column's flow, so it adds no gap", () => {
        show();

        expect(column.querySelector('[role="status"]')?.classList.contains("sr-only")).toBe(true);
    });

    it("moves the focus to the next control of the column when the control that had it leaves", async () => {
        publishWalk({ walking: true, walkStatus: "going" });
        commands.cancelWalk.mockImplementation(() => publishWalk(NOT_WALKING));
        show();
        tool("map-tool-cancel-walk")?.focus();

        tool("map-tool-cancel-walk")?.click();
        flushSync();
        await tick();
        await tick();

        expect(tool("map-tool-cancel-walk")).toBeNull();
        expect(document.activeElement).toBe(tool("zoom-in"));
    });

    it("keeps the focus where it is when the control stays", async () => {
        ownDesk();
        show();
        tool("map-tool-go-to-desk")?.focus();

        tool("map-tool-go-to-desk")?.click();
        await tick();

        expect(document.activeElement).toBe(tool("map-tool-go-to-desk"));
    });

    it("reports a tool that fails, and keeps the column working", () => {
        const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
        commands.goToDesk.mockImplementation(() => {
            throw new Error("no listener");
        });
        ownDesk();
        show();

        expect(() => tool("map-tool-go-to-desk")?.click()).not.toThrow();

        expect(report).toHaveBeenCalledTimes(1);
        expect(String(report.mock.calls[0]?.[0])).toContain("a tool failed");
        expect(get(cameraDetachedStore)).toBe(false);
    });

    describe("its entrance and its exit", () => {
        let animations: WebAnimationsStub;

        beforeEach(() => {
            animations = stubWebAnimations();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
        });

        afterEach(() => {
            animations.restore();
            vi.unstubAllGlobals();
        });

        const durations = () => animations.moving().map((animation) => animation.options.duration);
        const showAndSettle = async () => {
            show();
            await animations.settle();
            await animations.finishMoving();
        };

        it("rises in on the surface transition when a tool can act", async () => {
            show();
            await animations.settle();
            expect(tool("map-tool-cancel-walk")).toBeNull();

            publishWalk({ walking: true, walkStatus: "going" });
            flushSync();
            await animations.settle();

            expect(tool("map-tool-cancel-walk")).not.toBeNull();
            expect(durations()).toEqual([290]);
        });

        it("stays in the column for the length of its exit, inert, and is then taken away", async () => {
            publishWalk({ walking: true, walkStatus: "going" });
            await showAndSettle();

            publishWalk(NOT_WALKING);
            flushSync();
            await animations.settle();

            expect(tool("map-tool-cancel-walk")).not.toBeNull();
            expect(tool("map-tool-cancel-walk")?.inert).toBe(true);
            expect(durations()).toEqual([200]);

            await animations.finishMoving();

            expect(tool("map-tool-cancel-walk")).toBeNull();
        });

        it("hands the focus to the next control as soon as the tool that had it is leaving, not once it is gone", async () => {
            publishWalk({ walking: true, walkStatus: "going" });
            commands.cancelWalk.mockImplementation(() => publishWalk(NOT_WALKING));
            await showAndSettle();
            tool("map-tool-cancel-walk")?.focus();

            tool("map-tool-cancel-walk")?.click();
            flushSync();
            await animations.settle();

            // The tool is still in the page, held for its exit: the focus must already be on its neighbour.
            expect(tool("map-tool-cancel-walk")).not.toBeNull();
            expect(document.activeElement).toBe(tool("zoom-in"));

            await animations.finishMoving();
            expect(tool("map-tool-cancel-walk")).toBeNull();
            expect(document.activeElement).toBe(tool("zoom-in"));
        });

        it("does not hand the focus to a neighbour that is already leaving", async () => {
            publishWalk({ walking: true, walkStatus: "going" });
            commands.cancelWalk.mockImplementation(() => publishWalk(NOT_WALKING));
            ownDesk();
            await showAndSettle();
            // The desk tool, next to the cancel control, goes first and is held for its exit.
            publishDesks({ kind: "absent" });
            flushSync();
            await animations.settle();
            expect(tool("map-tool-go-to-desk")?.inert).toBe(true);
            tool("map-tool-cancel-walk")?.focus();

            tool("map-tool-cancel-walk")?.click();
            flushSync();
            await animations.settle();

            expect(document.activeElement).toBe(tool("zoom-in"));
        });

        it("leaves in the same flush, with nothing to hold, for a viewer who reduces motion", async () => {
            publishWalk({ walking: true, walkStatus: "going" });
            commands.cancelWalk.mockImplementation(() => publishWalk(NOT_WALKING));
            await showAndSettle();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
            tool("map-tool-cancel-walk")?.focus();
            const before = animations.animations.length;

            tool("map-tool-cancel-walk")?.click();
            flushSync();
            await tick();

            expect(tool("map-tool-cancel-walk")).toBeNull();
            expect(animations.animations.length).toBe(before);
            expect(document.activeElement).toBe(tool("zoom-in"));
        });

        it("gives under a press, as the other controls that are clicked often do", async () => {
            ownDesk();
            await showAndSettle();

            expect(tool("map-tool-go-to-desk")?.classList.contains("k-press")).toBe(true);
        });
    });
});
