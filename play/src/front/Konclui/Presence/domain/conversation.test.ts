import { describe, expect, it } from "vitest";
import { describeConversation, isSameConversation, type ConversationRoom } from "./conversation";

const ME = "me";

function room(overrides: Partial<ConversationRoom> & { others?: string[] }): ConversationRoom {
    const { others = [], ...rest } = overrides;
    return {
        kind: "default",
        joined: true,
        name: "",
        mySpaceUserId: ME,
        participants: [ME, ...others].map((spaceUserId) => ({ spaceUserId })),
        ...rest,
    };
}

describe("describeConversation", () => {
    it("is a bubble of the people who are with the current user, who is not counted", () => {
        expect(describeConversation([room({ others: ["a", "b"] })])).toEqual({ kind: "bubble", count: 2 });
    });

    it("is nothing while the user is alone", () => {
        expect(describeConversation([room({}), room({ kind: "meeting", name: "Sala 01" })])).toBeUndefined();
    });

    it("is nothing without a room", () => {
        expect(describeConversation([])).toBeUndefined();
    });

    it("ignores a room the user has not joined", () => {
        expect(describeConversation([room({ joined: false, others: ["a", "b"] })])).toBeUndefined();
    });

    it("is a room, with the name its map gave it, when a meeting area has others in it", () => {
        const conversation = describeConversation([room({ kind: "meeting", name: " Sala 01 ", others: ["a"] })]);

        expect(conversation).toEqual({ kind: "room", count: 1, placeName: "Sala 01" });
    });

    it("counts a person who is in the bubble and in the meeting area once", () => {
        const conversation = describeConversation([
            room({ kind: "default", others: ["a", "b"] }),
            room({ kind: "meeting", name: "Sala 01", others: ["b", "c"] }),
        ]);

        expect(conversation).toEqual({ kind: "room", count: 3, placeName: "Sala 01" });
    });

    it("counts two sessions of one account as two people, as their space user ids are", () => {
        expect(describeConversation([room({ others: ["session-1", "session-2"] })])).toEqual({
            kind: "bubble",
            count: 2,
        });
    });

    it("stays a bubble when the user is alone in a meeting area and talks to people in a bubble", () => {
        const conversation = describeConversation([
            room({ kind: "default", others: ["a"] }),
            room({ kind: "meeting", name: "Sala 01" }),
        ]);

        expect(conversation).toEqual({ kind: "bubble", count: 1 });
    });

    it("takes the first meeting area that has others, which the manager lists deepest first", () => {
        const conversation = describeConversation([
            room({ kind: "meeting", name: "Booth", others: ["a"] }),
            room({ kind: "meeting", name: "Wing", others: ["b"] }),
        ]);

        expect(conversation).toEqual({ kind: "room", count: 2, placeName: "Booth" });
    });

    it.each(["speaker", "listener", "area"] as const)(
        "does not take a %s room for a conversation, whoever is in it",
        (kind) => {
            const crowd = Array.from({ length: 300 }, (_, index) => `person-${index}`);

            expect(describeConversation([room({ kind, others: crowd })])).toBeUndefined();
        },
    );

    it("does not hide a bubble because a megaphone is also joined", () => {
        const conversation = describeConversation([
            room({ kind: "default", others: ["a"] }),
            room({ kind: "speaker", others: ["x", "y", "z"] }),
        ]);

        expect(conversation).toEqual({ kind: "bubble", count: 1 });
    });
});

describe("isSameConversation", () => {
    it.each([
        [{ kind: "bubble", count: 2 }, { kind: "bubble", count: 2 }, true],
        [{ kind: "bubble", count: 2 }, { kind: "bubble", count: 3 }, false],
        [{ kind: "room", count: 2, placeName: "A" }, { kind: "room", count: 2, placeName: "A" }, true],
        [{ kind: "room", count: 2, placeName: "A" }, { kind: "room", count: 2, placeName: "B" }, false],
        [{ kind: "bubble", count: 2 }, { kind: "room", count: 2, placeName: "A" }, false],
        [undefined, undefined, true],
        [undefined, { kind: "bubble", count: 1 }, false],
    ] as const)("compares %j with %j as %s", (a, b, same) => {
        expect(isSameConversation(a, b)).toBe(same);
    });
});
