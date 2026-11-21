<script lang="ts">
    import type { Readable } from "svelte/store";
    import { AvailabilityStatus } from "@workadventure/messages";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { getStatusLabel } from "../../../Utils/AvailabilityStatus";
    import type { PersonRow } from "../domain/peopleList";
    import { placeName } from "../domain/place";
    import PersonAvatar from "./PersonAvatar.svelte";

    // One person of the list. The whole row is one button: "Go to" the person. Its name is its text, in the order the eye
    // reads it: who, where, how, and why it cannot act when it cannot. Status is never colour alone: the label is always
    // in the row.
    let {
        row,
        liveStatus,
        you = false,
        onGo,
    }: {
        row: PersonRow;
        /** The person's own status, which follows them as it changes. The row falls back to the status it was given. */
        liveStatus?: Readable<number>;
        /** The player's own row: shown the same way, with nowhere to go. */
        you?: boolean;
        onGo?: (row: PersonRow) => void;
    } = $props();

    // A store held in a prop: `$liveStatus` reads it, and a row without one reads nothing.
    let status = $derived($liveStatus ?? row.status);
    let tone = $derived(toneOf(status));
    let statusLabel = $derived(status === undefined ? undefined : getStatusLabel(status));
    let place = $derived(
        row.place === undefined
            ? undefined
            : placeName(row.place, {
                  entrance: $LL.konclui.place.entrance(),
                  hall: $LL.konclui.place.hall(),
                  outside: $LL.konclui.place.outside(),
              }),
    );
    // Where the person is, as far as it is known: the place on the map, or the room that is not this one.
    let where = $derived(place ?? (row.elsewhere ? row.roomName : undefined));
    let details = $derived([where, statusLabel].filter((part): part is string => part !== undefined && part !== ""));
    let label = $derived(
        [
            $LL.konclui.peopleList.goToPerson({ name: row.name }),
            ...details,
            ...(row.elsewhere ? [$LL.konclui.peopleList.elsewhere()] : []),
        ].join(", "),
    );

    /** The colour class of a status. The label says the same in words. */
    function toneOf(value: number | undefined): "online" | "away" | "dnd" | "unknown" {
        switch (value) {
            case AvailabilityStatus.ONLINE:
            case AvailabilityStatus.JITSI:
            case AvailabilityStatus.BBB:
            case AvailabilityStatus.LIVEKIT:
            case AvailabilityStatus.LISTENER:
            case AvailabilityStatus.SPEAKER:
                return "online";
            case AvailabilityStatus.AWAY:
            case AvailabilityStatus.IDLE:
            case AvailabilityStatus.BUSY:
            case AvailabilityStatus.BACK_IN_A_MOMENT:
                return "away";
            case AvailabilityStatus.DO_NOT_DISTURB:
            case AvailabilityStatus.SILENT:
                return "dnd";
            default:
                return "unknown";
        }
    }

    function go() {
        // A person in another room is not on this map: the row stays focusable and says why, and does nothing.
        if (row.elsewhere) return;
        onGo?.(row);
    }
</script>

{#if you}
    <div class="person you" data-person-you>
        <PersonAvatar name={row.name} size={36} />
        <span class="grow">
            <b>{$LL.konclui.peopleList.you({ name: row.name })}</b>
            <small>
                <span class="dot" data-tone={tone} aria-hidden="true"></span>
                <span class="where">{details.join(" · ")}</span>
            </small>
        </span>
    </div>
{:else}
    <button
        type="button"
        class="person"
        data-person-row
        data-testid="person-row"
        aria-label={label}
        aria-disabled={row.elsewhere ? "true" : undefined}
        title={[row.name, ...details].join(" · ")}
        onclick={go}
    >
        <PersonAvatar name={row.name} size={36} />
        <span class="grow">
            <b>{row.name}</b>
            <small>
                <span class="dot" data-tone={tone} aria-hidden="true"></span>
                <span class="where">{details.join(" · ")}</span>
            </small>
        </span>
        {#if row.elsewhere}
            <span class="go reason">{$LL.konclui.peopleList.elsewhere()}</span>
        {:else}
            <span class="go" aria-hidden="true">{$LL.konclui.peopleList.goTo()}</span>
        {/if}
    </button>
{/if}

<style>
    .person {
        --avatar-ring: var(--k-card);
        display: flex;
        align-items: center;
        gap: 12px;
        box-sizing: border-box;
        width: 100%;
        min-height: 52px;
        margin: 0;
        padding: 6px 12px;
        border: 0;
        border-radius: var(--k-radius-inner);
        background: transparent;
        color: var(--k-fg);
        font: inherit;
        text-align: start;
    }
    button.person {
        cursor: pointer;
    }
    button.person:focus-visible {
        outline: 2px solid var(--k-accent);
        outline-offset: -2px;
    }
    button.person[aria-disabled="true"] {
        cursor: not-allowed;
    }
    @media (hover: hover) {
        button.person:hover {
            background: var(--k-hover);
        }
        button.person[aria-disabled="true"]:hover {
            background: transparent;
        }
    }
    .grow {
        flex: 1;
        min-width: 0;
    }
    b {
        display: block;
        overflow: hidden;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    small {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--k-fg-2);
        font-size: 12px;
        line-height: 1.5;
    }
    .where {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--k-fg-muted);
    }
    .dot[data-tone="online"] {
        background: var(--k-success);
    }
    .dot[data-tone="away"] {
        background: #e9c84e;
    }
    .dot[data-tone="dnd"] {
        background: #e96e53;
    }
    .go {
        flex: none;
        color: var(--k-fg-2);
        font-size: 12px;
        font-weight: 600;
    }
    /* "Go to" appears where a pointer can hover or a keyboard can focus, and is always there on a touch screen. The
       reason a row cannot act is always there. */
    @media (hover: hover) {
        .go:not(.reason) {
            opacity: 0;
        }
        button.person:hover .go,
        button.person:focus-visible .go {
            opacity: 1;
        }
    }
    @media (forced-colors: active) {
        .dot {
            forced-color-adjust: none;
        }
    }
</style>
