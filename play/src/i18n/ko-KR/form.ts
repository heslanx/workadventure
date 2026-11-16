import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "선택 사항",
    discard: {
        message: "여기에 입력한 내용이 있습니다. 닫고 삭제할까요?",
        keepEditing: "계속 편집",
        confirm: "텍스트 삭제",
    },
};

export default form;
