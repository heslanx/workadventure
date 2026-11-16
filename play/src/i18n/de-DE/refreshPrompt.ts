import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Aktualisieren",
    reason: "Die Karte wurde aktualisiert, und diese Seite muss neu geladen werden, um sie anzuzeigen. Beim Neuladen werden deine aktuelle Unterhaltung oder Besprechung unterbrochen, und Nachrichten, die du noch nicht gesendet hast, gehen verloren.",
    countdown: "Automatische Aktualisierung in {seconds} {{Sekunde|Sekunden}}.",
    notNow: "Jetzt nicht",
    postponedMessage: "Die Karte wurde aktualisiert. Aktualisiere die Seite, wenn du so weit bist.",
};

export default refreshPrompt;
