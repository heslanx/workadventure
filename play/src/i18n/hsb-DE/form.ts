import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "Opcijone",
    discard: {
        message: "Sy tu něšto zapisał. Začinić a zhubić?",
        keepEditing: "Dale wobdźěłać",
        confirm: "Tekst zaćisnyć",
    },
};

export default form;
