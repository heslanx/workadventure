import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { asError } from "catch-unknown";
import { CPU_OVERHEAT_THRESHOLD } from "../Enum/EnvironmentVariable";

const PROC_SELF_CGROUP = "/proc/self/cgroup";
const PROC_SELF_MOUNTINFO = "/proc/self/mountinfo";

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

function plainAbsolutePath(path: string | undefined): string | undefined {
    const trimmed = path?.trim();
    if (trimmed === undefined || !trimmed.startsWith("/") || trimmed.split("/").includes("..")) {
        return undefined;
    }
    return trimmed;
}

/**
 * Parses `/proc/self/cgroup` and returns the cgroup v2 path of the process ("0::<path>").
 * Returns undefined when there is no cgroup v2 entry or the path is not a plain absolute path.
 */
export function parseCgroupV2Path(content: string): string | undefined {
    const line = content.split("\n").find((entry) => entry.startsWith("0::"));
    return plainAbsolutePath(line?.slice("0::".length));
}

/**
 * Parses `/proc/self/cgroup` and returns the cgroup v1 path of the process in the hierarchy that holds the cpu
 * controller ("<id>:cpu,cpuacct:<path>").
 * Returns undefined when there is no such entry or the path is not a plain absolute path.
 */
export function parseCgroupV1CpuPath(content: string): string | undefined {
    const entry = content
        .split("\n")
        .map((line) => /^\d+:([^:]+):(.*)$/.exec(line))
        .find((fields) => fields !== null && fields[1].split(",").includes("cpu"));
    return plainAbsolutePath(entry?.[2]);
}

export type CgroupVersion = "v1" | "v2";

/**
 * A mounted cgroup hierarchy: `mountPoint` shows the cgroup `root` of the hierarchy and everything below it.
 */
export interface CgroupMount {
    root: string;
    mountPoint: string;
}

function unescapeMountinfo(field: string): string {
    return field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

/**
 * Parses `/proc/self/mountinfo` and returns the first mount of the hierarchy that holds the cpu controller: the
 * cgroup2 mount for v2, a cgroup mount with the cpu option for v1.
 */
export function parseCgroupMount(content: string, version: CgroupVersion): CgroupMount | undefined {
    for (const line of content.split("\n")) {
        const separator = line.indexOf(" - ");
        if (separator === -1) {
            continue;
        }
        const mountFields = line.slice(0, separator).split(" ");
        const [fsType, , superOptions] = line.slice(separator + " - ".length).split(" ");
        const holdsCpu =
            version === "v2"
                ? fsType === "cgroup2"
                : fsType === "cgroup" && (superOptions ?? "").split(",").includes("cpu");
        if (mountFields.length >= 5 && holdsCpu) {
            return { root: unescapeMountinfo(mountFields[3]), mountPoint: unescapeMountinfo(mountFields[4]) };
        }
    }
    return undefined;
}

/**
 * The directories of the process cgroup and its ancestors under the mount point, from the process cgroup up to the
 * mount point.
 *
 * The kernel renders the process path and the mount root relative to the namespace root of the reader. The mount root
 * is an ancestor of the process cgroup when the process path is below it. It is also one when the root only climbs out
 * of the namespace root ("/../.."): the mount point is then an ancestor, and the levels between it and the namespace
 * root have no names, so only the mount point is known. Any other root (a sibling of the process cgroup, or a climb
 * that descends again) names no ancestor, so no directory of that mount is read.
 */
function cgroupDirectories(mount: CgroupMount, cgroupPath: string): string[] {
    const rootParts = mount.root.split("/").filter(Boolean);
    const pathParts = cgroupPath.split("/").filter(Boolean);
    const isBelowRoot = rootParts.every((part, index) => pathParts[index] === part);
    if (!isBelowRoot) {
        return rootParts.every((part) => part === "..") ? [mount.mountPoint] : [];
    }
    const directories = [mount.mountPoint];
    for (const part of pathParts.slice(rootParts.length)) {
        directories.unshift(posix.join(directories[0], part));
    }
    return directories;
}

function isUnlimitedQuota(content: string): boolean {
    return /^(max\s+\d+|-1)$/.test(content.trim());
}

function warnMalformed(path: string, content: string): void {
    console.warn(`Ignoring malformed cgroup CPU quota in ${path}: ${JSON.stringify(content)}`);
}

function readCgroupV2Quota(readFile: ReadOptionalFile, directory: string): CpuCapacity | undefined {
    const path = `${directory}/cpu.max`;
    const content = readFile(path);
    if (content === undefined) {
        return undefined;
    }
    const cores = parseCgroupV2CpuMax(content);
    if (cores === undefined && !isUnlimitedQuota(content)) {
        warnMalformed(path, content);
    }
    return cores === undefined ? undefined : { cores, source: `cgroup v2 ${path}` };
}

function readCgroupV1Quota(readFile: ReadOptionalFile, directory: string): CpuCapacity | undefined {
    const quotaPath = `${directory}/cpu.cfs_quota_us`;
    const quota = readFile(quotaPath);
    const period = readFile(`${directory}/cpu.cfs_period_us`);
    if (quota === undefined || period === undefined) {
        return undefined;
    }
    const cores = parseCgroupV1CfsQuota(quota, period);
    if (cores === undefined && !isUnlimitedQuota(quota)) {
        warnMalformed(quotaPath, `${quota.trim()} / ${period.trim()}`);
    }
    return cores === undefined ? undefined : { cores, source: `cgroup v1 ${quotaPath}` };
}

interface CgroupHierarchy {
    version: CgroupVersion;
    /** Used when `/proc/self/mountinfo` is unreadable or does not list the hierarchy. */
    defaultMountPoint: string;
    processPath: (procSelfCgroup: string) => string | undefined;
    readQuota: (readFile: ReadOptionalFile, directory: string) => CpuCapacity | undefined;
}

const CGROUP_HIERARCHIES: readonly CgroupHierarchy[] = [
    {
        version: "v2",
        defaultMountPoint: "/sys/fs/cgroup",
        processPath: parseCgroupV2Path,
        readQuota: readCgroupV2Quota,
    },
    {
        version: "v1",
        defaultMountPoint: "/sys/fs/cgroup/cpu",
        processPath: parseCgroupV1CpuPath,
        readQuota: readCgroupV1Quota,
    },
];

/**
 * Reads the effective CPU quota of the process in cores: the tightest quota of the process cgroup and its ancestors up
 * to the mounted root, in the cgroup v2 hierarchy and in the cgroup v1 hierarchy holding the cpu controller. The paths
 * come from `/proc/self/cgroup` and `/proc/self/mountinfo`.
 * Returns undefined when no quota applies (no cgroup files, unlimited quotas or malformed content).
 */
export function readCgroupCpuQuota(readFile: ReadOptionalFile): CpuCapacity | undefined {
    const procSelfCgroup = readFile(PROC_SELF_CGROUP) ?? "";
    const mountinfo = readFile(PROC_SELF_MOUNTINFO) ?? "";
    const quotas = CGROUP_HIERARCHIES.flatMap((hierarchy) => {
        const mount = parseCgroupMount(mountinfo, hierarchy.version) ?? {
            root: "/",
            mountPoint: hierarchy.defaultMountPoint,
        };
        const cgroupPath = hierarchy.processPath(procSelfCgroup) ?? mount.root;
        return cgroupDirectories(mount, cgroupPath).flatMap(
            (directory) => hierarchy.readQuota(readFile, directory) ?? [],
        );
    });
    return quotas.reduce<CpuCapacity | undefined>(
        (tightest, quota) => (tightest === undefined || quota.cores < tightest.cores ? quota : tightest),
        undefined,
    );
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
