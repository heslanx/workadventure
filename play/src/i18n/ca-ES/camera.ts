import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "Editar càmera",
    editSpeaker: "Editar sortida d'àudio",
    active: "Actiu",
    disabled: "Desactivat",
    notRecommended: "No recomanat",
    enable: {
        title: "Encendre la càmera i el micròfon",
        join: "Entra a la sala",
        start: "Benvigut a la nostra pàgina de configuració de dispositius d'àudio i vídeo! Trobeu aquí les eines per millorar la vostra experiència en línia. Ajusteu la configuració segons les vostres preferències per resoldre qualsevol problema potencial. Assegureu-vos que el vostre maquinari estigui connectat correctament i actualitzat. Exploreu i proveu diferents configuracions per trobar la que millor us funciona.",
    },
    help: {
        title: "Es necessita accéss a la càmera/micròfon",
        cameraTitle: "Es necessita accés a la càmera",
        microphoneTitle: "Es necessita accés al micròfon",
        cameraPermissionDenied: "Permís de càmera denegat",
        microphonePermissionDenied: "Permís de micròfon denegat",
        cameraMicrophonePermissionDenied: "Permisos de càmera i micròfon denegats",
        content: "Ha de permetre accés a la càmera i el micròfon al navegador.",
        cameraContent: "Ha de permetre accés a la càmera al navegador.",
        microphoneContent: "Ha de permetre accés al micròfon al navegador.",
        firefoxContent:
            'Si us plau, feu clic a la caixa "Recordar aquesta decisió", si no voleu que Firefox sigui demanant autorització.',
        allow: "Permetre la webcam",
        allowMicrophone: "Permetre el micròfon",
        allowCameraMicrophone: "Permetre la webcam i el micròfon",
        continue: "Continuar sense càmera",
        continueWithoutMicrophone: "Continuar sense micròfon",
        continueCameraMicrophone: "Continuar sense webcam ni micròfon",
        showSteps: "Mostra'm com",
        hideSteps: "Amaga els passos",
        steps: {
            chrome: "Fes clic a la icona del cadenat a l'esquerra de la barra d'adreces, estableix Càmera o Micròfon a Permet i torna a carregar la pàgina.",
            firefox:
                "Fes clic a la icona de permisos a l'esquerra de la barra d'adreces, elimina l'entrada bloquejada de Càmera o Micròfon, torna a carregar la pàgina i permet l'accés quan te'l demanin.",
            safari: "Obre el menú de Safari, tria Configuració d'aquest lloc web, estableix Càmera o Micròfon a Permet i torna a carregar la pàgina.",
            android:
                "Toca la icona del cadenat a l'esquerra de la barra d'adreces, obre Permisos, estableix Càmera o Micròfon a Permet i torna a carregar la pàgina.",
            other: "Obre la configuració del lloc del navegador per a aquesta pàgina, estableix Càmera o Micròfon a Permet i torna a carregar la pàgina.",
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
        },
        tooltip: {
            permissionDeniedTitle: "Accés a la càmera bloquejat",
            permissionDeniedDesc:
                "El navegador ha denegat l’accés a la càmera per a aquest lloc. Permeteu-lo des de la barra d’adreces (cadenat o icona de càmera) o a la configuració del lloc. La il·lustració correspon al vostre navegador.",
            permissionDeniedFix:
                "El navegador ha denegat l'accés a la càmera per a aquest lloc. Permet-lo des de la barra d'adreces (icona del cadenat o de càmera) o a la configuració del lloc i torna a carregar la pàgina. Selecciona aquest botó per veure els passos.",
            noDeviceTitle: "Cap càmera utilitzable",
            noDeviceDesc:
                "El navegador no detecta cap càmera utilitzable. Proveu un altre navegador, comproveu que la càmera estigui connectada, reviseu la configuració de l’ordinador (privadesa, dispositius) o reinicieu l’ordinador si el dispositiu hauria de funcionar.",
            deviceInUseTitle: "Càmera en ús",
            deviceInUseDesc:
                "Una altra aplicació està fent servir la càmera. Tanqueu aquella aplicació i torneu-ho a provar.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "Accés al micròfon bloquejat",
            permissionDeniedDesc:
                "El navegador ha denegat l’accés al micròfon per a aquest lloc. Permeteu-lo des de la barra d’adreces (cadenat o icona de micròfon) o a la configuració del lloc. La il·lustració correspon al vostre navegador.",
            permissionDeniedFix:
                "El navegador ha denegat l'accés al micròfon per a aquest lloc. Permet-lo des de la barra d'adreces (icona del cadenat o de micròfon) o a la configuració del lloc i torna a carregar la pàgina. Selecciona aquest botó per veure els passos.",
            noDeviceTitle: "Cap micròfon utilitzable",
            noDeviceDesc:
                "El navegador no detecta cap micròfon utilitzable. Proveu un altre navegador, comproveu el micròfon, reviseu la configuració de l’ordinador (privadesa, dispositius) o reinicieu l’ordinador si el dispositiu hauria de funcionar.",
            deviceInUseTitle: "Micròfon en ús",
            deviceInUseDesc:
                "Una altra aplicació està fent servir el micròfon. Tanqueu aquella aplicació i torneu-ho a provar.",
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
        title: "Error de connexió amb el servidor de retransmissió de vídeo",
        titlePending: "Connexió amb el servidor de retransmissió de vídeo pendent",
        error: "El servidor TURN no és accessible",
        content:
            "El servidor de retransmissió de vídeo no es pot arribar. Pot ser que no pugueu comunicar-vos amb altres usuaris.",
        solutionVpn:
            "Si us esteu <strong>connectant mitjançant una VPN</strong>, desconnecteu-vos de la VPN i actualitzeu la pàgina web.",
        solutionVpnNotAskAgain: "Entès. No em tornis a avisar 🫡",
        solutionHotspot:
            "Si esteu en una xarxa restringida (xarxa d'empresa...), proveu de canviar de xarxa. Per exemple, creeu un <strong>punt d'accés Wifi</strong> amb el vostre telèfon i connecteu-vos mitjançant el telèfon.",
        solutionNetworkAdmin: "Si sou un <strong>administrador de xarxa</strong>, reviseu la ",
        preparingYouNetworkGuide: 'guia "Preparant la vostra xarxa"',
        refresh: "Actualitzar",
        continue: "Continuar",
        newDeviceDetected: "Nou dispositiu detectat {device} 🎉 Canviar? [ESPAI] Ignorar [ESC]",
        newDeviceSwitch: "Canvia",
        newDeviceIgnore: "Ignora",
        newDeviceAnnouncement:
            "S'ha detectat un dispositiu nou: {device}. Prem Espai per canviar-hi o Escape per ignorar-lo.",
    },
    my: {
        silentZone: "Zona silenciosa",
        silentZoneDesc:
            "Esteu en una zona silenciosa. Ningú no us pot parlar aquí, i el vostre micròfon i la vostra càmera estan desactivats.",
        nameTag: "Vós",
        loading: "Carregant la vostra càmera...",
    },
    disable: "Apagueu la càmera",
    menu: {
        moreAction: "Més accions",
        closeMenu: "Tancar el menú",
        senPrivateMessage: "Enviar un missatge privat (pròximament)",
        giveFloor: "Donar la paraula",
        revokeFloor: "Retirar la paraula",
        muteAudioUser: "Silenciar audio",
        askToMuteAudioUser: "Demanar de silenciar l'àudio",
        muteAudioEveryBody: "Silenciar audio per a tothom",
        muteVideoUser: "Silenciar vídeo",
        askToMuteVideoUser: "Demanar de silenciar el vídeo",
        muteVideoEveryBody: "Silenciar vídeo per a tothom",
        blockOrReportUser: "Bloquejar o informar d'usuari",
        mutedAudioNotice: "El micròfon de {name} està silenciat. Només aquesta persona el pot tornar a activar.",
        askedMuteAudioNotice: "S'ha demanat a {name} que silenciï el micròfon.",
        mutedVideoNotice: "La càmera de {name} està apagada. Només aquesta persona la pot tornar a encendre.",
        askedMuteVideoNotice: "S'ha demanat a {name} que apagui la càmera.",
        confirmMuteAudioEveryBodyTitle: "Vols silenciar el micròfon de tothom?",
        confirmMuteAudioEveryBodyMessage:
            "Això silencia totes les persones d'aquesta conversa. Només cada persona pot tornar a activar el seu propi micròfon.",
        confirmMuteAudioEveryBodyMessageCount:
            "Això silencia {count} {{persona|persones}} d'aquesta conversa. Només cada persona pot tornar a activar el seu propi micròfon.",
        confirmMuteAudioEveryBodyAction: "Silencia tothom",
        mutedAudioEveryBodyNotice: "El micròfon de tothom està silenciat. Només cada persona el pot tornar a activar.",
        mutedAudioEveryBodyNoticeCount:
            "Micròfon silenciat per a {count} {{persona|persones}}. Només cada persona el pot tornar a activar.",
        confirmMuteVideoEveryBodyTitle: "Vols apagar la càmera de tothom?",
        confirmMuteVideoEveryBodyMessage:
            "Això apaga la càmera de totes les persones d'aquesta conversa. Només cada persona pot tornar a encendre la seva pròpia càmera.",
        confirmMuteVideoEveryBodyMessageCount:
            "Això apaga la càmera de {count} {{persona|persones}} d'aquesta conversa. Només cada persona pot tornar a encendre la seva pròpia càmera.",
        confirmMuteVideoEveryBodyAction: "Apaga les càmeres",
        mutedVideoEveryBodyNotice: "La càmera de tothom està apagada. Només cada persona la pot tornar a encendre.",
        mutedVideoEveryBodyNoticeCount:
            "Càmera apagada per a {count} {{persona|persones}}. Només cada persona la pot tornar a encendre.",
        alreadyMuted: "Ja silenciat",
        videoAlreadyOff: "Vídeo ja apagat",
    },
    startError: {
        camera: "La teva càmera no s'ha iniciat. Els altres no et poden veure. Tanca altres aplicacions que la facin servir i torna-ho a provar.",
        microphone:
            "El teu micròfon no s'ha iniciat. Els altres no et poden sentir. Tanca altres aplicacions que el facin servir i torna-ho a provar.",
    },
};

export default camera;
