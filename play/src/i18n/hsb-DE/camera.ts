import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "Kameru wobdźěłać",
    editSpeaker: "Audiowyjadowanje wobdźěłać",
    active: "Aktiwny",
    disabled: "Deaktiwěrowany",
    notRecommended: "Njeporučeny",
    enable: {
        title: "Prošu zaswěć swoju kameru a swój mikrofon.",
        join: "Do ruma stupić",
        start: "Witajće na našej stronie za konfiguraciju awdio- a widejogratow! Namakajće tu nastroje, zo byšće swoju online-dožiwjenje polěpšili. Přiměrće nastajenja swojim preferencam, zo byšće eventuelne problemy rozrisali. Zawěsćće, zo waša hardware korektnje zwjazana a aktualizowana je. Wuslědźće a testujće wšelake konfiguracije, zo byšće namakali, što najlěpje za was funguje.",
    },
    help: {
        title: "přistup ke kamerje/mikrofonje trěbny",
        cameraTitle: "Přistup ke kamerje trěbny",
        microphoneTitle: "Přistup k mikrofonej trěbny",
        cameraPermissionDenied: "Dowolnosć za kameru zapowědźena",
        microphonePermissionDenied: "Dowolnosć za mikrofon zapowědźena",
        cameraMicrophonePermissionDenied: "Dowolnosć za kameru a mikrofon zapowědźena",
        content: "Přistup na kameru a mikrofon dyrbi so w browseru dopušćić dać.",
        cameraContent: "Přistup na kameru dyrbi so w browseru dopušćić dać.",
        microphoneContent: "Přistup na mikrofon dyrbi so w browseru dopušćić dać.",
        firefoxContent:
            'Prošu zaklik na "Diese Entscheidungen speichern" šaltowanskej přestrjeni, zo by so wospjetnym naprašowanjam za dowolnosću w Firefox zadźěwało.',
        allow: "Webcam dowolić",
        allowMicrophone: "Mikrofon dowolić",
        allowCameraMicrophone: "Webcam a mikrofon dowolić",
        continue: "bjez kamery pokročować",
        continueWithoutMicrophone: "Bjez mikrofona pokročować",
        continueCameraMicrophone: "Bjez webcamy a mikrofona pokročować",
        showSteps: "Pokazajće mi, kak",
        hideSteps: "Kročele schować",
        steps: {
            chrome: "Klikńće na symbol šloska nalěwo wot adresoweho pola, nastajće Kamera abo Mikrofon na „Dowolić“ a aktualizujće stronu.",
            firefox:
                "Klikńće na symbol dowolnosćow nalěwo wot adresoweho pola, wotstrońće zablokowany zapisk Kamera abo Mikrofon, aktualizujće potom stronu a dowolće přistup, hdyž so was praša.",
            safari: "Wočińće meni Safari, wubjerće „Nastajenja za tute websydło“, nastajće Kamera abo Mikrofon na „Dowolić“ a aktualizujće stronu.",
            android:
                "Tupńće na symbol šloska nalěwo wot adresoweho pola, wočińće „Dowolnosće“, nastajće Kamera abo Mikrofon na „Dowolić“ a aktualizujće stronu.",
            other: "Wočińće nastajenja sydła swojeho wobhladowaka za tutu stronu, nastajće Kamera abo Mikrofon na „Dowolić“ a aktualizujće stronu.",
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/de-DE-chrome.png",
        },
        tooltip: {
            permissionDeniedTitle: "Kamerowy přistup je so zablokował",
            permissionDeniedDesc:
                "Waš wobhladowak je přistup ke kamerje za tutu stronu wotpokazał. Dopušćće jón přez adresowe polo (šlosk abo symbol kamery) abo w nastajenjach sydła. Wobraz wotpowěduje wašemu wobhladowakej.",
            permissionDeniedFix:
                "Waš wobhladowak je přistup ke kamerje za tute sydło wotpokazał. Dopušćće jón přez adresowe polo (šlosk abo symbol kamery) abo w nastajenjach sydła a aktualizujće potom stronu. Wubjerće tutón knefl za kročele.",
            noDeviceTitle: "Žana wužiwajomna kamera",
            noDeviceDesc:
                "Wobhladowak namaka žanu kameru, kotruž móžeće wužiwać. Spytajće druhi wobhladowak, překontrolujće zwjazanje kamery, přepruwujće konfiguraciju kompjutra (datowy škit, graty) abo startujće kompjuter znowa, jeli hardware měł fungować.",
            deviceInUseTitle: "Kamera so wužiwa",
            deviceInUseDesc: "Wašu kameru wužiwa druha aplikacija. Začińće tu aplikaciju a spytajće to potom znowa.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/de-DE-chrome.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/de-DE-chrome.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "Mikrofonowy přistup je so zablokował",
            permissionDeniedDesc:
                "Waš wobhladowak je přistup ke mikrofonej za tutu stronu wotpokazał. Dopušćće jón přez adresowe polo (šlosk abo symbol mikrofona) abo w nastajenjach sydła. Wobraz wotpowěduje wašemu wobhladowakej.",
            permissionDeniedFix:
                "Waš wobhladowak je přistup ke mikrofonej za tute sydło wotpokazał. Dopušćće jón přez adresowe polo (šlosk abo symbol mikrofona) abo w nastajenjach sydła a aktualizujće potom stronu. Wubjerće tutón knefl za kročele.",
            noDeviceTitle: "Žadyn wužiwajomny mikrofon",
            noDeviceDesc:
                "Wobhladowak namaka žadyn mikrofon, kotryž móžeće wužiwać. Spytajće druhi wobhladowak, překontrolujće mikrofon, přepruwujće konfiguraciju kompjutra (datowy škit, graty) abo startujće kompjuter znowa, jeli hardware měł fungować.",
            deviceInUseTitle: "Mikrofon so wužiwa",
            deviceInUseDesc: "Waš mikrofon wužiwa druha aplikacija. Začińće tu aplikaciju a spytajće to potom znowa.",
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
        title: "serwer widejo-relej njewotmołwja – zmylk",
        titlePending: "zwjaza so ze serwerom widejo-relej",
        error: "serwer TURN njedocpěju",
        content: "Zwisk k serwerej widejo-relej njeje móžny. Tuž druhich wužiwarjow ewtl. njedocpěješ.",
        solutionVpn: "Zwjazaš-li so přez VPN, přetorhń dotalny zwisk ze swojim VPN a aktualizuj web-stronu.",
        solutionVpnNotAskAgain: "Rozumjeno. Mje zaso njewarnować 🫡",
        solutionHotspot:
            "Sy-li w někajkej wobmjezowanej/internej syći, spytaj to w druhej syći. Wutwor na př. ze swojim telefonom WLAN-hotspot a zwjazaj so přez njón.",
        solutionNetworkAdmin: "Sy-li administrator syće, pruwuj ",
        preparingYouNetworkGuide: 'nawod "Preparing your network"',
        refresh: "aktualizuj",
        continue: "dale",
        newDeviceDetected: "Nowy grat namakany {device} 🎉 Změnić? [SPACE] ignorować [ESC]",
        newDeviceSwitch: "Změnić",
        newDeviceIgnore: "Ignorować",
        newDeviceAnnouncement:
            "Nowy grat namakany: {device}. Tłóčće Space, zo byšće na njón změnił, abo Escape, zo byšće jón ignorował.",
    },
    my: {
        silentZone: "ćichi wobłuk",
        silentZoneDesc:
            "Sće w ćichim wobłuku. Tu njemóže nichtó z wami rěčeć, a waš mikrofon a waša kamera staj deaktiwěrowanej.",
        nameTag: "Wy",
        loading: "Waša kamera so začituje...",
    },
    disable: "hasńće swoju kameru",
    menu: {
        moreAction: "dalše akcije",
        closeMenu: "meny začinić",
        senPrivateMessage: "pśewatne powěsće posłaś (pśichadźe)",
        giveFloor: "Słowo dać",
        revokeFloor: "Słowo wotewzać",
        muteAudioUser: "audio stummschalten",
        askToMuteAudioUser: "prosyć, zo by audio stummschalten",
        muteAudioEveryBody: "audio za wšěch stummschalten",
        muteVideoUser: "video stummschalten",
        askToMuteVideoUser: "prosyć, zo by video stummschalten",
        muteVideoEveryBody: "video za wšěch stummschalten",
        blockOrReportUser: "wužiwarja blokować abo pśihłasować",
        mutedAudioNotice: "Mikrofon wosoby {name} je wupinjeny. Jenož tuta wosoba móže jón zaso zapinać.",
        askedMuteAudioNotice: "{name} bu prošeny/-a, mikrofon wupinać.",
        mutedVideoNotice: "Kamera wosoby {name} je wupinjena. Jenož tuta wosoba móže ju zaso zapinać.",
        askedMuteVideoNotice: "{name} bu prošeny/-a, kameru wupinać.",
        confirmMuteAudioEveryBodyTitle: "Mikrofon wšěch němy činić?",
        confirmMuteAudioEveryBodyMessage:
            "Tole wupina mikrofon wšěch w tutej rozmołwje. Jenož kóžda wosoba móže swój mikrofon zaso zapinać.",
        confirmMuteAudioEveryBodyMessageCount:
            "Tole wupina mikrofony w tutej rozmołwje ({count} {{wosobow|wosoba|wosobje|wosoby|wosobow|wosobow}}). Jenož kóžda wosoba móže swój mikrofon zaso zapinać.",
        confirmMuteAudioEveryBodyAction: "Wšěch němy činić",
        mutedAudioEveryBodyNotice: "Mikrofon wšěch je wupinjeny. Jenož kóžda wosoba móže swój zaso zapinać.",
        mutedAudioEveryBodyNoticeCount:
            "Mikrofon wupinjeny za {count} {{wosobow|wosobu|wosobje|wosoby|wosobow|wosobow}}. Jenož kóžda wosoba móže swój zaso zapinać.",
        confirmMuteVideoEveryBodyTitle: "Kameru wšěch wupinać?",
        confirmMuteVideoEveryBodyMessage:
            "Tole wupina kameru wšěch w tutej rozmołwje. Jenož kóžda wosoba móže swoju kameru zaso zapinać.",
        confirmMuteVideoEveryBodyMessageCount:
            "Tole wupina kamery w tutej rozmołwje ({count} {{wosobow|wosoba|wosobje|wosoby|wosobow|wosobow}}). Jenož kóžda wosoba móže swoju kameru zaso zapinać.",
        confirmMuteVideoEveryBodyAction: "Kamery wupinać",
        mutedVideoEveryBodyNotice: "Kamera wšěch je wupinjena. Jenož kóžda wosoba móže swoju zaso zapinać.",
        mutedVideoEveryBodyNoticeCount:
            "Kamera wupinjena za {count} {{wosobow|wosobu|wosobje|wosoby|wosobow|wosobow}}. Jenož kóžda wosoba móže swoju zaso zapinać.",
        alreadyMuted: "Hižo wupinjeny",
        videoAlreadyOff: "Widejo je hižo wupinjene",
    },
    startError: {
        camera: "Twoja kamera njeje startowała. Druzy će njewidźa. Začiń druhe aplikacije, kotrež ju wužiwaja, a spytaj hišće raz.",
        microphone:
            "Twój mikrofon njeje startował. Druzy će njesłyša. Začiń druhe aplikacije, kotrež jón wužiwaja, a spytaj hišće raz.",
    },
};

export default camera;
