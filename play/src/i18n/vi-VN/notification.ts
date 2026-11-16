import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const notification: DeepPartial<Translation["notification"]> = {
    discussion: "{name} muốn trò chuyện với bạn",
    message: "{name} đã gửi một tin nhắn",
    mention: "{name} đã nhắc đến bạn",
    askToMuteMicrophone: "Tôi có thể tắt micrô của bạn không?",
    askToMuteCamera: "Tôi có thể tắt camera của bạn không?",
    microphoneMuted: "Micrô của bạn đã bị người điều hành tắt",
    cameraMuted: "Camera của bạn đã bị người điều hành tắt",
    microphoneMutedForEverybody: "Người điều hành đã tắt tiếng micrô của mọi người. Bạn có thể bật lại micrô của mình.",
    cameraMutedForEverybody: "Người điều hành đã tắt camera của mọi người. Bạn có thể bật lại camera của mình.",
    givenTheFloor: "Đến lượt bạn phát biểu",
    givenTheFloorEnableMicrophone: "Đến lượt bạn phát biểu — hãy bật micrô",
    floorRevoked: "Bạn không còn quyền phát biểu",
    floorGivenBack: "Bạn đã trả lại quyền phát biểu",
    handLowered: "Người điều hành đã hạ tay của bạn",
    removedFromConversation: "Một người điều hành đã cho bạn rời cuộc trò chuyện.",
    actionFailed: "Không thể hoàn tất thao tác này",
    announcement: "Thông báo chung",
    help: {
        title: "Quyền thông báo bị từ chối",
        permissionDenied: "Quyền bị từ chối",
        content:
            "Đừng bỏ lỡ cuộc trò chuyện nào. Hãy bật thông báo để biết khi có người muốn nói chuyện với bạn, kể cả khi bạn không ở trên thẻ WorkAdventure.",
        firefoxContent:
            'Vui lòng đánh dấu ô "Ghi nhớ quyết định này" nếu bạn không muốn Firefox tiếp tục hỏi quyền truy cập.',
        refresh: "Tải lại",
        continue: "Tiếp tục không cần thông báo",
        screen: {
            chrome: "/resources/help-setting-notification-permission/en-US-chrome.png",
        },
        screenAlt: "Cho phép thông báo từ thanh địa chỉ trong Chrome",
    },
    addNewTag: "thêm nhãn mới: '{tag}'",
    screenSharingError: "Không thể bắt đầu chia sẻ màn hình",
    recordingStarted: "Một người trong cuộc trò chuyện đã bắt đầu ghi hình.",
    urlCopiedToClipboard: "Đã sao chép liên kết vào bộ nhớ tạm",
    muteRequest: {
        acceptMicrophone: "Tắt tiếng micrô của tôi",
        acceptCamera: "Tắt camera của tôi",
        refuse: "Giữ bật",
    },
    copyFailed: "Không thể sao chép: trình duyệt đã chặn bộ nhớ tạm. Hãy chọn văn bản và nhấn Ctrl+C (Cmd+C trên Mac).",
    closeToast: "Đóng thông báo",
};

export default notification;
