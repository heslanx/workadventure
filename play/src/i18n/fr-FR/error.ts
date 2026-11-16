import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "Lien d'accès incorrect",
        subTitle: "Impossible de trouver la carte. Veuillez vérifier votre lien d'accès.",
        details:
            "Si vous souhaitez obtenir de plus amples informations, vous pouvez contacter l'administrateur ou nous contacter à l'adresse suivante : hello@workadventu.re",
    },
    connectionRejected: {
        title: "Connexion rejetée",
        subTitle: "Vous ne pouvez pas rejoindre le monde. Réessayez plus tard {error}.",
        details:
            "Si vous souhaitez obtenir de plus amples informations, vous pouvez contacter l'administrateur ou nous contacter à l'adresse suivante : hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Connexion au serveur perdue. Vous ne pourrez pas parler aux autres.",
        retrying: "Nouvelle tentative automatique. Ce message disparaît dès que le serveur répond.",
    },
    errorDialog: {
        title: "Erreur 😱",
        hasReportIssuesUrl:
            "Si vous souhaitez obtenir de plus amples informations, vous pouvez contacter l'administrateur ou signaler un problème à l'adresse suivante :",
        noReportIssuesUrl:
            "Si vous souhaitez obtenir de plus amples informations, vous pouvez contacter l'administrateur du monde.",
        messageFAQ: "Vous pouvez également consulter notre :",
        reload: "Recharger",
        close: "Fermer",
    },
    errorScreen: {
        genericTitle: "Nous n'avons pas pu ouvrir ce monde.",
        genericNextStep: "Rechargez la page pour réessayer. Si le problème persiste, contactez votre administrateur.",
        networkTitle: "Nous n'avons pas pu joindre le serveur.",
        networkNextStep: "Vérifiez votre connexion Internet, puis rechargez la page.",
        reload: "Recharger la page",
        showDetails: "Afficher les détails",
        code: "Code d'erreur {code}",
    },
};

export default error;
