import type { BaseTranslation } from "../i18n-types";

const camera: BaseTranslation = {
    editCam: "Edit camera",
    startError: {
        camera: "Your camera did not start. Others cannot see you. Close other apps using it and try again.",
        microphone: "Your microphone did not start. Others cannot hear you. Close other apps using it and try again.",
    },
    editSpeaker: "Edit audio output",
    active: "Active",
    disabled: "Disabled",
    notRecommended: "Not recommended",
    enable: {
        title: "Turn on your camera and microphone",
        join: "Join the room",
        start: "Welcome to our audio and video device configuration page! Find the tools here to enhance your online experience. Adjust settings to your preferences to address any potential issues. Ensure your hardware is properly connected and up to date. Explore and test different configurations to find what works best for you.",
    },
    help: {
        title: "Camera / Microphone access needed",
        cameraTitle: "Camera access needed",
        microphoneTitle: "Microphone access needed",
        cameraPermissionDenied: "Camera permission denied",
        microphonePermissionDenied: "Microphone permission denied",
        cameraMicrophonePermissionDenied: "Camera and microphone permissions denied",
        content: "You must allow camera and microphone access in your browser.",
        cameraContent: "You must allow camera access in your browser.",
        microphoneContent: "You must allow microphone access in your browser.",
        firefoxContent:
            'Please click the "Remember this decision" checkbox, if you don\'t want Firefox to keep asking you the authorization.',
        allow: "Allow camera",
        allowMicrophone: "Allow microphone",
        allowCameraMicrophone: "Allow camera and microphone",
        continue: "Continue without camera",
        continueWithoutMicrophone: "Continue without microphone",
        continueCameraMicrophone: "Continue without camera and microphone",
        showSteps: "Show me how",
        hideSteps: "Hide the steps",
        steps: {
            chrome: "Click the lock icon at the left of the address bar, set Camera or Microphone to Allow, then reload the page.",
            firefox:
                "Click the permissions icon at the left of the address bar, remove the blocked Camera or Microphone entry, then reload the page and allow access when asked.",
            safari: "Open the Safari menu, choose Settings for This Website, set Camera or Microphone to Allow, then reload the page.",
            android:
                "Tap the lock icon at the left of the address bar, open Permissions, set Camera or Microphone to Allow, then reload the page.",
            other: "Open your browser's site settings for this page, set Camera or Microphone to Allow, then reload the page.",
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
        },
        tooltip: {
            permissionDeniedTitle: "Camera access blocked",
            permissionDeniedDesc:
                "Your browser denied camera access for this site. Allow it from the address bar (lock or camera icon) or in site settings. The illustration below matches your browser.",
            permissionDeniedFix:
                "Your browser denied camera access for this site. Allow it from the address bar (lock or camera icon) or in site settings, then reload. Select this button for the steps.",
            noDeviceTitle: "No usable camera",
            noDeviceDesc:
                "Your browser does not see any camera you can use. Try another browser, check that a camera is connected, check your computer's settings (privacy, devices), or restart your computer if the device should work.",
            deviceInUseTitle: "Camera in use",
            deviceInUseDesc:
                "Your camera is being used by another application. Close that application, then try again.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "Microphone access blocked",
            permissionDeniedDesc:
                "Your browser denied microphone access for this site. Allow it from the address bar (lock or microphone icon) or in site settings. The illustration below matches your browser.",
            permissionDeniedFix:
                "Your browser denied microphone access for this site. Allow it from the address bar (lock or microphone icon) or in site settings, then reload. Select this button for the steps.",
            noDeviceTitle: "No usable microphone",
            noDeviceDesc:
                "Your browser does not see any microphone you can use. Try another browser, check that a microphone is connected, check your computer's settings (privacy, devices), or restart your computer if the device should work.",
            deviceInUseTitle: "Microphone in use",
            deviceInUseDesc:
                "Your microphone is being used by another application. Close that application, then try again.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
    },
    webrtc: {
        title: "Video connection problem",
        titlePending: "Video relay server connection pending",
        error: "Video cannot reach some people. They may not see or hear you. Check your network or VPN and reload.",
        content: "We could not reach the video server. Try one of the options below.",
        solutionVpn:
            "If you are <strong>connecting via a VPN</strong>, please disconnect from you VPN and refresh the web page.",
        solutionVpnNotAskAgain: "Understood. Don't warn me again 🫡",
        solutionHotspot:
            "If you are on a restricted network (company network...), try switching network. For instance, create a <strong>Wifi hotspot</strong> with your phone and connect via your phone.",
        solutionNetworkAdmin: "If you are a <strong>network administrator</strong>, review the ",
        preparingYouNetworkGuide: '"Preparing your network" guide',
        refresh: "Refresh",
        continue: "Continue",
        newDeviceDetected: "New device detected {device} 🎉 Switch? [SPACE] Ignore [ESCAPE]",
        newDeviceSwitch: "Switch",
        newDeviceIgnore: "Ignore",
        newDeviceAnnouncement: "New device detected: {device}. Press Space to switch to it, or Escape to ignore it.",
    },
    my: {
        silentZone: "Silent zone",
        silentZoneDesc:
            "You are in a silent zone. Nobody can talk to you here, and your microphone and camera are off.",
        nameTag: "You",
        loading: "Loading your camera...",
    },
    disable: "Turn off your camera",
    menu: {
        mutedAudioNotice: "{name}'s microphone is muted. Only they can turn it back on.",
        askedMuteAudioNotice: "{name} was asked to mute their microphone.",
        mutedVideoNotice: "{name}'s camera is off. Only they can turn it back on.",
        askedMuteVideoNotice: "{name} was asked to turn off their camera.",
        confirmMuteAudioEveryBodyTitle: "Mute everybody's microphone?",
        confirmMuteAudioEveryBodyMessage:
            "This mutes everyone in this conversation. Only each person can turn their own microphone back on.",
        confirmMuteAudioEveryBodyMessageCount:
            "This mutes {count:number} {{person|people}} in this conversation. Only each person can turn their own microphone back on.",
        confirmMuteAudioEveryBodyAction: "Mute everybody",
        mutedAudioEveryBodyNotice: "Everybody's microphone is muted. Only each person can turn theirs back on.",
        mutedAudioEveryBodyNoticeCount:
            "Microphone muted for {count:number} {{person|people}}. Only each person can turn theirs back on.",
        confirmMuteVideoEveryBodyTitle: "Turn off everybody's camera?",
        confirmMuteVideoEveryBodyMessage:
            "This turns off everyone's camera in this conversation. Only each person can turn their own camera back on.",
        confirmMuteVideoEveryBodyMessageCount:
            "This turns off the camera of {count:number} {{person|people}} in this conversation. Only each person can turn their own camera back on.",
        confirmMuteVideoEveryBodyAction: "Turn off cameras",
        mutedVideoEveryBodyNotice: "Everybody's camera is off. Only each person can turn theirs back on.",
        mutedVideoEveryBodyNoticeCount:
            "Camera turned off for {count:number} {{person|people}}. Only each person can turn theirs back on.",
        moreAction: "More actions",
        closeMenu: "Close menu",
        senPrivateMessage: "Send a private message (coming soon)",
        giveFloor: "Give the floor",
        revokeFloor: "Take back the floor",
        muteAudioUser: "Mute audio",
        askToMuteAudioUser: "Ask to mute audio",
        muteAudioEveryBody: "Mute audio for everybody",
        muteVideoUser: "Turn off video",
        askToMuteVideoUser: "Ask to turn off video",
        muteVideoEveryBody: "Turn off video for everybody",
        alreadyMuted: "Already muted",
        videoAlreadyOff: "Video already off",
        blockOrReportUser: "Moderation",
    },
};

export default camera;
