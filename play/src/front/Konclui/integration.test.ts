import { describe, expect, it, vi } from "vitest";
import { mount } from "svelte";
import { get, type Writable } from "svelte/store";
import {
    registerActionBar,
    registerAppFrame,
    registerMapTools,
    registerSceneExtension,
    registerWorldSpaceExtension,
    setEmbeddedChatHost,
} from "../ExternalModule/ClientExtensionPoints";
import type { SceneFrameContext } from "../ExternalModule/ClientExtensionPoints";
import { registerCustomEmoteProvider } from "../Phaser/Entity/CustomEmotes";
import { registerReactionsMenu } from "../ExternalModule/ReactionsMenuPort";
import { installKonclui } from "./integration";
import { createBrowserEffectsPort } from "./Ambience/phaser/browserEffectsPort";
import { gameActions } from "./Preferences/phaser/gameActions";
import { installGameCommands } from "./Preferences/stores/gameCommands";
import { cameraSceneAdapter } from "./OfficeMenu/phaser/cameraSceneAdapter";
import { mapToolsAdapter } from "./OfficeMenu/phaser/mapToolsAdapter";
import { installCameraScene } from "./OfficeMenu/stores/cameraScene";
import { installMapTools } from "./OfficeMenu/stores/mapTools";
import { presenceStore } from "./Presence/stores/presenceStore";
import { presenceActions } from "./Presence/phaser/presenceActions";
import { crowdStore } from "./Presence/stores/crowdStore";
import { installPresenceCommands } from "./Presence/stores/presenceCommands";
import { attachWorldSpace, rosterListOpenStore } from "./Presence/stores/worldRoster";
import { deskActions } from "./Focus/phaser/deskActions";
import { installDeskCommands } from "./Focus/stores/deskCommands";
import { focusActiveStore, publishSeat } from "./Focus/stores/focusStore";
import MapTools from "./MapTools/components/MapTools.svelte";
import { mapToolsActions } from "./MapTools/phaser/mapToolsActions";
import { createTileInteractionExtension } from "./MapTools/phaser/tileInteractionExtension";
import { localUserId, publishAtDesk, publishDesks } from "./MapTools/stores/deskStore";
import { publishWalk } from "./MapTools/stores/walkStore";
import { installMapToolsCommands } from "./MapTools/stores/mapToolsCommands";
import { shellActiveStore } from "./Shell/stores/shellStore";
import EmoteSection from "./Reactions/components/EmoteSection.svelte";
import { customEmoteProvider, describeNativeReaction } from "./Reactions/stores/reactionsAdapter";

vi.mock("./Shell/components/Frame.svelte", () => ({ default: {} }));
vi.mock("./Shell/components/Dock.svelte", () => ({ default: {} }));
vi.mock("./Shell/stores/shellStore", async () => {
    const { writable } = await import("svelte/store");
    return { shellActiveStore: writable(false), shellEnabledStore: writable(false) };
});
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
vi.mock("../Phaser/Entity/CustomEmotes", () => ({ registerCustomEmoteProvider: vi.fn() }));
vi.mock("../ExternalModule/ReactionsMenuPort", () => ({ registerReactionsMenu: vi.fn() }));
vi.mock("./Reactions/components/EmoteSection.svelte", () => ({ default: {} }));
vi.mock("./Reactions/stores/reactionsAdapter", () => ({
    customEmoteProvider: { resolve: vi.fn() },
    describeNativeReaction: vi.fn(),
}));
vi.mock("./MapTools/components/MapTools.svelte", () => ({ default: {} }));
vi.mock("./MapTools/phaser/mapToolsActions", () => ({
    mapToolsActions: { centerOnPlayer: vi.fn(), goToDesk: vi.fn() },
}));
vi.mock("./MapTools/phaser/tileInteractionExtension", () => ({
    createTileInteractionExtension: vi.fn(() => ({ id: "konclui.tileInteraction", cancelWalk: vi.fn(() => true) })),
}));
vi.mock("./MapTools/stores/deskStore", () => ({
    publishDesks: vi.fn(),
    publishAtDesk: vi.fn(),
    localUserId: vi.fn(),
}));
vi.mock("./MapTools/stores/mapToolsCommands", () => ({ installMapToolsCommands: vi.fn() }));
vi.mock("./Presence/phaser/presenceActions", () => ({ presenceActions: { walkTo: vi.fn() } }));
vi.mock("./Presence/stores/presenceCommands", () => ({ installPresenceCommands: vi.fn() }));
vi.mock("svelte", () => ({ mount: vi.fn() }));
vi.stubGlobal("document", { createElement: () => ({}), body: { append: vi.fn() } });
vi.mock("../ExternalModule/ClientExtensionPoints", () => ({
    registerAppFrame: vi.fn(),
    registerActionBar: vi.fn(),
    registerMapTools: vi.fn(),
    registerSceneExtension: vi.fn(),
    registerWorldSpaceExtension: vi.fn(),
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
            "konclui.desks",
            "konclui.tileInteraction",
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

    it("tells the desk tool whether the user sits at their desk, from the user's own seat and the picture of their chair", () => {
        vi.mocked(localUserId).mockReturnValue("uuid-ana");
        installKonclui();
        const desks = vi
            .mocked(registerSceneExtension)
            .mock.calls.map(([extension]) => extension)
            .find((extension) => extension.id === "konclui.desks");
        const entities = new Map([["chair-4", { x: 96, y: 96, displayWidth: 32, displayHeight: 48 }]]);
        const context = {
            scene: { getGameMapFrontWrapper: () => ({ getEntitiesManager: () => ({ getEntities: () => entities }) }) },
            currentPlayer: { x: 112, y: 128 },
            getRoomVariable: () => JSON.stringify({ "chair-4": { uuid: "uuid-ana", name: "Ana" } }),
            getPlayerVariable: () => ({ v: 1, direction: "up" }),
        } as unknown as SceneFrameContext;

        desks?.onFrame?.(context);

        expect(publishDesks).toHaveBeenCalledWith({
            kind: "desks",
            desks: { "chair-4": { uuid: "uuid-ana", name: "Ana" } },
        });
        expect(publishAtDesk).toHaveBeenLastCalledWith(true);
    });

    it("gives the engine the provider of the pixel emotes and the reactions menu their grid, each once", () => {
        installKonclui();
        installKonclui();

        expect(registerCustomEmoteProvider).toHaveBeenCalledTimes(1);
        expect(registerCustomEmoteProvider).toHaveBeenCalledWith(customEmoteProvider);
        expect(registerReactionsMenu).toHaveBeenCalledTimes(1);
        expect(registerReactionsMenu).toHaveBeenCalledWith({
            section: EmoteSection,
            describeReaction: describeNativeReaction,
        });
    });

    it("fills the map tools slot of the zoom column while the shell is active", () => {
        installKonclui();

        expect(registerMapTools).toHaveBeenCalledTimes(1);
        expect(registerMapTools).toHaveBeenCalledWith({ component: MapTools, active: shellActiveStore });
    });

    it("lets the floor be clicked while the shell is active, and gives the tools the walk it reports", () => {
        installKonclui();
        const options = vi.mocked(createTileInteractionExtension).mock.calls[0]?.[0];

        expect(options?.active).toBe(shellActiveStore);
        expect(options?.publish).toBe(publishWalk);
    });

    it("ends a walk through the tile extension, which owns the walk, and hands the rest of the actions over as they are", () => {
        installKonclui();
        const commands = vi.mocked(installMapToolsCommands).mock.calls[0]?.[0];
        const extension = vi.mocked(createTileInteractionExtension).mock.results[0]?.value as {
            cancelWalk: ReturnType<typeof vi.fn>;
        };

        commands?.cancelWalk();

        expect(extension.cancelWalk).toHaveBeenCalledTimes(1);
        expect(commands?.centerOnPlayer).toBe(mapToolsActions.centerOnPlayer);
        expect(commands?.goToDesk).toBe(mapToolsActions.goToDesk);
    });
});

describe("installKonclui, the people panel", () => {
    it("gives the world space to the roster that counts the world and lists it only while the panel is open", () => {
        installKonclui();

        expect(registerWorldSpaceExtension).toHaveBeenCalledTimes(1);
        expect(registerWorldSpaceExtension).toHaveBeenCalledWith({ joined: attachWorldSpace });
    });

    it("walks to a person of the panel through the connection", () => {
        installKonclui();

        expect(installPresenceCommands).toHaveBeenCalledTimes(1);
        expect(installPresenceCommands).toHaveBeenCalledWith(presenceActions);
    });

    it("hands the people around the player to the panel only while the panel is open", () => {
        installKonclui();
        const presence = vi
            .mocked(registerSceneExtension)
            .mock.calls.map(([extension]) => extension)
            .find((extension) => extension.id === "konclui.presence");
        const frame = (time: number) =>
            ({
                scene: {
                    roomUrl: "https://office.example/map",
                    connection: { getSpaceUserId: () => "https://office.example/map_1" },
                    getGameMapFrontWrapper: () => ({ getAreas: () => undefined }),
                },
                time,
                currentPlayer: { x: 10, y: 10, playerName: "Eu" },
                remoteCharacters: new Map([
                    [4, { userId: 4, userUuid: "ana", playerName: "Ana Ribeiro", x: 40, y: 10 }],
                ]),
                remotePlayers: new Map([[4, { availabilityStatus: 1 }]]),
            }) as unknown as SceneFrameContext;

        rosterListOpenStore.set(false);
        presence?.onFrame?.(frame(0));
        expect(get(crowdStore)).toBeUndefined();

        rosterListOpenStore.set(true);
        presence?.onFrame?.(frame(300));
        expect(get(crowdStore)?.people.map((person) => person.name)).toEqual(["Ana Ribeiro"]);

        rosterListOpenStore.set(false);
        presence?.onFrame?.(frame(600));
        expect(get(crowdStore)).toBeUndefined();
    });
});
