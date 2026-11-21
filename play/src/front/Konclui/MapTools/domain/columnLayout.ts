/**
 * The numbers of the zoom column, which the map tools share. The column is drawn by upstream's `ExplorerMenu.svelte` from
 * the `.k-control` utilities (`libs/tailwind/style/konclui.css`): 36 px controls, 6 px between them, 6 px of padding
 * (`p-1.5`) around, 8 px in from the map's right edge. `columnLayout.test.ts` reads those files and fails if they
 * stop saying so.
 */
export const CONTROL_SIZE = 36;
export const CONTROL_GAP = 6;
export const COLUMN_PADDING = 6;
export const COLUMN_RIGHT_INSET = 8;
export const COLUMN_WIDTH = CONTROL_SIZE + 2 * COLUMN_PADDING;

/** The zoom controls and the explorer control, which the column always draws. */
export const BASE_CONTROLS = 3;
/** The tools above them: leave the walk, go to the desk, centre on the avatar. */
export const MAX_TOOLS = 3;

/** The height of the column with `controls` controls in it. */
export function columnHeight(controls: number): number {
    return controls * CONTROL_SIZE + Math.max(0, controls - 1) * CONTROL_GAP + 2 * COLUMN_PADDING;
}

export interface ColumnBox {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

/**
 * Where the column stands in a viewport, from its bottom offset: the distance between the viewport's bottom edge and the
 * column's. The column keeps its width and its inset whatever it holds, so only its top moves as tools come and go.
 */
export function columnBox(
    viewport: { width: number; height: number },
    bottomOffset: number,
    controls: number,
): ColumnBox {
    const right = viewport.width - COLUMN_RIGHT_INSET;
    const bottom = viewport.height - bottomOffset;
    return { left: right - COLUMN_WIDTH, right, top: bottom - columnHeight(controls), bottom };
}

export function intersects(a: ColumnBox, b: ColumnBox): boolean {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
