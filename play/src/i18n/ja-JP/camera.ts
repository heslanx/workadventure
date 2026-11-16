import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "カメラを編集",
    editSpeaker: "オーディオ出力を編集",
    active: "アクティブ",
    disabled: "無効",
    notRecommended: "推奨されません",
    enable: {
        title: "カメラとマイクを有効にしてください",
        join: "ルームに参加",
        start: "オーディオおよびビデオデバイスの設定ページへようこそ！オンライン体験を向上させるためのツールをここで見つけることができます。潜在的な問題を解決するために、設定を好みに合わせて調整してください。ハードウェアが正しく接続され、最新の状態であることを確認してください。最適な構成を見つけるために、さまざまな構成を探索してテストしてください。",
    },
    help: {
        title: "カメラとマイクへのアクセスが必要です",
        cameraTitle: "カメラへのアクセスが必要です",
        microphoneTitle: "マイクへのアクセスが必要です",
        cameraPermissionDenied: "カメラの権限が拒否されました",
        microphonePermissionDenied: "マイクの権限が拒否されました",
        cameraMicrophonePermissionDenied: "カメラとマイクの権限が拒否されました",
        content: "ブラウザからカメラとマイクへのアクセスを許可する必要があります。",
        cameraContent: "ブラウザからカメラへのアクセスを許可する必要があります。",
        microphoneContent: "ブラウザからマイクへのアクセスを許可する必要があります。",
        firefoxContent:
            "今後 Firefox からの問い合わせを受けたくない場合は「今後も同様に処理する」にチェックを付けてください。",
        allow: "ウェブカメラを許可",
        allowMicrophone: "マイクを許可",
        allowCameraMicrophone: "ウェブカメラとマイクを許可",
        continue: "カメラなしで続ける",
        continueWithoutMicrophone: "マイクなしで続ける",
        continueCameraMicrophone: "ウェブカメラとマイクなしで続ける",
        showSteps: "手順を表示",
        hideSteps: "手順を非表示",
        steps: {
            chrome: "アドレスバー左側の鍵アイコンをクリックし、カメラまたはマイクを「許可」に設定してから、ページを更新してください。",
            firefox:
                "アドレスバー左側の権限アイコンをクリックし、ブロックされているカメラまたはマイクの項目を削除してからページを更新し、確認が表示されたらアクセスを許可してください。",
            safari: "Safari のメニューから「このWebサイトの設定」を選び、カメラまたはマイクを「許可」に設定してから、ページを更新してください。",
            android:
                "アドレスバー左側の鍵アイコンをタップし、「権限」を開いて、カメラまたはマイクを「許可」に設定してから、ページを更新してください。",
            other: "ブラウザでこのページのサイト設定を開き、カメラまたはマイクを「許可」に設定してから、ページを更新してください。",
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
        },
        tooltip: {
            permissionDeniedTitle: "カメラへのアクセスがブロックされています",
            permissionDeniedDesc:
                "ブラウザがこのサイトのカメラへのアクセスを拒否しました。アドレスバー（鍵またはカメラアイコン）またはサイトの設定から許可してください。下の図はお使いのブラウザに対応しています。",
            permissionDeniedFix:
                "ブラウザがこのサイトのカメラへのアクセスを拒否しました。アドレスバー（鍵またはカメラアイコン）またはサイトの設定から許可し、ページを更新してください。手順はこのボタンを選択すると表示されます。",
            noDeviceTitle: "使用できるカメラがありません",
            noDeviceDesc:
                "ブラウザが使用できるカメラを検出できません。別のブラウザを試すか、カメラの接続を確認するか、パソコンの設定（プライバシー、デバイス）を確認するか、ハードウェアに問題がなければパソコンを再起動してください。",
            deviceInUseTitle: "カメラは使用中です",
            deviceInUseDesc:
                "別のアプリケーションがカメラを使用しています。そのアプリケーションを閉じてから、もう一度お試しください。",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "マイクへのアクセスがブロックされています",
            permissionDeniedDesc:
                "ブラウザがこのサイトのマイクへのアクセスを拒否しました。アドレスバー（鍵またはマイクアイコン）またはサイトの設定から許可してください。下の図はお使いのブラウザに対応しています。",
            permissionDeniedFix:
                "ブラウザがこのサイトのマイクへのアクセスを拒否しました。アドレスバー（鍵またはマイクアイコン）またはサイトの設定から許可し、ページを更新してください。手順はこのボタンを選択すると表示されます。",
            noDeviceTitle: "使用できるマイクがありません",
            noDeviceDesc:
                "ブラウザが使用できるマイクを検出できません。別のブラウザを試すか、マイクの接続を確認するか、パソコンの設定（プライバシー、デバイス）を確認するか、ハードウェアに問題がなければパソコンを再起動してください。",
            deviceInUseTitle: "マイクは使用中です",
            deviceInUseDesc:
                "別のアプリケーションがマイクを使用しています。そのアプリケーションを閉じてから、もう一度お試しください。",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
    },
    webrtc: {
        title: "ビデオ中継サーバー接続エラー",
        titlePending: "ビデオ中継サーバー接続保留",
        error: "TURN サーバーにアクセスできません",
        content: "ビデオ中継サーバーにアクセスできません。他のユーザーと通信できない可能性があります。",
        solutionVpn: "<strong>VPN 経由で接続している</strong>場合は、VPN を切断してページを更新してください。",
        solutionVpnNotAskAgain: "わかりました。もう警告しないでください 🫡",
        solutionHotspot:
            "企業ネットワークなど制限されたネットワークを使用している場合は、ネットワークを切り替えてみてください。例えば、携帯電話で Wi-Fi ホットスポットを作成して、携帯電話経由で接続してください。",
        solutionNetworkAdmin:
            "あなたが<strong>ネットワーク管理者</strong>であれば、「ネットワーク準備」ガイドを確認してください。",
        preparingYouNetworkGuide: '"ネットワーク準備"ガイド',
        refresh: "更新",
        continue: "続ける",
        newDeviceDetected: "新しいデバイスが検出されました {device} 🎉 切り替えますか？ [スペース] 無視 [Esc]",
        newDeviceSwitch: "切り替える",
        newDeviceIgnore: "無視",
        newDeviceAnnouncement:
            "新しいデバイスが検出されました: {device}。スペースキーで切り替え、Escape キーで無視します。",
    },
    my: {
        silentZone: "サイレントゾーン",
        silentZoneDesc:
            "あなたはサイレントゾーンにいます。ここでは誰もあなたと話すことができず、マイクとカメラはオフになっています。",
        nameTag: "あなた",
        loading: "カメラを読み込んでいます...",
    },
    disable: "カメラをオフにする",
    menu: {
        moreAction: "その他のアクション",
        closeMenu: "メニューを閉じる",
        senPrivateMessage: "プライベートメッセージを送る (近日公開)",
        giveFloor: "発言を許可する",
        revokeFloor: "発言を取り消す",
        muteAudioUser: "音声をミュート",
        askToMuteAudioUser: "音声をミュートするよう依頼",
        muteAudioEveryBody: "全員の音声をミュート",
        muteVideoUser: "ビデオをミュート",
        askToMuteVideoUser: "ビデオをミュートするよう依頼",
        muteVideoEveryBody: "全員のビデオをミュート",
        blockOrReportUser: "ユーザーをブロックまたは報告",
        mutedAudioNotice: "{name}さんのマイクはミュートされています。再びオンにできるのは本人だけです。",
        askedMuteAudioNotice: "{name}さんにマイクのミュートを依頼しました。",
        mutedVideoNotice: "{name}さんのカメラはオフです。再びオンにできるのは本人だけです。",
        askedMuteVideoNotice: "{name}さんにカメラをオフにするよう依頼しました。",
        confirmMuteAudioEveryBodyTitle: "全員のマイクをミュートしますか？",
        confirmMuteAudioEveryBodyMessage: "この会話の全員をミュートします。マイクを再びオンにできるのは本人だけです。",
        confirmMuteAudioEveryBodyMessageCount:
            "この会話の {count} 人をミュートします。マイクを再びオンにできるのは本人だけです。",
        confirmMuteAudioEveryBodyAction: "全員をミュート",
        mutedAudioEveryBodyNotice: "全員のマイクをミュートしました。再びオンにできるのは本人だけです。",
        mutedAudioEveryBodyNoticeCount: "{count} 人のマイクをミュートしました。再びオンにできるのは本人だけです。",
        confirmMuteVideoEveryBodyTitle: "全員のカメラをオフにしますか？",
        confirmMuteVideoEveryBodyMessage:
            "この会話の全員のカメラをオフにします。カメラを再びオンにできるのは本人だけです。",
        confirmMuteVideoEveryBodyMessageCount:
            "この会話の {count} 人のカメラをオフにします。カメラを再びオンにできるのは本人だけです。",
        confirmMuteVideoEveryBodyAction: "カメラをオフにする",
        mutedVideoEveryBodyNotice: "全員のカメラをオフにしました。再びオンにできるのは本人だけです。",
        mutedVideoEveryBodyNoticeCount: "{count} 人のカメラをオフにしました。再びオンにできるのは本人だけです。",
        alreadyMuted: "ミュート済み",
        videoAlreadyOff: "ビデオはすでにオフです",
    },
    startError: {
        camera: "カメラを起動できませんでした。他の人からあなたが見えません。カメラを使用している他のアプリを閉じて、もう一度お試しください。",
        microphone:
            "マイクを起動できませんでした。他の人にあなたの声が聞こえません。マイクを使用している他のアプリを閉じて、もう一度お試しください。",
    },
};

export default camera;
