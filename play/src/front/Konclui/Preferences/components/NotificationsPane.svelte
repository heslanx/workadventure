<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import {
        notificationsBlocked,
        notificationsSupported,
        setAskBeforeOpeningSites,
        setIgnoreFollowRequests,
        setNotification,
    } from "../stores/notificationSettings";
    import PrefSection from "./PrefSection.svelte";
    import PrefToggle from "./PrefToggle.svelte";

    const supported = notificationsSupported();
    let notify = $state(supported && localUserStore.getNotification());
    // The browser blocked the site: the switch says why it stays off, as the browser will not ask again.
    let blocked = $state(notificationsBlocked());
    let askSites = $state(localUserStore.getForceCowebsiteTrigger());
    let ignoreFollow = $state(localUserStore.getIgnoreFollowRequests());

    function changeNotification(on: boolean): void {
        notify = on;
        setNotification(on)
            .then((granted) => {
                notify = granted;
                blocked = notificationsBlocked();
            })
            .catch((error: unknown) => {
                console.error("[konclui] preferences: notifications", error);
                notify = localUserStore.getNotification();
            });
    }
</script>

<PrefSection title={$LL.konclui.preferences.notifications.alerts()}>
    <PrefToggle
        title={$LL.konclui.preferences.notifications.browser()}
        hint={$LL.konclui.preferences.notifications.browserHint()}
        checked={notify}
        onchange={changeNotification}
        unavailable={supported ? undefined : $LL.konclui.preferences.notifications.browserUnsupported()}
        error={blocked ? $LL.konclui.preferences.notifications.browserBlocked() : undefined}
    />
</PrefSection>
<PrefSection title={$LL.konclui.preferences.notifications.requests()}>
    <PrefToggle
        title={$LL.konclui.preferences.notifications.askSites()}
        hint={$LL.konclui.preferences.notifications.askSitesHint()}
        checked={askSites}
        onchange={(on) => {
            askSites = on;
            setAskBeforeOpeningSites(on);
        }}
    />
    <PrefToggle
        title={$LL.konclui.preferences.notifications.ignoreFollow()}
        hint={$LL.konclui.preferences.notifications.ignoreFollowHint()}
        checked={ignoreFollow}
        onchange={(on) => {
            ignoreFollow = on;
            setIgnoreFollowRequests(on);
        }}
    />
</PrefSection>
