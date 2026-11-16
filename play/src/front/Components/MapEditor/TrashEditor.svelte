<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
</script>

<div class="flex flex-col gap-1 text-center">
    <span class="text-l">{$LL.mapEditor.entityEditor.trashTool.delete()}</span>
    <span class="text-sm text-white/70">{$LL.mapEditor.entityEditor.trashTool.undoHint()}</span>
    <span class="text-sm text-white/70">{$LL.mapEditor.entityEditor.trashTool.keyboardHint()}</span>
</div>

<style>
</style>
