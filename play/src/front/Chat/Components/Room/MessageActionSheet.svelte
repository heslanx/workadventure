<script lang="ts">
    import { readable } from "svelte/store";
    import { onDestroy, onMount } from "svelte";
    import type { ChatMessage } from "../../Connection/ChatConnection";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import { selectedChatMessageToEdit, selectedChatMessageToReply } from "../../Stores/ChatStore";
    import { decodeHtmlEntities } from "../../decodeHtmlEntities";
    import { focusTrap } from "../../../Utils/focusTrap";
    import { confirmDelete } from "./confirmDeleteMessage";
    import { IconArrowBackUp, IconCopy, IconMessageCircle2, IconPencil, IconTrash } from "@wa-icons";

    interface Props {
        message: ChatMessage;
        onOpenThread?: () => Promise<void>;
        onClose: () => void;
    }

    let { message, onOpenThread = undefined, onClose }: Props = $props();

    const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"];

    let { content, canDelete, canReact, canEdit } = $derived(message);
    let canReply = $derived(message.canReply ?? readable(true));
    // Proximity (bubble) messages are plain text too.
    let canCopy = $derived((message.type === "text" || message.type === "proximity") && $content.body !== "");
    let copyState: "idle" | "copied" | "failed" = $state("idle");
    let sheet: HTMLDivElement | undefined = $state();

    // The chat panel is blurred and clips its content: render the sheet at the root, above everything.
    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return { destroy: () => node.remove() };
    }

    onMount(() => {
        sheet?.querySelector("button")?.focus();
    });

    onDestroy(() => clearTimeout(closeTimeout));

    function run(action: () => void) {
        action();
        onClose();
    }

    let closeTimeout: ReturnType<typeof setTimeout> | undefined;

    function copyText() {
        navigator.clipboard
            .writeText(decodeHtmlEntities($content.body))
            .then(() => {
                copyState = "copied";
                closeTimeout = setTimeout(onClose, 600);
            })
            .catch((error: unknown) => {
                // Say the copy failed and stay open, rather than nothing at all.
                console.error("Could not copy the message", error);
                copyState = "failed";
            });
    }
</script>

<svelte:window
    onkeydown={(event) => {
        if (event.key === "Escape") onClose();
    }}
/>

<div use:portal class="fixed inset-0 z-[3500] flex flex-col justify-end">
    <button
        type="button"
        class="absolute inset-0 m-0 p-0 rounded-none bg-black/40 border-0 cursor-default"
        aria-label={$LL.chat.messageActions.close()}
        tabindex="-1"
        onclick={onClose}
    ></button>
    <div
        bind:this={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={$LL.chat.messageActions.label()}
        tabindex="-1"
        use:focusTrap
        data-testid="messageActionSheet"
        class="relative bg-contrast text-white rounded-t-xl pt-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col shadow-lg"
    >
        <div class="w-9 h-1 rounded-full bg-white/30 mx-auto mb-2" aria-hidden="true"></div>
        {#if message.date}
            <!-- Touch has no hover: this is where the full date of a message is readable. -->
            <p class="m-0 pb-2 text-xs text-center text-white/70">
                <time datetime={message.date.toISOString()}
                    >{message.date.toLocaleString($locale, { dateStyle: "full", timeStyle: "short" })}</time
                >
            </p>
        {/if}
        {#if $canReact}
            <div class="flex gap-1 pb-2 mb-1 border-0 border-b border-solid border-white/10">
                {#each QUICK_REACTIONS as emoji (emoji)}
                    <button
                        type="button"
                        class="m-0 p-2 text-2xl leading-none rounded [@media(hover:hover)]:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70"
                        aria-label={$LL.chat.messageActions.reactWith({ emoji })}
                        onclick={() =>
                            run(() => {
                                message.addReaction(emoji).catch((error) => console.error(error));
                            })}
                    >
                        {emoji}
                    </button>
                {/each}
            </div>
        {/if}
        {#if $canReply}
            <button
                type="button"
                class="action"
                data-testid="messageActionReply"
                onclick={() => run(() => selectedChatMessageToReply.set(message))}
            >
                <IconArrowBackUp aria-hidden="true" font-size={20} />{$LL.chat.reply()}
            </button>
        {/if}
        {#if message.openThread && onOpenThread}
            <button
                type="button"
                class="action"
                onclick={() =>
                    run(() => {
                        onOpenThread?.().catch((error) => console.error(error));
                    })}
            >
                <IconMessageCircle2 aria-hidden="true" font-size={20} />{$LL.chat.thread.openThreadButtonTitle()}
            </button>
        {/if}
        {#if canCopy}
            <button type="button" class="action" onclick={copyText}>
                <IconCopy aria-hidden="true" font-size={20} />{copyState === "copied"
                    ? $LL.chat.copied()
                    : copyState === "failed"
                      ? $LL.chat.copyFailed()
                      : $LL.chat.copy()}
            </button>
        {/if}
        {#if $canEdit}
            <button type="button" class="action" onclick={() => run(() => selectedChatMessageToEdit.set(message))}>
                <IconPencil aria-hidden="true" font-size={20} />{$LL.chat.messageActions.edit()}
            </button>
        {/if}
        {#if $canDelete}
            <button
                type="button"
                class="action text-danger-400"
                onclick={() => run(() => confirmDelete("message", () => message.remove(), $content.body))}
            >
                <IconTrash aria-hidden="true" font-size={20} />{$LL.chat.delete()}
            </button>
        {/if}
    </div>
</div>

<style>
    .action {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        margin: 0;
        padding: 0.75rem 0.5rem;
        border-radius: 0.5rem;
        text-align: start;
        font-size: 1rem;
    }
    /* Not on touch: the hover would stick under the finger that just opened the sheet. */
    @media (hover: hover) {
        .action:hover {
            background: rgb(255 255 255 / 0.1);
        }
    }
    .action:focus-visible {
        outline: 2px solid white;
        outline-offset: -2px;
    }
</style>
