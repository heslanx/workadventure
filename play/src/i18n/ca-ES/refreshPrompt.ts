import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Actualitzar",
    reason: "S'ha actualitzat el mapa i aquesta pàgina s'ha de tornar a carregar per mostrar-lo. En recarregar-la s'interromp la teva conversa o reunió actual i es perden els missatges que no hagis enviat.",
    countdown: "S'actualitzarà automàticament d'aquí a {seconds} {{segon|segons}}.",
    notNow: "Ara no",
    postponedMessage: "S'ha actualitzat el mapa. Actualitza quan estiguis a punt.",
};

export default refreshPrompt;
