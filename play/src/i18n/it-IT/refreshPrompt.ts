import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Aggiornare",
    reason: "La mappa è stata aggiornata e questa pagina deve essere ricaricata per mostrarla. Il ricaricamento interrompe la conversazione o la riunione in corso e cancella i messaggi non ancora inviati.",
    countdown: "Aggiornamento automatico tra {seconds} {{secondo|secondi}}.",
    notNow: "Non ora",
    postponedMessage: "La mappa è stata aggiornata. Aggiorna quando vuoi.",
};

export default refreshPrompt;
