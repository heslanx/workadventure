<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { profileAvailable, getProfileUrl } from "../../Stores/MenuStore";
    import { iframeListener } from "../../Api/IframeListener";

    let profileIframe: HTMLIFrameElement;

    onMount(() => {
        if ($profileAvailable && profileIframe) iframeListener.registerIframe(profileIframe);
    });

    onDestroy(() => {
        if ($profileAvailable && profileIframe) iframeListener.unregisterIframe(profileIframe);
    });
</script>

<div class="customize-main">
    <div class="content">
        <section class="centered-column w-full m-auto resizing-text">
            {#if $profileAvailable}
                <iframe
                    bind:this={profileIframe}
                    title={$LL.menu.sub.profile()}
                    src={getProfileUrl()}
                    class="w-full h-dvh border-0"
                ></iframe>
            {/if}
        </section>
    </div>
</div>
