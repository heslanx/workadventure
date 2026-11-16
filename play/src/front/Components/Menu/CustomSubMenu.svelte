<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { iframeListener } from "../../Api/IframeListener";

    interface Props {
        url: string;
        allowApi: boolean;
        allow: string | undefined;
        // The name of the menu entry, for the screen readers.
        title?: string;
    }

    let { url, allowApi, allow, title = undefined }: Props = $props();

    let HTMLIframe: HTMLIFrameElement;

    onMount(() => {
        if (allowApi) {
            iframeListener.registerIframe(HTMLIframe);
        }
    });

    onDestroy(() => {
        if (allowApi) {
            iframeListener.unregisterIframe(HTMLIframe);
        }
    });
</script>

<iframe title={title ?? $LL.menu.title()} src={url} bind:this={HTMLIframe} {allow} class="border-none w-full h-full m-0"
></iframe>
