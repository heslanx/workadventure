<script lang="ts">
    import { LL, locale } from "../../../i18n/i18n-svelte";
    import { getPermissionHelpBrowser, getPermissionHelpScreenshot } from "./permissionHelp";
    import { IconInfoCircle } from "@wa-icons";

    interface Props {
        // Which devices the browser blocks. Both false (the state changed while the help closes) reads as both.
        camera: boolean;
        microphone: boolean;
    }

    let { camera, microphone }: Props = $props();

    const browser = getPermissionHelpBrowser();

    let cameraAndMicrophone = $derived(camera === microphone);
    let screenshot = $derived(getPermissionHelpScreenshot(browser, $locale));
    let steps = $derived.by(() => {
        switch (browser) {
            case "chrome":
                return $LL.camera.help.steps.chrome();
            case "firefox":
                return $LL.camera.help.steps.firefox();
            case "safari":
                return $LL.camera.help.steps.safari();
            case "android":
                return $LL.camera.help.steps.android();
            default:
                return $LL.camera.help.steps.other();
        }
    });
</script>

<div class="px-4 mt-4">
    <p class="help-text !text-danger-400">
        <IconInfoCircle class="mr-2 mb-1 min-w-6" font-size="18" aria-hidden="true" />
        {#if cameraAndMicrophone}
            {$LL.camera.help.cameraMicrophonePermissionDenied()}
        {:else if camera}
            {$LL.camera.help.cameraPermissionDenied()}
        {:else}
            {$LL.camera.help.microphonePermissionDenied()}
        {/if}
    </p>
</div>
<div class="p-4 pb-2 italic opacity-60 text-sm leading-6">
    {#if cameraAndMicrophone}
        {$LL.camera.help.content()}
    {:else if camera}
        {$LL.camera.help.cameraContent()}
    {:else}
        {$LL.camera.help.microphoneContent()}
    {/if}
</div>
<p class="px-4 pb-4 m-0 text-sm leading-6" data-testid="permission-help-steps">{steps}</p>
{#if browser === "firefox"}
    <p class="err">
        {$LL.camera.help.firefoxContent()}
    </p>
{/if}
{#if screenshot}
    <div class="h-72 overflow-hidden opacity-80 saturate-50">
        <img draggable="false" src={screenshot} alt={$LL.a11y.compHelpCameraPermission()} class="w-full m-auto" />
    </div>
{/if}
