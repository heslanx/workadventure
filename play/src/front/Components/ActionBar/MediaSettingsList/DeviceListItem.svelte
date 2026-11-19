<script lang="ts">
    import type { Component } from "svelte";
    import { StringUtils } from "../../../Utils/StringUtils";
    import { IconCheck } from "@wa-icons";

    interface Props {
        label: string;
        isSelected: boolean;
        onclick: () => void;
        // The kind of device, in the lead slot. Without it the slot stays, empty, so the labels still align.
        icon?: Component;
    }

    let { label, isSelected, onclick, icon: Icon }: Props = $props();
</script>

<button
    type="button"
    class="k-menu-row"
    onclick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onclick();
    }}
    aria-current={isSelected ? "true" : undefined}
>
    <span class="k-menu-lead" aria-hidden="true">
        {#if Icon}<Icon />{/if}
    </span>
    <span class="k-menu-label" title={StringUtils.normalizeDeviceName(label)}>
        {StringUtils.normalizeDeviceName(label)}
    </span>
    {#if isSelected}
        <IconCheck class="k-menu-mark" aria-hidden="true" />
    {/if}
</button>
