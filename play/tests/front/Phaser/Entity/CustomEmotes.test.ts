// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    customEmoteTextureKey,
    findCustomEmote,
    loadCustomEmoteElement,
    registerCustomEmoteProvider,
    type CustomEmote,
    type CustomEmoteProvider,
    type CustomEmoteTextures,
    type DecodeImage,
} from "../../../../src/front/Phaser/Entity/CustomEmotes";

const ART = "data:image/png;base64,iVBORw0KGgo=";

function emote(id: string, src = ART): CustomEmote {
    return { id, src, accessibleName: (playerName) => `${playerName} reacted: ${id}` };
}

/** A texture manager that remembers the keys it was given: the real one needs a running game. */
function createTextures() {
    const keys = new Set<string>();
    const textures = {
        exists: (key: string) => keys.has(key),
        addImage: vi.fn((key: string) => {
            keys.add(key);
        }),
    } satisfies CustomEmoteTextures;
    return { textures, keys };
}

/** A decoder that hands out an image per call and counts the calls. */
function createDecoder() {
    const decode = vi.fn<DecodeImage>(() => Promise.resolve(document.createElement("img")));
    return decode;
}

describe("the custom emote provider", () => {
    let unregister: (() => void) | undefined;

    afterEach(() => {
        unregister?.();
        unregister = undefined;
        vi.restoreAllMocks();
    });

    function register(resolve: CustomEmoteProvider["resolve"]): void {
        unregister = registerCustomEmoteProvider({ resolve });
    }

    it("finds nothing while no provider is registered, so every emote stays the emoji text", () => {
        expect(findCustomEmote("👍")).toBeUndefined();
        expect(findCustomEmote("\u{1F4AC}\u{E006B}\u{E006C}\u{E007F}")).toBeUndefined();
    });

    it("finds what the registered provider says an emote message stands for", () => {
        const love = emote("lv");
        register((message) => (message === "love" ? love : undefined));

        expect(findCustomEmote("love")).toBe(love);
        expect(findCustomEmote("👍")).toBeUndefined();
    });

    it("stops finding once the provider is unregistered", () => {
        register(() => emote("lv"));

        unregister?.();

        expect(findCustomEmote("love")).toBeUndefined();
    });

    it("lets a later provider replace the earlier one, and the earlier one's unregister leave the later alone", () => {
        const first = registerCustomEmoteProvider({ resolve: () => emote("first") });
        unregister = registerCustomEmoteProvider({ resolve: () => emote("second") });

        first();

        expect(findCustomEmote("x")?.id).toBe("second");
    });

    it.each([
        ["a remote URL", "https://evil.example/emote.png"],
        ["a script", "javascript:alert(1)"],
        ["an SVG", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
        ["a PNG with a quote that closes the attribute", `data:image/png;base64,AAAA" onerror="x`],
        ["an empty PNG", "data:image/png;base64,"],
    ])("refuses art that is %s, reports it once, and leaves the message as text", (name, src) => {
        const report = vi.spyOn(console, "error").mockImplementation(() => {});
        // The report is once for each emote, so each case has an emote of its own.
        register(() => emote(`bad-${name}`, src));

        expect(findCustomEmote("a")).toBeUndefined();
        expect(findCustomEmote("b")).toBeUndefined();
        expect(report).toHaveBeenCalledTimes(1);
    });
});

describe("loadCustomEmoteElement", () => {
    it("decodes the art into one texture, named by the emote, the first time it is drawn", async () => {
        const { textures, keys } = createTextures();
        const decode = createDecoder();

        await loadCustomEmoteElement(textures, emote("lv"), "Ana", decode);

        expect(decode).toHaveBeenCalledExactlyOnceWith(ART);
        expect(textures.addImage).toHaveBeenCalledTimes(1);
        expect([...keys]).toEqual(["custom-emote-lv"]);
        expect(customEmoteTextureKey("lv")).toBe("custom-emote-lv");
    });

    it("creates one texture for a hundred plays, by any number of characters, one after the other", async () => {
        const { textures } = createTextures();
        const decode = createDecoder();

        for (let play = 0; play < 100; play++) {
            // eslint-disable-next-line no-await-in-loop -- one play after the other, as a room's emotes come
            await loadCustomEmoteElement(textures, emote("lv"), `player ${play % 7}`, decode);
        }

        expect(decode).toHaveBeenCalledTimes(1);
        expect(textures.addImage).toHaveBeenCalledTimes(1);
    });

    it("creates one texture for a hundred plays that all start before the art is decoded", async () => {
        const { textures } = createTextures();
        const decode = createDecoder();

        await Promise.all(
            Array.from({ length: 100 }, (_unused, play) =>
                loadCustomEmoteElement(textures, emote("lv"), `player ${play}`, decode),
            ),
        );

        expect(decode).toHaveBeenCalledTimes(1);
        expect(textures.addImage).toHaveBeenCalledTimes(1);
    });

    it("keeps one texture for each emote", async () => {
        const { textures, keys } = createTextures();
        const decode = createDecoder();

        await loadCustomEmoteElement(textures, emote("lv"), "Ana", decode);
        await loadCustomEmoteElement(textures, emote("ok"), "Ana", decode);
        await loadCustomEmoteElement(textures, emote("lv"), "Bia", decode);

        expect(textures.addImage).toHaveBeenCalledTimes(2);
        expect([...keys].sort()).toEqual(["custom-emote-lv", "custom-emote-ok"]);
    });

    it("does not decode art whose texture the manager already holds", async () => {
        const { textures, keys } = createTextures();
        keys.add("custom-emote-lv");
        const decode = createDecoder();

        await loadCustomEmoteElement(textures, emote("lv"), "Ana", decode);

        expect(decode).not.toHaveBeenCalled();
        expect(textures.addImage).not.toHaveBeenCalled();
    });

    it("gives each texture manager its own texture, as a restarted game has", async () => {
        const first = createTextures();
        const second = createTextures();
        const decode = createDecoder();

        await loadCustomEmoteElement(first.textures, emote("lv"), "Ana", decode);
        await loadCustomEmoteElement(second.textures, emote("lv"), "Ana", decode);

        expect(first.textures.addImage).toHaveBeenCalledTimes(1);
        expect(second.textures.addImage).toHaveBeenCalledTimes(1);
    });

    it("rejects when the art cannot be decoded, creates no texture, and tries again on the next play", async () => {
        const { textures } = createTextures();
        const decode = vi
            .fn<DecodeImage>()
            .mockRejectedValueOnce(new Error("broken"))
            .mockResolvedValue(document.createElement("img"));

        await expect(loadCustomEmoteElement(textures, emote("lv"), "Ana", decode)).rejects.toThrow("broken");
        expect(textures.addImage).not.toHaveBeenCalled();

        await loadCustomEmoteElement(textures, emote("lv"), "Ana", decode);

        expect(decode).toHaveBeenCalledTimes(2);
        expect(textures.addImage).toHaveBeenCalledTimes(1);
    });

    it("draws the art as a crisp 32 pixel picture that carries who reacted and with what as its name", async () => {
        const { textures } = createTextures();

        const element = await loadCustomEmoteElement(textures, emote("lv"), "Ana Ribeiro", createDecoder());

        expect(element).toBeInstanceOf(HTMLImageElement);
        const picture = element as HTMLImageElement;
        expect(picture.getAttribute("src")).toBe(ART);
        expect(picture.alt).toBe("Ana Ribeiro reacted: lv");
        expect([picture.width, picture.height]).toEqual([32, 32]);
        expect(picture.style.imageRendering).toBe("pixelated");
        expect(picture.draggable).toBe(false);
    });

    it("makes a new element for each play, so two characters never share one in the DOM", async () => {
        const { textures } = createTextures();
        const decode = createDecoder();

        const first = await loadCustomEmoteElement(textures, emote("lv"), "Ana", decode);
        const second = await loadCustomEmoteElement(textures, emote("lv"), "Bia", decode);

        expect(first).not.toBe(second);
        expect((first as HTMLImageElement).alt).toBe("Ana reacted: lv");
        expect((second as HTMLImageElement).alt).toBe("Bia reacted: lv");
    });
});
