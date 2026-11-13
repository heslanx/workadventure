import { get } from "svelte/store";
import type { ChatMessage, ChatTimelineItem } from "../../Connection/ChatConnection";
import LL, { locale } from "../../../../i18n/i18n-svelte";

export type RoomTimelineRenderItem =
    | { kind: "separator"; key: string; label: string }
    | { kind: "item"; key: string; timelineItem: ChatTimelineItem; showHeader: boolean; showTime: boolean };

// Time gap threshold for message grouping (5 minutes)
const TIME_GAP_THRESHOLD = 5 * 60 * 1000;

function isValidDate(d: Date) {
    return d instanceof Date && !Number.isNaN(d.getTime());
}

function getTimelineItemDate(timelineItem: ChatTimelineItem): Date | undefined {
    if (timelineItem?.date && isValidDate(timelineItem.date)) {
        return timelineItem.date;
    }
    return undefined;
}

function isSameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(d: Date): string {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const labels = get(LL);
    if (isSameLocalDay(d, today)) return labels.chat.timeLine.today();
    if (isSameLocalDay(d, yesterday)) return labels.chat.timeLine.yesterday();

    return new Intl.DateTimeFormat(get(locale), {
        weekday: "short",
        day: "numeric",
        month: "short",
    }).format(d);
}

function dayKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
}

/**
 * The rows of the timeline: a separator before the first item of each local day, and for each item
 * whether it shows its sender header and its time. Day labels read the clock and the locale on each call (RT-05).
 */
export function buildRenderItems(currentTimelineItems: readonly ChatTimelineItem[]): RoomTimelineRenderItem[] {
    const out: RoomTimelineRenderItem[] = [];
    let lastDayKey: string | null = null;
    let previousMessage: ChatMessage | undefined = undefined;

    for (const timelineItem of currentTimelineItems) {
        const d = getTimelineItemDate(timelineItem);
        let insertedSeparator = false;

        if (d && isValidDate(d)) {
            const k = dayKey(d);
            if (k !== lastDayKey) {
                out.push({
                    kind: "separator",
                    key: `sep-${k}`,
                    label: dayLabel(d),
                });
                lastDayKey = k;
                insertedSeparator = true;
            }
        }

        if (insertedSeparator) {
            previousMessage = undefined;
        }

        const currentMessage = timelineItem.kind === "message" ? timelineItem.message : undefined;
        const previousMessageUserId = previousMessage?.sender?.spaceUserId ?? previousMessage?.sender?.chatId;
        const currentMessageUserId = currentMessage?.sender?.spaceUserId ?? currentMessage?.sender?.chatId;
        const timeDiff =
            currentMessage?.date && previousMessage?.date
                ? currentMessage.date.getTime() - previousMessage.date.getTime()
                : Infinity;
        const isRepeatedSender =
            !!currentMessage &&
            !!previousMessageUserId &&
            previousMessageUserId === currentMessageUserId &&
            timeDiff < TIME_GAP_THRESHOLD;

        out.push({
            kind: "item",
            key: `${timelineItem.kind}-${timelineItem.id}`,
            timelineItem,
            showHeader: !isRepeatedSender,
            showTime: true,
        });
        previousMessage = currentMessage;
    }

    // A run of messages from one sender shows its time once, on its last message.
    out.forEach((item, index) => {
        const next = out[index + 1];
        if (item.kind === "item" && next?.kind === "item" && !next.showHeader) {
            item.showTime = false;
        }
    });

    return out;
}

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
