import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const companion: DeepPartial<Translation["cowebsite"]> = {
    open: "Ouvrir",
    close: "Fermer",
    bigBlueButton: "BigBlueButton",
    jitsi: "Jitsi",
    resize: "Redimensionner le panneau du site web (flèches du clavier pour redimensionner)",
};

export default companion;
