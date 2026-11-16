<script lang="ts">
    import * as Sentry from "@sentry/svelte";
    import { onDestroy, onMount } from "svelte";
    import { on } from "svelte/events";
    import { computePosition, flip, shift, offset, autoUpdate } from "@floating-ui/dom";
    import type { Snippet } from "svelte";
    import type { Readable } from "svelte/store";
    import { AskPositionMessage_AskType } from "@workadventure/messages";
    import teleport from "../../images/teleport.svg";
    import businessCard from "../../images/business-cards.svg";
    import type { AnyKindOfUser, ChatUser } from "../../Connection/ChatConnection";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { scriptUtils } from "../../../Api/ScriptUtils";
    import { requestVisitCardsStore } from "../../../Stores/GameStore";
    import { wokaMenuStore } from "../../../Stores/WokaMenuStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { openModerationModal } from "../../../Components/Moderation/openModerationModal";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import type { UserProviderMerger } from "../../UserProviderMerger/UserProviderMerger";
    import { IconForbid, IconDots, IconCamera, IconMapPin, IconUserPlus } from "@wa-icons";

    interface Props {
        /** A message sender may be an admin user without a chat id: it is matched by uuid then. */
        user: AnyKindOfUser;
        /** Replaces the "..." icon, e.g. a sender name in a message. Rendered as plain content when no action applies. */
        trigger?: Snippet;
        /** Accessible name of the trigger button when `trigger` is set. */
        triggerLabel?: string;
    }

    let { user: userProp, trigger, triggerLabel }: Props = $props();

    let popoversElement: HTMLDivElement | undefined = $state();

    let buttonElement: HTMLButtonElement | undefined = $state();

    let chatMenuActive = $state(false);

    let usersByRoomStore:
        | Readable<Map<string | undefined, { roomName: string | undefined; users: ChatUser[] }>>
        | undefined = $state(undefined);

    let cleanup: undefined | (() => void);

    $effect(() => {
        if (popoversElement && buttonElement) {
            cleanup = autoUpdate(buttonElement, popoversElement, repositionIfOverflowing);
            return () => {
                cleanup?.();
                cleanup = undefined;
            };
        }
        return undefined;
    });
    let usersByRoomMap = $derived(usersByRoomStore && $usersByRoomStore ? $usersByRoomStore : new Map());
    // Flatten usersByRoomMap into a list of users with playUri from their room
    let usersWithRoomPlayUri = $derived(
        (() => {
            const usersList: (ChatUser & { playUri: string })[] = [];
            for (const [playUri, roomData] of usersByRoomMap.entries()) {
                for (const user of roomData.users) {
                    usersList.push({
                        ...user,
                        playUri: playUri ?? user.playUri ?? "",
                    });
                }
            }
            return usersList;
        })(),
    );
    // A message sender carries only its chat identity: complete it with the user list entry (room, uuid, card).
    let user = $derived(
        usersWithRoomPlayUri.find(
            (u) => (!!userProp.chatId && u.chatId === userProp.chatId) || (!!userProp.uuid && u.uuid === userProp.uuid),
        ) ?? userProp,
    );
    let userToLocate = $derived(usersWithRoomPlayUri.find((u) => u.uuid === user.uuid));

    const { connection, roomUrl } = gameManager.getCurrentGameScene();

    let isInTheSameMap = $derived(user.playUri === roomUrl);
    // Same conditions as the menu entries below: a trigger never opens an empty menu.
    let hasActions = $derived(
        isInTheSameMap || !!user.playUri || !!user.visitCardUrl || (!!user.username && !!user.uuid),
    );

    const goTo = (type: string, playUri: string, uuid: string) => {
        analyticsClient.trackAdminEvent("user.go_to_clicked");

        if (type === "room") {
            scriptUtils.goToPage(`${playUri}#moveToUser=${uuid}`);
        } else if (type === "user") {
            if (user.uuid && connection && user.playUri) connection.emitAskPosition(user.uuid, user.playUri);
        }
    };

    function repositionIfOverflowing() {
        if (!buttonElement || !popoversElement) return;
        const currentPopoversElement = popoversElement;
        computePosition(buttonElement, currentPopoversElement, {
            middleware: [offset(6), flip(), shift({ padding: 5 })],
        })
            .then(({ x, y }) => {
                Object.assign(currentPopoversElement.style, {
                    left: `${x}px`,
                    top: `${y}px`,
                });
            })
            .catch((error) => {
                console.error("Failed to compute popover position : ", error);
            });
    }

    const closeChatUserMenu = () => {
        chatMenuActive = false;
    };

    const toggleChatUSerMenu = () => {
        chatMenuActive = !chatMenuActive;
    };

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
        // The button toggles the menu itself.
        if (event.target && buttonElement?.contains(event.target as Node)) return;
        if (event.target && popoversElement && !popoversElement.contains(event.target as Node)) {
            closeChatUserMenu();
        }
    };

    // On the button's own document, not <svelte:window>: in the desktop companion (a child window), clicks
    // never reach the main window.
    $effect(() => {
        const ownerDocument = buttonElement?.ownerDocument;
        if (!ownerDocument) return;
        const stopClick = on(ownerDocument, "click", handleClickOutside);
        const stopTouch = on(ownerDocument, "touchstart", handleClickOutside);
        return () => {
            stopClick();
            stopTouch();
        };
    });

    onMount(() => {
        gameManager
            .getCurrentGameScene()
            .userProviderMerger.then((merger: UserProviderMerger) => {
                usersByRoomStore = merger.usersByRoomStore;
            })
            .catch((error) => {
                console.error("Failed to get users by room store : ", error);
            });
    });

    onDestroy(() => {
        if (cleanup) cleanup();
    });

    const showBusinessCard = (visitCardUrl: string | undefined) => {
        analyticsClient.trackAdminEvent("user.business_card.opened");

        // If woka menu is open, close it
        if ($wokaMenuStore) {
            wokaMenuStore.clear();
        }

        if (visitCardUrl) {
            if ($requestVisitCardsStore == visitCardUrl) {
                requestVisitCardsStore.set(null);
                closeChatUserMenu();
                return;
            }
            requestVisitCardsStore.set(visitCardUrl);
        }
        closeChatUserMenu();
    };

    function locateUser() {
        if (userToLocate == undefined || userToLocate.uuid == undefined) return;

        // Check if visit card url is the same as the current visit card url
        if ($requestVisitCardsStore != undefined) {
            requestVisitCardsStore.set(null);
        }

        // Track the open woka menu action
        analyticsClient.trackAdminEvent("user.woka_menu.opened");

        const currentScerne = gameManager.getCurrentGameScene();

        // Il user is in view port and represented by remote player, use it to activate the woka menu
        const remotePlayerData = currentScerne.getRemotePlayersRepository().getPlayerByUuid(userToLocate.uuid);
        if (remotePlayerData != undefined) {
            // Get the actual RemotePlayer sprite from MapPlayersByKey using userId
            const remotePlayer = currentScerne.MapPlayersByKey.get(remotePlayerData.userId);
            if (remotePlayer != undefined) {
                remotePlayer.activate();
                closeChatUserMenu();
                return;
            }
        }

        // If the user isn't in the view port, emit the ask position message to the server
        currentScerne.connection?.emitAskPosition(
            userToLocate.uuid ?? "",
            userToLocate.playUri ?? "",
            AskPositionMessage_AskType.LOCATE,
        );
        closeChatUserMenu();
    }
</script>

<div class={trigger ? "wa-dropdown inline-flex min-w-0" : "wa-dropdown"}>
    {#if trigger && !hasActions}
        {@render trigger()}
    {:else}
        <button
            class={trigger
                ? "m-0 p-0 inline-flex min-w-0 items-end rounded bg-transparent border-0 cursor-pointer !text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                : "m-0 p-2 flex items-center rounded hover:bg-white/10 bg-transparent !text-white"}
            type="button"
            aria-label={trigger ? triggerLabel : $LL.chat.manageRoomUsers.actions()}
            aria-expanded={chatMenuActive}
            bind:this={buttonElement}
            onclick={(event) => {
                event.stopPropagation();
                toggleChatUSerMenu();
            }}
        >
            {#if trigger}
                {@render trigger()}
            {:else}
                <IconDots aria-hidden="true" font-size="16" />
            {/if}
        </button>
    {/if}
    <!-- onmouseleave={closeChatUserMenu} -->
    {#if chatMenuActive}
        <div
            bind:this={popoversElement}
            class="wa-dropdown-menu z-10 mr-1 fixed bg-contrast/95 backdrop-blur-md rounded-md p-1"
        >
            {#if isInTheSameMap}
                <button
                    type="button"
                    class="walk-to wa-dropdown-item text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded"
                    onclick={(event) => {
                        event.stopPropagation();
                        goTo("user", user.playUri ?? "", user.uuid ?? "");
                        closeChatUserMenu();
                    }}
                >
                    <IconCamera aria-hidden="true" class="w-4" />
                    {$LL.chat.userList.TalkTo()}</button
                >
                <button
                    type="button"
                    disabled={userToLocate == undefined}
                    class={`follow wa-dropdown-item text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded ${
                        userToLocate == undefined ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    onclick={(event) => {
                        event.stopPropagation();
                        locateUser();
                    }}
                >
                    <IconMapPin aria-hidden="true" class="w-4" />
                    {$LL.chat.userList.follow()}
                </button>
                <button
                    type="button"
                    class="invite wa-dropdown-item text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded"
                    data-testid="user-list-invite"
                    onclick={(event) => {
                        event.stopPropagation();
                        if (user.uuid) {
                            const scene = gameManager.getCurrentGameScene();
                            const sent = scene.inviteManager?.requestMeetingInvitation(user.uuid);
                            if (sent) {
                                try {
                                    scene.playSound("meeting-in", 0.15);
                                } catch (error) {
                                    console.error("Failed to play sound: ", error);
                                    Sentry.captureException(error);
                                }
                            }
                        }
                        closeChatUserMenu();
                    }}
                >
                    <IconUserPlus aria-hidden="true" class="w-4" />
                    {$LL.chat.userList.invite()}
                </button>
            {:else if user.playUri}
                <button
                    type="button"
                    class="teleport wa-dropdown-item text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded"
                    onclick={(event) => {
                        event.stopPropagation();
                        goTo("room", user.playUri ?? "", user.uuid ?? "");
                        closeChatUserMenu();
                    }}
                    ><img class="noselect" src={teleport} alt="" height="13" width="13" draggable="false" />
                    {$LL.chat.userList.teleport()}</button
                >
                <button
                    type="button"
                    class="invite wa-dropdown-item text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded"
                    data-testid="user-list-invite"
                    onclick={(event) => {
                        event.stopPropagation();
                        if (user.uuid) {
                            const scene = gameManager.getCurrentGameScene();
                            const sent = scene.inviteManager?.requestMeetingInvitation(user.uuid);
                            if (sent) {
                                try {
                                    scene.playSound("meeting-in", 0.15);
                                } catch (error) {
                                    console.error("Failed to play sound: ", error);
                                    Sentry.captureException(error);
                                }
                            }
                        }
                        closeChatUserMenu();
                    }}
                >
                    <IconUserPlus aria-hidden="true" class="w-4" />
                    {$LL.chat.userList.invite()}
                </button>
            {/if}
            {#if user.visitCardUrl}
                <button
                    type="button"
                    class="businessCard wa-dropdown-item text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded"
                    onclick={(event) => {
                        event.stopPropagation();
                        showBusinessCard(user.visitCardUrl);
                    }}
                    ><img class="noselect" src={businessCard} alt="" height="13" width="13" draggable="false" />
                    {$LL.chat.userList.businessCard()}</button
                >
            {/if}

            {#if user.username && user.uuid}
                <button
                    type="button"
                    class="ban wa-dropdown-item text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded"
                    onclick={(event) => {
                        event.stopPropagation();
                        openModerationModal(user.uuid ?? "", user.username ?? "");
                        closeChatUserMenu();
                    }}><IconForbid aria-hidden="true" font-size="13" /> {$LL.report.moderate.action()}</button
                >
            {/if}
        </div>
    {/if}
</div>
