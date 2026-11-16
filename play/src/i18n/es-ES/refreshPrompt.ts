import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Actualizar",
    reason: "El mapa se ha actualizado y esta página tiene que volver a cargarse para mostrarlo. Al actualizar se interrumpirá tu conversación o reunión actual y se descartará cualquier mensaje que no hayas enviado.",
    countdown: "Actualizando automáticamente en {seconds} {{segundo|segundos}}.",
    notNow: "Ahora no",
    postponedMessage: "El mapa se ha actualizado. Actualiza cuando quieras.",
};

export default refreshPrompt;
