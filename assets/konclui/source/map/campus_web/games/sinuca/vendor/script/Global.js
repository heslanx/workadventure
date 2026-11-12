// Koncluí: patched (see VENDOR.md). The menu, sound and AI-mode flags are gone; the table size, the ball ids and the
// sink animation length are new, and the glue sets TRAIN_ITER from the difficulty select.
const BALL_SIZE = 38;
const BORDER_SIZE = 57;
const HOLE_RADIUS = 46;

const DELTA = 1/100;

const TABLE_W = 1500;
const TABLE_H = 825;
const WHITE_ID = 15;
const BLACK_ID = 4;
const SINK_STEPS = 15;

let TRAIN_ITER = 50;
