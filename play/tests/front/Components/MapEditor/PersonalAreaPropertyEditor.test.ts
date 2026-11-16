// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { EntityDataProperty, OpenFilePropertyData, PersonalAreaPropertyData } from "@workadventure/map-editor";

const openModal = vi.hoisted(() => vi.fn());
vi.mock("@wa-modals", () => ({ modals: { open: openModal, close: vi.fn() } }));
vi.mock("../../../../src/front/Components/MapEditor/ActionPopupOnPersonalAreaWithEntities.svelte", () => ({
    default: "ActionPopupOnPersonalAreaWithEntities",
}));
const entitiesInside = vi.hoisted(() => ({ properties: [] as EntityDataProperty[][] }));
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => ({
            connection: undefined,
            getGameMapFrontWrapper: () => ({
                getEntitiesManager: () => ({
                    getEntitiesInsideArea: (areaId: string) =>
                        new Map(
                            areaId === "desk"
                                ? entitiesInside.properties.map((properties, index) => [
                                      `entity-${index}`,
                                      { getProperties: () => properties },
                                  ])
                                : [],
                        ),
                }),
            }),
        }),
    },
}));
vi.mock("../../../../src/front/Stores/MapEditorStore", async () => {
    const { readable } = await import("svelte/store");
    return { mapEditorSelectedAreaPreviewStore: readable({ getId: () => "desk" }) };
});
vi.mock("../../../../src/front/Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { inputFormFocusStore: writable(false) };
});
vi.mock("../../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every message reads as its own path, e.g. "mapEditor.properties.removeProperty".
    const messages = (path: string): unknown =>
        new Proxy(() => path, {
            get: (_target, name) => messages(path === "" ? String(name) : `${path}.${String(name)}`),
        });
    const LL = readable(messages(""));
    return { default: LL, LL, locale: readable("en-US") };
});

import PersonalAreaPropertyEditor from "../../../../src/front/Components/MapEditor/PropertyEditor/PersonalAreaPropertyEditor.svelte";

type PopupProps = {
    entitiesCount: number;
    warning?: string;
    onDeleteEntities: () => void;
    onKeepEntities: () => void;
    onCancel: () => void;
};

const uploadedDocument: OpenFilePropertyData = {
    id: "doc",
    type: "openFile",
    name: "plan.pdf",
    link: "http://map-storage/file/plan.pdf",
    newTab: false,
    hideUrl: false,
    closable: true,
};
const plainDocument: OpenFilePropertyData = {
    ...uploadedDocument,
    name: null,
    link: "https://example.com/plan.pdf",
};

function ownedArea(): PersonalAreaPropertyData {
    return {
        id: "personal",
        type: "personalAreaPropertyData",
        accessClaimMode: "dynamic",
        allowedTags: [],
        ownerId: "owner",
    };
}

describe("PersonalAreaPropertyEditor with objects inside the area", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        openModal.mockReset();
        entitiesInside.properties = [];
    });

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
    });

    function render() {
        const property = ownedArea();
        const onchange = vi.fn();
        const onclose = vi.fn();
        component = mount(PersonalAreaPropertyEditor, { target, props: { property, onchange, onclose } });
        flushSync();
        return { property, onchange, onclose };
    }

    function click(selector: string): PopupProps {
        const button = target.querySelector<HTMLButtonElement>(selector);
        expect(button).not.toBeNull();
        button?.click();
        flushSync();
        expect(openModal).toHaveBeenCalledWith("ActionPopupOnPersonalAreaWithEntities", expect.anything());
        return openModal.mock.calls[0][1] as PopupProps;
    }

    const removeProperty = 'button[aria-label="mapEditor.properties.removeProperty"]';
    const revokeAccess = '[data-testid="revokeAccessButton"]';

    it.each([
        ["removing the property", removeProperty],
        ["revoking the owner", revokeAccess],
    ])("warns before %s when an object inside holds an uploaded file", (_label, selector) => {
        entitiesInside.properties = [[plainDocument], [uploadedDocument]];
        render();

        const popup = click(selector);

        expect(popup.entitiesCount).toBe(2);
        expect(popup.warning).toBe("mapEditor.uploadedFileDeletion.warning");
    });

    it("gives no file warning when no object inside holds an uploaded file", () => {
        entitiesInside.properties = [[plainDocument]];
        render();

        expect(click(removeProperty).warning).toBeUndefined();
    });

    it("keeps the objects and Cancel choices as they were", () => {
        entitiesInside.properties = [[uploadedDocument]];
        const { property, onchange, onclose } = render();

        const removal = click(removeProperty);
        removal.onCancel();
        expect(onclose).not.toHaveBeenCalled();
        removal.onKeepEntities();
        expect(onclose).toHaveBeenLastCalledWith();
        removal.onDeleteEntities();
        expect(onclose).toHaveBeenLastCalledWith(true);

        openModal.mockReset();
        const revocation = click(revokeAccess);
        revocation.onCancel();
        expect(property.ownerId).toBe("owner");
        expect(onchange).not.toHaveBeenCalled();
        revocation.onDeleteEntities();
        expect(property.ownerId).toBeNull();
        expect(onchange).toHaveBeenLastCalledWith(true);
    });
});
