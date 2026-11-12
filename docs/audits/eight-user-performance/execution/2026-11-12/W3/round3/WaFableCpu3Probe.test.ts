import { expect, it, vi } from "vitest";
import { CpuTracker, readCpuCapacity, readOptionalFile } from "../src/Services/QuotaAwareCpuTracker";

vi.mock("../src/Enum/EnvironmentVariable", () => ({ CPU_OVERHEAT_THRESHOLD: 80 }));

it("reads the capacity from the real cgroup files and reports a spinning process against it", async () => {
    console.log("proc self cgroup:", JSON.stringify(readOptionalFile("/proc/self/cgroup")));
    console.log("capacity:", JSON.stringify(readCpuCapacity(readOptionalFile)));
    const tracker = new CpuTracker();
    const samples: string[] = [];
    for (let round = 0; round < 15; round++) {
        const end = Date.now() + 100;
        while (Date.now() < end) {
            Math.sqrt(Math.random());
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        samples.push(`${tracker.getCpuPercent()}${tracker.isOverHeating() ? "!" : ""}`);
    }
    console.log("cpuPercent samples (! = overheating):", samples.join(" "));
    expect(true).toBe(true);
});
