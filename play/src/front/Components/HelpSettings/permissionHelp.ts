import { getNavigatorType, isAndroid, NavigatorType } from "../../WebRtc/DeviceUtils";

export type PermissionHelpBrowser = "firefox" | "chrome" | "safari" | "android" | "other";

/**
 * The screenshots in public/resources/help-setting-camera-permission, named <locale>-<browser>.png, by browser.
 * Add the file there and its locale here: a browser and locale without one get the written steps only.
 */
const SCREENSHOT_LOCALES: Partial<Record<PermissionHelpBrowser, readonly string[]>> = {
    firefox: ["en-US"],
    chrome: ["de-DE", "fr-FR"],
};

export function getPermissionHelpBrowser(): PermissionHelpBrowser {
    if (isAndroid()) {
        return "android";
    }
    try {
        switch (getNavigatorType()) {
            case NavigatorType.firefox:
                return "firefox";
            case NavigatorType.chrome:
                return "chrome";
            case NavigatorType.safari:
                return "safari";
        }
    } catch {
        // getNavigatorType() throws on some embedded or uncommon browsers
    }
    return "other";
}

/**
 * The screenshot that shows this browser in this language, or undefined when none was made: the help then relies on
 * its written steps instead of showing another browser's window.
 */
export function getPermissionHelpScreenshot(browser: PermissionHelpBrowser, locale: string): string | undefined {
    if (!SCREENSHOT_LOCALES[browser]?.includes(locale)) {
        return undefined;
    }
    return `/resources/help-setting-camera-permission/${locale}-${browser}.png`;
}
