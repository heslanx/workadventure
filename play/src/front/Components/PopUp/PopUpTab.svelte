<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { UserInputManager } from "../../Phaser/UserInput/UserInputManager";
    import LL from "../../../i18n/i18n-svelte";
    import Button from "../UI/Button.svelte";
    import PopUpContainer from "./PopUpContainer.svelte";

    interface Props {
        message: string;
        click: () => void;
        userInputManager: UserInputManager;
    }

    let { message, click, userInputManager }: Props = $props();

    onMount(() => {
        userInputManager.addSpaceEventListener(click);
    });

    onDestroy(() => {
        userInputManager.removeSpaceEventListener(click);
    });
</script>

<PopUpContainer reduceOnSmallScreen={true}>
    {message}
    {#snippet buttons()}
        <Button variant="secondary" class="w-1/2 max-w-80 responsive-message" onclick={click}
            >{$LL.warning.popUp.openInNewTab()}</Button
        >
    {/snippet}
</PopUpContainer>

<style>
    @media (max-width: 768px) {
        :global(.responsive-message) {
            font-size: 1.5rem;
            line-height: 2rem;
            padding-bottom: 14px;
        }
    }
</style>
