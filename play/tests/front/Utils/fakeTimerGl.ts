import type { GpuTimerContext } from "../../../src/front/Utils/GpuFrameTimer";

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;

export interface FakeQuery {
    id: number;
    /** The GPU time this query will report, taken from the series at begin. */
    ns: number | null;
    began: boolean;
    ended: boolean;
    /** Order in which queries ended: the GPU finishes them in this order. */
    endOrder: number;
    deleted: boolean;
    /** Whether the GPU has finished: results are read only once this is true. */
    ready: boolean;
}

export interface FakeTimerGlOptions {
    flavor: "webgl2" | "webgl1" | "none";
    /** GPU time per measured frame in nanoseconds, in the order queries begin. null stands for a failed read. */
    elapsedNs?: (number | null)[];
    /** When false a query becomes ready only through gl.finishAll() / gl.finishOldest(): the GPU runs behind. */
    autoReady?: boolean;
    /** createQuery returns null, as on a lost context. */
    nullQueries?: boolean;
    /** createQuery hands out this many real queries, then returns null: a context lost half way through a pool. */
    nullQueryAfter?: number;
}

/** A stateful stand-in for the timer-query part of a WebGL1 or WebGL2 context. */
export function createFakeTimerGl(options: FakeTimerGlOptions) {
    const queries: FakeQuery[] = [];
    let beginCount = 0;
    let endCount = 0;
    let open: FakeQuery | undefined;
    let disjointFlag = false;
    let disjointReads = 0;
    const autoReady = options.autoReady ?? true;

    const create = (): FakeQuery | null => {
        if (options.nullQueries || (options.nullQueryAfter !== undefined && queries.length >= options.nullQueryAfter)) {
            return null;
        }
        const query: FakeQuery = {
            id: queries.length,
            ns: 0,
            began: false,
            ended: false,
            endOrder: 0,
            deleted: false,
            ready: false,
        };
        queries.push(query);
        return query;
    };
    const begin = (query: unknown) => {
        const q = query as FakeQuery;
        if (q === null || q === undefined) {
            throw new Error("beginQuery(null): the timer used a query that was never created");
        }
        if (open) {
            throw new Error(
                "beginQuery while another query is active: a second TIME_ELAPSED query is an INVALID_OPERATION",
            );
        }
        q.began = true;
        const series = options.elapsedNs ?? [];
        q.ns = beginCount < series.length ? series[beginCount] : 0;
        beginCount++;
        open = q;
    };
    const end = () => {
        if (!open) {
            throw new Error("endQuery without an active query");
        }
        open.ended = true;
        open.endOrder = ++endCount;
        open.ready = autoReady;
        open = undefined;
    };
    const readParameter = (query: unknown, pname: number): unknown => {
        const q = query as FakeQuery;
        if (q.deleted) {
            throw new Error("query read after delete");
        }
        if (pname === QUERY_RESULT_AVAILABLE) {
            return q.ready;
        }
        if (pname === QUERY_RESULT) {
            if (!q.ready) {
                throw new Error("QUERY_RESULT read before QUERY_RESULT_AVAILABLE: the real call would stall the GPU");
            }
            return q.ns;
        }
        throw new Error(`unexpected pname ${pname}`);
    };
    const getParameter = (pname: number): unknown => {
        if (pname !== GPU_DISJOINT_EXT) {
            return 0;
        }
        // Reading the flag clears it, as the extension specifies
        disjointReads++;
        const value = disjointFlag;
        disjointFlag = false;
        return value;
    };
    const remove = (query: unknown) => {
        if (query) {
            (query as FakeQuery).deleted = true;
        }
    };

    const ext2 = { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT };
    const ext1 = {
        TIME_ELAPSED_EXT,
        GPU_DISJOINT_EXT,
        QUERY_RESULT_EXT: QUERY_RESULT,
        QUERY_RESULT_AVAILABLE_EXT: QUERY_RESULT_AVAILABLE,
        createQueryEXT: create,
        deleteQueryEXT: remove,
        beginQueryEXT: (_target: number, query: unknown) => begin(query),
        endQueryEXT: () => end(),
        getQueryObjectEXT: readParameter,
    };

    const gl: GpuTimerContext = {
        getExtension: (name: string) => {
            if (options.flavor === "webgl2" && name === "EXT_disjoint_timer_query_webgl2") {
                return ext2;
            }
            if (options.flavor === "webgl1" && name === "EXT_disjoint_timer_query") {
                return ext1;
            }
            return null;
        },
        getParameter,
        ...(options.flavor === "webgl2"
            ? {
                  QUERY_RESULT,
                  QUERY_RESULT_AVAILABLE,
                  createQuery: create,
                  deleteQuery: remove,
                  beginQuery: (_target: number, query: unknown) => begin(query),
                  endQuery: () => end(),
                  getQueryParameter: readParameter,
              }
            : {}),
    };

    return {
        gl,
        queries,
        /** Query objects created and not deleted. */
        liveQueries: () => queries.filter((q) => !q.deleted).length,
        /** The GPU finishes every ended query. */
        finishAll: () => {
            for (const q of queries) {
                if (q.ended && !q.deleted) q.ready = true;
            }
        },
        /** The GPU finishes the n oldest ended queries that are not ready yet. */
        finishOldest: (n: number) => {
            for (const q of queries
                .filter((candidate) => candidate.ended && !candidate.deleted && !candidate.ready)
                .sort((a, b) => a.endOrder - b.endOrder)
                .slice(0, n)) {
                q.ready = true;
            }
        },
        /** The GPU was reset or throttled: the next read of GPU_DISJOINT_EXT is true, then it clears. */
        raiseDisjoint: () => {
            disjointFlag = true;
        },
        disjointReads: () => disjointReads,
        hasOpenQuery: () => open !== undefined,
    };
}
