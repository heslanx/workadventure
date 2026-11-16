import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "Cài đặt camera",
    editSpeaker: "Cài đặt đầu ra âm thanh",
    active: "Đang hoạt động",
    disabled: "Đã tắt",
    notRecommended: "Không khuyến nghị",
    enable: {
        title: "Bật camera và micrô của bạn",
        join: "Vào phòng",
        start: "Chào mừng bạn đến trang cấu hình thiết bị âm thanh và hình ảnh! Tại đây bạn sẽ tìm thấy các công cụ giúp cải thiện trải nghiệm trực tuyến. Hãy điều chỉnh cài đặt theo ý muốn để khắc phục các sự cố có thể gặp. Đảm bảo thiết bị của bạn được kết nối đúng cách và đã cập nhật. Hãy khám phá và thử các cấu hình khác nhau để tìm ra lựa chọn phù hợp nhất với bạn.",
    },
    help: {
        title: "Cần quyền truy cập camera / micrô",
        cameraTitle: "Cần quyền truy cập camera",
        microphoneTitle: "Cần quyền truy cập micrô",
        cameraPermissionDenied: "Quyền truy cập camera bị từ chối",
        microphonePermissionDenied: "Quyền truy cập micrô bị từ chối",
        cameraMicrophonePermissionDenied: "Quyền truy cập camera và micrô bị từ chối",
        content: "Bạn phải cho phép truy cập camera và micrô trong trình duyệt của mình.",
        cameraContent: "Bạn phải cho phép truy cập camera trong trình duyệt của mình.",
        microphoneContent: "Bạn phải cho phép truy cập micrô trong trình duyệt của mình.",
        firefoxContent:
            'Vui lòng đánh dấu ô "Ghi nhớ quyết định này" nếu bạn không muốn Firefox tiếp tục hỏi quyền truy cập.',
        allow: "Cho phép webcam",
        allowMicrophone: "Cho phép micrô",
        allowCameraMicrophone: "Cho phép webcam và micrô",
        continue: "Tiếp tục không cần webcam",
        continueWithoutMicrophone: "Tiếp tục không cần micrô",
        continueCameraMicrophone: "Tiếp tục không cần webcam và micrô",
        showSteps: "Xem cách làm",
        hideSteps: "Ẩn các bước",
        steps: {
            chrome: "Bấm vào biểu tượng ổ khóa ở bên trái thanh địa chỉ, đặt Camera hoặc Micrô thành Cho phép, rồi tải lại trang.",
            firefox:
                "Bấm vào biểu tượng quyền ở bên trái thanh địa chỉ, xóa mục Camera hoặc Micrô đang bị chặn, rồi tải lại trang và cho phép truy cập khi được hỏi.",
            safari: "Mở menu Safari, chọn Cài đặt cho trang web này, đặt Camera hoặc Micrô thành Cho phép, rồi tải lại trang.",
            android:
                "Chạm vào biểu tượng ổ khóa ở bên trái thanh địa chỉ, mở Quyền, đặt Camera hoặc Micrô thành Cho phép, rồi tải lại trang.",
            other: "Mở cài đặt trang web của trình duyệt cho trang này, đặt Camera hoặc Micrô thành Cho phép, rồi tải lại trang.",
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
        },
        tooltip: {
            permissionDeniedTitle: "Truy cập camera bị chặn",
            permissionDeniedDesc:
                "Trình duyệt của bạn đã từ chối quyền truy cập camera cho trang này. Hãy cho phép từ thanh địa chỉ (biểu tượng ổ khóa hoặc camera) hoặc trong cài đặt trang web. Hình minh họa bên dưới tương ứng với trình duyệt của bạn.",
            permissionDeniedFix:
                "Trình duyệt của bạn đã từ chối quyền truy cập camera cho trang này. Hãy cho phép từ thanh địa chỉ (biểu tượng ổ khóa hoặc camera) hoặc trong cài đặt trang web, rồi tải lại trang. Chọn nút này để xem các bước.",
            noDeviceTitle: "Không có camera khả dụng",
            noDeviceDesc:
                "Trình duyệt của bạn không tìm thấy camera nào có thể dùng. Hãy thử trình duyệt khác, kiểm tra camera đã được kết nối chưa, kiểm tra cài đặt máy tính (quyền riêng tư, thiết bị), hoặc khởi động lại máy nếu thiết bị lẽ ra phải hoạt động.",
            deviceInUseTitle: "Camera đang được sử dụng",
            deviceInUseDesc: "Một ứng dụng khác đang sử dụng camera của bạn. Hãy đóng ứng dụng đó rồi thử lại.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "Truy cập micrô bị chặn",
            permissionDeniedDesc:
                "Trình duyệt của bạn đã từ chối quyền truy cập micrô cho trang này. Hãy cho phép từ thanh địa chỉ (biểu tượng ổ khóa hoặc micrô) hoặc trong cài đặt trang web. Hình minh họa bên dưới tương ứng với trình duyệt của bạn.",
            permissionDeniedFix:
                "Trình duyệt của bạn đã từ chối quyền truy cập micrô cho trang này. Hãy cho phép từ thanh địa chỉ (biểu tượng ổ khóa hoặc micrô) hoặc trong cài đặt trang web, rồi tải lại trang. Chọn nút này để xem các bước.",
            noDeviceTitle: "Không có micrô khả dụng",
            noDeviceDesc:
                "Trình duyệt của bạn không tìm thấy micrô nào có thể dùng. Hãy thử trình duyệt khác, kiểm tra micrô đã được kết nối chưa, kiểm tra cài đặt máy tính (quyền riêng tư, thiết bị), hoặc khởi động lại máy nếu thiết bị lẽ ra phải hoạt động.",
            deviceInUseTitle: "Micrô đang được sử dụng",
            deviceInUseDesc: "Một ứng dụng khác đang sử dụng micrô của bạn. Hãy đóng ứng dụng đó rồi thử lại.",
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
        title: "Lỗi kết nối máy chủ chuyển tiếp video",
        titlePending: "Đang chờ kết nối máy chủ chuyển tiếp video",
        error: "Không thể kết nối tới máy chủ TURN",
        content:
            "Không thể kết nối tới máy chủ chuyển tiếp video. Bạn có thể sẽ không liên lạc được với những người khác.",
        solutionVpn: "Nếu bạn <strong>đang kết nối qua VPN</strong>, vui lòng ngắt kết nối VPN và tải lại trang.",
        solutionVpnNotAskAgain: "Đã hiểu. Đừng cảnh báo tôi nữa 🫡",
        solutionHotspot:
            "Nếu bạn đang dùng mạng bị hạn chế (mạng công ty...), hãy thử đổi mạng khác. Ví dụ: tạo <strong>điểm phát Wi-Fi</strong> bằng điện thoại rồi kết nối qua điện thoại.",
        solutionNetworkAdmin: "Nếu bạn là <strong>quản trị viên mạng</strong>, hãy xem ",
        preparingYouNetworkGuide: 'hướng dẫn "Chuẩn bị mạng của bạn"',
        refresh: "Tải lại",
        continue: "Tiếp tục",
        newDeviceDetected: "Phát hiện thiết bị mới {device} 🎉 Chuyển sang? [PHÍM CÁCH] Bỏ qua [ESC]",
        newDeviceSwitch: "Chuyển",
        newDeviceIgnore: "Bỏ qua",
        newDeviceAnnouncement:
            "Phát hiện thiết bị mới: {device}. Nhấn phím Cách để chuyển sang thiết bị đó, hoặc Esc để bỏ qua.",
    },
    my: {
        silentZone: "Khu vực yên lặng",
        silentZoneDesc:
            "Bạn đang ở trong khu vực yên lặng. Không ai có thể nói chuyện với bạn ở đây, và micrô cùng camera của bạn đã bị tắt.",
        nameTag: "Bạn",
        loading: "Đang tải camera của bạn...",
    },
    disable: "Tắt camera của bạn",
    menu: {
        moreAction: "Thao tác khác",
        closeMenu: "Đóng menu",
        senPrivateMessage: "Gửi tin nhắn riêng (sắp ra mắt)",
        giveFloor: "Trao quyền phát biểu",
        revokeFloor: "Thu hồi quyền phát biểu",
        muteAudioUser: "Tắt tiếng",
        askToMuteAudioUser: "Yêu cầu tắt tiếng",
        muteAudioEveryBody: "Tắt tiếng tất cả mọi người",
        muteVideoUser: "Tắt video",
        askToMuteVideoUser: "Yêu cầu tắt video",
        muteVideoEveryBody: "Tắt video của tất cả mọi người",
        blockOrReportUser: "Kiểm duyệt",
        mutedAudioNotice: "Micrô của {name} đang tắt tiếng. Chỉ người đó mới có thể bật lại.",
        askedMuteAudioNotice: "Đã yêu cầu {name} tắt tiếng micrô.",
        mutedVideoNotice: "Camera của {name} đang tắt. Chỉ người đó mới có thể bật lại.",
        askedMuteVideoNotice: "Đã yêu cầu {name} tắt camera.",
        confirmMuteAudioEveryBodyTitle: "Tắt tiếng micrô của tất cả mọi người?",
        confirmMuteAudioEveryBodyMessage:
            "Thao tác này sẽ tắt tiếng mọi người trong cuộc trò chuyện này. Chỉ mỗi người mới có thể tự bật lại micrô của mình.",
        confirmMuteAudioEveryBodyMessageCount:
            "Thao tác này sẽ tắt tiếng {count} người trong cuộc trò chuyện này. Chỉ mỗi người mới có thể tự bật lại micrô của mình.",
        confirmMuteAudioEveryBodyAction: "Tắt tiếng tất cả",
        mutedAudioEveryBodyNotice: "Micrô của mọi người đang tắt tiếng. Chỉ mỗi người mới có thể tự bật lại.",
        mutedAudioEveryBodyNoticeCount: "Đã tắt tiếng micrô của {count} người. Chỉ mỗi người mới có thể tự bật lại.",
        confirmMuteVideoEveryBodyTitle: "Tắt camera của tất cả mọi người?",
        confirmMuteVideoEveryBodyMessage:
            "Thao tác này sẽ tắt camera của mọi người trong cuộc trò chuyện này. Chỉ mỗi người mới có thể tự bật lại camera của mình.",
        confirmMuteVideoEveryBodyMessageCount:
            "Thao tác này sẽ tắt camera của {count} người trong cuộc trò chuyện này. Chỉ mỗi người mới có thể tự bật lại camera của mình.",
        confirmMuteVideoEveryBodyAction: "Tắt camera",
        mutedVideoEveryBodyNotice: "Camera của mọi người đang tắt. Chỉ mỗi người mới có thể tự bật lại.",
        mutedVideoEveryBodyNoticeCount: "Đã tắt camera của {count} người. Chỉ mỗi người mới có thể tự bật lại.",
        alreadyMuted: "Đã tắt tiếng",
        videoAlreadyOff: "Video đã tắt",
    },
    startError: {
        camera: "Camera của bạn không khởi động được. Người khác không thể nhìn thấy bạn. Hãy đóng các ứng dụng khác đang dùng camera và thử lại.",
        microphone:
            "Micrô của bạn không khởi động được. Người khác không thể nghe thấy bạn. Hãy đóng các ứng dụng khác đang dùng micrô và thử lại.",
    },
};

export default camera;
