export interface ViewportSize {
    width: number;
    height: number;
}

export interface ViewportBounds extends ViewportSize {
    left: number;
    top: number;
}

export function coWebsiteRatioAtPointer(
    bounds: ViewportBounds,
    pointer: { x: number; y: number },
    vertical: boolean,
    rtl: boolean,
): number {
    const extent = vertical ? bounds.height : bounds.width;
    const position = vertical ? pointer.y - bounds.top : pointer.x - bounds.left;
    const websiteSize = vertical || rtl ? position : extent - position;
    return Math.min(extent, Math.max(Math.min(8, extent), websiteSize)) / extent;
}

export interface RoomShellState {
    roomId: string | undefined;
    sceneLoaded: boolean;
    loading: boolean;
    entryScreenVisible: boolean;
    errorVisible: boolean;
}

export function isKoncluiShellActive(state: RoomShellState): boolean {
    return (
        state.roomId?.replace(/^\//, "").replace(/\/$/, "") === "~/konclui-office/office.wam" &&
        state.sceneLoaded &&
        !state.loading &&
        !state.entryScreenVisible &&
        !state.errorVisible
    );
}

export function splitGameViewport(
    available: ViewportSize,
    website: { visible: boolean; fullscreen: boolean; ratio: number; vertical: boolean },
): { game: ViewportSize; website: ViewportSize } {
    if (!website.visible) {
        return { game: available, website: { width: 0, height: 0 } };
    }
    if (website.vertical) {
        return {
            game: website.fullscreen
                ? { width: 0, height: 0 }
                : { width: available.width, height: available.height * (1 - website.ratio) },
            website: { width: available.width, height: available.height * website.ratio },
        };
    }
    return {
        game: website.fullscreen
            ? { width: 0, height: 0 }
            : { width: available.width * (1 - website.ratio), height: available.height },
        website: { width: available.width * website.ratio, height: available.height },
    };
}
