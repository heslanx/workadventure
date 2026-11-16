import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "Không bắt buộc",
    discard: {
        message: "Bạn đã nhập nội dung ở đây. Đóng và bỏ nội dung đó?",
        keepEditing: "Tiếp tục chỉnh sửa",
        confirm: "Bỏ văn bản",
    },
};

export default form;
