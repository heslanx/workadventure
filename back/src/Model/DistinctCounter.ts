/**
 * Counts distinct keys when a key can be added several times, such as one person with two tabs open.
 * A key is forgotten when its last reference is removed.
 */
export class DistinctCounter {
    private readonly refCounts = new Map<string, number>();

    public add(key: string): void {
        this.refCounts.set(key, (this.refCounts.get(key) ?? 0) + 1);
    }

    public remove(key: string): void {
        const refCount = this.refCounts.get(key);
        if (refCount === undefined) {
            return;
        }
        if (refCount === 1) {
            this.refCounts.delete(key);
        } else {
            this.refCounts.set(key, refCount - 1);
        }
    }

    public get size(): number {
        return this.refCounts.size;
    }
}
