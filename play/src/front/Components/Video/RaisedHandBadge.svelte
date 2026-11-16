<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import { findHandPosition, raisedHandsOrderStore } from "../../Stores/RaisedHandsStore";
    import RaiseHandIcon from "../Icons/RaiseHandIcon.svelte";

    interface Props {
        spaceUserId: string;
        /** The space of the tile; undefined for the local tile (see findHandPosition). */
        spaceName: string | undefined;
    }

    let { spaceUserId, spaceName }: Props = $props();

    // 1-based order in which this participant raised their hand (undefined when the hand is not raised).
    let hand = $derived(findHandPosition($raisedHandsOrderStore, spaceName, spaceUserId));
</script>

{#if hand !== undefined}
    <div class="flex items-center gap-1 px-1 pointer-events-none" data-testid="raised-hand-badge">
        <span class="inline-flex" aria-hidden="true">
            <RaiseHandIcon height="h-4" width="w-4" strokeColor="stroke-current" hover="" />
        </span>
        <span class="sr-only">{$LL.a11y.videoHandRaised()}</span>
        <!-- The order only matters when several hands are raised. -->
        {#if hand.queueSize > 1}
            <span class="text-sm font-bold leading-none tabular-nums">{hand.position}</span>
        {/if}
    </div>
{/if}
