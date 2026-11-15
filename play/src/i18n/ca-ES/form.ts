import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "Opcional",
    discard: {
        message: "Has escrit alguna cosa aquí. Vols tancar i perdre-ho?",
        keepEditing: "Continua editant",
        confirm: "Descarta el text",
    },
};

export default form;
