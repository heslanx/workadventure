/**
 * The geometry of the real konclui-office effects manifest (assets build output maps/konclui-office/fx/manifest.json),
 * copied as it is: every `rect` and `floor` is [x, y, w, h], glassFaces are [x0, x1, foot]. A synthetic fixture with
 * corner-style rects hid the crowd's placement bug once (borders and light centres landed on the wrong geometry), so
 * the placement tests feed this copy.
 */
export const KONCLUI_OFFICE_FX = {
    map: [2752, 1792],
    glassFaces: [
        [608, 1312, 252],
        [1472, 2176, 252],
        [192, 2592, 1596],
        [608, 1312, 604],
        [1472, 2176, 604],
    ],
    staticLights: [
        { kind: "door", at: [1392.0, 1522] },
        { kind: "door", at: [1392.0, 1568] },
        { kind: "door", at: [1392.0, 1600] },
        { kind: "door", rect: [1340, 1600, 104, 150] },
        { kind: "doorLawn", at: [1392.0, 1612] },
        { kind: "fountain", at: [1391.0, 282.0] },
        { kind: "pool", at: [1392.0, 976.0] },
    ],
    rooms: [
        { key: "room_01", layer: "lock-room_01", rect: [610, 256, 348, 352], floor: [608, 256, 352, 288] },
        { key: "room_02", layer: "lock-room_02", rect: [962, 256, 352, 352], floor: [960, 256, 352, 288] },
        { key: "room_03", layer: "lock-room_03", rect: [1474, 256, 348, 352], floor: [1472, 256, 352, 288] },
        { key: "room_04", layer: "lock-room_04", rect: [1826, 256, 348, 352], floor: [1824, 256, 352, 288] },
        { key: "meeting_01", layer: "lock-meeting_01", rect: [194, 1024, 416, 224], floor: [192, 1024, 416, 224] },
        { key: "meeting_02", layer: "lock-meeting_02", rect: [194, 1312, 412, 224], floor: [192, 1312, 416, 224] },
    ],
};
