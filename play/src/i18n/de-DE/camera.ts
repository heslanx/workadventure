import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "Kamera bearbeiten",
    editSpeaker: "Audioausgabe bearbeiten",
    active: "Aktiv",
    disabled: "Deaktiviert",
    notRecommended: "Nicht empfohlen",
    enable: {
        title: "Bitte schalte deine Kamera und dein Mikrofon ein.",
        join: "Dem Raum beitreten",
        start: "Willkommen auf unserer Seite zur Konfiguration von Audio- und Videogeräten! Finden Sie hier die Werkzeuge, um Ihr Online-Erlebnis zu verbessern. Passen Sie die Einstellungen nach Ihren Vorlieben an, um mögliche Probleme zu lösen. Stellen Sie sicher, dass Ihre Hardware ordnungsgemäß angeschlossen und auf dem neuesten Stand ist. Erkunden und testen Sie verschiedene Konfigurationen, um herauszufinden, was am besten für Sie funktioniert.",
    },
    help: {
        title: "Zugriff auf Kamera / Mikrofon erforderlich",
        cameraTitle: "Zugriff auf Kamera erforderlich",
        microphoneTitle: "Zugriff auf Mikrofon erforderlich",
        cameraPermissionDenied: "Kameraberechtigung verweigert",
        microphonePermissionDenied: "Mikrofonberechtigung verweigert",
        cameraMicrophonePermissionDenied: "Kamera- und Mikrofonberechtigung verweigert",
        content: "Der Zugriff auf Kamera und Mikrofon muss im Browser freigegeben werden.",
        cameraContent: "Der Zugriff auf die Kamera muss im Browser freigegeben werden.",
        microphoneContent: "Der Zugriff auf das Mikrofon muss im Browser freigegeben werden.",
        firefoxContent:
            'Bitte klicke auf die Schaltfläche "Diese Entscheidung speichern", um erneute Nachfragen nach der Freigabe in Firefox zu verhindern.',
        allow: "Webcam erlauben",
        allowMicrophone: "Mikrofon erlauben",
        allowCameraMicrophone: "Webcam und Mikrofon erlauben",
        continue: "Ohne Kamera fortfahren",
        continueWithoutMicrophone: "Ohne Mikrofon fortfahren",
        continueCameraMicrophone: "Ohne Webcam und Mikrofon fortfahren",
        showSteps: "Zeig mir, wie",
        hideSteps: "Schritte ausblenden",
        steps: {
            chrome: "Klicke links in der Adressleiste auf das Schloss-Symbol, stelle Kamera oder Mikrofon auf „Zulassen“ und lade die Seite neu.",
            firefox:
                "Klicke links in der Adressleiste auf das Berechtigungssymbol, entferne den blockierten Eintrag für Kamera oder Mikrofon, lade die Seite neu und erlaube den Zugriff, sobald du gefragt wirst.",
            safari: "Öffne das Safari-Menü, wähle „Einstellungen für diese Website“, stelle Kamera oder Mikrofon auf „Erlauben“ und lade die Seite neu.",
            android:
                "Tippe links in der Adressleiste auf das Schloss-Symbol, öffne „Berechtigungen“, stelle Kamera oder Mikrofon auf „Zulassen“ und lade die Seite neu.",
            other: "Öffne in deinem Browser die Website-Einstellungen für diese Seite, stelle Kamera oder Mikrofon auf „Zulassen“ und lade die Seite neu.",
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/de-DE-chrome.png",
        },
        tooltip: {
            permissionDeniedTitle: "Kamerazugriff blockiert",
            permissionDeniedDesc:
                "Der Browser hat den Kamerazugriff für diese Seite verweigert. Erlauben Sie ihn über die Adressleiste (Schloss- oder Kamerasymbol) oder in den Seiteneinstellungen. Die Abbildung passt zu Ihrem Browser.",
            permissionDeniedFix:
                "Der Browser hat den Kamerazugriff für diese Seite verweigert. Erlaube ihn über die Adressleiste (Schloss- oder Kamerasymbol) oder in den Seiteneinstellungen und lade die Seite dann neu. Wähle diese Schaltfläche aus, um die Schritte zu sehen.",
            noDeviceTitle: "Keine verwendbare Kamera",
            noDeviceDesc:
                "Der Browser erkennt keine verwendbare Kamera. Versuchen Sie einen anderen Browser, prüfen Sie die Verbindung der Kamera, prüfen Sie die Konfiguration des Computers (Datenschutz, Geräte), oder starten Sie den Computer neu, wenn die Hardware in Ordnung sein sollte.",
            deviceInUseTitle: "Kamera wird verwendet",
            deviceInUseDesc:
                "Ihre Kamera wird von einer anderen Anwendung verwendet. Schließen Sie diese Anwendung und versuchen Sie es dann erneut.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/de-DE-chrome.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/de-DE-chrome.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "Mikrofonzugriff blockiert",
            permissionDeniedDesc:
                "Der Browser hat den Mikrofonzugriff für diese Seite verweigert. Erlauben Sie ihn über die Adressleiste (Schloss- oder Mikrofonsymbol) oder in den Seiteneinstellungen. Die Abbildung passt zu Ihrem Browser.",
            permissionDeniedFix:
                "Der Browser hat den Mikrofonzugriff für diese Seite verweigert. Erlaube ihn über die Adressleiste (Schloss- oder Mikrofonsymbol) oder in den Seiteneinstellungen und lade die Seite dann neu. Wähle diese Schaltfläche aus, um die Schritte zu sehen.",
            noDeviceTitle: "Kein verwendbares Mikrofon",
            noDeviceDesc:
                "Der Browser erkennt kein verwendbares Mikrofon. Versuchen Sie einen anderen Browser, prüfen Sie das Mikrofon, prüfen Sie die Konfiguration des Computers (Datenschutz, Geräte), oder starten Sie den Computer neu, wenn die Hardware in Ordnung sein sollte.",
            deviceInUseTitle: "Mikrofon wird verwendet",
            deviceInUseDesc:
                "Ihr Mikrofon wird von einer anderen Anwendung verwendet. Schließen Sie diese Anwendung und versuchen Sie es dann erneut.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/de-DE-chrome.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/de-DE-chrome.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
    },
    webrtc: {
        title: "Der Video-Relay-Server antwortet nicht - Fehler",
        titlePending: "Verbinde mit dem Video-Relay-Server",
        error: '"TURN"-Server nicht erreichbar',
        content:
            "Eine Verbindung zum Video-Relay-Server konnte nicht hergestellt werden. Sie sind möglicherweise nicht in der Lage, mit anderen Benutzern zu kommunizieren.",
        solutionVpn:
            "Wenn Sie eine Verbindung über ein VPN herstellen, trennen Sie bitte die Verbindung zu Ihrem VPN und aktualisieren Sie die Webseite.",
        solutionHotspot:
            "Wenn Sie sich in einem eingeschränkten Netzwerk befinden (Firmennetzwerk...), versuchen Sie, das Netzwerk zu wechseln. Erstellen Sie zum Beispiel mit Ihrem Telefon einen WLAN-Hotspot und verbinden Sie sich über Ihr Telefon.",
        solutionNetworkAdmin: "Wenn Sie ein Netzwerkadministrator sind, überprüfen Sie die",
        preparingYouNetworkGuide: 'Anleitung "Preparing your network"',
        refresh: "Aktualisieren",
        continue: "Weiter",
        solutionVpnNotAskAgain: "Verstanden. Mich nicht erneut warnen 🫡",
        newDeviceDetected: "Neues Gerät erkannt {device} 🎉 Wechseln? [LEERTASTE] Ignorieren [ESC]",
        newDeviceSwitch: "Wechseln",
        newDeviceIgnore: "Ignorieren",
        newDeviceAnnouncement:
            "Neues Gerät erkannt: {device}. Drücke die Leertaste, um zu diesem Gerät zu wechseln, oder die Esc-Taste, um es zu ignorieren.",
    },
    my: {
        silentZone: "Stiller Bereich",
        silentZoneDesc:
            "Sie befinden sich in einer stillen Zone. Hier kann niemand mit Ihnen sprechen, und Ihr Mikrofon und Ihre Kamera sind ausgeschaltet.",
        nameTag: "Sie",
        loading: "Ihre Kamera wird geladen...",
    },
    disable: "Kamera deaktivieren",
    menu: {
        moreAction: "Mehr Aktionen",
        closeMenu: "Menü schließen",
        senPrivateMessage: "Private Nachricht senden (kommt bald)",
        giveFloor: "Das Wort erteilen",
        revokeFloor: "Das Wort entziehen",
        muteAudioUser: "Audio stummschalten",
        askToMuteAudioUser: "Bitten, Audio stummzuschalten",
        muteAudioEveryBody: "Audio für alle stummschalten",
        muteVideoUser: "Video stummschalten",
        askToMuteVideoUser: "Bitten, Video stummzuschalten",
        muteVideoEveryBody: "Video für alle stummschalten",
        blockOrReportUser: "Benutzer blockieren oder melden",
        mutedAudioNotice: "Das Mikrofon von {name} ist stummgeschaltet. Nur diese Person kann es wieder einschalten.",
        askedMuteAudioNotice: "{name} wurde gebeten, das Mikrofon stummzuschalten.",
        mutedVideoNotice: "Die Kamera von {name} ist aus. Nur diese Person kann sie wieder einschalten.",
        askedMuteVideoNotice: "{name} wurde gebeten, die Kamera auszuschalten.",
        confirmMuteAudioEveryBodyTitle: "Alle Mikrofone stummschalten?",
        confirmMuteAudioEveryBodyMessage:
            "Das schaltet alle in dieser Unterhaltung stumm. Nur die jeweilige Person kann ihr eigenes Mikrofon wieder einschalten.",
        confirmMuteAudioEveryBodyMessageCount:
            "Das schaltet {count} {{Person|Personen}} in dieser Unterhaltung stumm. Nur die jeweilige Person kann ihr eigenes Mikrofon wieder einschalten.",
        confirmMuteAudioEveryBodyAction: "Alle stummschalten",
        mutedAudioEveryBodyNotice:
            "Alle Mikrofone sind stummgeschaltet. Nur die jeweilige Person kann ihr eigenes Mikrofon wieder einschalten.",
        mutedAudioEveryBodyNoticeCount:
            "Mikrofon für {count} {{Person|Personen}} stummgeschaltet. Nur die jeweilige Person kann ihr eigenes Mikrofon wieder einschalten.",
        confirmMuteVideoEveryBodyTitle: "Alle Kameras ausschalten?",
        confirmMuteVideoEveryBodyMessage:
            "Das schaltet die Kameras aller in dieser Unterhaltung aus. Nur die jeweilige Person kann ihre eigene Kamera wieder einschalten.",
        confirmMuteVideoEveryBodyMessageCount:
            "Das schaltet die Kamera von {count} {{Person|Personen}} in dieser Unterhaltung aus. Nur die jeweilige Person kann ihre eigene Kamera wieder einschalten.",
        confirmMuteVideoEveryBodyAction: "Kameras ausschalten",
        mutedVideoEveryBodyNotice:
            "Alle Kameras sind aus. Nur die jeweilige Person kann ihre eigene Kamera wieder einschalten.",
        mutedVideoEveryBodyNoticeCount:
            "Kamera für {count} {{Person|Personen}} ausgeschaltet. Nur die jeweilige Person kann ihre eigene Kamera wieder einschalten.",
        alreadyMuted: "Bereits stummgeschaltet",
        videoAlreadyOff: "Video bereits aus",
    },
    startError: {
        camera: "Deine Kamera ist nicht gestartet. Andere können dich nicht sehen. Schließe andere Apps, die sie verwenden, und versuche es erneut.",
        microphone:
            "Dein Mikrofon ist nicht gestartet. Andere können dich nicht hören. Schließe andere Apps, die es verwenden, und versuche es erneut.",
    },
};

export default camera;
