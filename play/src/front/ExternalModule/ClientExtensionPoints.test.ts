import type { Component } from "svelte";
import { get, readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameScene } from "../Phaser/Game/GameScene";
import type { AppFrameComponent, SceneExtension, SceneFrameContext } from "./ClientExtensionPoints";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/svelte", () => ({ captureException }));

describe("gameViewportBounds", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function loadPort() {
        return (await import("./ClientExtensionPoints")).gameViewportBounds;
    }

    it("is unset until an extension measures the game area, so that consumers fall back to the window", async () => {
        const gameViewportBounds = await loadPort();

        expect(get(gameViewportBounds)).toBeUndefined();
    });

    it("holds the area an extension registers and tells its subscribers each time it changes", async () => {
        const gameViewportBounds = await loadPort();
        const seen: Array<unknown> = [];
        const unsubscribe = gameViewportBounds.subscribe((bounds) => seen.push(bounds));

        gameViewportBounds.set({ left: 362, top: 6, width: 1072, height: 788 });
        gameViewportBounds.set({ left: 0, top: 0, width: 640, height: 480 });
        unsubscribe();

        expect(seen).toEqual([
            undefined,
            { left: 362, top: 6, width: 1072, height: 788 },
            { left: 0, top: 0, width: 640, height: 480 },
        ]);
    });

    it("goes back to the window when the extension clears its area", async () => {
        const gameViewportBounds = await loadPort();
        gameViewportBounds.set({ left: 362, top: 6, width: 1072, height: 788 });

        gameViewportBounds.set(undefined);

        expect(get(gameViewportBounds)).toBeUndefined();
    });
});

describe("app frame", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    const frame: AppFrameComponent = () => ({});

    it("is absent until an extension registers one, so that the app is not framed", async () => {
        const { getAppFrame } = await import("./ClientExtensionPoints");

        expect(getAppFrame()).toBeUndefined();
    });

    it("hands the registered frame to the app", async () => {
        const { getAppFrame, registerAppFrame } = await import("./ClientExtensionPoints");

        registerAppFrame(frame);

        expect(getAppFrame()).toBe(frame);
    });

    it("keeps the last frame registered", async () => {
        const { getAppFrame, registerAppFrame } = await import("./ClientExtensionPoints");
        const later: AppFrameComponent = () => ({});

        registerAppFrame(frame);
        registerAppFrame(later);

        expect(getAppFrame()).toBe(later);
    });
});

describe("activeActionBar", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    const dock: Component = () => ({});
    const otherDock: Component = () => ({});

    async function loadPort() {
        return await import("./ClientExtensionPoints");
    }

    it("is undefined when no extension replaces the action bar, so that the default one shows", async () => {
        const { activeActionBar } = await loadPort();

        expect(get(activeActionBar)).toBeUndefined();
    });

    it("stays undefined while the registered override is not active", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();

        registerActionBar({ component: dock, active: readable(false) });

        expect(get(activeActionBar)).toBeUndefined();
    });

    it("is the override component while the override is active", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();

        registerActionBar({ component: dock, active: readable(true) });

        expect(get(activeActionBar)).toBe(dock);
    });

    it("follows the active store of the override and tells its subscribers each time it changes", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();
        const active = writable(false);
        registerActionBar({ component: dock, active });
        const seen: Array<Component | undefined> = [];
        const unsubscribe = activeActionBar.subscribe((component) => seen.push(component));

        active.set(true);
        active.set(false);
        unsubscribe();

        expect(seen).toEqual([undefined, dock, undefined]);
    });

    it("picks up an override registered after a consumer subscribed", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();
        const seen: Array<Component | undefined> = [];
        const unsubscribe = activeActionBar.subscribe((component) => seen.push(component));

        registerActionBar({ component: dock, active: readable(true) });
        unsubscribe();

        expect(seen).toEqual([undefined, dock]);
    });

    it("switches to the override registered last and ignores the active store of the one it replaced", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();
        const firstActive = writable(true);
        registerActionBar({ component: dock, active: firstActive });
        const seen: Array<Component | undefined> = [];
        const unsubscribe = activeActionBar.subscribe((component) => seen.push(component));

        registerActionBar({ component: otherDock, active: readable(false) });
        firstActive.set(false);
        firstActive.set(true);
        unsubscribe();

        expect(seen).toEqual([dock, undefined]);
    });

    it("stops listening to the active store of the override once nothing reads the action bar", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();
        let listeners = 0;
        const active = readable(true, () => {
            listeners += 1;
            return () => {
                listeners -= 1;
            };
        });
        registerActionBar({ component: dock, active });

        const unsubscribe = activeActionBar.subscribe(() => undefined);
        expect(listeners).toBe(1);
        unsubscribe();

        expect(listeners).toBe(0);
    });
});

describe("embeddedChatHost", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function loadPort() {
        return await import("./ClientExtensionPoints");
    }

    it("is false when no extension hosts the chat, so that the app keeps its own chat sidebar", async () => {
        const { embeddedChatHost } = await loadPort();

        expect(get(embeddedChatHost)).toBe(false);
    });

    it("is false while the registered host is not active", async () => {
        const { embeddedChatHost, setEmbeddedChatHost } = await loadPort();

        setEmbeddedChatHost(readable(false));

        expect(get(embeddedChatHost)).toBe(false);
    });

    it("is true while the registered host is active", async () => {
        const { embeddedChatHost, setEmbeddedChatHost } = await loadPort();

        setEmbeddedChatHost(readable(true));

        expect(get(embeddedChatHost)).toBe(true);
    });

    it("follows the active store of the host and tells its subscribers each time it changes", async () => {
        const { embeddedChatHost, setEmbeddedChatHost } = await loadPort();
        const active = writable(false);
        setEmbeddedChatHost(active);
        const seen: boolean[] = [];
        const unsubscribe = embeddedChatHost.subscribe((hosted) => seen.push(hosted));

        active.set(true);
        active.set(false);
        unsubscribe();

        expect(seen).toEqual([false, true, false]);
    });

    it("picks up a host registered after a consumer subscribed", async () => {
        const { embeddedChatHost, setEmbeddedChatHost } = await loadPort();
        const seen: boolean[] = [];
        const unsubscribe = embeddedChatHost.subscribe((hosted) => seen.push(hosted));

        setEmbeddedChatHost(readable(true));
        unsubscribe();

        expect(seen).toEqual([false, true]);
    });

    it("switches to the host registered last and ignores the active store of the one it replaced", async () => {
        const { embeddedChatHost, setEmbeddedChatHost } = await loadPort();
        const firstActive = writable(true);
        setEmbeddedChatHost(firstActive);
        const seen: boolean[] = [];
        const unsubscribe = embeddedChatHost.subscribe((hosted) => seen.push(hosted));

        setEmbeddedChatHost(readable(false));
        firstActive.set(false);
        firstActive.set(true);
        unsubscribe();

        expect(seen).toEqual([true, false]);
    });

    it("releases the active store of a replaced host while a consumer keeps reading", async () => {
        const { embeddedChatHost, setEmbeddedChatHost } = await loadPort();
        let firstListeners = 0;
        const first = readable(true, () => {
            firstListeners += 1;
            return () => {
                firstListeners -= 1;
            };
        });
        setEmbeddedChatHost(first);
        const unsubscribe = embeddedChatHost.subscribe(() => undefined);
        expect(firstListeners).toBe(1);

        setEmbeddedChatHost(readable(false));
        const releasedWhileReading = firstListeners === 0;
        unsubscribe();

        expect(releasedWhileReading).toBe(true);
    });

    it("stops listening to the active store of the host once nothing reads the chat host", async () => {
        const { embeddedChatHost, setEmbeddedChatHost } = await loadPort();
        let listeners = 0;
        const active = readable(true, () => {
            listeners += 1;
            return () => {
                listeners -= 1;
            };
        });
        setEmbeddedChatHost(active);

        const unsubscribe = embeddedChatHost.subscribe(() => undefined);
        expect(listeners).toBe(1);
        unsubscribe();

        expect(listeners).toBe(0);
    });
});

describe("scene extensions", () => {
    const scene = {} as unknown as GameScene;

    beforeEach(() => {
        vi.resetModules();
        captureException.mockClear();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function loadPort() {
        return await import("./ClientExtensionPoints");
    }

    function frameContext(time = 0): SceneFrameContext {
        return {
            scene,
            time,
            delta: 16,
            baseUrl: "http://localhost:8090/~/office.wam",
            currentPlayer: undefined,
            remoteCharacters: new Map(),
            remotePlayers: new Map(),
            getPlayerVariable: () => undefined,
        };
    }

    function recordingExtension(id: string, calls: string[]): SceneExtension {
        return {
            id,
            onFrame: (context) => calls.push(`${id} frame ${context.time}`),
            onShutdown: () => calls.push(`${id} shutdown`),
        };
    }

    describe("registration", () => {
        it("has no extension until one registers, so that the scene runs as if there were no port", async () => {
            const { getSceneExtensions, notifySceneShutdown, runSceneFrame } = await loadPort();

            expect(getSceneExtensions()).toEqual([]);
            expect(() => runSceneFrame(frameContext())).not.toThrow();
            expect(() => notifySceneShutdown(scene)).not.toThrow();
            expect(captureException).not.toHaveBeenCalled();
        });

        it("lists the registered extensions in the order they registered", async () => {
            const { getSceneExtensions, registerSceneExtension } = await loadPort();
            const first = recordingExtension("first", []);
            const second = recordingExtension("second", []);

            registerSceneExtension(first);
            registerSceneExtension(second);

            expect(getSceneExtensions()).toEqual([first, second]);
        });

        it("removes only the extension that unregisters", async () => {
            const { getSceneExtensions, registerSceneExtension } = await loadPort();
            const first = recordingExtension("first", []);
            const second = recordingExtension("second", []);
            const third = recordingExtension("third", []);
            registerSceneExtension(first);
            const unregisterSecond = registerSceneExtension(second);
            registerSceneExtension(third);

            unregisterSecond();

            expect(getSceneExtensions()).toEqual([first, third]);
        });

        it("does nothing when an extension unregisters twice", async () => {
            const { getSceneExtensions, registerSceneExtension } = await loadPort();
            const extension = recordingExtension("twice", []);
            const unregisterFirst = registerSceneExtension(extension);
            registerSceneExtension(extension);

            unregisterFirst();
            unregisterFirst();

            expect(getSceneExtensions()).toEqual([extension]);
        });
    });

    describe("runSceneFrame", () => {
        it("calls each extension once per frame in registration order, with the context of the frame", async () => {
            const { registerSceneExtension, runSceneFrame } = await loadPort();
            const calls: string[] = [];
            const received: SceneFrameContext[] = [];
            registerSceneExtension({ id: "first", onFrame: (context) => received.push(context) });
            registerSceneExtension(recordingExtension("second", calls));
            registerSceneExtension(recordingExtension("third", calls));
            const context = frameContext(100);

            runSceneFrame(context);
            runSceneFrame(frameContext(116));

            expect(calls).toEqual(["second frame 100", "third frame 100", "second frame 116", "third frame 116"]);
            expect(received).toHaveLength(2);
            expect(received[0]).toBe(context);
        });

        it("skips an extension that has no frame hook", async () => {
            const { registerSceneExtension, runSceneFrame } = await loadPort();
            const calls: string[] = [];
            registerSceneExtension({ id: "shutdown only", onShutdown: () => calls.push("shutdown") });
            registerSceneExtension(recordingExtension("framed", calls));

            runSceneFrame(frameContext(1));

            expect(calls).toEqual(["framed frame 1"]);
        });

        it("stops calling an extension once it unregisters", async () => {
            const { registerSceneExtension, runSceneFrame } = await loadPort();
            const calls: string[] = [];
            registerSceneExtension(recordingExtension("first", calls));
            const unregisterSecond = registerSceneExtension(recordingExtension("second", calls));
            registerSceneExtension(recordingExtension("third", calls));
            unregisterSecond();

            runSceneFrame(frameContext(1));

            expect(calls).toEqual(["first frame 1", "third frame 1"]);
        });

        it("runs the extensions it started with when one unregisters or registers during the frame", async () => {
            const { registerSceneExtension, runSceneFrame } = await loadPort();
            const calls: string[] = [];
            const late = recordingExtension("late", calls);
            const unregisterFirst = registerSceneExtension({
                id: "first",
                onFrame: (context) => {
                    calls.push(`first frame ${context.time}`);
                    unregisterFirst();
                    registerSceneExtension(late);
                },
            });
            registerSceneExtension(recordingExtension("second", calls));

            runSceneFrame(frameContext(1));
            runSceneFrame(frameContext(2));

            expect(calls).toEqual(["first frame 1", "second frame 1", "second frame 2", "late frame 2"]);
        });

        it("reports an extension that throws and still runs the others", async () => {
            const { registerSceneExtension, runSceneFrame } = await loadPort();
            const calls: string[] = [];
            const failure = new Error("pose failed");
            registerSceneExtension(recordingExtension("before", calls));
            registerSceneExtension({
                id: "faulty",
                onFrame: () => {
                    throw failure;
                },
            });
            registerSceneExtension(recordingExtension("after", calls));

            expect(() => runSceneFrame(frameContext(5))).not.toThrow();

            expect(calls).toEqual(["before frame 5", "after frame 5"]);
            expect(captureException).toHaveBeenCalledTimes(1);
            expect(captureException).toHaveBeenCalledWith(failure, {
                extra: { extensionId: "faulty", failuresSinceLastReport: 1 },
            });
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"faulty"'), failure);
        });

        it("reports a value that is not an Error as an Error", async () => {
            const { registerSceneExtension, runSceneFrame } = await loadPort();
            const thrown: unknown = "not an error";
            registerSceneExtension({
                id: "faulty",
                onFrame: () => {
                    throw thrown;
                },
            });

            runSceneFrame(frameContext(5));

            expect(captureException).toHaveBeenCalledTimes(1);
            expect(captureException.mock.calls[0][0]).toBeInstanceOf(Error);
        });

        it("reports a failing extension at most once per interval and counts the failures it held back", async () => {
            const { registerSceneExtension, runSceneFrame } = await loadPort();
            registerSceneExtension({
                id: "faulty",
                onFrame: () => {
                    throw new Error("still failing");
                },
            });

            runSceneFrame(frameContext(1_000));
            runSceneFrame(frameContext(2_000));
            runSceneFrame(frameContext(5_000));
            expect(captureException).toHaveBeenCalledTimes(1);

            runSceneFrame(frameContext(11_000));

            expect(captureException).toHaveBeenCalledTimes(2);
            expect(captureException.mock.calls[1][1]).toEqual({
                extra: { extensionId: "faulty", failuresSinceLastReport: 3 },
            });
        });

        it("keeps the interval of each failing extension apart", async () => {
            const { registerSceneExtension, runSceneFrame } = await loadPort();
            for (const id of ["one", "two"]) {
                registerSceneExtension({
                    id,
                    onFrame: () => {
                        throw new Error(`${id} failing`);
                    },
                });
            }

            runSceneFrame(frameContext(1_000));

            expect(captureException).toHaveBeenCalledTimes(2);
        });

        it("forgets the failures of an extension that unregisters, so that it reports again after it registers anew", async () => {
            const { registerSceneExtension, runSceneFrame } = await loadPort();
            const faulty: SceneExtension = {
                id: "faulty",
                onFrame: () => {
                    throw new Error("failing");
                },
            };
            const unregister = registerSceneExtension(faulty);
            runSceneFrame(frameContext(1_000));
            unregister();
            registerSceneExtension(faulty);

            runSceneFrame(frameContext(2_000));

            expect(captureException).toHaveBeenCalledTimes(2);
        });
    });

    describe("notifySceneShutdown", () => {
        it("tells each extension in registration order, with the scene", async () => {
            const { notifySceneShutdown, registerSceneExtension } = await loadPort();
            const calls: string[] = [];
            const received: GameScene[] = [];
            registerSceneExtension(recordingExtension("first", calls));
            registerSceneExtension({ id: "second", onShutdown: (closing) => received.push(closing) });
            registerSceneExtension(recordingExtension("third", calls));

            notifySceneShutdown(scene);

            expect(calls).toEqual(["first shutdown", "third shutdown"]);
            expect(received).toEqual([scene]);
        });

        it("skips an extension that has no shutdown hook and one that unregistered", async () => {
            const { notifySceneShutdown, registerSceneExtension } = await loadPort();
            const calls: string[] = [];
            registerSceneExtension({ id: "frame only", onFrame: () => calls.push("frame") });
            const unregister = registerSceneExtension(recordingExtension("gone", calls));
            registerSceneExtension(recordingExtension("kept", calls));
            unregister();

            notifySceneShutdown(scene);

            expect(calls).toEqual(["kept shutdown"]);
        });

        it("reports an extension that throws and still tells the others", async () => {
            const { notifySceneShutdown, registerSceneExtension } = await loadPort();
            const calls: string[] = [];
            const failure = new Error("could not give back");
            registerSceneExtension({
                id: "faulty",
                onShutdown: () => {
                    throw failure;
                },
            });
            registerSceneExtension(recordingExtension("after", calls));

            expect(() => notifySceneShutdown(scene)).not.toThrow();

            expect(calls).toEqual(["after shutdown"]);
            expect(captureException).toHaveBeenCalledTimes(1);
            expect(captureException).toHaveBeenCalledWith(failure, { extra: { extensionId: "faulty" } });
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"faulty"'), failure);
        });
    });
});
