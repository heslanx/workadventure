<script lang="ts">
    import LL from "../../../i18n/i18n-svelte";
    import { isReducedMotion } from "../../Utils/reducedMotion";
    import { IconPause, IconPlay } from "@wa-icons";

    interface Props {
        src: string;
    }

    const { src }: Props = $props();

    // A looping autoplay video is moving content that lasts more than 5 seconds: it always has a pause control.
    // When the user reduces motion it does not start by itself or loop, and plays once on request.
    const reducedMotion = isReducedMotion();

    let video: HTMLVideoElement | undefined = $state();
    // Follows the video itself (play and pause events), so a browser that refuses to autoplay shows "Play".
    let paused = $state(true);

    function toggle(): void {
        if (!video) return;
        if (video.paused) {
            video.play().catch((error: unknown) => console.error("Could not play the onboarding video", error));
        } else {
            video.pause();
        }
    }
</script>

<div class="relative mb-4">
    <video
        bind:this={video}
        autoplay={!reducedMotion}
        muted
        loop={!reducedMotion}
        playsinline
        preload="metadata"
        class="w-full rounded-lg"
        onplay={() => (paused = false)}
        onpause={() => (paused = true)}
        onended={() => (paused = true)}
    >
        <source {src} type="video/mp4" />
    </video>
    <button
        type="button"
        class="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/90 cursor-pointer"
        data-testid="onboarding-video-toggle"
        aria-label={paused ? $LL.onboarding.videoPlay() : $LL.onboarding.videoPause()}
        onclick={toggle}
    >
        {#if paused}
            <IconPlay font-size="18" aria-hidden="true" />
        {:else}
            <IconPause font-size="18" aria-hidden="true" />
        {/if}
    </button>
</div>
