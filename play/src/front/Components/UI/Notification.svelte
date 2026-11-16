<script lang="ts">
    import { fly } from "../../Utils/reducedMotion";
    import type { Notification } from "../../Stores/NotificationStore";
    import { notificationPlayingStore } from "../../Stores/NotificationStore";
    import microphoneOffImg from "../images/mic.svg";
    import cameraOffImg from "../images/cam.svg";
    import jistiImg from "../images/jitsi.png";
    import waImg from "../images/icon-workadventure-white.png";
    import AreaToolImg from "../images/icon-tool-area.png";
    import { autoDismiss } from "../Toasts/autoDismiss";
    import LL from "../../../i18n/i18n-svelte";
    import megaphoneImg from "./images/megaphone.svg";
    import recordingStopImg from "./images/recording-stop.svg";
    import recordingStartImg from "./images/recording-start.svg";
    import { IconX } from "@wa-icons";

    const icons = new Map<string, string>([
        ["microphone-off.png", microphoneOffImg],
        ["camera-off.png", cameraOffImg],
        ["jitsi.png", jistiImg],
        ["icon-tool-area.png", AreaToolImg],
        ["megaphone", megaphoneImg],
        ["recording-stop", recordingStopImg],
        ["recording-start", recordingStartImg],
    ]);

    interface Props {
        notification: Notification;
    }

    let { notification }: Props = $props();

    // Removed after 5 seconds, except while the pointer is over it or the focus is inside it. The live region that
    // makes a screen reader speak it is the container in MainLayout, which exists before the first notification.
    const NOTIFICATION_DURATION_MS = 5000;

    function dismiss(): void {
        notificationPlayingStore.removeNotification(notification);
    }
</script>

<div
    class="notification-playing bg-contrast/80 p-1 backdrop-blur rounded-lg mr-3 pointer-events-auto"
    transition:fly={{ x: 210, duration: 500 }}
    {@attach autoDismiss(NOTIFICATION_DURATION_MS, dismiss)}
>
    <img
        src={notification.icon ? (icons.get(notification.icon) ?? notification.icon) : waImg}
        alt=""
        class="bg-white/10 rounded-md h-12"
        draggable="false"
    />
    <p>{notification.text}</p>
    <button
        type="button"
        class="shrink-0 flex items-center justify-center w-8 h-8 p-0 m-0 me-1 self-start rounded cursor-pointer text-white/80 bg-transparent border-0 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        aria-label={$LL.notification.closeToast()}
        title={$LL.notification.closeToast()}
        onclick={dismiss}
    >
        <IconX font-size="1.125rem" aria-hidden="true" />
    </button>
</div>

<style>
    .notification-playing {
        top: 40px;
        transition: all 0.1s ease-out;
        display: inline-flex;
        align-items: center;
        z-index: 750;

        img {
            padding: 5px;
        }

        p {
            color: white;
            margin-left: 10px;
            margin-top: 14px;
            margin-right: 10px;
        }
    }
</style>
