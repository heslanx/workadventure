import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const recording: DeepPartial<Translation["recording"]> = {
    refresh: "Atualizar",
    title: "Sua lista de gravações",
    noRecordings: "Nenhuma gravação ainda. Comece uma gravação pela barra de ações e ela aparece aqui.",
    errorFetchingRecordings: "Suas gravações não carregaram. Elas continuam salvas. Feche esta janela e abra de novo.",
    expireIn: "Expira em {days} dia{s}",
    expiresOn: "Expira em {date}",
    download: "Baixar",
    close: "Fechar",
    recordingList: "Gravações",
    viewList: "Visualização em lista",
    viewCards: "Visualização em cartões",
    back: "Voltar",
    actions: "Ações",
    contextMenu: {
        openInNewTab: "Abrir em nova aba",
        delete: "Excluir",
    },
    notification: {
        deleteNotification: "Gravação excluída com sucesso",
        deleteFailedNotification: "Falha ao excluir gravação",
        startFailedNotification: "A gravação não começou. Nada foi gravado. Tente de novo.",
        stopFailedNotification: "A gravação pode continuar ativa. Tente parar de novo.",
        recordingStarted: "{name} iniciou uma gravação.",
        downloadFailedNotification: "O download não começou. A gravação continua salva. Tente de novo.",
        recordingComplete: "Gravação concluída",
        recordingIsInProgress: "Gravação em andamento",
        unexpectedlyStoppedNotification: "A gravação foi interrompida inesperadamente",
        recordingSaved: "Sua gravação foi salva com sucesso.",
        howToAccess: "Para acessar suas gravações:",
        viewRecordings: "Ver gravações",
    },
    actionbar: {
        title: {
            start: "Iniciar gravação",
            stop: "Parar gravação",
            inProgress: "Uma gravação está em andamento",
        },
        desc: {
            needLogin: "Você precisa estar logado para gravar.",
            advert: "Todos os participantes serão notificados de que você está iniciando uma gravação.",
            yourRecordInProgress: "Gravação em andamento, clique para parar.",
            inProgress: "Uma gravação está em andamento",
        },
        spacePicker: {
            megaphone: "Gravar megafone",
            discussion: "Gravar discussão",
            recordedByOther: "Só uma gravação por vez aqui. Você pode iniciar a sua quando esta terminar.",
        },
    },
};

export default recording;
