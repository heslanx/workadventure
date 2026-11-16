<script lang="ts">
    import { onMount, tick, type Snippet } from "svelte";
    import { fly } from "../../Utils/reducedMotion";
    import ButtonClose from "../Input/ButtonClose.svelte";
    import Button from "../UI/Button.svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { getModal, modals } from "@wa-modals";

    interface Props {
        isOpen?: boolean;
        withAction?: boolean;
        title?: Snippet;
        content?: Snippet;
        action?: Snippet;
        /**
         * True while the popup holds typed work that a close would lose. When set, every close path (Esc, the
         * backdrop, the close button, Cancel) first asks "Discard?". Dialogs that register their own
         * onBeforeClose must not pass it: there is one close guard per modal.
         */
        isDirty?: () => boolean;
    }

    let { isOpen = false, withAction = true, title, content, action, isDirty }: Props = $props();

    // Read during init: the modal context only exists then.
    const modal = getModal();
    let confirmingDiscard = $state(false);
    let discardConfirmed = false;
    let keepEditingButton: HTMLButtonElement | undefined = $state();

    onMount(() => {
        if (!isDirty || !modal) return;
        modal.onBeforeClose = () => {
            if (discardConfirmed || !isDirty?.()) return true;
            confirmingDiscard = true;
            tick()
                .then(() => keepEditingButton?.focus())
                .catch((error: unknown) => console.error(error));
            return false;
        };
        return () => {
            modal.onBeforeClose = undefined;
        };
    });

    function keepEditing() {
        confirmingDiscard = false;
    }

    function discard() {
        discardConfirmed = true;
        modals.close();
    }

    const titleId = `popup-title-${Math.random().toString(36).slice(2)}`;
    const FOCUSABLE =
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    let dialog: HTMLDivElement | undefined = $state();

    function focusables(): HTMLElement[] {
        if (!dialog) return [];
        return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (element) => element.offsetParent !== null,
        );
    }

    // Keyboard users land on the first field, else on the first footer button (Cancel in our popups), and get
    // their focus back on the element that opened the popup when it closes.
    $effect(() => {
        if (!isOpen || !dialog) return;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const firstField = dialog.querySelector<HTMLElement>(
            'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
        );
        const firstFooterButton = dialog.querySelector<HTMLElement>(".footer button:not([disabled])");
        (firstField ?? firstFooterButton ?? focusables()[0])?.focus();
        return () => {
            if (opener?.isConnected) opener.focus();
        };
    });

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            // A second Esc on the "Discard?" question means "no", never "yes".
            if (confirmingDiscard) {
                keepEditing();
                return;
            }
            modals.close();
            return;
        }
        if (event.key !== "Tab") return;
        const elements = focusables();
        if (elements.length === 0) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
</script>

{#if isOpen}
    <div class="absolute flex items-center justify-center w-full h-full">
        <div
            bind:this={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabindex="-1"
            onkeydown={onKeyDown}
            class="bg-contrast/95 backdrop-blur-md text-white z-[2001] w-[90%] m-auto left-0 right-0 sm:max-w-[668px] rounded-lg max-h-full overflow-y-auto pointer-events-auto"
            transition:fly={{ y: -1000, delay: 0, duration: 300 }}
        >
            <div class="p-8 flex flex-col justify-center items-center">
                <div class="flex-row flex items-start w-full justify-between gap-4">
                    <div class="p-2" id={titleId}>
                        {@render title?.()}
                    </div>
                    <div>
                        <ButtonClose
                            dataTestId="closeModal"
                            onclick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                modals.close();
                            }}
                        />
                    </div>
                </div>
                {@render content?.()}
            </div>
            {#if confirmingDiscard}
                <div
                    class="flex flex-col gap-3 sm:flex-row sm:items-center w-full px-8 pb-4"
                    role="alert"
                    data-testid="popupDiscardConfirm"
                >
                    <p class="m-0 grow text-sm">{$LL.form.discard.message()}</p>
                    <div class="flex gap-2">
                        <button
                            type="button"
                            class="btn btn-light btn-ghost btn-sm"
                            bind:this={keepEditingButton}
                            data-testid="popupKeepEditing"
                            onclick={keepEditing}
                        >
                            {$LL.form.discard.keepEditing()}
                        </button>
                        <Button variant="danger" size="sm" dataTestId="popupDiscard" onclick={discard}>
                            {$LL.form.discard.confirm()}
                        </Button>
                    </div>
                </div>
            {/if}
            {#if withAction}
                <div class="footer flex flex-row justify-evenly items-center bg-contrast w-full p-4 gap-3 rounded-b-lg">
                    {@render action?.()}
                </div>
            {/if}
        </div>
    </div>
{/if}
