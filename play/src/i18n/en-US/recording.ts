import type { BaseTranslation } from "../i18n-types";

const recording: BaseTranslation = {
    refresh: "Refresh",
    title: "Your recording list",
    noRecordings: "No recordings yet. Start a recording from the action bar and it will appear here.",
    errorFetchingRecordings: "Your recordings did not load. They are still saved. Close this window and open it again.",
    expireIn: "Expires in {days} day{s}",
    expiresOn: "Expires on {date}",
    download: "Download",
    close: "Close",
    recordingList: "Recordings",
    viewList: "List view",
    viewCards: "Card view",
    back: "Back",
    actions: "Actions",
    contextMenu: {
        openInNewTab: "Open in new tab",
        delete: "Delete",
    },
    notification: {
        deleteNotification: "Recording deleted successfully",
        deleteFailedNotification: "Failed to delete recording",
        startFailedNotification: "The recording did not start. Nothing was recorded. Try again.",
        stopFailedNotification: "The recording may still be running. Try stopping it again.",
        recordingStarted: "{name} has started a recording.",
        downloadFailedNotification: "The download did not start. The recording is still saved. Try again.",
        recordingComplete: "Recording complete",
        recordingIsInProgress: "Recording is in progress",
        unexpectedlyStoppedNotification: "Recording stopped unexpectedly",
        recordingSaved: "Your recording has been saved successfully.",
        howToAccess: "To access your recordings:",
        viewRecordings: "View Recordings",
    },
    actionbar: {
        title: {
            start: "Start recording",
            stop: "Stop recording",
            inProgress: "A recording is in progress",
        },
        desc: {
            needLogin: "You need to be logged in to record.",
            advert: "All participants will be notified that you are starting a recording.",
            yourRecordInProgress: "Recording in progress, click to stop it.",
            inProgress: "A recording is in progress",
        },
        spacePicker: {
            megaphone: "Record megaphone",
            discussion: "Record discussion",
            recordedByOther: "Only one recording at a time here. You can start yours when this one ends.",
        },
    },
};

export default recording;
