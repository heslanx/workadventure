<script lang="ts">
    import * as Sentry from "@sentry/svelte";
    import { AvailabilityStatus } from "@workadventure/messages";
    import { setContext } from "svelte";
    import type { Readable } from "svelte/store";
    import { derived, get } from "svelte/store";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { connectionManager } from "../../../Connection/ConnectionManager";
    import { ENABLE_OPENID, SENTRY_DSN_FRONT } from "../../../Enum/EnvironmentVariable";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { EnableCameraScene, EnableCameraSceneName } from "../../../Phaser/Login/EnableCameraScene";
    import { LoginScene, LoginSceneName } from "../../../Phaser/Login/LoginScene";
    import { PwaInstallScene, PwaInstallSceneName } from "../../../Phaser/Login/PwaInstallScene";
    import { SelectCharacterScene, SelectCharacterSceneName } from "../../../Phaser/Login/SelectCharacterScene";
    import { SelectCompanionScene, SelectCompanionSceneName } from "../../../Phaser/Login/SelectCompanionScene";
    import type { RequestedStatus } from "../../../Rules/StatusRules/statusRules";
    import { loginSceneVisibleStore } from "../../../Stores/LoginSceneStore";
    import { enableCameraSceneVisibilityStore, inBbbStore, inJitsiStore } from "../../../Stores/MediaStore";
    import { requestedMegaphoneStore } from "../../../Stores/MegaphoneStore";
    import type { RightMenuItem } from "../../../Stores/MenuStore";
    import {
        openedMenuStore,
        rightActionBarMenuItems,
        showMenuItem,
        SubMenusInterface,
        userIsConnected,
    } from "../../../Stores/MenuStore";
    import { onboardingStore } from "../../../Stores/OnboardingStore";
    import { pwaInstallProfileMenuEligibleStore } from "../../../Stores/PwaInstallStore";
    import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
    import { selectCompanionSceneVisibleStore } from "../../../Stores/SelectCompanionStore";
    import { isInActiveConversationStore } from "../../../Stores/StreamableCollectionStore";
    import { getStatusInformation } from "../../../Utils/AvailabilityStatus";
    import { LL } from "../../../../i18n/i18n-svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import AvailabilityStatusList from "../AvailabilityStatus/AvailabilityStatusList.svelte";
    import Companion from "../../Companion/Companion.svelte";
    import ExternalComponents from "../../ExternalModules/ExternalComponents.svelte";
    import CamSettingsIcon from "../../Icons/CamSettingsIcon.svelte";
    import { IconAppWindow, IconBug, IconFileDownload, IconHelpCircle, IconLogout } from "../../Icons";
    import ProfilIcon from "../../Icons/ProfilIcon.svelte";
    import SettingsIcon from "../../Icons/SettingsIcon.svelte";
    import Woka from "../../Woka/WokaFromUserId.svelte";
    import AdditionalMenuItems from "./AdditionalMenuItems.svelte";
    import ContextualMenuItems from "./ContextualMenuItems.svelte";
    import HeaderMenuItem from "./HeaderMenuItem.svelte";
    import LeaveConversationConfirmModal from "./LeaveConversationConfirmModal.svelte";
    import { modals } from "@wa-modals";

    interface Props {
        showContextualMenuItems: boolean;
    }

    let { showContextualMenuItems }: Props = $props();

    // This component is mounted in the global floating UI layer, so it must provide
    // the menu contexts itself rather than inheriting them from the action bar.
    setContext("profileMenu", true);
    setContext("inMenu", true);

    const statusToShow: Array<RequestedStatus | AvailabilityStatus.ONLINE> = [
        AvailabilityStatus.ONLINE,
        AvailabilityStatus.BUSY,
        AvailabilityStatus.BACK_IN_A_MOMENT,
        AvailabilityStatus.DO_NOT_DISTURB,
    ];

    function showWokaNameMenuItem() {
        return connectionManager.currentRoom?.opidWokaNamePolicy !== "force_opid";
    }

    /**
     * Whether leaving the room now would cost the user something: a conversation (bubble or meeting) or a live they
     * speak in. The tutorial simulates a bubble, in which nothing real is lost.
     */
    function isInConversation(): boolean {
        if (get(onboardingStore) !== null) {
            return false;
        }
        return get(isInActiveConversationStore) || get(inJitsiStore) || get(inBbbStore) || get(requestedMegaphoneStore);
    }

    /**
     * These screens replace the room: leaving it ends the conversation, stops a live and turns the camera and the
     * microphone off. Say so first, but only when something would be lost.
     */
    function leaveRoomThen(leave: () => void) {
        if (!isInConversation()) {
            leave();
            return;
        }
        openedMenuStore.close("profileMenu");
        modals.open(LeaveConversationConfirmModal, { onconfirm: leave });
    }

    function openEditNameScene() {
        leaveRoomThen(() => {
            loginSceneVisibleStore.set(true);
            gameManager.leaveGame(LoginSceneName, new LoginScene());
            analyticsClient.trackAdminEvent("profile.name_edit_opened");
        });
    }

    function openEditSkinScene() {
        leaveRoomThen(() => {
            selectCharacterSceneVisibleStore.set(true);
            gameManager.leaveGame(SelectCharacterSceneName, new SelectCharacterScene());
            analyticsClient.trackAdminEvent("profile.woka_edit_opened");
        });
    }

    function openEditCompanionScene() {
        leaveRoomThen(() => {
            selectCompanionSceneVisibleStore.set(true);
            gameManager.leaveGame(SelectCompanionSceneName, new SelectCompanionScene());
            analyticsClient.trackAdminEvent("profile.companion_edit_opened");
        });
    }

    function openEnableCameraScene() {
        leaveRoomThen(() => {
            enableCameraSceneVisibilityStore.showEnableCameraScene();
            gameManager.leaveGame(EnableCameraSceneName, new EnableCameraScene());
            analyticsClient.trackAdminEvent("profile.camera_edit_opened");
        });
    }

    async function openFeedbackScene() {
        const feedbackIntegrationInstance = Sentry.feedbackIntegration({
            colorScheme: "system",
            showBranding: false,
            enableScreenshot: true,
            formTitle: $LL.actionbar.issueReport.formTitle(),
            emailLabel: $LL.actionbar.issueReport.emailLabel(),
            nameLabel: $LL.actionbar.issueReport.nameLabel(),
            messageLabel: $LL.actionbar.issueReport.descriptionLabel(),
            messagePlaceholder: $LL.actionbar.issueReport.descriptionPlaceholder(),
            submitButtonLabel: $LL.actionbar.issueReport.submitButtonLabel(),
            cancelButtonLabel: $LL.actionbar.issueReport.cancelButtonLabel(),
            confirmButtonLabel: $LL.actionbar.issueReport.confirmButtonLabel(),
            addScreenshotButtonLabel: $LL.actionbar.issueReport.addScreenshotButtonLabel(),
            removeScreenshotButtonLabel: $LL.actionbar.issueReport.removeScreenshotButtonLabel(),
            successMessageText: $LL.actionbar.issueReport.successMessageText(),
            removeHighlightText: $LL.actionbar.issueReport.removeHighlightText(),
            highlightToolText: $LL.actionbar.issueReport.highlightToolText(),
            hideToolText: $LL.actionbar.issueReport.hideToolText(),
            isRequiredLabel: "",
            onFormOpen: () => {
                analyticsClient.trackAdminEvent("feedback.opened", { feedbackSource: "sentry" });
                gameManager.getCurrentGameScene().userInputManager.disableControls("store");
                gameManager.getCurrentGameScene().userInputManager.disableRightClick();
                openedMenuStore.close("profileMenu");
            },
            onFormClose: () => {
                gameManager.getCurrentGameScene().userInputManager.restoreControls("store");
                gameManager.getCurrentGameScene().userInputManager.restoreRightClick();
                form?.close();
            },
            onSubmitSuccess: () => {
                // No hasScreenshot: the form allows one but tells us nothing about it
                // here, and the property is optional precisely so it can be left out
                // rather than guessed.
                analyticsClient.trackAdminEvent("feedback.submitted", { feedbackSource: "sentry" });
                gameManager.getCurrentGameScene().userInputManager.restoreControls("store");
                gameManager.getCurrentGameScene().userInputManager.restoreRightClick();
                form?.close();
            },
        });
        const form = await feedbackIntegrationInstance?.createForm();
        form?.appendToDom();
        form?.open();
    }

    let rightActionBarMenuItemsInBurgerMenu: Readable<RightMenuItem[]> = derived(
        rightActionBarMenuItems,
        ($rightActionBarMenuItems, set) => {
            const theDerived = derived(
                $rightActionBarMenuItems.map((item) => item.fallsInBurgerMenuStore),
                (items) => items,
            );
            const ghostSubscriptionUnsubscribe = theDerived.subscribe(() => {
                set(get(rightActionBarMenuItems).filter((item) => get(item.fallsInBurgerMenuStore)));
            });
            return () => ghostSubscriptionUnsubscribe();
        },
    );

    function openPwaInstallPrompt(): void {
        analyticsClient.trackAdminEvent("pwa.install_from_profile_menu_clicked");
        openedMenuStore.close("profileMenu");
        leaveRoomThen(() => gameManager.leaveGame(PwaInstallSceneName, new PwaInstallScene()));
    }
</script>

<div class="bg-contrast/95 backdrop-blur rounded-md p-1 w-56 text-white select-none" data-testid="profile-menu">
    <div class="p-0 m-0 list-none overflow-y-auto max-h-[calc(100vh-96px)]">
        <ExternalComponents zone="menuTop" />
        <AvailabilityStatusList statusInformation={getStatusInformation(statusToShow)} />
        <HeaderMenuItem label={$LL.menu.sub.profile()} />
        {#if showWokaNameMenuItem()}
            <ActionBarButton label={$LL.actionbar.profil()} onclick={openEditNameScene}>
                <ProfilIcon height="h-5" width="w-5" strokeWidth="2" />
            </ActionBarButton>
        {/if}
        <ActionBarButton label={$LL.actionbar.woka()} onclick={openEditSkinScene}>
            <Woka userId={-1} placeholderSrc="" customWidth="26px" />
        </ActionBarButton>
        <ActionBarButton label={$LL.actionbar.companion()} onclick={openEditCompanionScene}>
            <Companion userId={-1} placeholderSrc="../static/images/default-companion.png" width="26px" height="26px" />
        </ActionBarButton>

        <HeaderMenuItem label={$LL.menu.sub.settings()} />
        <ActionBarButton label={$LL.actionbar.editCamMic()} onclick={openEnableCameraScene}>
            <CamSettingsIcon height="h-5" width="w-5" strokeWidth="2" />
        </ActionBarButton>

        {#if SENTRY_DSN_FRONT != undefined && connectionManager.currentRoom?.isIssueReportEnabled}
            <ActionBarButton label={$LL.actionbar.issueReport.menuAction()} onclick={openFeedbackScene}>
                <IconBug font-size="20" aria-hidden="true" />
            </ActionBarButton>
        {/if}

        <ActionBarButton
            label={$LL.actionbar.allSettings()}
            onclick={() => {
                showMenuItem(SubMenusInterface.settings);
                analyticsClient.trackAdminEvent("menu.opened");
                openedMenuStore.close("profileMenu");
            }}
        >
            <SettingsIcon height="h-5" width="w-5" strokeWidth="2" />
        </ActionBarButton>

        {#if window.WAD?.desktop && window.WAD.windows}
            <HeaderMenuItem label={$LL.actionbar.desktop.section()} />
            <ActionBarButton
                label={$LL.actionbar.desktop.openMiniWindow()}
                onclick={() => {
                    window.WAD?.windows?.openMiniWindow();
                    openedMenuStore.close("profileMenu");
                }}
                dataTestId="desktop-open-mini-window"
            >
                <IconAppWindow font-size="20" aria-hidden="true" />
            </ActionBarButton>
        {/if}

        {#if showContextualMenuItems}
            <div class="items-center">
                <ContextualMenuItems />
            </div>
        {/if}

        <AdditionalMenuItems menu="profileMenu" />

        {#each $rightActionBarMenuItemsInBurgerMenu ?? [] as button (button.id)}
            {@const ButtonComponent = button.component}
            <ButtonComponent {...button.props} />
        {/each}

        {#if $pwaInstallProfileMenuEligibleStore === true}
            <button
                data-testid="profile-menu-install-web-app"
                disabled={$pwaInstallProfileMenuEligibleStore !== true}
                onclick={openPwaInstallPrompt}
                class="group flex p-2 gap-2 items-center font-bold text-sm w-full pointer-events-auto text-start rounded transition-all {$pwaInstallProfileMenuEligibleStore ===
                true
                    ? 'hover:bg-white/10 cursor-pointer'
                    : 'opacity-50 cursor-not-allowed'}"
            >
                <div class="transition-all w-6 h-6 aspect-square text-center flex items-center justify-center">
                    <IconFileDownload height="20" width="20" class="text-white" aria-hidden="true" />
                </div>
                <div class="text-start leading-4 text-white flex items-center">
                    {$LL.actionbar.installPwa()}
                </div>
            </button>
        {/if}

        <button
            onclick={() => {
                onboardingStore.restart();
                openedMenuStore.close("profileMenu");
            }}
            class="group flex p-2 gap-2 items-center hover:bg-white/10 transition-all cursor-pointer font-bold text-sm w-full pointer-events-auto text-start rounded"
        >
            <div class="transition-all w-6 h-6 aspect-square text-center flex items-center justify-center">
                <IconHelpCircle height="20" width="20" class="text-white" aria-hidden="true" />
            </div>
            <div class="text-start leading-4 text-white flex items-center">
                {$LL.menu.profile.replayTutorial()}
            </div>
        </button>

        {#if ENABLE_OPENID && $userIsConnected}
            <button
                onclick={() => {
                    analyticsClient.trackAdminEvent("auth.logout_clicked");
                    connectionManager.logout();
                }}
                class="group flex p-2 gap-2 items-center hover:bg-danger-600 transition-all cursor-pointer font-bold text-sm w-full pointer-events-auto text-start rounded"
            >
                <div class="transition-all w-6 h-6 aspect-square text-center flex items-center justify-center">
                    <IconLogout
                        height="20"
                        width="20"
                        class="text-danger-400 group-hover:text-contrast-900"
                        aria-hidden="true"
                    />
                </div>
                <div class="text-start leading-4 text-danger-400 group-hover:text-contrast-900 flex items-center">
                    {$LL.menu.profile.logout()}
                </div>
            </button>
        {/if}
    </div>
</div>
