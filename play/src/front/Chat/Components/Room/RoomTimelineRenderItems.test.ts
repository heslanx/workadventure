import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatPollItem, ChatTimelineItem } from "../../Connection/ChatConnection";
import { reuseUnchangedRenderItems, type RoomTimelineRenderItem } from "./RoomTimelineRenderItems";

const date = new Date(Date.UTC(2026, 10, 12, 8, 0, 0));

function row(timelineItem: ChatTimelineItem, showHeader = true, showTime = true): RoomTimelineRenderItem {
    return { kind: "item", key: `${timelineItem.kind}-${timelineItem.id}`, timelineItem, showHeader, showTime };
}

// The proximity store rebuilds every item object on each change; the message objects stay the same.
function messageItem(id: string, message: ChatMessage): ChatTimelineItem {
    return { kind: "message", id, date: new Date(date), message };
}

describe("reuseUnchangedRenderItems", () => {
    it("keeps the previous rows when one message is appended to rebuilt timeline items", () => {
        const a = { id: "a" } as ChatMessage;
        const b = { id: "b" } as ChatMessage;
        const separator: RoomTimelineRenderItem = { kind: "separator", key: "sep-2026-11-12", label: "Today" };
        const previous = reuseUnchangedRenderItems([separator, row(messageItem("a", a)), row(messageItem("b", b))], []);

        const next = reuseUnchangedRenderItems(
            [
                { ...separator },
                row(messageItem("a", a)),
                row(messageItem("b", b)),
                row(messageItem("c", { id: "c" } as ChatMessage)),
            ],
            previous,
        );

        expect(next.slice(0, 3)).toEqual(previous);
        for (let index = 0; index < 3; index++) {
            expect(next[index]).toBe(previous[index]);
        }
        expect(next.map((item) => item.key)).toEqual(["sep-2026-11-12", "message-a", "message-b", "message-c"]);
    });

    it("gives a new row when its grouping, time, payload or day label changes", () => {
        const a = { id: "a" } as ChatMessage;
        const previous = reuseUnchangedRenderItems(
            [{ kind: "separator", key: "sep-2026-11-12", label: "Today" }, row(messageItem("a", a), true, true)],
            [],
        );

        const hiddenTime = row(messageItem("a", a), true, false);
        expect(reuseUnchangedRenderItems([previous[0], hiddenTime], previous)[1]).toBe(hiddenTime);

        const grouped = row(messageItem("a", a), false, true);
        expect(reuseUnchangedRenderItems([previous[0], grouped], previous)[1]).toBe(grouped);

        const replaced = row(messageItem("a", { id: "a" } as ChatMessage));
        expect(reuseUnchangedRenderItems([previous[0], replaced], previous)[1]).toBe(replaced);

        const relabelled: RoomTimelineRenderItem = { kind: "separator", key: "sep-2026-11-12", label: "Yesterday" };
        expect(reuseUnchangedRenderItems([relabelled, previous[1]], previous)[0]).toBe(relabelled);
    });

    it("reuses a poll row only while it shows the same poll", () => {
        const poll = { id: "p" } as ChatPollItem;
        const pollRow = row({ kind: "poll", id: "p", date: null, poll });
        const previous = reuseUnchangedRenderItems([pollRow], []);
        const otherPoll = row({ kind: "poll", id: "p", date: null, poll: { id: "p" } as ChatPollItem });

        expect(reuseUnchangedRenderItems([row({ kind: "poll", id: "p", date: null, poll })], previous)[0]).toBe(
            pollRow,
        );
        expect(reuseUnchangedRenderItems([otherPoll], previous)[0]).toBe(otherPoll);
    });

    it("gives a new row when a poll or question gets a new sender on the same object", () => {
        const poll = { id: "p", sender: undefined } as ChatPollItem;
        const pollRow = row({ kind: "poll", id: "p", date: null, poll });
        const previous = reuseUnchangedRenderItems([pollRow], []);

        poll.sender = { chatId: "@alice:example.org", username: "Alice" } as ChatPollItem["sender"];
        const renamed = row({ kind: "poll", id: "p", date: null, poll });
        const next = reuseUnchangedRenderItems([renamed], previous);

        expect(next[0]).toBe(renamed);
        expect(reuseUnchangedRenderItems([row({ kind: "poll", id: "p", date: null, poll })], next)[0]).toBe(renamed);
    });
});
