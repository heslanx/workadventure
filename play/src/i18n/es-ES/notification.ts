import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const notification: DeepPartial<Translation["notification"]> = {
    discussion: "{name} quiere discutir contigo",
    message: "{name} te envía un mensaje",
    mention: "{name} te ha mencionado",
    askToMuteMicrophone: "¿Puedo silenciar tu micrófono?",
    askToMuteCamera: "¿Puedo silenciar tu cámara?",
    microphoneMuted: "Tu micrófono ha sido silenciado por un moderador",
    cameraMuted: "Tu cámara ha sido silenciada por un moderador",
    microphoneMutedForEverybody: "Un moderador ha silenciado el micrófono de todos. Puedes volver a activar el tuyo.",
    cameraMutedForEverybody: "Un moderador ha apagado la cámara de todos. Puedes volver a encender la tuya.",
    givenTheFloor: "Es tu turno de hablar",
    givenTheFloorEnableMicrophone: "Es tu turno de hablar — activa tu micrófono",
    floorRevoked: "Ya no tienes la palabra",
    floorGivenBack: "Has devuelto la palabra",
    handLowered: "Un moderador ha bajado tu mano",
    removedFromConversation: "Un moderador te ha retirado de la conversación.",
    actionFailed: "No se ha podido completar esta acción",
    announcement: "Anuncio",
    help: {
        title: "Acceso a las notificaciones denegado",
        permissionDenied: "Permiso denegado",
        content:
            "No te pierdas ninguna discusión. Activa las notificaciones para ser notificado cuando alguien quiera hablar contigo, incluso si no estás en la pestaña de WorkAdventure.",
        firefoxContent:
            'Por favor, marca la casilla "Recordar esta decisión" si no quieres que Firefox siga pidiéndote la autorización.',
        refresh: "Actualizar",
        continue: "Continuar sin notificaciones",
        screen: {
            chrome: "/resources/help-setting-notification-permission/en-US-chrome.png",
        },
        screenAlt: "Permitir las notificaciones desde la barra de direcciones en Chrome",
    },
    addNewTag: 'añadir un nuevo tag: "{tag}"',
    screenSharingError: "No se puede iniciar el compartir de pantalla",
    recordingStarted: "Una persona en la discusión ha comenzado una grabación.",
    urlCopiedToClipboard: "URL copiada al portapapeles",
    muteRequest: {
        acceptMicrophone: "Silenciar mi micrófono",
        acceptCamera: "Apagar mi cámara",
        refuse: "Mantenerlo activado",
    },
    copyFailed:
        "No se pudo copiar: el navegador bloqueó el portapapeles. Selecciona el texto y pulsa Ctrl+C (Cmd+C en Mac).",
    closeToast: "Cerrar notificación",
};

export default notification;
