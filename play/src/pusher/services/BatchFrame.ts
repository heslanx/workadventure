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

/**
 * The frame of a batch: the entries of its sub-messages, in order, under the envelope of the socket. A sub-message
 * that was not encoded once is encoded here, together with the ones next to it.
 */
export function encodeBatchFrame(nonce: number, subMessages: readonly SubMessage[]): Uint8Array<ArrayBuffer> {
    // The generated codec refuses a nonce that is not a uint32; the varint writers below would wrap it silently.
    if (!Number.isInteger(nonce) || nonce < 0 || nonce > 0xffffffff) {
        throw new Error("nonce out of uint32 range");
    }
    const entries: Uint8Array[] = [];
    let batchLength = 0;
    let notShared: SubMessage[] = [];
    const flushNotShared = () => {
        if (notShared.length === 0) {
            return;
        }
        const encoded = encodeEntries(notShared);
        entries.push(encoded);
        batchLength += encoded.length;
        notShared = [];
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
    for (const entry of entries) {
        frame.set(entry, offset);
        offset += entry.length;
    }
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
    while (offset < frame.length) {
        const lengthOffset = offset + 1;
        const subMessageOffset = skipVarint(frame, lengthOffset);
        const end = subMessageOffset + readVarint(frame, lengthOffset);
        sizes.push(end - offset);
        offset = end;
    }
    return sizes;
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
