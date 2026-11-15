import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const megaphone: DeepPartial<Translation["megaphone"]> = {
    announcement: {
        title: "お知らせを送信",
        audience: "誰に送りますか？",
        thisRoom: "このルーム",
        wholeWorld: "ワールド全体",
        place: "移動先（任意）",
        noPlace: "場所なし",
        noPlaceOnMap: "このマップにはまだ名前付きエリアがありません。",
        preview: "プレビュー",
        sendToRoom: "このルームに送信",
        sendToWorld: "ワールド全体に送信",
        confirmWorld: "ワールドのすべてのルームに届きます。",
        confirmSend: "はい、ワールド全体に送信",
        cancel: "キャンセル",
        sentToRoom: "このルームにお知らせを送信しました",
        sentToWorld: "ワールド全体にお知らせを送信しました",
        join: "{place}へ移動",
        joinMap: "移動",
        placeNotFound: "この場所はマップ上にもう存在しません。",
        admin: "管理者",
        more: "待機中のお知らせ: {count}",
        sendFailed:
            "送信されませんでした: サーバーとの接続が切れています。テキストはここに残っています。再接続したらもう一度送信してください。",
        emptyMessage: "送信するにはメッセージを入力してください。",
    },
    modal: {
        liveMessage: {
            microphoneOff: "マイクオフ",
            cameraOff: "カメラオフ",
            cameraOffHint: "マイクだけでもライブ配信できます。",
            devices: "カメラとマイク",
            whoHears: "誰に聞こえますか？",
            thisRoom: "このルーム",
            wholeWorld: "ワールドのすべてのルーム",
            live: "ライブ",
            stop: "停止",
            title: "ライブメッセージ",
            enableMicrophone: "マイクをオンにする",
        },
    },
};

export default megaphone;
