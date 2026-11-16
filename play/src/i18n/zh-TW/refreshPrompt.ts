import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "重新整理",
    reason: "地圖已更新，此頁面需要重新載入才能顯示。重新載入會中斷您目前的對話或會議，且尚未傳送的訊息將會遺失。",
    countdown: "{seconds} 秒後自動重新整理。",
    notNow: "稍後再說",
    postponedMessage: "地圖已更新。準備好時請重新整理。",
};

export default refreshPrompt;
