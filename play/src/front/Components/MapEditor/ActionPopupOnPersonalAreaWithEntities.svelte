<script lang="ts">
    import PopupGeneric from "../Modal/Popup.svelte";
    import Button from "../UI/Button.svelte";
    import Alert from "../UI/Alert.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { modals } from "@wa-modals";

    interface Props {
        isOpen: boolean;
        /** How many objects stand inside the personal area, so the buttons say what they act on. */
        entitiesCount: number;
        /** Set when the area or an object inside holds an uploaded file that a choice would delete for good. */
        warning?: string;
        onDeleteEntities: () => void;
        onKeepEntities: () => void;
        onCancel: () => void;
    }

    let { isOpen, entitiesCount, warning, onDeleteEntities, onKeepEntities, onCancel }: Props = $props();

    const translations = $derived($LL.mapEditor.areaEditor.actionPopupOnPersonalAreaWithEntities);
</script>

<PopupGeneric {isOpen}>
    {#snippet title()}
        <h1 class="m-0 text-xl">{translations.heading({ count: entitiesCount })}</h1>
    {/snippet}
    {#snippet content()}
        <div class="flex w-full flex-col gap-3">
            <p class="m-0 text-white/80">{translations.question()}</p>
            {#if warning}
                <Alert variant="warning" class="w-full">{warning}</Alert>
            {/if}
        </div>
    {/snippet}
    {#snippet action()}
        <!-- Cancel comes first: Popup puts the focus on the first footer button, so Enter never deletes anything.
             The destructive choice comes last and wears the danger style. -->
        <div class="flex w-full flex-col gap-2 sm:flex-row">
            <Button
                variant="contrast"
                class="flex-1"
                dataTestId="personalAreaEntitiesCancel"
                onclick={() => {
                    onCancel();
                    modals.close();
                }}
            >
                {translations.buttons.cancel()}
            </Button>
            <Button
                variant="secondary"
                class="flex-1"
                dataTestId="personalAreaEntitiesKeep"
                onclick={() => {
                    onKeepEntities();
                    modals.close();
                }}
            >
                {translations.buttons.keepObjects()}
            </Button>
            <Button
                variant="danger"
                class="flex-1"
                dataTestId="personalAreaEntitiesDelete"
                onclick={() => {
                    onDeleteEntities();
                    modals.close();
                }}
            >
                {translations.buttons.deleteObjects({ count: entitiesCount })}
            </Button>
        </div>
    {/snippet}
</PopupGeneric>
