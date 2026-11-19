import { describe, expect, it, vi } from "vitest";
import { mount } from "svelte";
import { get, type Writable } from "svelte/store";
import {
    registerActionBar,
    registerAppFrame,
    registerSceneExtension,
    setEmbeddedChatHost,
} from "../ExternalModule/ClientExtensionPoints";
import type { SceneFrameContext } from "../ExternalModule/ClientExtensionPoints";
import { installKonclui } from "./integration";
import { createBrowserEffectsPort } from "./Ambience/phaser/browserEffectsPort";
import { gameActions } from "./Preferences/phaser/gameActions";
import { installGameCommands } from "./Preferences/stores/gameCommands";
import { cameraSceneAdapter } from "./OfficeMenu/phaser/cameraSceneAdapter";
import { mapToolsAdapter } from "./OfficeMenu/phaser/mapToolsAdapter";
import { installCameraScene } from "./OfficeMenu/stores/cameraScene";
import { installMapTools } from "./OfficeMenu/stores/mapTools";
import { presenceStore } from "./Presence/stores/presenceStore";
import { deskActions } from "./Focus/phaser/deskActions";
import { installDeskCommands } from "./Focus/stores/deskCommands";
import { focusActiveStore, publishSeat } from "./Focus/stores/focusStore";

vi.mock("./Shell/components/Frame.svelte", () => ({ default: {} }));
vi.mock("./Shell/components/Dock.svelte", () => ({ default: {} }));
vi.mock("./Shell/stores/shellStore", () => ({ shellActiveStore: {}, shellEnabledStore: {} }));
vi.mock("./Ambience/phaser/browserEffectsPort", () => ({ createBrowserEffectsPort: vi.fn(() => ({})) }));
vi.mock("./Preferences/components/PreferencesHost.svelte", () => ({ default: {} }));
vi.mock("./Preferences/phaser/gameActions", () => ({ gameActions: { openNameEditor: vi.fn() } }));
vi.mock("./Preferences/stores/gameCommands", () => ({ installGameCommands: vi.fn() }));
vi.mock("./OfficeMenu/phaser/cameraSceneAdapter", () => ({ cameraSceneAdapter: { openCameraScene: vi.fn() } }));
vi.mock("./OfficeMenu/stores/cameraScene", () => ({ installCameraScene: vi.fn() }));
vi.mock("./OfficeMenu/phaser/mapToolsAdapter", () => ({ mapToolsAdapter: { equip: vi.fn() } }));
vi.mock("./OfficeMenu/stores/mapTools", () => ({ installMapTools: vi.fn() }));
vi.mock("./Focus/phaser/deskActions", () => ({ deskActions: { walkToDesk: vi.fn() } }));
vi.mock("./Focus/stores/deskCommands", () => ({ installDeskCommands: vi.fn() }));
// The real focus store reads the upstream conversation signal, which pulls in the media graph.
vi.mock("./Focus/stores/focusStore", async () => {
    const { writable } = await import("svelte/store");
    return { focusActiveStore: writable(false), publishSeat: vi.fn() };
});
vi.mock("svelte", () => ({ mount: vi.fn() }));
vi.stubGlobal("document", { createElement: () => ({}), body: { append: vi.fn() } });
vi.mock("../ExternalModule/ClientExtensionPoints", () => ({
    registerAppFrame: vi.fn(),
    registerActionBar: vi.fn(),
    registerSceneExtension: vi.fn(),
    setEmbeddedChatHost: vi.fn(),
}));

describe("installKonclui", () => {
    it("plugs Konclui into each extension point once, and registers each scene extension once", () => {
        installKonclui();
        installKonclui();

        expect(registerAppFrame).toHaveBeenCalledTimes(1);
        expect(registerActionBar).toHaveBeenCalledTimes(1);
        expect(setEmbeddedChatHost).toHaveBeenCalledTimes(1);
        expect(mount).toHaveBeenCalledTimes(1);
        expect(installGameCommands).toHaveBeenCalledTimes(1);
        expect(installGameCommands).toHaveBeenCalledWith(gameActions);
        expect(installMapTools).toHaveBeenCalledTimes(1);
        expect(installMapTools).toHaveBeenCalledWith(mapToolsAdapter);
        expect(installCameraScene).toHaveBeenCalledTimes(1);
        expect(installCameraScene).toHaveBeenCalledWith(cameraSceneAdapter);
        expect(installDeskCommands).toHaveBeenCalledTimes(1);
        expect(installDeskCommands).toHaveBeenCalledWith(deskActions);
        expect(vi.mocked(registerSceneExtension).mock.calls.map(([extension]) => extension.id)).toEqual([
            "konclui.seatedPose",
            "konclui.presence",
            "konclui.sceneEffects",
            "konclui.focusSeat",
        ]);
    });

    it("feeds the presence store from the one presence extension, so the pill and the place chip share one walk of the scene", () => {
        installKonclui();
        const presence = vi
            .mocked(registerSceneExtension)
            .mock.calls.map(([extension]) => extension)
            .find((extension) => extension.id === "konclui.presence");
        const context = {
            scene: { getGameMapFrontWrapper: () => ({ getAreas: () => undefined }) },
            time: 0,
            currentPlayer: { x: 10, y: 10 },
            remoteCharacters: new Map([[4, { userId: 4, playerName: "Ana Ribeiro", x: 40, y: 10 }]]),
        } as unknown as SceneFrameContext;

        presence?.onFrame?.(context);

        expect(get(presenceStore)).toEqual({
            nearest: [{ id: 4, name: "Ana Ribeiro" }],
            nearCount: 1,
            place: undefined,
        });
    });

    it("gives the effects the user's focus, so the vignette follows it and darkens nothing while focus is off", () => {
        installKonclui();
        const options = vi.mocked(createBrowserEffectsPort).mock.calls[0]?.[0];
        const focus = focusActiveStore as unknown as Writable<boolean>;

        expect(options?.focused?.()).toBe(false);
        focus.set(true);
        expect(options?.focused?.()).toBe(true);
        focus.set(false);
        expect(options?.focused?.()).toBe(false);
    });

    it("tells focus when the player sits, from the player's own officeSeat variable", () => {
        installKonclui();
        const seat = vi
            .mocked(registerSceneExtension)
            .mock.calls.map(([extension]) => extension)
            .find((extension) => extension.id === "konclui.focusSeat");
        const context = {
            currentPlayer: {},
            baseUrl: "https://office.example/_/global/map",
            getPlayerVariable: () => ({ v: 1, direction: "down" }),
        } as unknown as SceneFrameContext;

        seat?.onFrame?.(context);

        expect(publishSeat).toHaveBeenCalledWith(true);
    });
});
