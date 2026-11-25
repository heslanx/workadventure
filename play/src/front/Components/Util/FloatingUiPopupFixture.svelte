<script lang="ts">
    // A stand-in for the content of a popup, for FloatingUiPopupList.test.ts: a menu, a picker or a tooltip.
    let { label = "popup" }: { label?: string } = $props();
</script>

<p data-testid="popup-content">{label}</p>
