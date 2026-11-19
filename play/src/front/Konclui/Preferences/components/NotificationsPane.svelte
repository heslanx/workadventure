<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import {
        askBeforeOpeningSites,
        changeNotification,
        ignoreFollowRequests,
        notificationState,
        notificationsSupported,
    } from "../stores/notificationSettings";
    import PrefSection from "./PrefSection.svelte";
    import PrefToggle from "./PrefToggle.svelte";

    const supported = notificationsSupported();
</script>

<PrefSection title={$LL.konclui.preferences.notifications.alerts()}>
    <PrefToggle
        title={$LL.konclui.preferences.notifications.browser()}
        hint={$LL.konclui.preferences.notifications.browserHint()}
        checked={$notificationState.on}
        onchange={changeNotification}
        unavailable={supported ? undefined : $LL.konclui.preferences.notifications.browserUnsupported()}
        error={$notificationState.blocked ? $LL.konclui.preferences.notifications.browserBlocked() : undefined}
    />
</PrefSection>
<PrefSection title={$LL.konclui.preferences.notifications.requests()}>
    <PrefToggle
        title={$LL.konclui.preferences.notifications.askSites()}
        hint={$LL.konclui.preferences.notifications.askSitesHint()}
        checked={$askBeforeOpeningSites}
        onchange={(on) => askBeforeOpeningSites.set(on)}
    />
    <PrefToggle
        title={$LL.konclui.preferences.notifications.ignoreFollow()}
        hint={$LL.konclui.preferences.notifications.ignoreFollowHint()}
        checked={$ignoreFollowRequests}
        onchange={(on) => ignoreFollowRequests.set(on)}
    />
</PrefSection>
