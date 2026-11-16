import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "Link de acesso incorreto",
        subTitle: "Não foi possível encontrar o mapa. Verifique seu link de acesso.",
        details:
            "Se você quiser mais informações, entre em contato com o administrador ou entre em contato conosco em: hello@workadventu.re",
    },
    connectionRejected: {
        title: "Conexão rejeitada",
        subTitle: "Você não pode se juntar ao mundo. Tente novamente mais tarde {error}.",
        details:
            "Se você quiser mais informações, entre em contato com o administrador ou entre em contato conosco em: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Conexão com o servidor perdida. Você não poderá falar com os outros.",
        retrying: "Tentando de novo automaticamente. Esta mensagem some quando o servidor responder.",
    },
    errorDialog: {
        title: "Erro 😱",
        hasReportIssuesUrl:
            "Se você quiser mais informações, entre em contato com o administrador ou informe um problema em:",
        noReportIssuesUrl: "Se você quiser mais informações, entre em contato com o administrador do mundo.",
        messageFAQ: "Você também pode verificar o nosso:",
        reload: "Recarregar",
        close: "Fechar",
    },
    errorScreen: {
        genericTitle: "Não foi possível abrir este mundo.",
        genericNextStep: "Recarregue a página para tentar de novo. Se continuar, fale com o administrador.",
        networkTitle: "Não foi possível falar com o servidor.",
        networkNextStep: "Verifique sua internet e recarregue a página.",
        reload: "Recarregar a página",
        showDetails: "Mostrar detalhes",
        code: "Código do erro {code}",
    },
};

export default error;
