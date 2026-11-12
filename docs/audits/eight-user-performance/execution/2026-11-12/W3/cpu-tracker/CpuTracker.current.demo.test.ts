// Evidence harness, not a product test. Drives the UNMODIFIED back/src/Services/CpuTracker.ts
// (sha256 093496fa...938b) with a synthetic clock. Run from back/ as w3scratch/CpuTracker.current.demo.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/Enum/EnvironmentVariable", () => ({ CPU_OVERHEAT_THRESHOLD: 80 }));

// Each 100 ms tick credits the process `coresUsed * 100 ms` of CPU time (user+system, all threads),
// i.e. what a process that fully consumes a cgroup quota of `coresUsed` CPUs accumulates.
async function currentTrackerConsuming(coresUsed: number) {
    vi.resetModules();
    let nowNs = 0n;
    let cpuUs = 0;
    vi.spyOn(process.hrtime, "bigint").mockImplementation(() => nowNs);
    vi.spyOn(process, "cpuUsage").mockImplementation((previous?: NodeJS.CpuUsage) =>
        previous ? { user: cpuUs - previous.user, system: 0 - previous.system } : { user: cpuUs, system: 0 },
    );
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const { cpuTracker } = await import("../src/Services/CpuTracker");
    for (let tick = 0; tick < 5; tick++) {
        nowNs += 100_000_000n;
        cpuUs += coresUsed * 100_000;
        vi.advanceTimersByTime(100);
    }
    console.log(
        `coresUsed=${coresUsed} reported=${cpuTracker.getCpuPercent()}% overheating=${cpuTracker.isOverHeating()}`,
    );
    return cpuTracker;
}

describe("current CpuTracker, threshold 80", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("quota 0.50 CPU fully consumed -> 50 %, never overheats", async () => {
        const t = await currentTrackerConsuming(0.5);
        expect([t.getCpuPercent(), t.isOverHeating()]).toEqual([50, false]);
    });

    it("quota 0.65 CPU (wa-fable-stack-back NanoCpus) fully consumed -> 65 %, never overheats", async () => {
        const t = await currentTrackerConsuming(0.65);
        expect([t.getCpuPercent(), t.isOverHeating()]).toEqual([65, false]);
    });

    it("1 CPU fully consumed -> 100 %, overheats", async () => {
        const t = await currentTrackerConsuming(1);
        expect([t.getCpuPercent(), t.isOverHeating()]).toEqual([100, true]);
    });

    it("quota 2 CPUs fully consumed (main thread + worker/GC threads) -> 200 %, overheats", async () => {
        const t = await currentTrackerConsuming(2);
        expect([t.getCpuPercent(), t.isOverHeating()]).toEqual([200, true]);
    });

    it("0.9 CPU inside a 2-CPU quota (45 % of quota) -> 90 %, overheats", async () => {
        const t = await currentTrackerConsuming(0.9);
        expect([t.getCpuPercent(), t.isOverHeating()]).toEqual([90, true]);
    });
});
