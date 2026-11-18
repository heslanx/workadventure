<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { peoplePillStore } from "../stores/peoplePillStore";
    import PersonAvatar from "./PersonAvatar.svelte";
    import { IconUsersGroup } from "@wa-icons";

    // The pill that opens the people panel on a phone. It says how many people are online and how many are near,
    // and stacks the avatars of the nearest ones. Its name is its text, so what is read out is what is shown.
    let {
        expanded,
        controls,
        onclick,
        button = $bindable(),
    }: {
        expanded: boolean;
        /** The id of the panel the pill opens. */
        controls: string;
        onclick: () => void;
        button?: HTMLButtonElement;
    } = $props();

    let { summary, nearest } = $derived($peoplePillStore);

    let headline = $derived(
        summary.kind === "others"
            ? $LL.konclui.pill.online({ count: summary.online })
            : summary.kind === "alone"
              ? $LL.konclui.pill.alone()
              : // Before the world's list has synchronised there is no number to show, and zero would be false.
                $LL.konclui.people(),
    );
    let subline = $derived(
        summary.kind !== "others" || summary.nearCount === undefined
            ? undefined
            : summary.nearCount > 0
              ? $LL.konclui.nearby({ count: summary.nearCount })
              : $LL.konclui.pill.nobodyNearby(),
    );
</script>

<button
    bind:this={button}
    class="people-pill k-chrome"
    class:has-stack={nearest.length > 0}
    type="button"
    aria-expanded={expanded}
    aria-controls={controls}
    {onclick}
>
    {#if nearest.length > 0}
        <span class="stack" aria-hidden="true">
            {#each nearest as person (person.id)}
                <PersonAvatar name={person.name} />
            {/each}
        </span>
    {/if}
    <span class="icon" aria-hidden="true"><IconUsersGroup font-size="18" /></span>
    <span class="text">
        <b>{headline}</b>
        {#if subline !== undefined}<small>{subline}</small>{/if}
    </span>
</button>

<style>
    .people-pill {
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 100%;
        min-height: 44px;
        margin: 0;
        padding: 6px 14px 6px 8px;
        border: 0;
        border-radius: 22px;
        color: var(--k-fg);
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .people-pill:hover {
        background-color: var(--k-hover);
    }
    .people-pill:focus-visible {
        outline: 2px solid var(--k-accent);
        outline-offset: 2px;
    }
    .stack {
        display: flex;
    }
    /* The avatars overlap, each cut out of the next by its ring. They are another component's elements, hence global. */
    .stack :global(.person-avatar + .person-avatar) {
        margin-inline-start: -8px;
    }
    .icon {
        display: flex;
        flex: none;
        padding-inline-start: 4px;
        color: var(--k-fg-2);
    }
    .has-stack .icon {
        display: none;
    }
    .text {
        min-width: 0;
    }
    b {
        display: block;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.3;
        white-space: nowrap;
    }
    small {
        display: block;
        color: var(--k-fg-2);
        font-size: 12px;
        line-height: 1.5;
        white-space: nowrap;
    }
    /* On a narrow screen the pill keeps its count and the room goes to the place chip beside it. */
    @media (max-width: 640px) {
        .stack,
        small {
            display: none;
        }
        .has-stack .icon {
            display: flex;
        }
    }
</style>
