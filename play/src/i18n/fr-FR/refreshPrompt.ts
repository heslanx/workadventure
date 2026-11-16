import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Rafraîchir",
    reason: "La carte a été mise à jour et cette page doit être rechargée pour l'afficher. Le rechargement interrompt votre conversation ou réunion en cours et supprime tout message non envoyé.",
    countdown: "Rafraîchissement automatique dans {seconds} {{seconde|secondes}}.",
    notNow: "Pas maintenant",
    postponedMessage: "La carte a été mise à jour. Rafraîchissez la page quand vous le souhaitez.",
};

export default refreshPrompt;
