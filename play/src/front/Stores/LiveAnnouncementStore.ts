import { writable } from "svelte/store";

export interface LiveAnnouncement {
    id: number;
    text: string;
}

/**
 * Screen-reader only announcements for events that have no focused element to speak for them
 * (people joining or leaving the proximity bubble). The latest one replaces the previous one,
 * so a burst of events reads as its last state instead of a backlog.
 */
function createLiveAnnouncementStore() {
    const { subscribe, set } = writable<LiveAnnouncement | undefined>(undefined);
    let nextId = 0;

    return {
        subscribe,
        announce(text: string): void {
            nextId += 1;
            set({ id: nextId, text });
        },
    };
}

export const liveAnnouncementStore = createLiveAnnouncementStore();
