// Each effect can be switched off in the settings (owner, 20/10/2026: lighter or more complete). Lean draws the map as
// the art is (no extra draw at all), balanced keeps what tells something (the hour, a locked room, a meeting's TV) and
// what costs no redraw, complete everything. A missing or unreadable choice is complete: every switch starts on.

export const FEATURES = [
    "light",
    "water",
    "shadows",
    "glass",
    "reflections",
    "trail",
    "clouds",
    "frost",
    "tv",
    "vignette",
    "iris",
] as const;

export type Feature = (typeof FEATURES)[number];

export type FeatureSwitches = Record<Feature, boolean>;

export const PRESET_NAMES = ["lean", "balanced", "complete"] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

export const PRESETS: Readonly<Record<PresetName, readonly Feature[]>> = {
    lean: [],
    balanced: ["light", "shadows", "glass", "frost", "tv", "vignette", "iris"],
    complete: FEATURES,
};

/** What `presetOf` answers when the switches match no preset. */
export const CUSTOM_PRESET = "custom";

export const FEATURES_KEY = "konclui.fx.features";

function isPresetName(name: string): name is PresetName {
    return Object.hasOwn(PRESETS, name);
}

function switchesFrom(on: (feature: Feature) => boolean): FeatureSwitches {
    return {
        light: on("light"),
        water: on("water"),
        shadows: on("shadows"),
        glass: on("glass"),
        reflections: on("reflections"),
        trail: on("trail"),
        clouds: on("clouds"),
        frost: on("frost"),
        tv: on("tv"),
        vignette: on("vignette"),
        iris: on("iris"),
    };
}

/** The switches from their stored JSON: every feature on unless stored false. */
export function parseFeatures(raw: string | null | undefined): FeatureSwitches {
    let stored: unknown;
    try {
        stored = JSON.parse(raw || "{}");
    } catch {
        // Unreadable storage is the documented default, every effect on, not a failure to report.
        stored = {};
    }
    return switchesFrom(
        (feature) => !(typeof stored === "object" && stored !== null && Reflect.get(stored, feature) === false),
    );
}

/** The preset the switches match, or `CUSTOM_PRESET`. */
export function presetOf(features: Readonly<FeatureSwitches>): PresetName | typeof CUSTOM_PRESET {
    const on = FEATURES.filter((feature) => features[feature]);
    const match = PRESET_NAMES.find(
        (name) => PRESETS[name].length === on.length && PRESETS[name].every((feature) => features[feature]),
    );
    return match ?? CUSTOM_PRESET;
}

/** A preset's switches; an unknown name is the complete preset. */
export function presetFeatures(name: string): FeatureSwitches {
    const list: readonly Feature[] = isPresetName(name) ? PRESETS[name] : FEATURES;
    return switchesFrom((feature) => list.includes(feature));
}
