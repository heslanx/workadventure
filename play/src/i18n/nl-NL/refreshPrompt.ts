import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Herlaad",
    reason: "De kaart is bijgewerkt en deze pagina moet opnieuw worden geladen om de nieuwe versie te tonen. Je huidige gesprek of vergadering wordt onderbroken en berichten die je nog niet hebt verstuurd gaan verloren.",
    countdown: "Automatisch herladen over {seconds} {{seconde|seconden}}.",
    notNow: "Niet nu",
    postponedMessage: "De kaart is bijgewerkt. Herlaad de pagina wanneer je klaar bent.",
};

export default refreshPrompt;
