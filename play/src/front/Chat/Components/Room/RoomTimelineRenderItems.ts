import type { ChatTimelineItem } from "../../Connection/ChatConnection";

export type RoomTimelineRenderItem =
    | { kind: "separator"; key: string; label: string }
    | { kind: "item"; key: string; timelineItem: ChatTimelineItem; showHeader: boolean; showTime: boolean };

/**
 * The sender each row was rendered with. Polls and questions replace their sender in place on the same
 * object, so comparing the payload alone would keep showing the old author.
 */
const renderedSenders = new WeakMap<RoomTimelineRenderItem, unknown>();

/**
 * Gives back the previous render's row for every row whose content did not change.
 * The keyed {#each} only updates a row whose value changed identity, and the timeline stores rebuild
 * every item object on each change: without this, one new message re-runs the effects of every loaded row.
 */
export function reuseUnchangedRenderItems(
    next: readonly RoomTimelineRenderItem[],
    previous: readonly RoomTimelineRenderItem[],
): RoomTimelineRenderItem[] {
    const previousByKey = new Map(previous.map((item) => [item.key, item]));
    return next.map((item) => {
        const previousItem = previousByKey.get(item.key);
        if (previousItem !== undefined && isSameRenderItem(previousItem, item)) {
            return previousItem;
        }
        if (item.kind === "item") {
            renderedSenders.set(item, timelinePayload(item.timelineItem).sender);
        }
        return item;
    });
}

function isSameRenderItem(previous: RoomTimelineRenderItem, next: RoomTimelineRenderItem): boolean {
    if (previous.kind === "separator") {
        return next.kind === "separator" && previous.label === next.label;
    }
    return (
        next.kind === "item" &&
        previous.showHeader === next.showHeader &&
        previous.showTime === next.showTime &&
        isSameTimelineItem(previous.timelineItem, next.timelineItem) &&
        renderedSenders.has(previous) &&
        renderedSenders.get(previous) === timelinePayload(next.timelineItem).sender
    );
}

function isSameTimelineItem(previous: ChatTimelineItem, next: ChatTimelineItem): boolean {
    return (
        previous.kind === next.kind &&
        previous.id === next.id &&
        previous.date?.getTime() === next.date?.getTime() &&
        timelinePayload(previous) === timelinePayload(next)
    );
}

function timelinePayload(item: ChatTimelineItem): { readonly sender: unknown } {
    switch (item.kind) {
        case "message":
        case "system":
            return item.message;
        case "poll":
            return item.poll;
        case "question":
            return item.question;
    }
}
