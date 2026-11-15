import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "Opcijone",
    discard: {
        message: "Sy how něco zapisał. Zacyniś a zgubiś?",
        keepEditing: "Dalej wobźěłaś",
        confirm: "Tekst zachyśiś",
    },
};

export default form;
