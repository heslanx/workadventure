import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const form: DeepPartial<Translation["form"]> = {
    optional: "ไม่บังคับ",
    discard: {
        message: "คุณพิมพ์บางอย่างไว้ที่นี่ ปิดและทิ้งข้อความหรือไม่",
        keepEditing: "แก้ไขต่อ",
        confirm: "ทิ้งข้อความ",
    },
};

export default form;
