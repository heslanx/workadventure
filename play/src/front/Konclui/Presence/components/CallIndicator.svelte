<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { callChipStore } from "../stores/conversationStore";
    import { IconMessageCircle2 } from "@wa-icons";

    // The chip above the dock that says the current user is in a conversation, for a person whose chat is closed or
    // whose camera is off and who would not otherwise know. The region is always mounted and empty while idle: a
    // status that appears already filled is often not announced, one that is filled while mounted is. The store
    // behind it changes at most every two seconds, so people joining a bubble one after the other are read out once.
    let conversation = $derived($callChipStore);
    let sentence = $derived(
        conversation === undefined
            ? ""
            : conversation.kind === "room" && conversation.placeName !== ""
              ? $LL.konclui.call.conversationIn({ place: conversation.placeName, count: conversation.count })
              : $LL.konclui.call.conversation({ count: conversation.count }),
    );
    let hint = $derived(conversation?.kind === "room" ? $LL.konclui.call.leaveRoom() : $LL.konclui.call.stepAway());
</script>

<div class="call" role="status" aria-live="polite" aria-atomic="true" data-testid="konclui-call">
    {#if conversation !== undefined}
        <div class="chip k-chrome">
            <span class="icon" aria-hidden="true"><IconMessageCircle2 font-size="18" /></span>
            <span class="text">{sentence}<span class="hint">{` · ${hint}`}</span></span>
        </div>
    {/if}
</div>

<style>
    .call {
        display: flex;
        justify-content: center;
        width: 100%;
        /* It is a status, not a control: a click goes through it to the map. */
        pointer-events: none;
    }
    .chip {
        display: flex;
        align-items: center;
        gap: 10px;
        /* The map zoom column (upstream ExplorerMenu) stands at the right edge of the screen: 8 px in, 56 px wide, and
           on a phone from 96 px up, which is the band the chip sits in. The chip is centred, so a cap that clears the
           column on the right clears the left edge by the same amount. 100% is the stack's width inside its 8 px
           padding: 100% - 128 px leaves 8 px of air past the column (2 x (8 + 64 + 8) - 2 x 8 = 144 - 16). A longer
           sentence wraps. */
        max-width: calc(100% - 128px);
        box-sizing: border-box;
        margin-bottom: 10px;
        padding: 9px 16px 9px 12px;
        border-radius: 22px;
        color: var(--k-fg-2);
        font-size: 13px;
        font-weight: 600;
        line-height: 1.4;
        /* The tokens are 0.01 ms under reduced motion (konclui.css), and the rule below removes the rise as well. */
        animation: rise var(--k-dur-normal) var(--k-ease-out-expo) backwards;
    }
    .icon {
        display: flex;
        flex: none;
        color: var(--k-accent);
    }
    .text {
        min-width: 0;
        text-wrap: balance;
        /* A place name is the map author's: a long one without a space must wrap inside the cap, not run past it. */
        overflow-wrap: anywhere;
    }
    .hint {
        color: var(--k-fg-muted);
        font-weight: 500;
    }
    @keyframes rise {
        from {
            opacity: 0;
            translate: 0 6px;
        }
    }
    /* On a phone the chip keeps the fact and drops the advice, so it stays on a line or two. */
    @media (max-width: 480px) {
        .hint {
            display: none;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .chip {
            animation: none;
        }
    }
</style>
