import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "Ungültiger Zugangslink",
        subTitle: "Karte konnte nicht gefunden werden. Prüfe bitte deinen Zugangslink.",
        details:
            "Für weitere Informationen wende dich bitte an die Administratoren oder melde dich bei uns unter: hello@workadventu.re",
    },
    connectionRejected: {
        title: "Verbindungen verweigert",
        subTitle: "Du kannst diese Welt nicht betreten. Versuche es später noch einmal {error}.",
        details:
            "Für weitere Information wende dich bitte an die Administratoren oder melde dich bei uns unter: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Verbindung zum Server verloren. Du kannst nicht mit anderen sprechen.",
        retrying: "Automatischer neuer Versuch. Diese Meldung verschwindet, sobald der Server antwortet.",
    },
    errorDialog: {
        title: "Fehler 😱",
        hasReportIssuesUrl:
            "Für weitere Informationen wende dich bitte an die Administratoren oder melde einen Fehler unter:",
        noReportIssuesUrl: "Für weitere Informationen wende dich bitte an die Administratoren dieser Welt.",
        messageFAQ: "Du kannst auch unsere FAQ lesen:",
        reload: "Neu laden",
        close: "Schließen",
    },
    errorScreen: {
        genericTitle: "Wir konnten diese Welt nicht öffnen.",
        genericNextStep:
            "Lade die Seite neu, um es erneut zu versuchen. Wenn das weiterhin passiert, wende dich an deinen Administrator.",
        networkTitle: "Wir konnten den Server nicht erreichen.",
        networkNextStep: "Überprüfe deine Internetverbindung und lade dann die Seite neu.",
        reload: "Seite neu laden",
        showDetails: "Details anzeigen",
        code: "Fehlercode {code}",
    },
};

export default error;
