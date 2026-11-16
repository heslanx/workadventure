import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "새로 고침",
    reason: "지도가 업데이트되어 변경 내용을 표시하려면 이 페이지를 새로 고쳐야 합니다. 새로 고치면 진행 중인 대화나 회의가 중단되고, 보내지 않은 메시지는 사라집니다.",
    countdown: "{seconds}초 후 자동으로 새로 고칩니다.",
    notNow: "나중에",
    postponedMessage: "지도가 업데이트되었습니다. 준비되면 새로 고치세요.",
};

export default refreshPrompt;
