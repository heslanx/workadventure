import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchMessage, PusherToFrontWebSocketMessage, SubMessage } from "@workadventure/messages";
import { encodeBatchFrame, encodeOnce } from "../../src/pusher/services/BatchFrame";

/** What the generated codec writes for a whole batch frame: the bytes encodeBatchFrame has to equal. */
function generatedFrame(nonce: number, payload: SubMessage[]): Uint8Array {
    return PusherToFrontWebSocketMessage.encode({
        nonce,
        message: { message: { $case: "batchMessage", batchMessage: { event: "", payload } } },
    }).finish();
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
    expect(
        Buffer.from(actual).equals(Buffer.from(expected)),
        `${actual.length} bytes, expected ${expected.length}`,
    ).toBe(true);
}

function error(message: string): SubMessage {
    return { message: { $case: "errorMessage", errorMessage: { message } } };
}

function userLeft(userId: number): SubMessage {
    return { message: { $case: "userLeftMessage", userLeftMessage: { userId } } };
}

/** The length of the BatchMessage that holds one error whose text is `textLength` characters long. */
function batchLengthOfError(textLength: number): number {
    return BatchMessage.encode({ event: "", payload: [error("x".repeat(textLength))] }).finish().length;
}

describe("encodeBatchFrame", () => {
    afterEach(() => vi.restoreAllMocks());

    it("writes the bytes of the generated codec for sub-messages that were encoded once", () => {
        const payload = [userLeft(1), error("a fault"), userLeft(300)].map((subMessage) => encodeOnce(subMessage));

        expectSameBytes(encodeBatchFrame(1, payload), generatedFrame(1, payload));
    });

    it("writes the bytes of the generated codec for sub-messages that were not encoded once", () => {
        const payload = [userLeft(1), error("a fault"), userLeft(300)];

        expectSameBytes(encodeBatchFrame(1, payload), generatedFrame(1, payload));
    });

    it("keeps the order of a batch that mixes both, in every arrangement of three sub-messages", () => {
        for (let arrangement = 0; arrangement < 8; arrangement += 1) {
            const payload = [userLeft(1), error("a fault"), userLeft(300)].map((subMessage, index) =>
                Math.floor(arrangement / 2 ** index) % 2 === 1 ? encodeOnce(subMessage) : subMessage,
            );

            expectSameBytes(encodeBatchFrame(9, payload), generatedFrame(9, payload));
        }
    });

    it("writes a sub-message that holds nothing as an entry of length 0", () => {
        const payload = [encodeOnce({ message: undefined }), { message: undefined }];

        expectSameBytes(encodeBatchFrame(1, payload), generatedFrame(1, payload));
    });

    it("writes a batch without a sub-message as the generated codec does", () => {
        expectSameBytes(encodeBatchFrame(1, []), generatedFrame(1, []));
    });

    it.each([1, 127, 128, 16_383, 16_384, 2_097_151, 2_097_152, 268_435_455, 268_435_456, 4_294_967_295])(
        "writes the nonce %i as the generated codec does",
        (nonce) => {
            const payload = [userLeft(1)];

            expectSameBytes(encodeBatchFrame(nonce, payload), generatedFrame(nonce, payload));
        },
    );

    it("refuses a nonce that is not a uint32, as the generated codec does, instead of wrapping it", () => {
        const payload = [userLeft(1)];

        for (const nonce of [-1, 1.5, 4_294_967_296, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => encodeBatchFrame(nonce, payload), `nonce ${nonce}`).toThrow("nonce out of uint32 range");
            expect(() => generatedFrame(nonce, payload), `codec, nonce ${nonce}`).toThrow();
        }
    });

    it("leaves the nonce out when it is 0, as the generated codec does", () => {
        const payload = [userLeft(1)];

        expectSameBytes(encodeBatchFrame(0, payload), generatedFrame(0, payload));
    });

    // The two wrappers hold the length of the batch as a varint, which gains a byte at 128, 16384 and 2^21 bytes.
    it.each([128, 16_384, 2_097_152])("writes a batch whose length goes from below to above %i bytes", (boundary) => {
        let textLength = boundary - 15;
        while (batchLengthOfError(textLength) < boundary) {
            textLength += 1;
        }
        const around = [textLength - 2, textLength - 1, textLength, textLength + 1];
        const lengths = around.map(batchLengthOfError);
        expect(lengths.some((length) => length < boundary)).toBe(true);
        expect(lengths.some((length) => length >= boundary)).toBe(true);

        for (const length of around) {
            const notShared = [error("x".repeat(length))];

            expectSameBytes(encodeBatchFrame(5, notShared), generatedFrame(5, notShared));
            const shared = notShared.map((subMessage) => encodeOnce(subMessage));
            expectSameBytes(encodeBatchFrame(5, shared), generatedFrame(5, shared));
        }
    });

    it("does not encode a sub-message that was encoded once again, whatever the number of frames it goes into", () => {
        const subMessage = encodeOnce(userLeft(42));
        const encode = vi.spyOn(SubMessage, "encode");

        for (let socket = 0; socket < 50; socket += 1) {
            encodeBatchFrame(socket + 1, [subMessage]);
        }

        expect(encode).not.toHaveBeenCalled();
    });

    it("encodes the sub-messages that were not encoded once for every frame, the ones next to each other in one call", () => {
        const notShared = [userLeft(1), userLeft(2)];
        const shared = encodeOnce(userLeft(3));
        const encodeSubMessage = vi.spyOn(SubMessage, "encode");
        const encodeBatch = vi.spyOn(BatchMessage, "encode");

        encodeBatchFrame(1, [...notShared, shared]);
        encodeBatchFrame(2, [...notShared, shared]);

        expect(encodeSubMessage).toHaveBeenCalledTimes(4);
        expect(encodeBatch).toHaveBeenCalledTimes(2);
    });

    it("builds a frame that the frames built after it do not change", () => {
        const subMessage = encodeOnce(userLeft(42));
        const first = encodeBatchFrame(1, [subMessage]);
        const copy = Uint8Array.from(first);

        encodeBatchFrame(2, [subMessage]);

        expectSameBytes(first, copy);
    });
});
