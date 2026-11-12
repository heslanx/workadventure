import { readFileSync } from "node:fs";
import { asError } from "catch-unknown";
import { CPU_OVERHEAT_THRESHOLD } from "../Enum/EnvironmentVariable";

const PROC_SELF_CGROUP = "/proc/self/cgroup";
const CGROUP_ROOT = "/sys/fs/cgroup";
const CGROUP_V2_CPU_MAX = "cpu.max";
const CGROUP_V1_CFS_QUOTA_US = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const CGROUP_V1_CFS_PERIOD_US = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

/**
 * Returns the content of a file, or undefined when it does not exist or cannot be read.
 */
export type ReadOptionalFile = (path: string) => string | undefined;

/**
 * The CPU capacity the percentage is relative to, and where it comes from (logged at start).
 */
export interface CpuCapacity {
    cores: number;
    source: string;
}

function secNSec2ms(secNSec: Array<number> | number) {
    if (Array.isArray(secNSec)) {
        return secNSec[0] * 1000 + secNSec[1] / 1000000;
    }
    return secNSec / 1000;
}

function quotaToCores(quotaUs: string, periodUs: string): number | undefined {
    if (!/^\d+$/.test(quotaUs) || !/^\d+$/.test(periodUs)) {
        return undefined;
    }
    const quota = Number(quotaUs);
    const period = Number(periodUs);
    if (quota <= 0 || period <= 0) {
        return undefined;
    }
    return quota / period;
}

/**
 * Parses cgroup v2 `cpu.max` ("<quota> <period>") into cores.
 * Returns undefined when the quota is unlimited ("max <period>") or the content is malformed.
 */
export function parseCgroupV2CpuMax(content: string): number | undefined {
    const fields = /^(\S+)\s+(\S+)$/.exec(content.trim());
    if (fields === null) {
        return undefined;
    }
    return quotaToCores(fields[1], fields[2]);
}

/**
 * Parses cgroup v1 `cpu.cfs_quota_us` and `cpu.cfs_period_us` into cores.
 * Returns undefined when the quota is unlimited (-1) or either content is malformed.
 */
export function parseCgroupV1CfsQuota(quotaContent: string, periodContent: string): number | undefined {
    return quotaToCores(quotaContent.trim(), periodContent.trim());
}

/**
 * Parses `/proc/self/cgroup` and returns the cgroup v2 path of the process ("0::<path>").
 * Returns undefined when there is no cgroup v2 entry or the path is not a plain absolute path.
 */
export function parseCgroupV2Path(content: string): string | undefined {
    const line = content.split("\n").find((entry) => entry.startsWith("0::"));
    const path = line?.slice("0::".length).trim();
    if (path === undefined || !path.startsWith("/") || path.split("/").includes("..")) {
        return undefined;
    }
    return path;
}

function isUnlimitedQuota(content: string): boolean {
    return /^(max\s+\d+|-1)$/.test(content.trim());
}

function warnMalformed(path: string, content: string): void {
    console.warn(`Ignoring malformed cgroup CPU quota in ${path}: ${JSON.stringify(content)}`);
}

function readCgroupV2Quota(readFile: ReadOptionalFile, path: string): CpuCapacity | "absent" | undefined {
    const content = readFile(path);
    if (content === undefined) {
        return "absent";
    }
    const cores = parseCgroupV2CpuMax(content);
    if (cores === undefined && !isUnlimitedQuota(content)) {
        warnMalformed(path, content);
    }
    return cores === undefined ? undefined : { cores, source: `cgroup v2 ${path}` };
}

/**
 * Reads the CPU quota of the current cgroup in cores: cgroup v2 first (the path of the process from
 * `/proc/self/cgroup`, then the root, which is the container view with a private cgroup namespace), then cgroup v1.
 * Returns undefined when no quota applies (no cgroup files, unlimited quota or malformed content).
 */
export function readCgroupCpuQuota(readFile: ReadOptionalFile): CpuCapacity | undefined {
    const procCgroup = readFile(PROC_SELF_CGROUP);
    const ownPath = procCgroup === undefined ? undefined : parseCgroupV2Path(procCgroup);
    const v2Paths = [`${CGROUP_ROOT}/${CGROUP_V2_CPU_MAX}`];
    if (ownPath !== undefined && ownPath !== "/") {
        v2Paths.unshift(`${CGROUP_ROOT}${ownPath}/${CGROUP_V2_CPU_MAX}`);
    }
    for (const path of v2Paths) {
        const quota = readCgroupV2Quota(readFile, path);
        if (quota !== "absent") {
            return quota;
        }
    }
    const quota = readFile(CGROUP_V1_CFS_QUOTA_US);
    const period = readFile(CGROUP_V1_CFS_PERIOD_US);
    if (quota === undefined || period === undefined) {
        return undefined;
    }
    const cores = parseCgroupV1CfsQuota(quota, period);
    if (cores === undefined && !isUnlimitedQuota(quota)) {
        warnMalformed(CGROUP_V1_CFS_QUOTA_US, `${quota.trim()} / ${period.trim()}`);
    }
    return cores === undefined ? undefined : { cores, source: `cgroup v1 ${CGROUP_V1_CFS_QUOTA_US}` };
}

/**
 * Returns the cores reported by readCgroupCpuQuota, or undefined when no quota applies.
 */
export function readCgroupCpuQuotaCores(readFile: ReadOptionalFile): number | undefined {
    return readCgroupCpuQuota(readFile)?.cores;
}

/**
 * The percentage stays relative to one core when there is no quota or a quota of one core or more, because the event
 * loop saturates at one core. A quota below one core lowers the reference: otherwise a process fully throttled at
 * 0.65 CPU reports 65 % and never crosses the default threshold of 80.
 */
export function cpuCapacityCores(quotaCores: number | undefined): number {
    return quotaCores === undefined ? 1 : Math.min(1, quotaCores);
}

/**
 * Returns the reference capacity of the tracker and its source, from the cgroup CPU quota when one applies.
 */
export function readCpuCapacity(readFile: ReadOptionalFile): CpuCapacity {
    const quota = readCgroupCpuQuota(readFile);
    if (quota === undefined) {
        return { cores: 1, source: "no cgroup CPU quota, one-core reference" };
    }
    return { cores: cpuCapacityCores(quota.cores), source: `${quota.source} (quota ${quota.cores} cores)` };
}

/**
 * Reads a file, returning undefined when it does not exist. Other read failures are logged, then treated as absent.
 */
export function readOptionalFile(path: string): string | undefined {
    try {
        return readFileSync(path, "utf8");
    } catch (e: unknown) {
        const error = asError(e);
        if (!("code" in error) || error.code !== "ENOENT") {
            console.warn(`Cannot read ${path}, ignoring it for the CPU quota`, error);
        }
        return undefined;
    }
}

export class CpuTracker {
    private cpuPercent = 0;
    private overHeating = false;
    private readonly capacityCores: number;

    constructor(capacity: CpuCapacity = readCpuCapacity(readOptionalFile)) {
        if (!Number.isFinite(capacity.cores) || capacity.cores <= 0) {
            throw new Error(`CPU capacity must be a positive number of cores, got ${capacity.cores}`);
        }
        this.capacityCores = capacity.cores;
        console.info(`CPU tracker: percentages are relative to ${capacity.cores} core(s), from ${capacity.source}`);

        let time = process.hrtime.bigint();
        let usage = process.cpuUsage();
        setInterval(() => {
            const elapTime = process.hrtime.bigint();
            const elapUsage = process.cpuUsage(usage);
            usage = process.cpuUsage();

            const elapTimeMS = Number(elapTime - time) / 1000000;
            const elapUserMS = secNSec2ms(elapUsage.user);
            const elapSystMS = secNSec2ms(elapUsage.system);
            this.cpuPercent = Math.round((100 * (elapUserMS + elapSystMS)) / (elapTimeMS * this.capacityCores));

            time = elapTime;

            if (!this.overHeating && this.cpuPercent > CPU_OVERHEAT_THRESHOLD) {
                this.overHeating = true;
                console.warn('CPU high threshold alert. Going in "overheat" mode');
            } else if (this.overHeating && this.cpuPercent <= CPU_OVERHEAT_THRESHOLD) {
                this.overHeating = false;
                console.info('CPU is back to normal. Canceling "overheat" mode');
            }
        }, 100);
    }

    public getCpuPercent(): number {
        return this.cpuPercent;
    }

    public isOverHeating(): boolean {
        return this.overHeating;
    }
}
