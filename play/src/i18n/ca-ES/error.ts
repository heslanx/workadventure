import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "Enllaç d'accés incorrecte",
        subTitle: "No s'ha trobat el mapa. Si us plau, reviseu el vostre enllaç d'accés.",
        details:
            "Si voleu més informació, podeu contactar amb l'administrador o contacteu amb nosaltres a: hello@workadventu.re",
    },
    connectionRejected: {
        title: "Conexió rebutjada",
        subTitle: "No podeu unir-vos al Món. Intenteu-lo de nou més tard {error}.",
        details:
            "Si voleu més informació, podeu contactar amb l'administrador o contacteu amb nosaltres a: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "S'ha perdut la connexió amb el servidor. No podràs parlar amb els altres.",
        retrying: "S'està tornant a provar automàticament. Aquest missatge desapareix quan el servidor respon.",
    },
    errorDialog: {
        title: "Error 😱",
        hasReportIssuesUrl: "Si voleu més informació, podeu contactar amb l'administrador o informar d'un problema a:",
        noReportIssuesUrl: "Si voleu més informació, podeu contactar amb l'administrador del món.",
        messageFAQ: "També podeu consultar la nostra:",
        reload: "Recarregar",
        close: "Tancar",
    },
    errorScreen: {
        genericTitle: "No hem pogut obrir aquest món.",
        genericNextStep:
            "Recarrega la pàgina per tornar-ho a provar. Si continua passant, contacta amb el teu administrador.",
        networkTitle: "No hem pogut connectar amb el servidor.",
        networkNextStep: "Comprova la connexió a Internet i després recarrega la pàgina.",
        reload: "Recarrega la pàgina",
        showDetails: "Mostra els detalls",
        code: "Codi d'error {code}",
    },
};

export default error;
