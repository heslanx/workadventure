import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "オプション",
    discard: {
        message: "ここに入力した内容があります。閉じて破棄しますか?",
        keepEditing: "編集を続ける",
        confirm: "テキストを破棄",
    },
};

export default form;
