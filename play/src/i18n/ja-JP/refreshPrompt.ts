import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "更新",
    reason: "マップが更新されたため、反映するにはこのページを再読み込みする必要があります。再読み込みすると、現在の会話やミーティングが中断され、未送信のメッセージは破棄されます。",
    countdown: "{seconds} 秒後に自動で更新します。",
    notNow: "今はしない",
    postponedMessage: "マップが更新されました。準備ができたら更新してください。",
};

export default refreshPrompt;
