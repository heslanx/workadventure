import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "選填",
    discard: {
        message: "你在這裡輸入了內容。要關閉並捨棄嗎?",
        keepEditing: "繼續編輯",
        confirm: "捨棄文字",
    },
};

export default form;
