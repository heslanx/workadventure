<script lang="ts">
    import type { CalendarEventInterface } from "@workadventure/shared-utils";
    import LL from "../../../i18n/i18n-svelte";
    import { formatDuration, formatTime } from "./agenda";
    import CalendarJoinButton from "./CalendarJoinButton.svelte";
    import { IconStack2 } from "@wa-icons";

    interface Props {
        event: CalendarEventInterface;
        /** A long event, running alongside the meetings rather than competing with them. */
        long?: boolean;
        now: Date;
    }

    let { event, long = false, now }: Props = $props();

    let inProgress = $derived(event.start <= now && now < event.end);
    // How much of the meeting has run: in a list, a card's size says nothing of time, so the bar shows it.
    let elapsedPercent = $derived(
        ((now.getTime() - event.start.getTime()) / (event.end.getTime() - event.start.getTime())) * 100,
    );
</script>

<div
    class="relative grid grid-cols-[5.5rem_1rem_minmax(0,1fr)_minmax(2rem,auto)] items-center gap-2 overflow-hidden rounded-md border p-2.5 {long
        ? 'border-dashed'
        : 'border-solid bg-white/5'} {inProgress ? 'border-danger-600/60' : 'border-white/10'}"
>
    {#if inProgress}
        <div class="absolute bottom-0 left-0 h-0.5 bg-danger-600/60" style="width: {elapsedPercent}%"></div>
    {/if}
    <div class="flex flex-col tabular-nums leading-tight">
        <span class="text-base font-bold">{formatTime(event.start)}</span>
        <span class="text-xs text-contrast-200">{formatTime(event.end)}</span>
    </div>
    <!-- A column of its own in every row, so titles start on one edge with or without the icon. -->
    <span class="flex justify-center" aria-hidden="true">
        {#if long}
            <IconStack2 class="h-4 w-4 text-contrast-200" />
        {/if}
    </span>
    <div class="flex min-w-0 flex-col">
        <span class="line-clamp-2 break-words" title={event.title}>{event.title}</span>
        <span class="text-xs text-contrast-200">
            {#if inProgress}
                <span class="font-bold text-danger-600">{$LL.externalModule.calendar.inProgress()}</span>&nbsp;·
            {/if}
            {formatDuration(event)}{#if event.resource?.onlineMeeting?.isWorkAdventure}&nbsp;· WorkAdventure{/if}
        </span>
    </div>
    <CalendarJoinButton {event} />
</div>
