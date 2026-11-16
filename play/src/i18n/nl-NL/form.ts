import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "Optioneel",
    discard: {
        message: "Je hebt hier iets getypt. Sluiten en kwijtraken?",
        keepEditing: "Verder bewerken",
        confirm: "Tekst weggooien",
    },
};

export default form;
