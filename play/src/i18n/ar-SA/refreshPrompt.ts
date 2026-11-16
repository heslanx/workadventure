import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "تحديث", // Refresh
    reason: "تم تحديث الخريطة، ويجب إعادة تحميل هذه الصفحة لعرضها. ستؤدي إعادة التحميل إلى مقاطعة محادثتك أو اجتماعك الحالي، وستفقد أي رسالة لم ترسلها.",
    countdown: "سيتم التحديث تلقائيًا بعد {seconds} {{ثانية|ثانية|ثانيتين|ثوانٍ|ثانية|ثانية}}.",
    notNow: "ليس الآن",
    postponedMessage: "تم تحديث الخريطة. حدّث الصفحة عندما تكون مستعدًا.",
};

export default refreshPrompt;
