import { describe, expect, it } from "vitest";
import { AvatarBuildQueue } from "../../../../src/front/Phaser/Entity/AvatarBuildQueue";

function avatarAt(x: number, y = 0) {
    return { x, y };
}

/** Queues the avatars in order and returns the order in which they are built. */
function queueAll(queue: AvatarBuildQueue, avatars: { x: number; y: number }[]): { x: number; y: number }[] {
    const built: { x: number; y: number }[] = [];
    for (const avatar of avatars) {
        queue.enqueue(avatar, () => built.push(avatar));
    }
    return built;
}

describe("AvatarBuildQueue", () => {
    it("builds at most the cap per drain and keeps the rest for the next drains", () => {
        const queue = new AvatarBuildQueue(3, Infinity);
        queueAll(
            queue,
            [1, 2, 3, 4, 5, 6, 7].map((x) => avatarAt(x)),
        );

        const counts = [queue.drain(), queue.drain(), queue.drain(), queue.drain()];

        expect(counts).toEqual([3, 3, 1, 0]);
        expect(queue.size).toBe(0);
    });

    it("builds the avatars nearest to the given point first", () => {
        const queue = new AvatarBuildQueue(2, Infinity);
        const [far, near, nearest, middle] = [avatarAt(900), avatarAt(200), avatarAt(100), avatarAt(500)];
        const built = queueAll(queue, [far, near, nearest, middle]);

        queue.drain({ x: 0, y: 0 });
        queue.drain({ x: 0, y: 0 });

        expect(built).toEqual([nearest, near, middle, far]);
    });

    it("measures the distance in both axes", () => {
        const queue = new AvatarBuildQueue(1, Infinity);
        const [sideways, diagonal] = [avatarAt(100, 0), avatarAt(70, 70)];
        const built = queueAll(queue, [sideways, diagonal]);

        queue.drain({ x: 0, y: 0 });

        // 70 px across and 70 down is about 99 px away, closer than 100 px across.
        expect(built).toEqual([diagonal]);
    });

    it("builds in arrival order when no point is given or when two avatars are as far", () => {
        const queue = new AvatarBuildQueue(4, Infinity);
        const [a, b, c, d] = [avatarAt(100), avatarAt(-100), avatarAt(0, 100), avatarAt(0, -100)];
        const built = queueAll(queue, [c, a, d, b]);

        queue.drain({ x: 0, y: 0 });

        expect(built).toEqual([c, a, d, b]);
    });

    it("uses the position an avatar has when its turn comes, not the one it queued from", () => {
        const queue = new AvatarBuildQueue(1, Infinity);
        const [walker, still] = [avatarAt(50), avatarAt(300)];
        const built = queueAll(queue, [walker, still]);

        walker.x = 900;
        queue.drain({ x: 0, y: 0 });

        expect(built).toEqual([still]);
    });

    it("does not build an avatar that was removed", () => {
        const queue = new AvatarBuildQueue(4, Infinity);
        const [kept, removed] = [avatarAt(1), avatarAt(2)];
        const built = queueAll(queue, [kept, removed]);

        queue.remove(removed);
        const count = queue.drain();

        expect(count).toBe(1);
        expect(built).toEqual([kept]);
    });

    it("leaves an avatar queued by a build for the next drain, so a frame never builds more than the cap", () => {
        const queue = new AvatarBuildQueue(1, Infinity);
        const built: string[] = [];
        queue.enqueue(avatarAt(1), () => {
            built.push("first");
            queue.enqueue(avatarAt(2), () => built.push("queued by the first"));
        });

        queue.drain();
        expect(built).toEqual(["first"]);

        queue.drain();
        expect(built).toEqual(["first", "queued by the first"]);
    });

    it("builds nothing when it is empty, without needing a point", () => {
        expect(new AvatarBuildQueue().drain()).toBe(0);
    });

    describe("time budget", () => {
        /** A clock the builds advance, so that a build costs exactly what the test says. */
        function createClock() {
            let time = 0;
            return {
                now: () => time,
                spend: (ms: number) => {
                    time += ms;
                },
            };
        }

        /** Queues `count` avatars whose builds each cost `costMs` on the clock; returns how many were built. */
        function queueCosting(
            queue: AvatarBuildQueue,
            clock: ReturnType<typeof createClock>,
            count: number,
            costMs: number,
        ) {
            const built: number[] = [];
            for (let index = 0; index < count; index++) {
                queue.enqueue(avatarAt(index), () => {
                    clock.spend(costMs);
                    built.push(index);
                });
            }
            return built;
        }

        it("starts no new build once the builds of the frame have spent the budget", () => {
            const clock = createClock();
            const queue = new AvatarBuildQueue(10, 4, clock.now);
            const built = queueCosting(queue, clock, 6, 1.5);

            // 1.5 ms and 3 ms are under the 4 ms budget, 4.5 ms is over it.
            expect(queue.drain()).toBe(3);
            expect(built).toEqual([0, 1, 2]);
            expect(queue.size).toBe(3);
        });

        it("builds one avatar per frame when one build costs more than the whole budget, so the queue still empties", () => {
            const clock = createClock();
            const queue = new AvatarBuildQueue(10, 4, clock.now);
            queueCosting(queue, clock, 3, 16);

            const counts = [queue.drain(), queue.drain(), queue.drain(), queue.drain()];

            expect(counts).toEqual([1, 1, 1, 0]);
            expect(queue.size).toBe(0);
        });

        it("measures each frame from the start of its own drain", () => {
            const clock = createClock();
            const queue = new AvatarBuildQueue(10, 4, clock.now);
            queueCosting(queue, clock, 4, 3);

            clock.spend(100); // time that passed between the frames is not part of the budget

            expect([queue.drain(), queue.drain()]).toEqual([2, 2]);
        });

        it("still stops at the cap when the builds are free", () => {
            const clock = createClock();
            const queue = new AvatarBuildQueue(4, 4, clock.now);
            queueCosting(queue, clock, 10, 0);

            expect(queue.drain()).toBe(4);
        });
    });
});
