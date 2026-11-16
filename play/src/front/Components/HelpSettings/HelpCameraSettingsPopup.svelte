<script lang="ts">
    import { fly } from "../../Utils/reducedMotion";
    import { LL } from "../../../i18n/i18n-svelte";
    import { mediaPermissionDeniedStore } from "../../Stores/MediaStatusStore";
    import { popupStore } from "../../Stores/PopupStore";
    import Button from "../UI/Button.svelte";
    import PermissionHelpDetails from "./PermissionHelpDetails.svelte";

    interface Props {
        // Devices the caller knows are blocked. A browser without the Permissions API never reports them, so the
        // popup reads the browser's permission state only for a device the caller does not name.
        camera?: boolean;
        microphone?: boolean;
    }

    let { camera = undefined, microphone = undefined }: Props = $props();

    let showDetails = $state(false);
    const detailsId = $props.id();

    let cameraDenied = $derived(camera ?? $mediaPermissionDeniedStore.camera);
    let microphoneDenied = $derived(microphone ?? $mediaPermissionDeniedStore.microphone);
    // Neither device denied (the state changed while the popup closes) reads as both, like the details do.
    let cameraAndMicrophoneDenied = $derived(cameraDenied === microphoneDenied);

    function toggleDetails() {
        showDetails = !showDetails;
    }

    function close() {
        popupStore.removePopup("cameraAccessDenied");
    }
</script>

<form
    class="helpCameraSettings z-[600] bg-contrast/95 backdrop-filter text-center rounded-lg text-white self-center pointer-events-auto flex flex-col w-full md:w-[380px] text-sm md:text-base overflow-hidden"
    onsubmit={(event) => {
        event.preventDefault();
        close();
    }}
    transition:fly={{ y: -50, duration: 500 }}
>
    <section class="mb-0">
        <div class="mb-0 text-lg bold border border-solid border-transparent border-b-white/20 bg-white/10 px-4 py-3">
            {#if cameraAndMicrophoneDenied}
                {$LL.camera.help.title()}
            {:else if cameraDenied}
                {$LL.camera.help.cameraTitle()}
            {:else}
                {$LL.camera.help.microphoneTitle()}
            {/if}
        </div>
        {#if showDetails}
            <div id={detailsId}>
                <PermissionHelpDetails camera={cameraDenied} microphone={microphoneDenied} />
            </div>
        {/if}
    </section>
    <section class="flex flex-col gap-2 p-4 bg-contrast">
        <Button
            variant="secondary"
            appearance="border"
            size="sm"
            class="w-full whitespace-normal"
            aria-expanded={showDetails}
            aria-controls={showDetails ? detailsId : undefined}
            onclick={(event) => {
                event.preventDefault();
                toggleDetails();
            }}
        >
            {showDetails ? $LL.camera.help.hideSteps() : $LL.camera.help.showSteps()}
        </Button>
        <Button
            type="submit"
            variant="secondary"
            size="sm"
            class="w-full whitespace-normal"
            onclick={(event) => {
                event.preventDefault();
                close();
            }}
        >
            {#if cameraAndMicrophoneDenied}
                {$LL.camera.help.continueCameraMicrophone()}
            {:else if cameraDenied}
                {$LL.camera.help.continue()}
            {:else}
                {$LL.camera.help.continueWithoutMicrophone()}
            {/if}
        </Button>
    </section>
</form>
