import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "Liên kết truy cập không đúng",
        subTitle: "Không tìm thấy bản đồ. Vui lòng kiểm tra liên kết truy cập của bạn.",
        details:
            "Nếu cần thêm thông tin, bạn có thể liên hệ quản trị viên hoặc liên hệ chúng tôi tại: hello@workadventu.re",
    },
    connectionRejected: {
        title: "Kết nối bị từ chối",
        subTitle: "Bạn không thể vào thế giới này. Vui lòng thử lại sau {error}.",
        details:
            "Nếu cần thêm thông tin, bạn có thể liên hệ quản trị viên hoặc liên hệ chúng tôi tại: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Mất kết nối tới máy chủ. Bạn sẽ không thể nói chuyện với những người khác.",
        retrying: "Đang tự động thử lại. Thông báo này sẽ biến mất khi máy chủ phản hồi.",
    },
    errorDialog: {
        title: "Lỗi 😱",
        hasReportIssuesUrl: "Nếu cần thêm thông tin, bạn có thể liên hệ quản trị viên hoặc báo lỗi tại:",
        noReportIssuesUrl: "Nếu cần thêm thông tin, bạn có thể liên hệ quản trị viên của thế giới này.",
        messageFAQ: "Bạn cũng có thể xem:",
        reload: "Tải lại",
        close: "Đóng",
    },
    errorScreen: {
        genericTitle: "Chúng tôi không thể mở thế giới này.",
        genericNextStep: "Tải lại trang để thử lại. Nếu vẫn xảy ra, hãy liên hệ quản trị viên của bạn.",
        networkTitle: "Chúng tôi không thể kết nối tới máy chủ.",
        networkNextStep: "Kiểm tra kết nối internet của bạn, sau đó tải lại trang.",
        reload: "Tải lại trang",
        showDetails: "Hiện chi tiết",
        code: "Mã lỗi {code}",
    },
};

export default error;
