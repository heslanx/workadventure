import { describe, expect, it } from "vitest";
import { nativeReactionId } from "./nativeReactions";

describe("nativeReactionId", () => {
    it.each([
        ["thumbs up", "like"],
        ["red heart", "love"],
        ["face with tears of joy", "haha"],
        ["clapping hands", "applause"],
        ["smiling face with heart-eyes", "adore"],
        ["folded hands", "thanks"],
    ])("names the reaction %s as %s", (emojiName, id) => {
        expect(nativeReactionId(emojiName)).toBe(id);
    });

    it.each(["grinning face", "", "constructor", "toString", "Thumbs up"])(
        "leaves %j without a name, so the emoji the player chose names itself",
        (emojiName) => {
            expect(nativeReactionId(emojiName)).toBeUndefined();
        },
    );
});
