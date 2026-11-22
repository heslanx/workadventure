export type NoncedMessage<TPayload> = {
    nonce: number;
    payload: TPayload;
};

type StoredNoncedMessage<TPayload> = NoncedMessage<TPayload> & {
    storedAt: number;
};

/**
 * What a store may keep, besides the age it is given. A limit of 0 (or less) is no limit: that is what the front uses,
 * and what the pusher uses until PUSHER_RESUME_STORE_MAX_BYTES or PUSHER_RESUME_STORE_MAX_MESSAGES is set.
 */
export interface NoncedMessageStoreLimits {
    maxMessages?: number;
    maxBytes?: number;
}

export class NoncedMessageStore<TPayload extends { byteLength: number }> {
    private readonly messages: StoredNoncedMessage<TPayload>[] = [];
    private readonly retentionMs: number;
    private readonly maxMessages: number;
    private readonly maxBytes: number;
    private storedBytes = 0;
    /** The highest nonce ever added, kept or not. Only read by a store with a limit, to tell an empty store from a store that forgot. */
    private highestNonceAdded = 0;
    private readonly hasLimit: boolean;

    public constructor(retentionMs?: number, limits: NoncedMessageStoreLimits = {}) {
        this.retentionMs = retentionMs ?? 30_000;
        this.maxMessages = limits.maxMessages !== undefined && limits.maxMessages > 0 ? limits.maxMessages : Infinity;
        this.maxBytes = limits.maxBytes !== undefined && limits.maxBytes > 0 ? limits.maxBytes : Infinity;
        this.hasLimit = this.maxMessages !== Infinity || this.maxBytes !== Infinity;
    }

    /**
     * Returns false when this message takes the store over a limit. The store then drops everything it holds, this
     * message included, and hasEveryNonceAfter() refuses any resume that would have needed one of them: a peer that
     * missed any of them starts again instead of being replayed a gap.
     */
    public add(nonce: number, payload: TPayload): boolean {
        this.pruneExpired();
        this.messages.push({
            nonce,
            payload,
            storedAt: Date.now(),
        });
        this.storedBytes += payload.byteLength;
        this.highestNonceAdded = Math.max(this.highestNonceAdded, nonce);

        if (this.messages.length > this.maxMessages || this.storedBytes > this.maxBytes) {
            this.clear();
            return false;
        }
        return true;
    }

    public getAll(): NoncedMessage<TPayload>[] {
        this.pruneExpired();
        return this.messages.map(({ nonce, payload }) => ({ nonce, payload }));
    }

    public getAfter(nonce: number): NoncedMessage<TPayload>[] {
        this.pruneExpired();
        // Nonces are stored in increasing order: walk back from the end, over the wanted tail only.
        let start = this.messages.length;
        while (start > 0 && this.messages[start - 1].nonce > nonce) {
            start--;
        }
        const tail: NoncedMessage<TPayload>[] = [];
        for (let index = start; index < this.messages.length; index++) {
            const message = this.messages[index];
            tail.push({ nonce: message.nonce, payload: message.payload });
        }
        return tail;
    }

    public has(nonce: number): boolean {
        this.pruneExpired();
        return this.messages.some((message) => message.nonce === nonce);
    }

    public hasEveryNonceAfter(lastReceivedNonce: number): boolean {
        this.pruneExpired();
        const firstMessage = this.messages[0];
        if (!firstMessage) {
            // Without a limit, an empty store is what it has always been: nothing to replay, so nothing missing (the front
            // relies on it). With a limit, the store may have emptied by overflow, or by age after an overflow: it then
            // has nothing for a peer that is behind, and a replay of nothing would leave a gap.
            return !this.hasLimit || lastReceivedNonce >= this.highestNonceAdded;
        }
        return firstMessage.nonce <= lastReceivedNonce + 1;
    }

    public clear(): void {
        this.messages.length = 0;
        this.storedBytes = 0;
    }

    /** Messages kept right now (some may be past their age: they leave at the next call that prunes). */
    public get size(): number {
        return this.messages.length;
    }

    /** The bytes of the payloads kept right now. */
    public get byteSize(): number {
        return this.storedBytes;
    }

    private pruneExpired(): void {
        if (this.messages.length === 0) return;

        const cutoff = Date.now() - this.retentionMs;
        let expired = 0;
        while (expired < this.messages.length && this.messages[expired].storedAt <= cutoff) {
            this.storedBytes -= this.messages[expired].payload.byteLength;
            expired++;
        }
        // One splice for the whole expired head: a shift() per message moves the rest of the array each time.
        if (expired > 0) {
            this.messages.splice(0, expired);
        }
    }
}
