import { expect, it, vi } from "vitest";
import {
    parseCgroupMount,
    readCgroupCpuQuotaCores,
    readCpuCapacity,
    readOptionalFile,
} from "../src/Services/QuotaAwareCpuTracker";

vi.mock("../src/Enum/EnvironmentVariable", () => ({ CPU_OVERHEAT_THRESHOLD: 80 }));

it("prints the cgroup view of the process and what the tracker resolves from it", () => {
    const mountinfo = readOptionalFile("/proc/self/mountinfo") ?? "";
    console.log("PROC_SELF_CGROUP", JSON.stringify(readOptionalFile("/proc/self/cgroup")));
    console.log(
        "MOUNTINFO_CGROUP_LINES",
        JSON.stringify(
            mountinfo
                .split("\n")
                .filter((line) => / - cgroup2? /.test(line))
                .join("\n"),
        ),
    );
    console.log("PARSED_MOUNT_V2", JSON.stringify(parseCgroupMount(mountinfo, "v2")));
    console.log("PARSED_MOUNT_V1", JSON.stringify(parseCgroupMount(mountinfo, "v1")));
    console.log("QUOTA_CORES", JSON.stringify(readCgroupCpuQuotaCores(readOptionalFile)));
    console.log("CAPACITY", JSON.stringify(readCpuCapacity(readOptionalFile)));
    expect(true).toBe(true);
});
