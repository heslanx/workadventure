import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const companion: DeepPartial<Translation["cowebsite"]> = {
    open: "Open",
    close: "Close",
    resize: "Resize the website panel (arrow keys to resize)",
    bigBlueButton: "BigBlueButton",
    jitsi: "Jitsi",
};

export default companion;
