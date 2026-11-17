<script lang="ts">
    import { onMount } from "svelte";
    import type { DesktopWindowMode, DesktopWindowModeState } from "@workadventure/desktop-api";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { desktopDownloadUrl, desktopVersionStatus } from "../../../../common/DesktopVersionPolicy";
    import { DESKTOP_VERSION_POLICY } from "../../../Enum/EnvironmentVariable";
    import PrefChoice from "./PrefChoice.svelte";
    import PrefRow from "./PrefRow.svelte";
    import PrefSection from "./PrefSection.svelte";
    import PrefToggle from "./PrefToggle.svelte";

    // The desktop app's settings, as upstream's settings show them (DesktopApplicationSettings.svelte): shown inside
    // the desktop app, and in a browser only when the organization offers its approved download.

    const desktop = window.WAD?.desktop ? window.WAD : undefined;
    // Desktop apps with a settings window of their own keep these settings there.
    const openDesktopSettings = desktop?.openSettings;
    const policy = DESKTOP_VERSION_POLICY;
    const downloadUrl = desktopDownloadUrl(policy);

    let t = $derived($LL.konclui.preferences.desktop);
    let installed: string | undefined = $state();
    let status = $derived(desktopVersionStatus(installed, policy));
    // Undefined until the app answers; older apps have no start at login, so no switch.
    let startAtLogin: boolean | undefined = $state();
    // Linux under Wayland only: undefined elsewhere, on older apps, and until the app answers.
    let windowMode: DesktopWindowModeState | undefined = $state();
    // The change the app refused last, shown on its own row until the next try.
    let failure: "windowMode" | "startAtLogin" | undefined = $state();

    onMount(() => {
        let active = true;
        if (desktop) {
            desktop
                .getVersion()
                .then((version) => {
                    if (active) installed = version;
                })
                .catch((error: unknown) => console.warn("[konclui] preferences: desktop version", error));
            if (!openDesktopSettings) {
                desktop.startAtLogin
                    ?.get()
                    .then((enabled) => {
                        if (active) startAtLogin = enabled;
                    })
                    .catch((error: unknown) => console.warn("[konclui] preferences: start at login", error));
                desktop.windowMode
                    ?.get()
                    .then((state) => {
                        if (active) windowMode = state;
                    })
                    .catch((error: unknown) => console.warn("[konclui] preferences: window mode", error));
            }
        }
        return () => {
            active = false;
        };
    });

    function changeStartAtLogin(enabled: boolean): void {
        startAtLogin = enabled;
        failure = undefined;
        desktop?.startAtLogin
            ?.set(enabled)
            .then((result) => {
                // What the system ends up with: macOS may wait for the user's approval in its settings.
                startAtLogin = result;
            })
            .catch((error: unknown) => {
                console.warn("[konclui] preferences: could not change start at login", error);
                startAtLogin = !enabled;
                failure = "startAtLogin";
            });
    }

    function changeWindowMode(mode: string): void {
        if (mode !== "x11" && mode !== "wayland") return;
        const choice: DesktopWindowMode = mode;
        failure = undefined;
        desktop?.windowMode
            ?.set(choice)
            .then((state) => {
                windowMode = state;
            })
            .catch((error: unknown) => {
                console.warn("[konclui] preferences: could not change the window mode", error);
                failure = "windowMode";
            });
    }

    let windowModeNote = $derived(
        windowMode?.setByCommandLine
            ? t.setByCommandLine()
            : windowMode?.x11Unavailable
              ? t.x11Unavailable()
              : t.windowModeHint(),
    );
</script>

{#if desktop || downloadUrl}
    <PrefSection title={t.title()}>
        {#if desktop}
            <div class="k-pref-item">
                <span class="k-pref-text">
                    <b>{t.version()}</b>
                    {#if status !== "unknown"}
                        <small role="status" class:k-pref-warning={status === "belowMinimum"}
                            >{t.status[status]()}</small
                        >
                    {/if}
                </span>
                <span class="k-pref-value" data-testid="desktop-installed-version"
                    >{installed ?? t.unknownVersion()}</span
                >
            </div>
            {#if openDesktopSettings}
                <PrefRow title={t.openSettings()} hint={t.openSettingsHint()} onclick={() => openDesktopSettings()} />
            {/if}
            {#if startAtLogin !== undefined}
                <PrefToggle
                    title={t.startAtLogin()}
                    hint={t.startAtLoginHint()}
                    checked={startAtLogin}
                    onchange={changeStartAtLogin}
                    error={failure === "startAtLogin" ? t.startAtLoginFailed() : undefined}
                />
            {/if}
            {#if windowMode}
                <PrefChoice
                    title={t.windowMode()}
                    hint={windowModeNote}
                    options={[
                        {
                            value: "x11",
                            label: t.x11(),
                            unavailable:
                                windowMode.setByCommandLine || windowMode.x11Unavailable ? windowModeNote : undefined,
                        },
                        {
                            value: "wayland",
                            label: t.wayland(),
                            unavailable: windowMode.setByCommandLine ? windowModeNote : undefined,
                        },
                    ]}
                    value={windowMode.saved}
                    onchange={changeWindowMode}
                    error={failure === "windowMode" ? t.windowModeFailed() : undefined}
                />
                <p class="k-pref-note">{windowMode.saved === "wayland" ? t.waylandHint() : t.x11Hint()}</p>
                {#if windowMode.restartNeeded}
                    <div class="k-pref-item k-pref-stack" role="status">
                        <span class="k-pref-text">
                            <b>{t.restartNeeded()}</b>
                            {#if windowMode.saved === "wayland"}<small>{t.waylandAfterRestart()}</small>{/if}
                        </span>
                        <button type="button" class="k-pref-button" onclick={() => desktop?.windowMode?.restart()}
                            >{t.restartNow()}</button
                        >
                    </div>
                {/if}
            {/if}
        {/if}
        {#if policy.recommendedVersion || policy.minimumVersion}
            <div class="k-pref-item">
                <span class="k-pref-text">
                    {#if policy.recommendedVersion}<small>{t.recommendedVersion()}: {policy.recommendedVersion}</small
                        >{/if}
                    {#if policy.minimumVersion}<small>{t.minimumVersion()}: {policy.minimumVersion}</small>{/if}
                </span>
            </div>
        {/if}
        {#if downloadUrl}
            <a class="k-pref-row" href={downloadUrl} target="_blank" rel="noopener noreferrer">
                <span class="k-pref-text"><b>{t.download()}</b><small>{t.downloadHint()}</small></span>
            </a>
        {/if}
    </PrefSection>
    <p class="k-pref-note">{t.managed()}</p>
{/if}
