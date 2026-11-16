<script lang="ts">
    import { clickOutside } from "svelte-outside";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { LockableAreaEntry } from "../../Stores/CurrentPlayerAreaLockStore";
    import LockIcon from "../Icons/LockIcon.svelte";
    import LockOpenIcon from "../Icons/LockOpenIcon.svelte";

    interface Props {
        areas: LockableAreaEntry[];
        areasWithPermission?: Set<string>;
        onselect?: (entry: LockableAreaEntry) => void;
        onclose?: () => void;
        /** When defined, show a row for the discussion bubble (group lock) in the list. */
        groupLockState?: boolean;
        /** Callback when the user selects the bubble row. Only used when groupLockState is defined. */
        onselectgrouplock?: () => void;
    }

    let {
        areas = [],
        areasWithPermission = new Set(),
        onselect,
        onclose,
        groupLockState,
        onselectgrouplock,
    }: Props = $props();

    function handleClose(): void {
        onclose?.();
    }

    function handleSelect(entry: LockableAreaEntry): void {
        onselect?.(entry);
        handleClose();
    }

    function handleSelectGroupLock(): void {
        onselectgrouplock?.();
        handleClose();
    }

    function entryKey(entry: LockableAreaEntry): string {
        return `${entry.areaId}:${entry.propertyId}`;
    }

    function canLock(entry: LockableAreaEntry): boolean {
        return areasWithPermission.has(entryKey(entry));
    }

    let showBubbleRow = $derived(groupLockState !== undefined && onselectgrouplock !== undefined);
</script>

<div
    data-testid="lockable-area-picker"
    class="bg-contrast/95 backdrop-blur-md rounded-md shadow-lg p-2 max-w-96 overflow-auto flex flex-col gap-1"
    use:clickOutside={handleClose}
>
    <div class="text-sm font-semibold text-white px-2 pb-1">
        {$LL.actionbar.help.lock.areaPickerTitle()}
    </div>

    {#if showBubbleRow}
        <button
            type="button"
            class="w-full text-left p-2 rounded-sm transition-colors flex flex-row items-center gap-2 {groupLockState
                ? 'bg-red-500/30 hover:bg-red-500/40 aria-disabled:hover:bg-red-500/30'
                : 'hover:bg-white/10 aria-disabled:hover:bg-transparent'} aria-disabled:cursor-not-allowed"
            data-testid="lockable-area-option-bubble"
            aria-pressed={groupLockState}
            onclick={handleSelectGroupLock}
        >
            {#if groupLockState}
                <LockIcon />
            {:else}
                <LockOpenIcon />
            {/if}
            <span class="text-sm text-white flex-1 truncate">
                {$LL.actionbar.help.lock.bubbleLabel()}
            </span>
        </button>
    {/if}

    {#each areas as entry, index (entryKey(entry))}
        <button
            type="button"
            class="w-full text-left p-2 rounded-sm transition-colors flex flex-row items-center gap-2 {entry.lockState
                ? 'bg-red-500/30 hover:bg-red-500/40 aria-disabled:hover:bg-red-500/30'
                : 'hover:bg-white/10 aria-disabled:hover:bg-transparent'} aria-disabled:cursor-not-allowed"
            data-testid="lockable-area-option-{index}"
            aria-pressed={entry.lockState}
            aria-disabled={!canLock(entry) || undefined}
            onclick={() => canLock(entry) && handleSelect(entry)}
        >
            <span class="flex {canLock(entry) ? '' : 'opacity-50'}">
                {#if entry.lockState}
                    <LockIcon />
                {:else}
                    <LockOpenIcon />
                {/if}
            </span>
            <span class="flex-1 min-w-0 flex flex-col">
                <span
                    class="text-sm text-white truncate {canLock(entry) ? '' : 'opacity-50'}"
                    title={entry.areaName?.trim() || $LL.actionbar.help.lock.unnamedArea()}
                >
                    {entry.areaName?.trim() || $LL.actionbar.help.lock.unnamedArea()}
                </span>
                {#if !canLock(entry)}
                    <span class="text-xs text-white/80" data-testid="lockable-area-option-{index}-reason">
                        {$LL.actionbar.help.lock.noPermission()}
                    </span>
                {/if}
            </span>
        </button>
    {/each}
</div>
