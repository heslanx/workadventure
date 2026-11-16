export function updateScriptedTileWallEdges(
    tile: { index: number; properties: Record<string, unknown> },
    properties: readonly { name: string; value?: unknown }[],
    previousEdges: unknown,
): boolean {
    const value = tile.index === -1 ? undefined : properties.find((property) => property.name === "wallEdges")?.value;
    const nextEdges = typeof value === "string" ? value : undefined;
    if (nextEdges === undefined) {
        delete tile.properties.wallEdges;
    } else {
        tile.properties.wallEdges = nextEdges;
    }
    return nextEdges !== (typeof previousEdges === "string" ? previousEdges : undefined);
}
