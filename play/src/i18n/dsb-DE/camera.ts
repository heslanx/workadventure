import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "Kameru wobźěłaś",
    editSpeaker: "Audiowyjadowanje wobźěłaś",
    active: "Aktiwny",
    disabled: "Deaktiwěrowany",
    notRecommended: "Nje dopórucony",
    enable: {
        title: "Zašaltuj kameru a mikrofon.",
        join: "Do ruma stupiś",
        start: "Witajśo na našej boku za konfiguraciju awdio- a widejogratow! Namakajśo how rědy, aby pólěpšyli swóju online-dožywjenje. Pśiměŕśo nastajenja swójim pśednosam, aby rozwězali eventuelne problemy. Zawěsććo, až waša hardware korektnje zwězana a aktualizěrowana jo. Wuslěźćo a testujśo wšake konfiguracije, aby namakali, což nejlěpje za was funkcioněrujo.",
    },
    help: {
        title: "Pśistup ku kamerje a mikrofonoju jo trjebny",
        cameraTitle: "Pśistup ku kamerje jo trjebny",
        microphoneTitle: "Pśistup ku mikrofonoju jo trjebny",
        cameraPermissionDenied: "Zwólenje kamery jo wótpokazane",
        microphonePermissionDenied: "Zwólenje mikrofona jo wótpokazane",
        cameraMicrophonePermissionDenied: "Zwólenje kamery a mikrofona jo wótpokazane",
        content: "Pśistup ku kamerje a mikrofonoju musy se zwóliś we browseru.",
        cameraContent: "Pśistup ku kamerje musy se zwóliś we browseru.",
        microphoneContent: "Pśistup ku mikrofonoju musy se zwóliś we browseru.",
        firefoxContent:
            'Klikni na bublin "Te nastajenja zachowaś", aby njemusali kuždy raz wótnowotki to zwólenje we Firefoxu aktiwěrowaś',
        allow: "Webcam zwóliś",
        allowMicrophone: "Mikrofon zwóliś",
        allowCameraMicrophone: "Webcam a mikrofon zwóliś",
        continue: "Dalej mimo kamery",
        continueWithoutMicrophone: "Dalej mimo mikrofona",
        continueCameraMicrophone: "Dalej mimo webcamy a mikrofona",
        showSteps: "Pokazaś, kak",
        hideSteps: "Kšace schowaś",
        steps: {
            chrome: "Klikniśo na symbol šloska nalěwo wót adresowego póla, nastajśo Kameru abo Mikrofon na Zwóliś a pón bok znowego zacytajśo.",
            firefox:
                "Klikniśo na symbol zwólenjow nalěwo wót adresowego póla, wótpórajśo blokěrowany zapisk za Kameru abo Mikrofon, pón bok znowego zacytajśo a dowóliśo pśistup, gaž se pšašo.",
            safari: "Wócyńśo menij Safari, wubjeŕśo Nastajenja za toś to websedło, nastajśo Kameru abo Mikrofon na Zwóliś a pón bok znowego zacytajśo.",
            android:
                "Tknuśo se symbola šloska nalěwo wót adresowego póla, wócyńśo Zwólenja, nastajśo Kameru abo Mikrofon na Zwóliś a pón bok znowego zacytajśo.",
            other: "Wócyńśo nastajenja websedła we wašom browseru za toś ten bok, nastajśo Kameru abo Mikrofon na Zwóliś a pón bok znowego zacytajśo.",
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/de-DE-chrome.png",
        },
        tooltip: {
            permissionDeniedTitle: "Kamerowy pśistup jo se blokěrował",
            permissionDeniedDesc:
                "Waš browser jo pśistup kamerje za toś ten bok wótpokazał. Zwóliśo jen pśez adresowe pólo (šlosk abo symbol kamery) abo w nastajenjach sedła. Wobraz wótpowědujo wašomu browseroju.",
            permissionDeniedFix:
                "Waš browser jo pśistup kamerje za toś ten bok wótpokazał. Zwóliśo jen pśez adresowe pólo (šlosk abo symbol kamery) abo w nastajenjach sedła a pón bok znowego zacytajśo. Wubjeŕśo toś ten tłocašk, aby kšace wiźeł.",
            noDeviceTitle: "Žedna wužywajobna kamera",
            noDeviceDesc:
                "Browser namakujo žednu kameru, kótaruž móžośo wužywaś. Wopytajśo drugi browser, pśekontrolěrujśo zwisk kamery, pśekontrolěrujśo konfiguraciju kompjutra (datowy škit, graty) abo startujśo kompjuter znowego, jolic hardware by měł funkcioněrowaś.",
            deviceInUseTitle: "Kamera se wužywa",
            deviceInUseDesc: "Wašu kameru wužywa druga aplikacija. Zacyńśo tu aplikaciju a wopytajśo to pón znowego.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/de-DE-chrome.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/de-DE-chrome.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "Mikrofonowy pśistup jo se blokěrował",
            permissionDeniedDesc:
                "Waš browser jo pśistup mikrofonoju za toś ten bok wótpokazał. Zwóliśo jen pśez adresowe pólo (šlosk abo symbol mikrofona) abo w nastajenjach sedła. Wobraz wótpowědujo wašomu browseroju.",
            permissionDeniedFix:
                "Waš browser jo pśistup mikrofonoju za toś ten bok wótpokazał. Zwóliśo jen pśez adresowe pólo (šlosk abo symbol mikrofona) abo w nastajenjach sedła a pón bok znowego zacytajśo. Wubjeŕśo toś ten tłocašk, aby kšace wiźeł.",
            noDeviceTitle: "Žeden wužywajobny mikrofon",
            noDeviceDesc:
                "Browser namakujo žeden mikrofon, kótaryž móžośo wužywaś. Wopytajśo drugi browser, pśekontrolěrujśo mikrofon, pśekontrolěrujśo konfiguraciju kompjutra (datowy škit, graty) abo startujśo kompjuter znowego, jolic hardware by měł funkcioněrowaś.",
            deviceInUseTitle: "Mikrofon se wužywa",
            deviceInUseDesc: "Waš mikrofon wužywa druga aplikacija. Zacyńśo tu aplikaciju a wopytajśo to pón znowego.",
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
        title: "Zmylk pśi zwězanju ze serwerom widejo-relej",
        titlePending: "Zwězanje ze serwerom widejo-relej w běgu",
        error: "Serwer TURN njedocpěju",
        content: "Serwer widejo-relej njedocpěju. Móžośo se z drugimi wužiwarjami njekomunikěrowaś.",
        solutionVpn: "Jolic se pśez VPN zwězujośo, pśetorhniśo pšosym zwisk ze swójim VPN a aktualizěrujśo web-boku.",
        solutionVpnNotAskAgain: "Rozměł. Mě zasej njewarnowaś 🫡",
        solutionHotspot:
            "Jolic sćo w wobmjezowanej syći (pśedewześowa syć...), spytajśo syć změniś. Napśikład, wutwóriśo z wašym telefonom WLAN-hotspot a zwězajśo se pśez telefon.",
        solutionNetworkAdmin: "Jolic sćo administrator syće, pśeglědajśo ",
        preparingYouNetworkGuide: 'nawod "Preparing your network"',
        refresh: "Aktualizěrowaś",
        continue: "Dalej",
        newDeviceDetected: "Nowy grat namakany {device} 🎉 Změniś? [SPACE] ignorować [ESC]",
        newDeviceSwitch: "Změniś",
        newDeviceIgnore: "Ignorěrowaś",
        newDeviceAnnouncement:
            "Nowy grat namakany: {device}. Tłocćo Space, aby na njen změnił, abo Escape, aby jen ignorěrował.",
    },
    my: {
        silentZone: "Śichy wobceŕk",
        silentZoneDesc:
            "Sćo w śichym wobcerku. How njamóžo nichten z wami powědaś, a waš mikrofon a waša kamera stej deaktiwěrowanej.",
        nameTag: "Wy",
        loading: "Waša kamera se zacytujo...",
    },
    disable: "Kameru deaktiwěrowaś",
    menu: {
        moreAction: "Dalše akcije",
        closeMenu: "Meny zacyniś",
        senPrivateMessage: "Pśewatne powěsće posłaś (Pśichadźe)",
        giveFloor: "Słowo daś",
        revokeFloor: "Słowo wótewześ",
        muteAudioUser: "Audio stummschalten",
        askToMuteAudioUser: "Pšosyś, aby audio stummschalten",
        muteAudioEveryBody: "Audio za wšěch stummschalten",
        muteVideoUser: "Video stummschalten",
        askToMuteVideoUser: "Pšosyś, aby video stummschalten",
        muteVideoEveryBody: "Video za wšěch stummschalten",
        blockOrReportUser: "Wužiwarja blokěrowaś abo pśihłasowaś",
        mutedAudioNotice: "Mikrofon wósoby {name} jo wótšaltowany. Jano toś ta wósoba móžo jen zasej zašaltowaś.",
        askedMuteAudioNotice: "{name} jo był/a pšošony/-a, mikrofon wótšaltowaś.",
        mutedVideoNotice: "Kamera wósoby {name} jo wótšaltowana. Jano toś ta wósoba móžo ju zasej zašaltowaś.",
        askedMuteVideoNotice: "{name} jo był/a pšošony/-a, kameru wótšaltowaś.",
        confirmMuteAudioEveryBodyTitle: "Mikrofony wšěch wótšaltowaś?",
        confirmMuteAudioEveryBodyMessage:
            "To wótšaltujo wšych w toś tom rozgronje. Jano kuždy sam móžo swój mikrofon zasej zašaltowaś.",
        confirmMuteAudioEveryBodyMessageCount:
            "To wótšaltujo {count} {{wósobu|wósobow}} w toś tom rozgronje. Jano kuždy sam móžo swój mikrofon zasej zašaltowaś.",
        confirmMuteAudioEveryBodyAction: "Wšych wótšaltowaś",
        mutedAudioEveryBodyNotice: "Mikrofony wšěch su wótšaltowane. Jano kuždy sam móžo swój zasej zašaltowaś.",
        mutedAudioEveryBodyNoticeCount:
            "Mikrofon wótšaltowany za {count} {{wósobu|wósobow}}. Jano kuždy sam móžo swój zasej zašaltowaś.",
        confirmMuteVideoEveryBodyTitle: "Kamery wšěch wótšaltowaś?",
        confirmMuteVideoEveryBodyMessage:
            "To wótšaltujo kamery wšych w toś tom rozgronje. Jano kuždy sam móžo swóju kameru zasej zašaltowaś.",
        confirmMuteVideoEveryBodyMessageCount:
            "To wótšaltujo kamery {count} {{wósoby|wósobow}} w toś tom rozgronje. Jano kuždy sam móžo swóju kameru zasej zašaltowaś.",
        confirmMuteVideoEveryBodyAction: "Kamery wótšaltowaś",
        mutedVideoEveryBodyNotice: "Kamery wšěch su wótšaltowane. Jano kuždy sam móžo swóju zasej zašaltowaś.",
        mutedVideoEveryBodyNoticeCount:
            "Kamera wótšaltowana za {count} {{wósobu|wósobow}}. Jano kuždy sam móžo swóju zasej zašaltowaś.",
        alreadyMuted: "Južo wótšaltowany",
        videoAlreadyOff: "Wideo jo južo wótšaltowane",
    },
    startError: {
        camera: "Twója kamera njejo startowała. Druge śi njewiźe. Zacyń druge nałoženja, kótarež ju wužywaju, a wopytaj hyšći raz.",
        microphone:
            "Twój mikrofon njejo startował. Druge śi njesłyše. Zacyń druge nałoženja, kótarež jen wužywaju, a wopytaj hyšći raz.",
    },
};

export default camera;
