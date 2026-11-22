import { BatchMessage, type SubMessage } from "@workadventure/messages";

/*
 * The frame a socket is sent for a batch is a PusherToFrontWebSocketMessage { nonce = 1; message = 2 } that holds a
 * ServerToClientMessage { batchMessage = 1 } that holds a BatchMessage { event = 1; payload = 2, repeated }.
 *
 * In protobuf a length-delimited field is its tag, its length and its content, and a repeated field is the
 * concatenation of its entries. So a frame is three small headers (the nonce, and the lengths of the two wrappers)
 * followed by the entries of the batch, and an entry can be encoded once and copied into the frame of every socket
 * that is sent it. The bytes are the ones the generated codec writes for the whole frame: BatchFrame.test.ts compares
 * both.
 *
 * What stops a frame from being shared by every socket, and what is left per socket (analysis, 2026-11-21; numbers from
 * `PUSHER_FANOUT=1 npx vitest run tests/pusher/FanOutBench.test.ts`, N=1000 dense, 20% walking at 5 Hz, budget off):
 *
 *  - The nonce. It is the first field of the envelope, and every socket has its own sequence (the NoncedMessageStore keeps
 *    each frame for replay by nonce), so no two sockets get the same bytes. This is not what blocks sharing: protobuf
 *    decodes fields in any order, so the nonce could be written last, after a body that is the same for every socket.
 *    Nothing is gained by it yet, because of the next point.
 *  - The batches differ. A socket is not sent its own moves (the zone skips the user of the socket), the cut between two
 *    of its frames is where its own timer fell (a dense room's timers are aligned by the back's bursts, a real room's
 *    are not), a group update replaces the one before it in place, and with the budget on each socket has its own
 *    selection. A body is shared only by sockets whose batch is the same list of entries, which in a dense room is
 *    "all but the walker themselves", and in a real room is rare.
 *  - What is already shared is every entry: `encodeOnce` encodes a sub-message once for all the sockets that get it.
 *    What is left per frame is the envelope (at most 14 bytes of the 1802 of a frame, under 1%) and the copy of the entries
 *    into the frame (`frame.set`, one call per entry, about 200 entries a frame). MEASURED: `encodeBatchFrame` is
 *    43.6% of the self time of the fan-out at N=1000 (about 4 us of the 9.6 us a frame), the zone's `notifyUserMove`
 *    27.0%, the batch timer closure 6.1%, `countSubMessages` 5.7%. A shared body plus a nonce suffix would still be
 *    one 1.8 kB copy per socket (uWS needs one buffer), so it would save the envelope and the per-entry calls only
 *    for the sockets whose batches match; copying byte by byte instead of `frame.set` gave nothing over 3 rounds.
 *
 * Timers: one per socket (PusherWebSocket arms one when a batch opens), 2.00 a socket with the keep-alive interval, which
 * is 1000 live timers a 100 ms window. Against one shared tick that visits every socket with something pending, the
 * MEASURED cost on real Node timers is 1.95 us a frame to arm and fire one (`what a per-socket batch timer costs`,
 * same file, on a host at load 32 on 10 cores, so an upper bound): 19.5 ms a second at 10000 frames a second, 48.7 at
 * 25000, against 0.15 to 0.23 us a frame for the loop. A shared tick would save at most 0.02 to 0.05 of a core, and
 * it would make every window close at the same instant, which they nearly do already (the flush herd of
 * MoveLatencyBudget.test.ts), take away the per-socket interval and the early flush, and change when a socket that was
 * quiet is sent its first move. Decision: keep one timer a socket, until the native `send` and the herd are measured on
 * the load host; the saving is under a tenth of what a frame costs (about 21 us of native send a frame, DERIVED).
 *
 * THE DECISION, 2026-11-21, with what it rests on (FanOutBench.test.ts, in the repo):
 *  - What blocks one encoded frame per zone is not a field of the socket. The nonce is first in the envelope but protobuf
 *    reads fields in any order, so it could be last; what blocks it is that the bodies differ. A socket is not told its own
 *    moves, and the cut between two of its frames is where its own timer fell. COUNTED ("how many frame bodies a dense
 *    room needs", N=300, virtual clock): with 20% walking 8700 frames are 1168 distinct bodies, the largest shared by 270
 *    sockets; with everyone walking 8700 frames are 4528 distinct bodies, the largest shared by 150. A shared frame would
 *    serve the sockets that do not walk and almost none of a room that all walks, and uWS wants one buffer a socket anyway:
 *    the copy stays. Not built.
 *  - One tick for all the sockets against a timer a socket: the timer a socket. The herd is there either way, because
 *    every socket gets the same burst from the back and the windows close together. MEASURED, N=1000, windows 50 / 100 ms, on
 *    a host at load 5 to 6 on 10 cores (2026-11-22; the figures were 4 to 5 times higher on a host at load 27 to 48, so quote
 *    the range, not one run): with the budget off the 1000 timers due at one instant take 4 to 21 ms p50 and 58 to 99 ms at most
 *    of JS to write 1000 frames, 10 times a second (20% to 100% of the users walking); with the budget on the longest groups
 *    are 334 to 553 frames, 1.0 to 2.9 ms p50 and 2 to 35 ms at most, 20 times a second. About 21 ms more of native send per
 *    1000 frames is DERIVED. A shared tick would write the same frames in the same instant and take away the per-socket interval, the early
 *    flush, and the stagger of the budget's rank timers; it would save 0.02 to 0.05 of a core (the figure above) and not
 *    the herd. What does cut the herd is the stagger already in the rank timers of the budget and a longer pusher window.
 */
const NONCE_TAG = 0x08; // PusherToFrontWebSocketMessage.nonce: field 1, varint
const MESSAGE_TAG = 0x12; // PusherToFrontWebSocketMessage.message: field 2, length-delimited
const BATCH_MESSAGE_TAG = 0x0a; // ServerToClientMessage.batchMessage: field 1, length-delimited

/**
 * The entries a batch gets from sub-messages that were encoded once. The key is the sub-message every socket is
 * given, so the batch of a socket keeps the sub-messages it is made of (its group updates are conflated on them).
 */
const sharedEntries = new WeakMap<SubMessage, Uint8Array>();

/**
 * Encodes a sub-message that is sent to several sockets, once. Every batch it is added to is given these bytes
 * instead of encoding the sub-message again. The sub-message must not be modified afterwards.
 */
export function encodeOnce(subMessage: SubMessage): SubMessage {
    sharedEntries.set(subMessage, encodeEntries([subMessage]));
    return subMessage;
}

// Scratch for encodeBatchFrame: the entries of the frame being built, and the sub-messages that were not encoded once
// and wait to be encoded together. A frame is built to its end before the next starts, so one copy serves every socket,
// and a frame allocates nothing but its own bytes.
const entriesScratch: Uint8Array[] = [];
const notSharedScratch: SubMessage[] = [];

/**
 * The frame of a batch: the entries of its sub-messages, in order, under the envelope of the socket. A sub-message
 * that was not encoded once is encoded here, together with the ones next to it.
 *
 * `entryBytes`, when given, is filled with the size of each sub-message's entry in the frame, in order (what
 * entrySizes would read off the frame): a socket counts what it sends by type, and the sizes are known here.
 */
export function encodeBatchFrame(
    nonce: number,
    subMessages: readonly SubMessage[],
    entryBytes?: number[],
): Uint8Array<ArrayBuffer> {
    // The generated codec refuses a nonce that is not a uint32; the varint writers below would wrap it silently.
    if (!Number.isInteger(nonce) || nonce < 0 || nonce > 0xffffffff) {
        throw new Error("nonce out of uint32 range");
    }
    const entries = entriesScratch;
    const notShared = notSharedScratch;
    entries.length = 0;
    notShared.length = 0;
    if (entryBytes !== undefined) {
        entryBytes.length = 0;
    }
    let batchLength = 0;
    const flushNotShared = () => {
        if (notShared.length === 0) {
            return;
        }
        const encoded = encodeEntries(notShared);
        entries.push(encoded);
        batchLength += encoded.length;
        if (entryBytes !== undefined) {
            entrySizesInto(encoded, entryBytes);
        }
        notShared.length = 0;
    };
    for (const subMessage of subMessages) {
        const shared = sharedEntries.get(subMessage);
        if (shared === undefined) {
            notShared.push(subMessage);
            continue;
        }
        flushNotShared();
        entries.push(shared);
        batchLength += shared.length;
        entryBytes?.push(shared.length);
    }
    flushNotShared();

    const messageLength = 1 + varintLength(batchLength) + batchLength;
    const nonceLength = nonce === 0 ? 0 : 1 + varintLength(nonce);
    const frame = new Uint8Array(nonceLength + 1 + varintLength(messageLength) + messageLength);

    let offset = 0;
    if (nonce !== 0) {
        frame[offset++] = NONCE_TAG;
        offset = writeVarint(frame, offset, nonce);
    }
    frame[offset++] = MESSAGE_TAG;
    offset = writeVarint(frame, offset, messageLength);
    frame[offset++] = BATCH_MESSAGE_TAG;
    offset = writeVarint(frame, offset, batchLength);
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        frame.set(entry, offset);
        offset += entry.length;
    }
    entries.length = 0;
    return frame;
}

/**
 * The size of each entry of a frame made by encodeBatchFrame, in order: the tag of the entry (one byte), the length of
 * its sub-message and the sub-message, which is what a client receives of it. The sizes are read off the frame, so the
 * entries shared by many frames are not encoded again to be measured.
 */
export function entrySizes(frame: Uint8Array): number[] {
    let offset = 0;
    if (frame[offset] === NONCE_TAG) {
        offset = skipVarint(frame, offset + 1);
    }
    // MESSAGE_TAG and BATCH_MESSAGE_TAG, each followed by the length of its wrapper.
    offset = skipVarint(frame, offset + 1);
    offset = skipVarint(frame, offset + 1);

    const sizes: number[] = [];
    entrySizesInto(frame.subarray(offset), sizes);
    return sizes;
}

/** Appends the size of each entry of `entries`, which holds nothing but entries (tag, length, sub-message), to `sizes`. */
function entrySizesInto(entries: Uint8Array, sizes: number[]): void {
    let offset = 0;
    while (offset < entries.length) {
        const lengthOffset = offset + 1;
        const subMessageOffset = skipVarint(entries, lengthOffset);
        const end = subMessageOffset + readVarint(entries, lengthOffset);
        sizes.push(end - offset);
        offset = end;
    }
}

/** The bytes the BatchMessage encoder writes for these sub-messages: one entry (tag, length, bytes) after the other. */
function encodeEntries(subMessages: SubMessage[]): Uint8Array {
    return BatchMessage.encode({ event: "", payload: subMessages }).finish();
}

function varintLength(value: number): number {
    let length = 1;
    for (let rest = value >>> 7; rest !== 0; rest >>>= 7) {
        length += 1;
    }
    return length;
}

function writeVarint(target: Uint8Array, offset: number, value: number): number {
    let rest = value >>> 0;
    while (rest > 0x7f) {
        target[offset++] = (rest & 0x7f) | 0x80;
        rest >>>= 7;
    }
    target[offset++] = rest;
    return offset;
}

function readVarint(bytes: Uint8Array, offset: number): number {
    let value = 0;
    let multiplier = 1;
    for (let cursor = offset; cursor < bytes.length; cursor++) {
        const byte = bytes[cursor];
        value += (byte & 0x7f) * multiplier;
        if ((byte & 0x80) === 0) {
            break;
        }
        multiplier *= 128;
    }
    return value;
}

/** The offset of the byte after the varint that starts at `offset`. */
function skipVarint(bytes: Uint8Array, offset: number): number {
    let cursor = offset;
    while (cursor < bytes.length) {
        if ((bytes[cursor++] & 0x80) === 0) {
            break;
        }
    }
    return cursor;
}
