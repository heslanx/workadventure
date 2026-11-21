import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Emoji } from "../../../Stores/Utils/emojiSchema";
import { EMOTE_COOLDOWN_MS } from "../domain/emoteCooldown";

// The three stores of the app the sender reads and writes. The sender is the boundary under test, so only they are
// replaced; the cooldown and the catalogue are the real ones.
const app = await vi.hoisted(async () => {
    const { writable } = await import("svelte/store");
    return {
        emoteStore: writable<Emoji | null>(null),
        emoteMenuStore: writable(false),
        enableUserInputsStore: writable(true),
    };
});

vi.mock("../../../Stores/EmoteStore", () => ({ emoteStore: app.emoteStore, emoteMenuStore: app.emoteMenuStore }));
vi.mock("../../../Stores/UserInputStore", () => ({ enableUserInputsStore: app.enableUserInputsStore }));

describe("sendCustomEmote", () => {
    let stopListening: (() => void) | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        app.emoteStore.set(null);
        app.emoteMenuStore.set(false);
        app.enableUserInputsStore.set(true);
    });

    afterEach(() => {
        stopListening?.();
        stopListening = undefined;
        vi.useRealTimers();
    });

    async function load() {
        const { sendCustomEmote } = await import("./emoteSender");
        const sent: Emoji[] = [];
        stopListening = app.emoteStore.subscribe((emoji) => {
            if (emoji) sent.push(emoji);
        });
        return {
            sendCustomEmote,
            sent,
            setEditing: (value: boolean) => app.emoteMenuStore.set(value),
            setInputs: (value: boolean) => app.enableUserInputsStore.set(value),
        };
    }

    it("sends the speech balloon with the id spelled in tag characters, which is what the server relays", async () => {
        const { sendCustomEmote, sent } = await load();

        expect(sendCustomEmote("lv")).toBe("sent");

        // k, l, v in tag characters (U+E006B, U+E006C, U+E0076), then the cancel tag.
        expect(sent).toEqual([{ emoji: "\u{1F4AC}\u{E006B}\u{E006C}\u{E0076}\u{E007F}", name: "lv" }]);
    });

    it("refuses a second emote within the cooldown, sends nothing for it, and accepts one at its end", async () => {
        const { sendCustomEmote, sent } = await load();
        sendCustomEmote("lv");

        vi.advanceTimersByTime(EMOTE_COOLDOWN_MS - 1);
        expect(sendCustomEmote("ok")).toBe("cooling");
        expect(sent).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(sendCustomEmote("ok")).toBe("sent");
        expect(sent.map((emoji) => emoji.name)).toEqual(["lv", "ok"]);
    });

    it("does not let a refused request restart the cooldown", async () => {
        const { sendCustomEmote } = await load();
        sendCustomEmote("lv");
        vi.advanceTimersByTime(1500);
        sendCustomEmote("ok");

        vi.advanceTimersByTime(500);

        expect(sendCustomEmote("ok")).toBe("sent");
    });

    it("refuses while the reactions are being edited, which the scene would ignore, and starts no cooldown", async () => {
        const { sendCustomEmote, sent, setEditing } = await load();
        setEditing(true);

        expect(sendCustomEmote("lv")).toBe("editing");
        expect(sent).toHaveLength(0);

        setEditing(false);
        expect(sendCustomEmote("lv")).toBe("sent");
    });

    it("refuses while the player's keys belong to something else, which the scene would ignore", async () => {
        const { sendCustomEmote, sent, setInputs } = await load();
        setInputs(false);

        expect(sendCustomEmote("lv")).toBe("blocked");
        expect(sent).toHaveLength(0);

        setInputs(true);
        expect(sendCustomEmote("lv")).toBe("sent");
    });

    it("gives the reason of the editing, not the keys, when both hold, as editing is what takes the keys", async () => {
        const { sendCustomEmote, setEditing, setInputs } = await load();
        setEditing(true);
        setInputs(false);

        expect(sendCustomEmote("lv")).toBe("editing");
    });

    it("refuses an id that is not in the catalogue, as the programming error it is", async () => {
        const { sendCustomEmote, sent } = await load();

        expect(() => sendCustomEmote("nope")).toThrow('no emote "nope"');
        expect(sent).toHaveLength(0);
        expect(get(app.emoteStore)).toBeNull();
    });
});
