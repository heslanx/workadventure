<script lang="ts">
    import { onMount } from "svelte";
    import { LL, locale } from "../../../../i18n/i18n-svelte";
    import type { Locales } from "../../../../i18n/i18n-types";
    import { SubMenusInterface, type MenuItem } from "../../../Stores/MenuStore";
    import { pwaInstallProfileMenuEligibleStore } from "../../../Stores/PwaInstallStore";
    import { displayableLocales } from "../../../Utils/locales";
    import {
        fullscreenAvailable,
        isFullscreen,
        keepFullscreenOff,
        openUpstreamMenu,
        restartTour,
        setFullscreen,
        setLanguage,
        visibleUpstreamMenus,
    } from "../stores/generalSettings";
    import { closePreferences } from "../stores/preferencesStore";
    import { openPwaInstall } from "../stores/gameCommands";
    import DesktopAppSection from "./DesktopAppSection.svelte";
    import InviteSection from "./InviteSection.svelte";
    import PrefRow from "./PrefRow.svelte";
    import PrefSection from "./PrefSection.svelte";
    import PrefSelect from "./PrefSelect.svelte";
    import PrefToggle from "./PrefToggle.svelte";

    let t = $derived($LL.konclui.preferences.general);
    // Only where the page can go full screen, and as the page is: Esc or F11 leave it without the switch.
    const fullscreenShown = fullscreenAvailable();
    let fullscreen = $state(isFullscreen());
    let fullscreenFailed = $state(false);

    onMount(() => {
        // Leaving full screen by Esc or the browser is the user's choice too: save it, or the next scene would
        // ask for full screen again while the switch shows off.
        const sync = () => {
            fullscreen = isFullscreen();
            if (!fullscreen) keepFullscreenOff();
        };
        document.addEventListener("fullscreenchange", sync);
        return () => document.removeEventListener("fullscreenchange", sync);
    });

    function changeFullscreen(on: boolean): void {
        fullscreen = on;
        fullscreenFailed = false;
        setFullscreen(on).catch((error: unknown) => {
            console.error("[konclui] preferences: full screen", error);
            fullscreen = isFullscreen();
            fullscreenFailed = true;
        });
    }

    const languages = displayableLocales.map((entry) => ({
        value: entry.id,
        label: `${entry.language ? entry.language.charAt(0).toUpperCase() + entry.language.slice(1) : ""} (${
            entry.region
        })`,
    }));

    function shown(key: string): boolean {
        return $visibleUpstreamMenus.some((item) => item.key === key);
    }
    // The menus a map's scripts added: they belong to the map, so they are listed as they come.
    let mapMenus = $derived(
        $visibleUpstreamMenus.filter(
            (item): item is Extract<MenuItem, { type: "scripting" }> => item.type === "scripting",
        ),
    );

    /** Closes the dialog, then opens one of upstream's own views. */
    function openView(key: string): () => void {
        return () => {
            closePreferences();
            openUpstreamMenu(key);
        };
    }

    function isLocale(value: string): value is Locales {
        return languages.some((language) => language.value === value);
    }
</script>

<PrefSection title={t.office()}>
    <PrefSelect
        title={t.language()}
        hint={t.languageHint()}
        value={$locale}
        options={languages}
        onchange={(value) => {
            if (isLocale(value)) setLanguage(value);
        }}
    />
    {#if fullscreenShown}
        <PrefToggle
            title={t.fullscreen()}
            hint={t.fullscreenHint()}
            checked={fullscreen}
            onchange={changeFullscreen}
            error={fullscreenFailed ? t.fullscreenFailed() : undefined}
        />
    {/if}
</PrefSection>
<InviteSection />
<DesktopAppSection />
<PrefSection title={t.about()}>
    <PrefRow
        title={t.tour()}
        hint={t.tourHint()}
        onclick={() => {
            closePreferences();
            restartTour();
        }}
    />
    <PrefRow title={t.credits()} hint={t.creditsHint()} onclick={openView(SubMenusInterface.aboutRoom)} />
    {#if shown(SubMenusInterface.contact)}
        <PrefRow title={t.contact()} hint={t.contactHint()} onclick={openView(SubMenusInterface.contact)} />
    {/if}
    {#if shown(SubMenusInterface.report)}
        <PrefRow title={t.report()} hint={t.reportHint()} onclick={openView(SubMenusInterface.report)} />
    {/if}
    {#if $pwaInstallProfileMenuEligibleStore === true}
        <PrefRow
            title={t.installApp()}
            hint={t.installAppHint()}
            onclick={() => {
                closePreferences();
                openPwaInstall();
            }}
        />
    {/if}
</PrefSection>
{#if mapMenus.length > 0}
    <PrefSection title={t.mapMenus()}>
        {#each mapMenus as menu (menu.key)}
            <PrefRow title={menu.label} hint={t.mapMenuHint()} onclick={openView(menu.key)} />
        {/each}
    </PrefSection>
{/if}
