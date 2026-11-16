import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Aktualizować",
    reason: "Karta bu zaktualizowana a tuta strona dyrbi so znowa začitać, zo by změny pokazała. Při tym so waša aktualna rozmołwa abo waše zetkanje přetorhnje a njepósłane powěsće so zhubja.",
    countdown: "Awtomatisce so za {seconds} {{sekundow|sekundu|sekundźe|sekundy|sekundow|sekundow}} aktualizuje.",
    notNow: "Nic nětko",
    postponedMessage: "Karta bu zaktualizowana. Aktualizujće, hdyž sće hotowy.",
};

export default refreshPrompt;
