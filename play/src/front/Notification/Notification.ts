// No `image`: that slot is the large hero picture of a notification, and a logo is not artwork for it.
export const defaultOptions = {
    icon: "/static/images/konclui/icon-192x192.png",
    badge: "/static/images/konclui/icon-192x192.png",
};

export interface NotificationWA {
    sendNotification: () => Promise<void>;
}

export const TIME_NOTIFYING_MILLISECOND = 10000;
