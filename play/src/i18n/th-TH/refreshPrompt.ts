import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "รีเฟรช",
    reason: "แผนที่ได้รับการอัปเดต หน้านี้ต้องโหลดใหม่เพื่อแสดงผล การโหลดใหม่จะขัดจังหวะการสนทนาหรือการประชุมปัจจุบันของคุณ และข้อความที่ยังไม่ได้ส่งจะหายไป",
    countdown: "จะรีเฟรชอัตโนมัติใน {seconds} วินาที",
    notNow: "ไม่ใช่ตอนนี้",
    postponedMessage: "แผนที่ได้รับการอัปเดต รีเฟรชได้เมื่อคุณพร้อม",
};

export default refreshPrompt;
