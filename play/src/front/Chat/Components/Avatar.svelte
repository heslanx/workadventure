<script lang="ts">
    import { get } from "svelte/store";
    import LL from "../../../i18n/i18n-svelte";
    import { getColorByString } from "../../Utils/ColorGenerator";
    import type { PictureStore } from "../../Stores/PictureStore";
    import { isLazyPictureStore } from "../../Stores/PictureStore";

    interface Props {
        pictureStore: PictureStore | undefined;
        fallbackName?: string;
        color?: string | null;
        isChatAvatar?: boolean;
        /**
         * Compact: 28×28px, `rounded-md` — same as user list rows and chat room rows (Room.svelte, User.svelte).
         * Default: 40×40px, `rounded-sm` — message thread avatars.
         */
        compact?: boolean;
        /** Tiny: 16×16px round, for read receipts. */
        tiny?: boolean;
    }

    let {
        pictureStore,
        fallbackName = "A",
        color = null,
        isChatAvatar = false,
        compact = false,
        tiny = false,
    }: Props = $props();

    // The generated avatar colours are pastels (HSL 0.5/0.6): white initials on them miss 4.5:1 for most hues. Up to a
    // relative luminance of 0.183 white still reads; on anything lighter the initial turns black.
    function relativeLuminance(hex: string): number | undefined {
        const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
        if (!match) {
            return undefined;
        }
        const digits = match[1].length === 3 ? match[1].replace(/./g, "$&$&") : match[1];
        const [r, g, b] = [0, 2, 4].map((offset) => {
            const channel = parseInt(digits.slice(offset, offset + 2), 16) / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function initialColor(background: string | null | undefined): string | undefined {
        const luminance = background ? relativeLuminance(background) : undefined;
        return luminance !== undefined && luminance > 0.183 ? "#000" : undefined;
    }

    let forceFallback = $state(false);
    let previousPictureUrl: string | undefined = $state();

    let sizeClass = $derived(
        tiny
            ? "h-4 w-4 min-h-4 min-w-4 shrink-0 rounded-full overflow-hidden text-xxs"
            : compact
              ? "h-7 w-7 min-h-[1.75rem] min-w-[1.75rem] shrink-0 rounded-md overflow-hidden"
              : "h-10 w-10 min-h-10 min-w-10 shrink-0 rounded-sm overflow-hidden",
    );

    $effect(() => {
        if ($pictureStore !== previousPictureUrl) {
            previousPictureUrl = $pictureStore;
            forceFallback = false;
        }
    });

    function loadLazyPictureStore(node: HTMLElement, store: PictureStore | undefined) {
        let observer: IntersectionObserver | undefined;

        const cleanup = () => {
            observer?.disconnect();
            observer = undefined;
        };

        const update = (nextStore: PictureStore | undefined) => {
            cleanup();
            if (!isLazyPictureStore(nextStore)) {
                return;
            }
            if (get(nextStore)) {
                return;
            }
            if (typeof IntersectionObserver === "undefined") {
                nextStore.load().catch((error) => console.warn("Failed to load avatar", error));
                return;
            }
            observer = new IntersectionObserver(
                (entries) => {
                    if (!entries.some((entry) => entry.isIntersecting)) {
                        return;
                    }
                    nextStore.load().catch((error) => console.warn("Failed to load avatar", error));
                    cleanup();
                },
                { rootMargin: "200px" },
            );
            observer.observe(node);
        };

        update(store);

        return {
            update,
            destroy: cleanup,
        };
    }
</script>

{#if $pictureStore && !forceFallback}
    <img
        use:loadLazyPictureStore={pictureStore}
        src={$pictureStore}
        alt={$LL.chat.a11y.userAvatar()}
        class="object-contain object-center bg-white {sizeClass}"
        draggable="false"
        loading="lazy"
        decoding="async"
        style:background-color={`${color ? color : `${getColorByString(fallbackName)}`}`}
        onerror={(event) => {
            console.warn(`Failed to load avatar image for ${fallbackName}`, event);
            forceFallback = true;
        }}
    />
{:else}
    <div
        use:loadLazyPictureStore={pictureStore}
        class:chatAvatar={isChatAvatar}
        class="text-center uppercase text-white flex items-center justify-center font-bold aspect-square {sizeClass}"
        draggable="false"
        style:background-color={`${color ? color : getColorByString(fallbackName)}`}
        style:color={initialColor(color ? color : getColorByString(fallbackName))}
    >
        {fallbackName.charAt(0)}
    </div>
{/if}
