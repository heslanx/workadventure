import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "잘못된 접근 링크",
        subTitle: "지도를 찾을 수 없습니다. 접근 링크를 확인하세요.",
        details: "자세한 정보가 필요하면 관리자에게 문의하거나 hello@workadventu.re로 연락하세요",
    },
    connectionRejected: {
        title: "연결이 거부됨",
        subTitle: "월드에 참여할 수 없습니다. 나중에 다시 시도하세요 {error}.",
        details: "자세한 정보가 필요하면 관리자에게 문의하거나 hello@workadventu.re로 연락하세요",
    },
    connectionRetry: {
        unableConnect: "서버 연결이 끊어졌습니다. 다른 사람들과 말할 수 없습니다.",
        retrying: "자동으로 다시 시도하는 중입니다. 서버가 응답하면 이 메시지는 사라집니다.",
    },
    errorDialog: {
        title: "오류 😱",
        hasReportIssuesUrl: "자세한 정보가 필요하면 관리자에게 문의하거나 다음에서 문제를 보고하세요:",
        noReportIssuesUrl: "자세한 정보가 필요하면 월드 관리자에게 문의하세요.",
        messageFAQ: "다음도 확인할 수 있습니다:",
        reload: "새로 고침",
        close: "닫기",
    },
    errorScreen: {
        genericTitle: "이 월드를 열 수 없습니다.",
        genericNextStep: "페이지를 새로 고쳐 다시 시도하세요. 문제가 계속되면 관리자에게 문의하세요.",
        networkTitle: "서버에 연결할 수 없습니다.",
        networkNextStep: "인터넷 연결을 확인한 다음 페이지를 새로 고치세요.",
        reload: "페이지 새로 고침",
        showDetails: "세부 정보 보기",
        code: "오류 코드 {code}",
    },
};

export default error;
