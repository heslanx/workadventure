import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "可选",
    discard: {
        message: "你在这里输入了内容。要关闭并丢弃吗?",
        keepEditing: "继续编辑",
        confirm: "丢弃文本",
    },
};

export default form;
