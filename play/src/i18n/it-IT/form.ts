import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "Opzionale",
    discard: {
        message: "Hai scritto qualcosa qui. Chiudere e perderlo?",
        keepEditing: "Continua a modificare",
        confirm: "Scarta il testo",
    },
};

export default form;
