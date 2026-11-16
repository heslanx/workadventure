import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "Link di accesso errato",
        subTitle: "Mappa non trovata. Si prega di controllare il link di accesso.",
        details:
            "Se desideri maggiori informazioni, puoi contattare l'amministratore o contattarci a: hello@workadventu.re",
    },
    connectionRejected: {
        title: "Connessione rifiutata",
        subTitle: "Non puoi entrare nel Mondo. Riprova più tardi {error}.",
        details:
            "Se desideri maggiori informazioni, puoi contattare l'amministratore o contattarci a: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Connessione al server persa. Non potrai parlare con gli altri.",
        retrying: "Nuovo tentativo automatico. Questo messaggio scompare non appena il server risponde.",
    },
    errorDialog: {
        title: "Errore 😱",
        hasReportIssuesUrl:
            "Se desideri maggiori informazioni, puoi contattare l'amministratore o segnalare un problema a:",
        noReportIssuesUrl: "Se desideri maggiori informazioni, puoi contattare l'amministratore del mondo.",
        messageFAQ: "Puoi anche controllare il nostro:",
        reload: "Ricarica",
        close: "Chiudi",
    },
    errorScreen: {
        genericTitle: "Non siamo riusciti ad aprire questo mondo.",
        genericNextStep: "Ricarica la pagina per riprovare. Se il problema persiste, contatta il tuo amministratore.",
        networkTitle: "Non siamo riusciti a raggiungere il server.",
        networkNextStep: "Controlla la tua connessione a Internet, poi ricarica la pagina.",
        reload: "Ricarica la pagina",
        showDetails: "Mostra dettagli",
        code: "Codice errore {code}",
    },
};

export default error;
