import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "刷新",
    reason: "地图已更新，需要重新加载此页面才能显示。重新加载会中断你当前的对话或会议，并丢弃尚未发送的消息。",
    countdown: "{seconds} 秒后自动刷新。",
    notNow: "暂不",
    postponedMessage: "地图已更新。准备好后请刷新。",
};

export default refreshPrompt;
