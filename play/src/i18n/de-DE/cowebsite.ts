import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const companion: DeepPartial<Translation["cowebsite"]> = {
    open: "öffnen",
    close: "schließen",
    bigBlueButton: "BigBlueButton",
    jitsi: "Jitsi",
    resize: "Größe des Website-Bereichs ändern (Pfeiltasten zum Ändern der Größe)",
};

export default companion;
