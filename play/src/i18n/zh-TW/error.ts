import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "存取連結錯誤",
        subTitle: "找不到地圖。請檢查你的存取連結。",
        details: "如果你想了解更多資訊，可以聯絡管理員或聯絡我們：hello@workadventu.re",
    },
    connectionRejected: {
        title: "連線被拒絕",
        subTitle: "你無法加入該世界。請稍後重試 {error}。",
        details: "如果你想了解更多資訊，可以聯絡管理員或聯絡我們：hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "與伺服器的連線已中斷。你將無法與其他人交談。",
        retrying: "正在自動重試。伺服器回應後,此訊息將會消失。",
    },
    errorDialog: {
        title: "錯誤 😱",
        hasReportIssuesUrl: "如果你想了解更多資訊，可以聯絡管理員或於以下網址回報問題：",
        noReportIssuesUrl: "如果你想了解更多資訊，可以聯絡世界管理員。",
        messageFAQ: "你也可以查看我們的：",
        reload: "重新載入",
        close: "關閉",
    },
    errorScreen: {
        genericTitle: "我們無法開啟此世界。",
        genericNextStep: "請重新載入頁面再試一次。如果問題持續發生,請聯絡你的管理員。",
        networkTitle: "我們無法連線到伺服器。",
        networkNextStep: "請檢查你的網路連線,然後重新載入頁面。",
        reload: "重新載入頁面",
        showDetails: "顯示詳細資料",
        code: "錯誤代碼 {code}",
    },
};

export default error;
