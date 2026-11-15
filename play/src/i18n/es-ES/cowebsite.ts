import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const companion: DeepPartial<Translation["cowebsite"]> = {
    open: "Abrir",
    close: "Cerca",
    bigBlueButton: "BigBlueButton",
    jitsi: "Jitsi",
    resize: "Cambiar el tamaño del panel del sitio web (teclas de flecha para cambiar el tamaño)",
};

export default companion;
