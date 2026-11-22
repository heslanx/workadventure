<script lang="ts">
    import { emoteMenuStore } from "../../../Stores/EmoteStore";
    import { enableUserInputsStore } from "../../../Stores/UserInputStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { emoteCatalogue, type EmoteId } from "../domain/emoteCatalogue";
    import { nextGridIndex } from "../domain/gridNavigation";
    import { coolingEmoteStore } from "../stores/emoteCooldownStore";
    import { sendCustomEmote } from "../stores/emoteSender";

    /**
     * The pixel emotes, drawn inside the reactions menu under the favourite reactions. One tab stop: the arrow keys,
     * Home and End move through the grid, Enter and Space send. Every emote stays focusable while none can go, and
     * the line under the grid says why in words: the reactions are being edited, the keys belong to something else,
     * an emote just left, or the player pressed one too soon.
     */
    const statusId = $props.id();

    let focusId = $state<EmoteId>(emoteCatalogue[0].id);
    // The player pressed an emote while the cooldown ran; it is forgotten when the cooldown ends.
    let tooSoon = $state(false);
    let buttons = $state<HTMLButtonElement[]>([]);

    // The words that say why no emote can go now, or an empty text when one can. A control is unavailable exactly
    // while the text says why.
    let status = $derived.by(() => {
        if ($emoteMenuStore) return $LL.konclui.reactions.editing();
        if (!$enableUserInputsStore) return $LL.konclui.reactions.blocked();
        const cooling = $coolingEmoteStore;
        if (cooling === undefined) return "";
        return tooSoon
            ? $LL.konclui.reactions.wait()
            : $LL.konclui.reactions.sent({ emote: $LL.konclui.reactions.emote[cooling]() });
    });
    let unavailable = $derived(status !== "");

    $effect(() => {
        if ($coolingEmoteStore === undefined) tooSoon = false;
    });

    function send(id: EmoteId, event: MouseEvent & { currentTarget: HTMLButtonElement }): void {
        focusId = id;
        if (sendCustomEmote(id) === "cooling") tooSoon = true;
        // A click of the pointer leaves the focus on the button, and a focused emote keeps the arrow keys from the game:
        // the player who clicks an emote and walks on would find the character still. `detail` counts the clicks, so it
        // is 0 when Enter or Space made the click, and then the focus stays where the keyboard put it.
        if (event.detail > 0) event.currentTarget.blur();
    }

    function navigate(event: KeyboardEvent, from: number): void {
        // The game moves the character with the arrow keys and acts on Enter: they belong to the focused control.
        if (event.key === "Enter" || event.key === " ") {
            event.stopPropagation();
            return;
        }
        const to = nextGridIndex(
            buttons.map((button) => button.getBoundingClientRect()),
            from,
            event.key,
        );
        if (to === undefined) {
            if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        focusId = emoteCatalogue[to].id;
        buttons[to].focus();
    }
</script>

<div class="section" data-testid="konclui-emotes">
    <span class="k-menu-title" aria-hidden="true">{$LL.konclui.reactions.title()}</span>
    <div class="grid" role="toolbar" aria-label={$LL.konclui.reactions.title()}>
        {#each emoteCatalogue as emote, index (emote.id)}
            {@const label = $LL.konclui.reactions.emote[emote.id]()}
            <button
                type="button"
                class="k-control emote"
                data-testid={`konclui-emote-${emote.id}`}
                data-sent={$coolingEmoteStore === emote.id ? "true" : undefined}
                aria-label={label}
                title={label}
                aria-disabled={unavailable ? "true" : undefined}
                aria-describedby={unavailable ? statusId : undefined}
                tabindex={focusId === emote.id ? 0 : -1}
                bind:this={buttons[index]}
                onclick={(event) => send(emote.id, event)}
                onfocus={() => (focusId = emote.id)}
                onkeydown={(event) => navigate(event, index)}
            >
                <img src={emote.art} alt="" width="32" height="32" draggable="false" />
            </button>
        {/each}
    </div>
    <!-- Always in the page, so the first message is announced: it changes at most once per cooldown. -->
    <p class="status" id={statusId} role="status" data-testid="konclui-emotes-status">{status}</p>
</div>

<style>
    .section {
        display: flex;
        flex-direction: column;
        padding: 0 4px 4px;
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(6, 40px);
        justify-content: center;
        /* The finger's area on a phone reaches 3 and 4 px past a control: 8 px keeps two areas apart. */
        gap: 8px;
        padding: 4px;
    }

    @media (min-width: 640px) {
        .grid {
            grid-template-columns: repeat(9, 40px);
        }
    }

    .emote {
        width: 40px;
        height: 40px;
        min-width: 40px;
    }

    /*
     * A finger needs 44 px, the shell's minimum touch target. Six columns of 44 px and 8 px gaps need 304 px, which a
     * menu fits down to a 360 px screen (the menu keeps 8 px at each side, and the bar, the section and the grid 4 px
     * each): a narrower one takes five columns.
     */
    @media (pointer: coarse) {
        .grid {
            grid-template-columns: repeat(6, 44px);
        }

        .emote {
            width: 44px;
            height: 44px;
            min-width: 44px;
        }
    }

    @media (pointer: coarse) and (max-width: 359px) {
        .grid {
            grid-template-columns: repeat(5, 44px);
        }
    }

    @media (pointer: coarse) and (min-width: 640px) {
        .grid {
            grid-template-columns: repeat(9, 44px);
        }
    }

    .emote img {
        display: block;
        width: 32px;
        height: 32px;
        image-rendering: pixelated;
    }

    /* The emote that just left is marked by a ring: the others dim, it does not. */
    .emote[data-sent="true"] {
        opacity: 1;
        box-shadow: inset 0 0 0 2px var(--k-accent);
    }

    /* A line is kept for the status, so the menu does not jump when a message comes. */
    .status {
        min-height: 1.25rem;
        margin: 0;
        padding: 0 8px;
        color: var(--k-fg-2);
        font-size: 12px;
        line-height: 1.25rem;
        text-align: center;
    }
</style>
