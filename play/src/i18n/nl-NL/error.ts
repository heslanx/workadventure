import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "Toegangskoppeling onjuist",
        subTitle: "Kaart niet gevonden. Controleer je toegangskoppeling.",
        details:
            "Als je meer informatie wilt, kun je contact opnemen met de beheerder of ons bereiken via: hello@workadventu.re",
    },
    connectionRejected: {
        title: "Verbinding afgewezen",
        subTitle: "Je kunt de Wereld niet betreden. Probeer het later opnieuw {error}.",
        details:
            "Als je meer informatie wilt, kun je contact opnemen met de beheerder of ons bereiken via: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Verbinding met de server verloren. Je kunt niet met anderen praten.",
        retrying: "Automatisch opnieuw proberen. Dit bericht verdwijnt zodra de server antwoordt.",
    },
    errorDialog: {
        title: "Fout 😱",
        hasReportIssuesUrl:
            "Als je meer informatie wilt, kun je contact opnemen met de beheerder of een probleem melden via:",
        noReportIssuesUrl: "Als je meer informatie wilt, kun je contact opnemen met de beheerder van de wereld.",
        messageFAQ: "Je kunt ook onze volgende informatie raadplegen:",
        reload: "Opnieuw laden",
        close: "Sluiten",
    },
    errorScreen: {
        genericTitle: "We konden deze wereld niet openen.",
        genericNextStep:
            "Herlaad de pagina om het opnieuw te proberen. Als dit blijft gebeuren, neem dan contact op met je beheerder.",
        networkTitle: "We konden de server niet bereiken.",
        networkNextStep: "Controleer je internetverbinding en herlaad daarna de pagina.",
        reload: "Pagina herladen",
        showDetails: "Details tonen",
        code: "Foutcode {code}",
    },
};

export default error;
