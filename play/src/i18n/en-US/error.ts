import type { BaseTranslation } from "../i18n-types";

const error: BaseTranslation = {
    accessLink: {
        title: "Access link incorrect",
        subTitle: "Could not find map. Please check your access link.",
        details: "If you want more information, you may contact administrator or contact us at: hello@workadventu.re",
    },
    connectionRejected: {
        title: "Connection rejected",
        subTitle: "You cannot join the World. Try again later {error}.",
        details: "If you want more information, you may contact administrator or contact us at: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Connection to server lost. You won't be able to speak to others.",
        retrying: "Retrying automatically. This message goes away once the server answers.",
    },
    errorDialog: {
        title: "Error 😱",
        hasReportIssuesUrl: "If you want more information, you may contact administrator or report an issue at:",
        noReportIssuesUrl: "If you want more information, you may contact the administrator of the world.",
        messageFAQ: "You may also check our:",
        reload: "Reload",
        close: "Close",
    },
    errorScreen: {
        genericTitle: "We could not open this world.",
        genericNextStep: "Reload the page to try again. If this keeps happening, contact your administrator.",
        networkTitle: "We could not reach the server.",
        networkNextStep: "Check your internet connection, then reload the page.",
        reload: "Reload the page",
        showDetails: "Show details",
        code: "Error code {code}",
    },
};

export default error;
