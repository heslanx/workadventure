// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount, type Component } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { OpenFilePropertyData, PlayAudioPropertyData } from "@workadventure/map-editor";

const openModal = vi.hoisted(() => vi.fn());
vi.mock("@wa-modals", () => ({ modals: { open: openModal, close: vi.fn() } }));
vi.mock("../../../../src/front/Chat/Components/ConfirmDialog.svelte", () => ({ default: "ConfirmDialog" }));
vi.mock("../../../../src/front/Components/Toasts/UndoToast.svelte", () => ({ default: "UndoToast" }));
const addToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/front/Stores/ToastStoreSingleton", () => ({ toastStore: { addToast } }));
vi.mock("../../../../src/front/Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: vi.fn() } }));
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../src/front/Stores/GameSceneStore", async () => {
    const { readable } = await import("svelte/store");
    return { gameSceneStore: readable(undefined) };
});
vi.mock("../../../../src/front/Phaser/Game/MapEditor/Commands/File/UploadFileFrontCommand", () => ({
    UploadFileFrontCommand: vi.fn(),
}));
vi.mock("../../../../src/front/Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { inputFormFocusStore: writable(false) };
});
vi.mock("../../../../src/front/WebRtc/AudioOutputManager", () => ({ audioOutput: () => ({}) }));
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

import OpenFilePropertyEditor from "../../../../src/front/Components/MapEditor/PropertyEditor/OpenFilePropertyEditor.svelte";
import PlayAudioPropertyEditor from "../../../../src/front/Components/MapEditor/PropertyEditor/PlayAudioPropertyEditor.svelte";

type ConfirmProps = { onConfirm: () => Promise<void> };

function uploadedDocument(): OpenFilePropertyData {
    return {
        id: "doc",
        type: "openFile",
        name: "tileset1.png",
        link: "http://map-storage/file/tileset1-doc.png",
        newTab: false,
        hideUrl: false,
        closable: true,
    };
}

function uploadedSound(): PlayAudioPropertyData {
    return {
        id: "sound",
        type: "playAudio",
        audioName: "bell.mp3",
        audioLink: "http://map-storage/sound/bell-sound.mp3",
        volume: 1,
    };
}

type UploadedFileProperty = OpenFilePropertyData | PlayAudioPropertyData;
type EditorProps<P extends UploadedFileProperty> = { property: P; onchange?: () => void; onclose?: () => void };

describe("property editors holding an uploaded file", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        openModal.mockReset();
        addToast.mockReset();
    });

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
    });

    function render<P extends UploadedFileProperty>(editor: Component<EditorProps<P>>, property: P) {
        const onchange = vi.fn();
        const onclose = vi.fn();
        component = mount(editor, { target, props: { property, onchange, onclose } });
        flushSync();
        return { onchange, onclose };
    }

    function click(selector: string) {
        const button = target.querySelector<HTMLButtonElement>(selector);
        expect(button).not.toBeNull();
        button?.click();
        flushSync();
    }

    const removeProperty = 'button[aria-label="mapEditor.properties.removeProperty"]';
    const removeFile = '[data-testid="closeFileUpload"]';

    it("hands the property, upload intact, to the parent's removal guard", () => {
        const property = uploadedDocument();
        let nameWhenParentDecides: string | null | undefined;
        const { onchange, onclose } = render(OpenFilePropertyEditor, property);
        onclose.mockImplementation(() => {
            nameWhenParentDecides = property.name;
        });

        click(removeProperty);

        expect(onclose).toHaveBeenCalledTimes(1);
        expect(nameWhenParentDecides).toBe("tileset1.png");
        expect(onchange).not.toHaveBeenCalled();
    });

    function describeUploadedFileRemoval<P extends UploadedFileProperty>(
        label: string,
        editor: Component<EditorProps<P>>,
        make: () => P,
        file: (property: P) => [string | null | undefined, string | null],
    ) {
        it(`keeps an uploaded ${label} until the person confirms, without an Undo`, async () => {
            const property = make();
            const before = file(property);
            const { onchange } = render(editor, property);

            click(removeFile);

            expect(openModal).toHaveBeenCalledWith("ConfirmDialog", expect.anything());
            expect(file(property)).toEqual(before);
            expect(onchange).not.toHaveBeenCalled();

            await (openModal.mock.calls[0][1] as ConfirmProps).onConfirm();

            expect(file(property)).toEqual([null, property.type === "openFile" ? null : ""]);
            expect(onchange).toHaveBeenCalledTimes(1);
            expect(addToast).not.toHaveBeenCalled();
        });

        it(`fails the confirm and leaves the next ${label} alone when the editor moved on`, async () => {
            const first = make();
            const next = make();
            // A reactive source, so the mounted editor really moves on to the next property.
            const shown = new SvelteMap<"property", P>([["property", first]]);
            const onchange = vi.fn();
            component = mount(editor, {
                target,
                props: {
                    get property() {
                        return shown.get("property") ?? first;
                    },
                    onchange,
                    onclose: vi.fn(),
                },
            });
            flushSync();

            click(removeFile);
            shown.set("property", next);
            flushSync();

            await expect((openModal.mock.calls[0][1] as ConfirmProps).onConfirm()).rejects.toThrow();
            expect(file(next)).toEqual(file(make()));
            expect(file(first)).toEqual(file(make()));
            expect(onchange).not.toHaveBeenCalled();
        });
    }

    describeUploadedFileRemoval("document", OpenFilePropertyEditor, uploadedDocument, (p) => [p.name, p.link]);
    describeUploadedFileRemoval("sound", PlayAudioPropertyEditor, uploadedSound, (p) => [p.audioName, p.audioLink]);
});
