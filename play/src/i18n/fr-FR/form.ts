import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "Facultatif",
    discard: {
        message: "Vous avez saisi du texte ici. Fermer et le perdre ?",
        keepEditing: "Continuer la saisie",
        confirm: "Abandonner le texte",
    },
};

export default form;
