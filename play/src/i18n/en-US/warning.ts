import type { BaseTranslation } from "../i18n-types";

const warning: BaseTranslation = {
    title: "Warning!",
    content: `This world is close to its limit!. You can upgrade its capacity <a href="{upgradeLink}" target="_blank">here</a>`,
    limit: "This world is close to its limit!",
    accessDenied: {
        camera: "Camera access denied. Click here and check your browser permissions.",
        teleport: "You have no right to teleport to this user.",
        room: "Room access denied. You are not allowed to enter this room.",
    },
    connectionLost: "Connection lost. Reconnecting...",
    connectionLostTitle: "Connection lost",
    connectionLostDetail: "Trying again automatically. What you typed stays in place.",
    uplinkCapped: "Weak connection: others see your camera in lower quality. It comes back on its own.",
    reconnectNow: "Try again now",
    limitMap: "This map is available for 2 days.",
    registerDomain: "Register your domain to keep it",
    connectionLostSubtitle: "Reconnecting",
    waitingConnectionTitle: "Waiting for connection",
    waitingConnectionSubtitle: "Connecting",
    megaphoneNeeds: "To go live, turn on your camera or microphone, or share your screen.",
    mapEditorShortCut: "There was an error while trying to open the map editor.",
    mapEditorNotEnabled: "The map editor is not enabled on this world.",
    popUp: {
        close: "Close",
        closeMessage: "Close message",
        openInNewTab: "Open in a new tab",
        joinJitsi: "Join the Jitsi meeting",
        openWebsite: "Open the website",
    },
    limitRoom: {
        title: "This map has a time limit.",
        content: "To keep using WorkAdventure here, create your account.",
        createAccount: "Create my account",
    },
    popupBlocked: {
        title: "Popup blocked",
        content: "Please allow popups for this website in your browser settings.",
        done: "Close",
    },
    backgroundProcessing: {
        failedToApply: "Failed to apply background effects",
        notSupportedOnThisBrowser: "Background effects are not supported on this browser",
    },
    duplicateUserConnected: {
        title: "Already connected",
        message:
            "You are already connected to this room from another tab or device. To avoid conflicts, please close the other tab or window.",
        confirmContinue: "I understand, continue",
        dontRemindAgain: "Don't show this message again",
    },
    browserNotSupported: {
        title: "😢 Browser Not Supported",
        message: "Your browser ({browserName}) is no longer supported by Koncluí.",
        description: "Your browser is too old to run Koncluí. Please update to the latest version to continue.",
        whatToDo: "What can you do?",
        option1: "Update {browserName} to the latest version",
        option2: "Leave Koncluí and use a different browser",
        updateBrowser: "Update Browser",
        leave: "Leave",
    },
    pwaInstall: {
        title: "Install Koncluí",
        description:
            "Install the app for a better experience: quick access, load on startup and an app-like experience.",
        descriptionIos: "Add Koncluí to your Home Screen for a better experience and quick access.",
        feature1Title: "Quick access",
        feature1Description: "Launch Koncluí from your Start menu, Dock, or desktop.",
        feature2Title: "Dedicated app window",
        feature2Description:
            "Keep Koncluí separate from your browser tabs and find Koncluí at a glance in your taskbar.",
        feature3Title: "Start with your computer",
        feature3Description: "Launch Koncluí when your device starts.",
        iosStepsTitle: "How to install",
        iosStep1: "Tap the Share button (square with arrow) at the bottom of Safari.",
        iosStep2: 'Scroll down and tap "Add to Home Screen".',
        iosStep3: 'Tap "Add" to confirm.',
        install: "Install Koncluí App",
        installing: "Installing…",
        skip: "Continuing in browser",
        continue: "Continue in browser",
        neverShowPage: "Don't ask again",
    },
    otherMeetingMuted:
        "You're now in a meeting here. Your microphone, camera and screen sharing were turned off in {world}.",
    desktopAppOutdated: "A new version of the WorkAdventure app is available: {url}",
};

export default warning;
