import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "Link za pśistup njejo płaśecy",
        subTitle: "Kórta njejo se namakała. Pśespytuj link za pśistup.",
        details:
            "Dla dalšnych informacijow wobroś se na administratory abo pśipowěź se pla nas pód adresu: hello@workadventu.re",
    },
    connectionRejected: {
        title: "Zwězanje njejo zwólone",
        subTitle: "Ty njamóžoš do togo swěta stupiś. Wopytaj pózdźej hyšći raz {error}.",
        details:
            "Dla dalšnych informacijow wobroś se na administratory abo pśipowěź se pla nas pód adresu: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Zwězanje k serweru jo se zgubiło. Njemóžoš z drugimi rěcaś.",
        retrying: "Awtomatiski se znowego wopytujo. Toś ta powěsć zgubijo se, gaž serwer wótegrono.",
    },
    errorDialog: {
        title: "Zmólka 😱",
        hasReportIssuesUrl:
            "Dla dalšnych informacijow móžoš se z administratorami kontaktěrowaś abo zmólku powdawaś pod:",
        noReportIssuesUrl: "Dla dalšnych informacijow wobroś se na administratory swěta.",
        messageFAQ: "Móžoš teke do našu FAQ poglědaś:",
        reload: "Aktualizowaś",
        close: "Zacyniś",
    },
    errorScreen: {
        genericTitle: "Njejsmy mógli toś ten swět wócyniś.",
        genericNextStep:
            "Zacytaj bok znowego, aby hyšći raz wopytał. Jolic se to dalej stawa, skontaktěruj swójogo administratora.",
        networkTitle: "Njejsmy mógli serwer dośěgnuś.",
        networkNextStep: "Pśeglěduj swój internetny zwisk a zacytaj pótom bok znowego.",
        reload: "Bok znowego zacytaś",
        showDetails: "Drobnostki pokazaś",
        code: "Kod zmólki {code}",
    },
};

export default error;
