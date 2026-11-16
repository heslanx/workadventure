<script lang="ts">
    import type { Snippet } from "svelte";

    let { children }: { children: Snippet } = $props();
</script>

<!--
    The frame of an app that nothing frames: the full window, with the app inside.
    The app below is sized relative to this wrapper and the page root has no height, so the wrapper must be the
    window itself.
-->
<div class="h-dvh w-dvw">
    {@render children()}
</div>
