// The media choices of the dialog, as upstream stores them: the same names and amounts as its own settings
// (SettingsSubMenu.svelte, BackgroundSettingsPanel.svelte), so either screen shows what the other chose.

export const QUALITY_NAMES = ["low", "recommended", "high"] as const;

export type QualityName = (typeof QUALITY_NAMES)[number];

export const BANDWIDTH_PREFERENCES = ["maintain-resolution", "maintain-framerate", "balanced"] as const;

export type BandwidthPreference = (typeof BANDWIDTH_PREFERENCES)[number];

/** Upstream's three blur levels, light to strong (BackgroundSettingsPanel.svelte). */
export const BLUR_AMOUNTS = [10, 25, 50] as const;

export interface BackgroundSetting {
    readonly mode: string;
    readonly blurAmount?: number | undefined;
    readonly backgroundImage?: string | undefined;
}

/** The value no camera or no microphone takes in a device list: the device is turned off. */
export const NO_DEVICE = "";

/** The value a device list shows while the device is on but which one is not known yet: it is starting. */
export const STARTING_DEVICE = "starting";

/**
 * The device a list shows as chosen. Off only when the user turned it off. While it starts, or with no saved
 * preference, the device in use is not known yet: the list shows "starting" rather than guess one, so every listed
 * device stays a real choice (picking the one already shown would fire no change).
 */
export function shownDevice(on: boolean, used: string | undefined, requested: string | undefined): string {
    if (!on) return NO_DEVICE;
    return used ?? requested ?? STARTING_DEVICE;
}

export function isQualityName(value: string): value is QualityName {
    return (QUALITY_NAMES as readonly string[]).includes(value);
}

export function isBandwidthPreference(value: string): value is BandwidthPreference {
    return (BANDWIDTH_PREFERENCES as readonly string[]).includes(value);
}

/**
 * The background option a setting shows as chosen: `none`, `blur:<amount>` for one of upstream's levels, or
 * `image:<url>`. A blur amount no level has (an older default, or none) chooses no blur level, as in upstream's panel.
 */
export function backgroundChoice(setting: BackgroundSetting): string {
    if (setting.mode === "blur") return setting.blurAmount === undefined ? "blur" : `blur:${setting.blurAmount}`;
    if (setting.mode === "image" && setting.backgroundImage !== undefined) return `image:${setting.backgroundImage}`;
    return "none";
}

/** The microphone level from 0 to 100, from the volume spectrum upstream measures (0 to about 20 when talking). */
export function meterLevel(spectrum: readonly number[] | undefined): number {
    if (spectrum === undefined || spectrum.length === 0) return 0;
    const average = spectrum.reduce((sum, value) => sum + value, 0) / spectrum.length;
    return Math.round(Math.min(100, Math.max(0, average * 5)));
}

export interface PageAddress {
    readonly origin: string;
    readonly pathname: string;
}

export interface InviteOptions {
    /** The start position the link enters by, when the guest should not take the map's default one. */
    readonly entryPoint?: string | undefined;
    /** Where the guest walks after entering, in map pixels. */
    readonly walkTo?: { readonly x: number; readonly y: number } | undefined;
}

/**
 * The office link to send, as upstream's invite builds it (GuestSubMenu.svelte): the room's address alone, never
 * the query or hash the user arrived with (someone else's entrance and walk), then the invite's own options.
 */
export function inviteLink(page: PageAddress, options: InviteOptions): string {
    const room = `${page.origin}${page.pathname}`;
    if (options.entryPoint === undefined && options.walkTo === undefined) return room;
    const walk = options.walkTo === undefined ? "" : `&moveTo=${options.walkTo.x},${options.walkTo.y}`;
    return `${room}#${options.entryPoint ?? ""}${walk}`;
}
