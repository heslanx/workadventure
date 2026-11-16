<script lang="ts">
    import type { CalendarEventInterface } from "@workadventure/shared-utils";
    import LL from "../../../i18n/i18n-svelte";
    import { formatDayName, formatTime, formatTimeUntil, startOfDay } from "./agenda";
    import { REMINDER_LEAD_MS } from "./CalendarReminder";
    import CalendarJoinButton from "./CalendarJoinButton.svelte";
    import { IconAlertTriangle, IconBell } from "@wa-icons";

    interface Props {
        event: CalendarEventInterface;
        /** The other meetings happening during this one. */
        overlaps: CalendarEventInterface[];
        now: Date;
    }

    let { event, overlaps, now }: Props = $props();

    let started = $derived(event.start <= now);
    let reminder = $derived(new Date(event.start.getTime() - REMINDER_LEAD_MS));
    let isToday = $derived(startOfDay(event.start).getTime() === startOfDay(now).getTime());
</script>

<section
    aria-label={$LL.externalModule.calendar.nextMeeting()}
    class="flex flex-col gap-2 rounded-lg bg-contrast-600 p-3"
>
    <div class="flex items-center gap-2">
        <!-- The countdown is what the card is for: it outweighs its caption and the time range below. -->
        <span class="text-sm text-contrast-200">
            {#if started}
                <span class="font-bold text-danger-400">{$LL.externalModule.calendar.inProgress()}</span>
            {:else}
                {$LL.externalModule.calendar.nextMeeting()} ·
                <span class="font-bold text-white">{formatTimeUntil(event.start, now)}</span>
            {/if}
        </span>
        {#if reminder > now}
            <span class="ms-auto flex items-center gap-1 text-xs text-contrast-200">
                <IconBell class="h-3.5 w-3.5" aria-hidden="true" />
                {$LL.externalModule.calendar.reminderAt({ time: formatTime(reminder) })}
            </span>
        {/if}
    </div>

    <div class="flex flex-col">
        <span class="font-title text-xl leading-tight">{event.title}</span>
        <span class="text-sm text-contrast-200">
            {isToday ? "" : `${formatDayName(startOfDay(event.start), now)} · `}{$LL.externalModule.calendar.timeRange({
                start: formatTime(event.start),
                end: formatTime(event.end),
            })}
        </span>
    </div>

    {#if overlaps.length > 0}
        <p class="m-0 flex items-start gap-1.5 text-sm text-warning">
            <IconAlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {$LL.externalModule.calendar.overlapsWith({
                titles: overlaps.map((other) => `${other.title} (${formatTime(other.start)})`).join(", "),
            })}
        </p>
    {/if}

    <CalendarJoinButton {event} prominent class="w-full" />
</section>
