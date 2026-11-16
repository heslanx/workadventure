function toLinear(channel: number): number {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function parseHexColor(color: string): [number, number, number] | undefined {
    const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
    if (!match) {
        return undefined;
    }
    const hex = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/**
 * The label color (white or black) that reads best on a background taken from a hash of the user's name.
 * It compares the real WCAG contrast ratios, so the result is always at least 4.5:1, which a brightness threshold
 * does not guarantee on saturated greens and mid tones. Falls back to white when the color cannot be parsed.
 */
export function readableTextColor(background: string | null | undefined): "white" | "black" {
    const rgb = background ? parseHexColor(background) : undefined;
    if (!rgb) {
        return "white";
    }
    const luminance = 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
    const contrastWithWhite = 1.05 / (luminance + 0.05);
    const contrastWithBlack = (luminance + 0.05) / 0.05;
    return contrastWithBlack > contrastWithWhite ? "black" : "white";
}
