import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "Optional",
    discard: {
        message: "Du hast hier etwas eingegeben. Schließen und verwerfen?",
        keepEditing: "Weiter bearbeiten",
        confirm: "Text verwerfen",
    },
};

export default form;
