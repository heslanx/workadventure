import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "リンクが正しくありません",
        subTitle: "マップが見つかりませんでした。リンクを確認してください。",
        details: "詳しくは管理者にお問い合わせください。",
    },
    connectionRejected: {
        title: "接続が拒否されました",
        subTitle: "ワールドに参加できませんでした。後でもう一度試してみてください。{error}",
        details: "詳しくは管理者にお問い合わせください。",
    },
    connectionRetry: {
        unableConnect: "サーバーとの接続が切れました。ほかの人と話せません。",
        retrying: "自動的に再試行しています。サーバーが応答すると、このメッセージは消えます。",
    },
    errorDialog: {
        title: "エラー 😱",
        hasReportIssuesUrl: "より詳細な情報が必要な場合は、管理者に連絡するか、下記まで問題を報告してください。",
        noReportIssuesUrl: "より詳細な情報が必要な場合は、ワールドの管理者に連絡してください。",
        messageFAQ: "私たちのサイトもご覧ください。",
        reload: "更新",
        close: "閉じる",
    },
    errorScreen: {
        genericTitle: "このワールドを開けませんでした。",
        genericNextStep: "ページを再読み込みしてもう一度お試しください。問題が続く場合は管理者に連絡してください。",
        networkTitle: "サーバーに接続できませんでした。",
        networkNextStep: "インターネット接続を確認してから、ページを再読み込みしてください。",
        reload: "ページを再読み込み",
        showDetails: "詳細を表示",
        code: "エラーコード {code}",
    },
};

export default error;
