<script lang="ts">
    import { fly } from "../../Utils/reducedMotion";
    import { ADMIN_URL } from "../../Enum/EnvironmentVariable";
    import LL from "../../../i18n/i18n-svelte";
    import Button from "../UI/Button.svelte";

    function register() {
        window.open(`${ADMIN_URL}/second-step-register`, "_self");
    }
</script>

<div
    class="limit-map absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-contrast/95 backdrop-blur rounded-lg"
    transition:fly={{ y: -900, duration: 500 }}
>
    <section class="p-4">
        <h2>{$LL.warning.limitRoom.title()}</h2>
        <p>{$LL.warning.limitRoom.content()}</p>
    </section>

    <section class="justify-center bottom-0 w-full bg-contrast p-4 flex flex-row space-x-4 mt-4 rounded-b-lg">
        <Button
            variant="secondary"
            class="grow"
            onclick={(event) => {
                event.preventDefault();
                register();
            }}
        >
            {$LL.warning.limitRoom.createAccount()}
        </Button>
    </section>
</div>

<style>
    .limit-map {
        pointer-events: auto;
        max-height: 80vh;
        max-width: 80vw;
        overflow: auto;
        text-align: center;
        z-index: 500;
    }
</style>
