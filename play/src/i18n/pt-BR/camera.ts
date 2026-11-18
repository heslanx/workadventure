import type { BaseTranslation } from "../i18n-types";

const camera: BaseTranslation = {
    editCam: "Editar câmera",
    startError: {
        camera: "Sua câmera não iniciou. Os outros não conseguem ver você. Feche outros apps que a usam e tente de novo.",
        microphone:
            "Seu microfone não iniciou. Os outros não conseguem ouvir você. Feche outros apps que o usam e tente de novo.",
    },
    editSpeaker: "Editar saída de áudio",
    active: "Ativo",
    disabled: "Desabilitado",
    notRecommended: "Não recomendado",
    enable: {
        title: "Ligue sua câmera e microfone",
        join: "Entrar no escritório",
        start: "Bem-vindo à nossa página de configuração de dispositivos de áudio e vídeo! Encontre aqui as ferramentas para melhorar sua experiência online. Ajuste as configurações às suas preferências para resolver possíveis problemas. Certifique-se de que seu hardware esteja conectado corretamente e atualizado. Explore e teste diferentes configurações para encontrar o que funciona melhor para você.",
    },
    help: {
        title: "Necessário acesso à câmera/microfone",
        cameraTitle: "Necessário acesso à câmera",
        microphoneTitle: "Necessário acesso ao microfone",
        cameraPermissionDenied: "Permissão da câmera negada",
        microphonePermissionDenied: "Permissão do microfone negada",
        cameraMicrophonePermissionDenied: "Permissões da câmera e do microfone negadas",
        content: "Você deve permitir o acesso à câmera e ao microfone em seu navegador.",
        cameraContent: "Você deve permitir o acesso à câmera em seu navegador.",
        microphoneContent: "Você deve permitir o acesso ao microfone em seu navegador.",
        firefoxContent:
            'Por favor, clique na caixa de seleção "Lembrar esta decisão", se você não quiser que o Firefox continue pedindo a autorização.',
        allow: "Permitir câmera",
        allowMicrophone: "Permitir microfone",
        allowCameraMicrophone: "Permitir câmera e microfone",
        continue: "Continuar sem câmera",
        continueWithoutMicrophone: "Continuar sem microfone",
        continueCameraMicrophone: "Continuar sem câmera e microfone",
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
        },
        tooltip: {
            permissionDeniedTitle: "Acesso à câmera bloqueado",
            permissionDeniedDesc:
                "O navegador negou o acesso à câmera para este site. Permita na barra de endereços (cadeado ou ícone da câmera) ou nas configurações do site. A ilustração abaixo corresponde ao seu navegador.",
            noDeviceTitle: "Nenhuma câmera utilizável",
            noDeviceDesc:
                "O navegador não detecta nenhuma câmera utilizável. Tente outro navegador, verifique se a câmera está conectada, verifique as configurações do computador (privacidade, dispositivos) ou reinicie o computador se o dispositivo deveria funcionar.",
            deviceInUseTitle: "Câmera em uso",
            deviceInUseDesc: "Outro aplicativo está usando a câmera. Feche esse aplicativo e tente novamente.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "Acesso ao microfone bloqueado",
            permissionDeniedDesc:
                "O navegador negou o acesso ao microfone para este site. Permita na barra de endereços (cadeado ou ícone do microfone) ou nas configurações do site. A ilustração abaixo corresponde ao seu navegador.",
            noDeviceTitle: "Nenhum microfone utilizável",
            noDeviceDesc:
                "O navegador não detecta nenhum microfone utilizável. Tente outro navegador, verifique o microfone, verifique as configurações do computador (privacidade, dispositivos) ou reinicie o computador se o dispositivo deveria funcionar.",
            deviceInUseTitle: "Microfone em uso",
            deviceInUseDesc: "Outro aplicativo está usando o microfone. Feche esse aplicativo e tente novamente.",
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
        title: "Problema na conexão de vídeo",
        titlePending: "Conexão do servidor de retransmissão de vídeo pendente",
        error: "O vídeo não alcança algumas pessoas. Elas podem não ver nem ouvir você. Confira sua rede ou VPN e recarregue.",
        content: "Não foi possível falar com o servidor de vídeo. Tente uma das opções abaixo.",
        solutionVpn:
            "Se você está <strong>conectando via VPN</strong>, por favor desconecte da sua VPN e atualize a página web.",
        solutionVpnNotAskAgain: "Entendido. Não me avise novamente 🫡",
        solutionHotspot:
            "Se você está em uma rede restrita (rede da empresa...), tente trocar de rede. Por exemplo, crie um <strong>hotspot Wifi</strong> com seu telefone e conecte via seu telefone.",
        solutionNetworkAdmin: "Se você é um <strong>administrador de rede</strong>, revise o ",
        preparingYouNetworkGuide: 'guia "Preparando sua rede"',
        refresh: "Atualizar",
        continue: "Continuar",
        newDeviceDetected: "Novo dispositivo detectado {device} 🎉 Trocar? [ESPAÇO] Ignorar [ESC]",
    },
    my: {
        silentZone: "Zona silenciosa",
        silentZoneDesc:
            "Você está em uma zona silenciosa. Ninguém pode falar com você aqui, e seu microfone e sua câmera estão desativados.",
        nameTag: "Você",
        loading: "Carregando sua câmera...",
    },
    disable: "Desligue sua câmera",
    menu: {
        mutedAudioNotice: "O microfone de {name} foi silenciado. Só a própria pessoa pode religá-lo.",
        askedMuteAudioNotice: "{name} recebeu o pedido para silenciar o microfone.",
        mutedVideoNotice: "A câmera de {name} foi desligada. Só a própria pessoa pode religá-la.",
        askedMuteVideoNotice: "{name} recebeu o pedido para desligar a câmera.",
        moreAction: "Mais ações",
        closeMenu: "Fechar menu",
        senPrivateMessage: "Enviar mensagem privada (em breve)",
        giveFloor: "Dar a palavra",
        revokeFloor: "Retirar a palavra",
        muteAudioUser: "Silenciar áudio",
        askToMuteAudioUser: "Pedir para silenciar áudio",
        muteAudioEveryBody: "Silenciar áudio para todos",
        muteVideoUser: "Desligar vídeo",
        askToMuteVideoUser: "Pedir para desligar vídeo",
        muteVideoEveryBody: "Desligar vídeo para todos",
        alreadyMuted: "Já está sem áudio",
        videoAlreadyOff: "Vídeo já desligado",
        blockOrReportUser: "Moderação",
    },
};

export default camera;
