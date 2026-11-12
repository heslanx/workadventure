import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    CpuTracker,
    parseCgroupV1CfsQuota,
    parseCgroupV2CpuMax,
    parseCgroupV2Path,
    readCgroupCpuQuotaCores,
    readCpuCapacity,
    readOptionalFile,
} from "../src/Services/QuotaAwareCpuTracker";

vi.mock("../src/Enum/EnvironmentVariable", () => ({ CPU_OVERHEAT_THRESHOLD: 80 }));

const PROC_SELF_CGROUP = "/proc/self/cgroup";
const V2_CPU_MAX = "/sys/fs/cgroup/cpu.max";
const V1_QUOTA = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const V1_PERIOD = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

const fakeCgroup =
    (files: Record<string, string>) =>
    (path: string): string | undefined =>
        files[path];

// Synthetic clock: each 100 ms tick credits the process `coresUsed * 100 ms` of CPU time.
function trackerConsuming(coresUsed: number, cgroupFiles: Record<string, string>): CpuTracker {
    let nowNs = 0n;
    let cpuUs = 0;
    vi.spyOn(process.hrtime, "bigint").mockImplementation(() => nowNs);
    vi.spyOn(process, "cpuUsage").mockImplementation((previous?: NodeJS.CpuUsage) =>
        previous ? { user: cpuUs - previous.user, system: -previous.system } : { user: cpuUs, system: 0 },
    );
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const tracker = new CpuTracker(readCpuCapacity(fakeCgroup(cgroupFiles)));
    for (let tick = 0; tick < 5; tick++) {
        nowNs += 100_000_000n;
        cpuUs += coresUsed * 100_000;
        vi.advanceTimersByTime(100);
    }
    return tracker;
}

describe("CpuTracker", () => {
    let warn: ReturnType<typeof vi.spyOn>;
    let info: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe("parseCgroupV2CpuMax", () => {
        it("should read a quota as cores", () => {
            expect(parseCgroupV2CpuMax("65000 100000\n")).toBe(0.65);
            expect(parseCgroupV2CpuMax("200000 100000")).toBe(2);
        });

        it("should treat max as unlimited", () => {
            expect(parseCgroupV2CpuMax("max 100000\n")).toBeUndefined();
        });

        it("should reject malformed content", () => {
            for (const content of ["", "garbage", "65000", "65000 100000 1", "abc 100000", "65000 0", "0 100000"]) {
                expect(parseCgroupV2CpuMax(content), content).toBeUndefined();
            }
        });
    });

    describe("parseCgroupV1CfsQuota", () => {
        it("should read a quota as cores", () => {
            expect(parseCgroupV1CfsQuota("50000\n", "100000\n")).toBe(0.5);
        });

        it("should treat -1 as unlimited", () => {
            expect(parseCgroupV1CfsQuota("-1\n", "100000\n")).toBeUndefined();
        });

        it("should reject malformed content", () => {
            expect(parseCgroupV1CfsQuota("", "100000")).toBeUndefined();
            expect(parseCgroupV1CfsQuota("abc", "100000")).toBeUndefined();
            expect(parseCgroupV1CfsQuota("50000", "0")).toBeUndefined();
            expect(parseCgroupV1CfsQuota("50000", "1e5")).toBeUndefined();
        });
    });

    describe("parseCgroupV2Path", () => {
        it("should read the cgroup v2 path of the process", () => {
            expect(parseCgroupV2Path("0::/\n")).toBe("/");
            expect(parseCgroupV2Path("12:cpu,cpuacct:/docker/abc\n0::/system.slice/wa.service\n")).toBe(
                "/system.slice/wa.service",
            );
        });

        it("should reject a missing entry or a path that is not plain absolute", () => {
            expect(parseCgroupV2Path("12:cpu,cpuacct:/docker/abc\n")).toBeUndefined();
            expect(parseCgroupV2Path("0::relative\n")).toBeUndefined();
            expect(parseCgroupV2Path("0::/../../escape\n")).toBeUndefined();
        });
    });

    describe("readCgroupCpuQuotaCores", () => {
        it("should prefer cgroup v2 over cgroup v1", () => {
            const quota = readCgroupCpuQuotaCores(
                fakeCgroup({ [V2_CPU_MAX]: "65000 100000\n", [V1_QUOTA]: "200000\n", [V1_PERIOD]: "100000\n" }),
            );
            expect(quota).toBe(0.65);
        });

        it("should read cpu.max of the process cgroup from /proc/self/cgroup before the root", () => {
            const files = {
                [PROC_SELF_CGROUP]: "0::/system.slice/wa.service\n",
                "/sys/fs/cgroup/system.slice/wa.service/cpu.max": "50000 100000\n",
                [V2_CPU_MAX]: "max 100000\n",
            };
            expect(readCgroupCpuQuotaCores(fakeCgroup(files))).toBe(0.5);
        });

        it("should fall back to the root cpu.max when the process cgroup has none", () => {
            const files = { [PROC_SELF_CGROUP]: "0::/system.slice/wa.service\n", [V2_CPU_MAX]: "65000 100000\n" };
            expect(readCgroupCpuQuotaCores(fakeCgroup(files))).toBe(0.65);
        });

        it("should read cgroup v1 when cpu.max is absent", () => {
            expect(readCgroupCpuQuotaCores(fakeCgroup({ [V1_QUOTA]: "50000\n", [V1_PERIOD]: "100000\n" }))).toBe(0.5);
        });

        it("should report no quota when the files are missing", () => {
            expect(readCgroupCpuQuotaCores(fakeCgroup({}))).toBeUndefined();
            expect(readCgroupCpuQuotaCores(fakeCgroup({ [V1_QUOTA]: "50000\n" }))).toBeUndefined();
            expect(warn).not.toHaveBeenCalled();
        });

        it("should warn about malformed content but not about an unlimited quota", () => {
            expect(readCgroupCpuQuotaCores(fakeCgroup({ [V2_CPU_MAX]: "max 100000\n" }))).toBeUndefined();
            expect(
                readCgroupCpuQuotaCores(fakeCgroup({ [V1_QUOTA]: "-1\n", [V1_PERIOD]: "100000\n" })),
            ).toBeUndefined();
            expect(warn).not.toHaveBeenCalled();

            expect(readCgroupCpuQuotaCores(fakeCgroup({ [V2_CPU_MAX]: "garbage\n" }))).toBeUndefined();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining(V2_CPU_MAX));
        });
    });

    describe("readOptionalFile", () => {
        it("should return undefined for a missing file without logging", () => {
            expect(readOptionalFile("/nonexistent/wa-cpu-tracker/cpu.max")).toBeUndefined();
            expect(warn).not.toHaveBeenCalled();
        });

        it("should log a read failure other than a missing file", () => {
            expect(readOptionalFile("/")).toBeUndefined();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("Cannot read /"), expect.any(Error));
        });
    });

    describe("getCpuPercent and isOverHeating", () => {
        it("should overheat when the process fully consumes a 0.65-core cgroup v2 quota", () => {
            const tracker = trackerConsuming(0.65, { [V2_CPU_MAX]: "65000 100000\n" });
            expect(tracker.getCpuPercent()).toBe(100);
            expect(tracker.isOverHeating()).toBe(true);
            expect(info).toHaveBeenCalledWith(expect.stringMatching(/relative to 0\.65 core.*cgroup v2/));
        });

        it("should overheat when the process fully consumes a 0.5-core cgroup v1 quota", () => {
            const tracker = trackerConsuming(0.5, { [V1_QUOTA]: "50000\n", [V1_PERIOD]: "100000\n" });
            expect(tracker.getCpuPercent()).toBe(100);
            expect(tracker.isOverHeating()).toBe(true);
        });

        it("should not overheat at 60 % of a 0.65-core quota", () => {
            const tracker = trackerConsuming(0.39, { [V2_CPU_MAX]: "65000 100000\n" });
            expect(tracker.getCpuPercent()).toBe(60);
            expect(tracker.isOverHeating()).toBe(false);
        });

        it("should keep the one-core reference when the quota exceeds one core", () => {
            const tracker = trackerConsuming(0.9, { [V2_CPU_MAX]: "200000 100000\n" });
            expect(tracker.getCpuPercent()).toBe(90);
            expect(tracker.isOverHeating()).toBe(true);
        });

        it("should keep the one-core reference when the quota is unlimited, missing or malformed", () => {
            const cases: Record<string, string>[] = [
                { [V2_CPU_MAX]: "max 100000\n" },
                { [V1_QUOTA]: "-1\n", [V1_PERIOD]: "100000\n" },
                {},
                { [V2_CPU_MAX]: "garbage\n" },
            ];
            for (const cgroupFiles of cases) {
                const tracker = trackerConsuming(0.65, cgroupFiles);
                expect(tracker.getCpuPercent()).toBe(65);
                expect(tracker.isOverHeating()).toBe(false);
                vi.useRealTimers();
            }
            expect(info).toHaveBeenCalledWith(
                expect.stringContaining("relative to 1 core(s), from no cgroup CPU quota"),
            );
        });

        it("should reject a capacity that is not a positive number of cores", () => {
            for (const cores of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
                expect(() => new CpuTracker({ cores, source: "test" }), String(cores)).toThrow(/positive number/);
            }
        });
    });
});
