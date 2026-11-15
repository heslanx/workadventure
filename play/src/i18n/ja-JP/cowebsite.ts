import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const companion: DeepPartial<Translation["cowebsite"]> = {
    open: "開く",
    close: "閉じる",
    bigBlueButton: "BigBlueButton",
    jitsi: "Jitsi",
    resize: "ウェブサイトパネルのサイズを変更(矢印キーでサイズ変更)",
};

export default companion;
