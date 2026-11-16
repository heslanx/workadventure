import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "访问链接错误",
        subTitle: "找不到地图。请检查你的访问链接。",
        details: "如果你想了解更多信息，你可以联系管理员或联系我们: hello@workadventu.re",
    },
    connectionRejected: {
        title: "连接被拒绝",
        subTitle: "你无法加入该世界。请稍后重试 {error}.",
        details: "如果你想了解更多信息，你可以联系管理员或联系我们: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "与服务器的连接已中断。你将无法与其他人交谈。",
        retrying: "正在自动重试。服务器响应后,此消息将消失。",
    },
    errorDialog: {
        title: "错误 😱",
        hasReportIssuesUrl: "如果你想了解更多信息，你可以联系管理员或在以下网址报告问题:",
        noReportIssuesUrl: "如果你想了解更多信息，你可以联系世界管理员。",
        messageFAQ: "你也可以查看我们的:",
        reload: "重新加载",
        close: "关闭",
    },
    errorScreen: {
        genericTitle: "我们无法打开此世界。",
        genericNextStep: "请重新加载页面再试。如果问题持续出现,请联系你的管理员。",
        networkTitle: "我们无法连接到服务器。",
        networkNextStep: "请检查你的网络连接,然后重新加载页面。",
        reload: "重新加载页面",
        showDetails: "显示详情",
        code: "错误代码 {code}",
    },
};

export default error;
