import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "Opcional",
    discard: {
        message: "Has escrito algo aquí. ¿Cerrar y perderlo?",
        keepEditing: "Seguir editando",
        confirm: "Descartar texto",
    },
};

export default form;
