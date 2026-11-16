import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Aktualizěrowanje",
    reason: "Kórta jo se zaktualizěrowała, a toś ten bok musy se znowego zacytaś, aby ju pokazał. Znowego zacytanje pśetergnjo waše aktualne rozgrono abo zetkanje, a njepósłane powěsći se zgubiju.",
    countdown: "Awtomatiski se aktualizěrujo za {seconds} {{sekundu|sekundow}}.",
    notNow: "Nic něnto",
    postponedMessage: "Kórta jo se zaktualizěrowała. Aktualizěrujśo, gaž sćo gótowy.",
};

export default refreshPrompt;
