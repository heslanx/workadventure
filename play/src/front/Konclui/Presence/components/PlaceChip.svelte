<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { surface } from "../../../Utils/surfaceTransition";
    import { placeName } from "../domain/place";
    import { callChipStore } from "../stores/conversationStore";
    import { placeStore } from "../stores/placeStore";
    import { presenceStore } from "../stores/presenceStore";
    import { IconMapPin } from "@wa-icons";

    // Where the current player stands, and how many people are near. Only the place name is a live region, and the
    // store behind it changes at most every two seconds: the near count changes as people walk by, and read out each
    // time it would be a storm. The chip comes and goes on the surface transition, with the whole chip held for its
    // exit; the name and the count inside it change in place, with no motion of their own.

    let name = $derived(
        $placeStore === undefined
            ? undefined
            : placeName($placeStore, {
                  entrance: $LL.konclui.place.entrance(),
                  hall: $LL.konclui.place.hall(),
                  outside: $LL.konclui.place.outside(),
              }),
    );
    let nearCount = $derived($presenceStore?.nearCount ?? 0);
    // In a conversation the call chip says where it is, and the camera strip takes the top of the screen.
    let inConversation = $derived($callChipStore !== undefined);
</script>

{#if name !== undefined && !inConversation}
    <div class="place k-chrome" transition:surface>
        <span class="icon" aria-hidden="true"><IconMapPin font-size="18" /></span>
        <b role="status" aria-live="polite" aria-atomic="true">
            <span class="visually-hidden">{`${$LL.konclui.place.here()} `}</span>{name}
        </b>
        {#if nearCount > 0}
            <span class="separator" aria-hidden="true"></span>
            <span class="near">{$LL.konclui.nearby({ count: nearCount })}</span>
        {/if}
    </div>
{/if}

<style>
    .place {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        min-height: 40px;
        box-sizing: border-box;
        padding: 0 14px 0 10px;
        border-radius: 20px;
        color: var(--k-fg);
        font-size: 13px;
        /* It is a status, not a control: a click goes through it to the map. */
        pointer-events: none;
    }
    .icon {
        display: flex;
        flex: none;
        color: var(--k-accent);
    }
    b {
        min-width: 0;
        overflow: hidden;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .separator {
        flex: none;
        width: 1px;
        height: 18px;
        background: var(--k-border);
    }
    .near {
        flex: none;
        color: var(--k-fg-2);
        white-space: nowrap;
    }
    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }
    @media (max-width: 640px) {
        .separator,
        .near {
            display: none;
        }
    }
</style>
