import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Tải lại",
    reason: "Bản đồ đã được cập nhật và trang này cần tải lại để hiển thị. Việc tải lại sẽ làm gián đoạn cuộc trò chuyện hoặc cuộc họp hiện tại và xóa mọi tin nhắn bạn chưa gửi.",
    countdown: "Tự động tải lại sau {seconds} giây.",
    notNow: "Để sau",
    postponedMessage: "Bản đồ đã được cập nhật. Hãy tải lại khi bạn sẵn sàng.",
};

export default refreshPrompt;
