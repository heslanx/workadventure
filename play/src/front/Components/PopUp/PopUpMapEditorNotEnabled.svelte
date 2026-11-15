<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { UserInputManager } from "../../Phaser/UserInput/UserInputManager";
    import LL from "../../../i18n/i18n-svelte";
    import Button from "../UI/Button.svelte";
    import PopUpContainer from "./PopUpContainer.svelte";

    interface Props {
        message: string;
        onclick: () => void;
        userInputManager: UserInputManager;
    }

    let { message, onclick, userInputManager }: Props = $props();

    onMount(() => {
        userInputManager.addSpaceEventListener(onclick);
    });

    onDestroy(() => {
        userInputManager.removeSpaceEventListener(onclick);
    });
</script>

<PopUpContainer reduceOnSmallScreen={true}>
    {message}
    {#snippet buttons()}
        <Button variant="secondary" class="w-1/2 responsive-message" {onclick}>{$LL.warning.popUp.close()}</Button>
    {/snippet}
</PopUpContainer>

<style>
    @media (max-width: 768px) {
        :global(.responsive-message) {
            scale: 1.2;
        }
    }
</style>
