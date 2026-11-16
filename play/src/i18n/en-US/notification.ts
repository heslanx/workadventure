import type { BaseTranslation } from "../i18n-types";

const notification: BaseTranslation = {
    discussion: "{name} wants to discuss with you",
    message: "{name} sends a message",
    mention: "{name} mentioned you",
    askToMuteMicrophone: "Can I mute your microphone?",
    askToMuteCamera: "Can I mute your camera?",
    muteRequest: {
        acceptMicrophone: "Mute my microphone",
        acceptCamera: "Turn off my camera",
        refuse: "Keep it on",
    },
    microphoneMuted: "Your microphone was muted by a moderator",
    cameraMuted: "Your camera was muted by a moderator",
    microphoneMutedForEverybody: "A moderator muted everybody's microphone. You can turn yours back on.",
    cameraMutedForEverybody: "A moderator turned off everybody's camera. You can turn yours back on.",
    givenTheFloor: "It's your turn to speak",
    givenTheFloorEnableMicrophone: "It's your turn to speak. Turn on your microphone.",
    floorRevoked: "You no longer have the floor",
    floorGivenBack: "You gave back the floor",
    handLowered: "A moderator lowered your hand",
    removedFromConversation: "A moderator removed you from the conversation.",
    actionFailed: "The change was not applied. Nothing changed for the other people. Try again in a moment.",
    announcement: "Announcement",
    help: {
        title: "Notifications access denied",
        permissionDenied: "Permission denied",
        content:
            "Do not miss any discussion. Enable notifications to know when someone wants to talk to you, even when you are not on the WorkAdventure tab.",
        firefoxContent:
            'Please check the "Remember this decision" box if you don\'t want Firefox to keep asking you for permission.',
        refresh: "Refresh",
        continue: "Continue without notification",
        screen: {
            chrome: "/resources/help-setting-notification-permission/en-US-chrome.png",
        },
        screenAlt: "Allowing notifications from the address bar in Chrome",
    },
    addNewTag: "add a new tag: '{tag}'",
    screenSharingError:
        "Screen sharing did not start. Others cannot see your screen. Allow screen sharing in your browser and try again.",
    recordingStarted: "One person in the discussion has started a recording.",
    urlCopiedToClipboard: "Url copied to clipboard",
    copyFailed: "Could not copy: the browser blocked the clipboard. Select the text and press Ctrl+C (Cmd+C on Mac).",
    closeToast: "Close notification",
};

export default notification;
