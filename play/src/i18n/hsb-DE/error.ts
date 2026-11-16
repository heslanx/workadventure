import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "njepłaćiwy přistupny link",
        subTitle: "Karta njeje so namakała. Pruwuj prošu swój přistupny link.",
        details:
            "Za dalše informacije móžeš so z administratorami skontaktować abo přizjew so pola nas pod: hello@workadventu.re",
    },
    connectionRejected: {
        title: "zwiski wotpokazali",
        subTitle: "Njemóžeš do tuteho swěta zastupić. Spytaj pozdźišo hišće raz {error}.",
        details:
            "Za dalše informacije móžeš so z administratorami skontaktować abo přizjew so pola nas pod: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Zwisk k serweru je so zhubił. Njemóžeš z druhimi rěčeć.",
        retrying: "Awtomatisce so znowa spytuje. Tuta powěsć zmizny, hdyž serwer wotmołwi.",
    },
    errorDialog: {
        title: "Zmylk 😱",
        hasReportIssuesUrl: "Za dalše informacije móžeš so z administratorami skontaktować abo zmylk podawać pod:",
        noReportIssuesUrl: "Za dalše informacije móžeš so z administratorami swěta skontaktować.",
        messageFAQ: "Móžeš tež do našu FAQ pohladać:",
        reload: "aktualizować",
        close: "začinić",
    },
    errorScreen: {
        genericTitle: "Njemóžachmy tutón swět wočinić.",
        genericNextStep:
            "Začitaj stronu znowa, zo by hišće raz spytał. Jeli so to dale stawa, skontaktuj swojeho administratora.",
        networkTitle: "Njemóžachmy serwer docpěć.",
        networkNextStep: "Přepruwuj swój internetny zwisk a začitaj potom stronu znowa.",
        reload: "Stronu znowa začitać",
        showDetails: "Podrobnosće pokazać",
        code: "Kod zmylka {code}",
    },
};

export default error;
