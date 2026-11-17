<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { CUSTOM_PRESET, PRESET_NAMES, presetOf, type Feature, type PresetName } from "../domain/effectSwitches";
    import { applyEffectsPreset, effectSwitchesStore, setEffect } from "../stores/effectSwitchesStore";
    import { pauseTileAnimations } from "../stores/gameCommands";
    import PrefChoice from "./PrefChoice.svelte";
    import PrefSection from "./PrefSection.svelte";
    import PrefToggle from "./PrefToggle.svelte";

    // The vignette has a switch but nothing draws it yet: the desk focus mode it frames is not in this client.
    const SHOWN: readonly Feature[] = [
        "light",
        "water",
        "shadows",
        "glass",
        "reflections",
        "trail",
        "clouds",
        "frost",
        "tv",
        "iris",
    ];

    let animations = $state(!localUserStore.getDisableAnimations());
    let preset = $derived(presetOf($effectSwitchesStore));

    let t = $derived($LL.konclui.preferences.performance);
    let presetLabels = $derived<Record<PresetName, string>>({
        lean: t.lean(),
        balanced: t.balanced(),
        complete: t.complete(),
    });
    let featureText = $derived<Record<string, { title: string; hint: string }>>({
        light: { title: t.light(), hint: t.lightHint() },
        water: { title: t.water(), hint: t.waterHint() },
        shadows: { title: t.shadows(), hint: t.shadowsHint() },
        glass: { title: t.glass(), hint: t.glassHint() },
        reflections: { title: t.reflections(), hint: t.reflectionsHint() },
        trail: { title: t.trail(), hint: t.trailHint() },
        clouds: { title: t.clouds(), hint: t.cloudsHint() },
        frost: { title: t.frost(), hint: t.frostHint() },
        tv: { title: t.tv(), hint: t.tvHint() },
        iris: { title: t.iris(), hint: t.irisHint() },
    });

    function isPresetName(value: string): value is PresetName {
        return (PRESET_NAMES as readonly string[]).includes(value);
    }

    function changeAnimations(on: boolean): void {
        animations = on;
        localUserStore.setDisableAnimations(!on);
        pauseTileAnimations(!on);
    }
</script>

<PrefSection title={t.effects()}>
    <PrefChoice
        title={t.preset()}
        hint={preset === CUSTOM_PRESET ? t.custom() : t.presetHint()}
        options={PRESET_NAMES.map((name) => ({ value: name, label: presetLabels[name] }))}
        value={preset}
        onchange={(name) => {
            if (isPresetName(name)) applyEffectsPreset(name);
        }}
    />
    {#each SHOWN as feature (feature)}
        <PrefToggle
            title={featureText[feature].title}
            hint={featureText[feature].hint}
            checked={$effectSwitchesStore[feature]}
            onchange={(on) => setEffect(feature, on)}
        />
    {/each}
</PrefSection>
<PrefSection title={t.motion()}>
    <PrefToggle title={t.animations()} hint={t.animationsHint()} checked={animations} onchange={changeAnimations} />
</PrefSection>
