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
    import { enableCameraSceneVisibilityStore } from "../../../Stores/MediaStore";
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
    import { getStatusInformation } from "../../../Utils/AvailabilityStatus";
    import { LL } from "../../../../i18n/i18n-svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import AvailabilityStatusList from "../AvailabilityStatus/AvailabilityStatusList.svelte";
    import ExternalComponents from "../../ExternalModules/ExternalComponents.svelte";
    import {
        IconAppWindow,
        IconBug,
        IconCamera,
        IconFileDownload,
        IconHelpCircle,
        IconLogout,
        IconPencil,
        IconSettings,
        IconUserEdit,
        IconUserPlus,
    } from "../../Icons";
    import AdditionalMenuItems from "./AdditionalMenuItems.svelte";
    import ContextualMenuItems from "./ContextualMenuItems.svelte";
    import HeaderMenuItem from "./HeaderMenuItem.svelte";

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

    function openEditNameScene() {
        loginSceneVisibleStore.set(true);
        gameManager.leaveGame(LoginSceneName, new LoginScene());
    }

    function openEditSkinScene() {
        selectCharacterSceneVisibleStore.set(true);
        gameManager.leaveGame(SelectCharacterSceneName, new SelectCharacterScene());
    }

    function openEditCompanionScene() {
        selectCompanionSceneVisibleStore.set(true);
        gameManager.leaveGame(SelectCompanionSceneName, new SelectCompanionScene());
    }

    function openEnableCameraScene() {
        enableCameraSceneVisibilityStore.showEnableCameraScene();
        gameManager.leaveGame(EnableCameraSceneName, new EnableCameraScene());
        analyticsClient.trackAdminEvent("profile.camera_edit_opened");
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
        gameManager.leaveGame(PwaInstallSceneName, new PwaInstallScene());
    }
</script>

<!-- The office menu's surface and width. The list scrolls inside it, never the surface: its edge fade would fade the
     rim. The list keeps 28px free: the 8px offset from the avatar, the surface's 12px of padding and 8px at the top
     edge. Without the dock (upstream's action bar), 68px gives upstream's former 100vh - 96px. -->
<div
    class="k-chrome rounded-lg p-1.5 w-66 max-w-[calc(100vw_-_16px)] text-white select-none"
    data-testid="profile-menu"
>
    <div
        class="k-scroll-y flex min-h-0 flex-col gap-0.5 m-0 p-0 list-none max-h-[calc(100dvh_-_var(--konclui-dock-stack-height,68px)_-_28px)]"
        data-testid="profile-menu-list"
    >
        <ExternalComponents zone="menuTop" />
        <AvailabilityStatusList statusInformation={getStatusInformation(statusToShow)} />
        <HeaderMenuItem label={$LL.menu.sub.profile()} />
        {#if showWokaNameMenuItem()}
            <ActionBarButton
                label={$LL.actionbar.profil()}
                onclick={() => {
                    openEditNameScene();
                    analyticsClient.trackAdminEvent("profile.name_edit_opened");
                }}
            >
                <IconPencil aria-hidden="true" />
            </ActionBarButton>
        {/if}
        <ActionBarButton
            label={$LL.actionbar.woka()}
            onclick={() => {
                openEditSkinScene();
                analyticsClient.trackAdminEvent("profile.woka_edit_opened");
            }}
        >
            <IconUserEdit aria-hidden="true" />
        </ActionBarButton>
        <ActionBarButton
            label={$LL.actionbar.companion()}
            onclick={() => {
                openEditCompanionScene();
                analyticsClient.trackAdminEvent("profile.companion_edit_opened");
            }}
        >
            <IconUserPlus aria-hidden="true" />
        </ActionBarButton>

        <HeaderMenuItem label={$LL.menu.sub.settings()} />
        <ActionBarButton label={$LL.actionbar.editCamMic()} onclick={openEnableCameraScene}>
            <IconCamera aria-hidden="true" />
        </ActionBarButton>

        {#if SENTRY_DSN_FRONT != undefined && connectionManager.currentRoom?.isIssueReportEnabled}
            <ActionBarButton label={$LL.actionbar.issueReport.menuAction()} onclick={openFeedbackScene}>
                <IconBug aria-hidden="true" />
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
            <IconSettings aria-hidden="true" />
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
                <IconAppWindow aria-hidden="true" />
            </ActionBarButton>
        {/if}

        {#if showContextualMenuItems}
            <div class="flex flex-col gap-0.5">
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
                type="button"
                class="k-menu-row pointer-events-auto"
            >
                <span class="k-menu-lead" aria-hidden="true"><IconFileDownload /></span>
                <span class="k-menu-label">{$LL.actionbar.installPwa()}</span>
            </button>
        {/if}

        <button
            onclick={() => {
                onboardingStore.restart();
                openedMenuStore.close("profileMenu");
            }}
            type="button"
            class="k-menu-row pointer-events-auto"
        >
            <span class="k-menu-lead" aria-hidden="true"><IconHelpCircle /></span>
            <span class="k-menu-label">{$LL.menu.profile.helpAndTips()}</span>
        </button>

        {#if ENABLE_OPENID && $userIsConnected}
            <button
                onclick={() => {
                    analyticsClient.trackAdminEvent("auth.logout_clicked");
                    connectionManager.logout();
                }}
                type="button"
                class="k-menu-row group pointer-events-auto hover:bg-danger-600"
            >
                <span class="k-menu-lead" aria-hidden="true">
                    <IconLogout class="text-danger-400 group-hover:text-contrast-900" />
                </span>
                <span class="k-menu-label text-danger-400 group-hover:text-contrast-900">
                    {$LL.menu.profile.logout()}
                </span>
            </button>
        {/if}
    </div>
</div>
