import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "اختياري",
    discard: {
        message: "لقد كتبت شيئًا هنا. هل تريد الإغلاق وفقدانه؟",
        keepEditing: "مواصلة التحرير",
        confirm: "تجاهل النص",
    },
};

export default form;
