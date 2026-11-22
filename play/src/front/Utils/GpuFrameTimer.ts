/**
 * GPU time per frame through a disjoint timer query, for the e2eHooks frame recorder. Nothing here touches the game:
 * the recorder hands it the renderer's GL context, and it never exists outside a recording.
 *
 * The default Phaser 4 context uses WebGL1. The HQ probe requests WebGL2 explicitly. WebGL1 only has
 * EXT_disjoint_timer_query, whose entry points carry an EXT suffix. WebGL2 has EXT_disjoint_timer_query_webgl2. A
 * small adapter hides the difference and names the method that ran, so that a number is never quoted without it.
 *
 * What a sample covers: the GL commands issued between begin() and end(), which the recorder places at PRE_RENDER and
 * POST_RENDER. Texture uploads done during the scene step and the browser compositor work for the DOM over the canvas
 * are outside it, and so are frames that did not render. Browsers may also coarsen timer-query results.
 *
 * A query result is ready some frames later, so results are read asynchronously, oldest first. A "disjoint" event
 * (the GPU was reset, throttled or switched) makes every query in flight meaningless: they are all dropped and
 * counted, never reported. Dropped frames are the ones where the GPU was disturbed, so a figure with many drops
 * understates the worst frames.
 */

export const GPU_TIMER_EXTENSION_WEBGL2 = "EXT_disjoint_timer_query_webgl2";
export const GPU_TIMER_EXTENSION_WEBGL1 = "EXT_disjoint_timer_query";

export type GpuTimerMethod = typeof GPU_TIMER_EXTENSION_WEBGL2 | typeof GPU_TIMER_EXTENSION_WEBGL1;

export type GpuTimerUnavailableReason = "no-webgl-context" | "extension-missing" | "query-creation-failed";

/**
 * The subset of a WebGL context the timer uses, so that a test can stand in for a GPU. The query methods are those of
 * WebGL2; a WebGL1 context has none of them and exposes its own on the extension object instead.
 */
export interface GpuTimerContext {
    readonly QUERY_RESULT?: number;
    readonly QUERY_RESULT_AVAILABLE?: number;
    getExtension(name: string): unknown;
    getParameter(pname: number): unknown;
    createQuery?(): unknown;
    deleteQuery?(query: unknown): void;
    beginQuery?(target: number, query: unknown): void;
    endQuery?(target: number): void;
    getQueryParameter?(query: unknown, pname: number): unknown;
}

/** EXT_disjoint_timer_query on a WebGL1 context. */
interface Webgl1TimerExtension {
    readonly TIME_ELAPSED_EXT: number;
    readonly GPU_DISJOINT_EXT: number;
    readonly QUERY_RESULT_EXT: number;
    readonly QUERY_RESULT_AVAILABLE_EXT: number;
    createQueryEXT(): unknown;
    deleteQueryEXT(query: unknown): void;
    beginQueryEXT(target: number, query: unknown): void;
    endQueryEXT(target: number): void;
    getQueryObjectEXT(query: unknown, pname: number): unknown;
}

/** EXT_disjoint_timer_query_webgl2: the query calls are on the context itself. */
interface Webgl2TimerExtension {
    readonly TIME_ELAPSED_EXT: number;
    readonly GPU_DISJOINT_EXT: number;
}

/** The five things the timer needs from a GL, whichever WebGL version provides them. */
interface QueryApi {
    method: GpuTimerMethod;
    create(): unknown;
    delete(query: unknown): void;
    begin(query: unknown): void;
    end(): void;
    isAvailable(query: unknown): boolean;
    result(query: unknown): unknown;
    isDisjoint(): boolean;
}

type Webgl2Context = GpuTimerContext &
    Required<
        Pick<
            GpuTimerContext,
            | "createQuery"
            | "deleteQuery"
            | "beginQuery"
            | "endQuery"
            | "getQueryParameter"
            | "QUERY_RESULT"
            | "QUERY_RESULT_AVAILABLE"
        >
    >;

function hasWebgl2Queries(gl: GpuTimerContext): gl is Webgl2Context {
    return (
        gl.createQuery !== undefined &&
        gl.deleteQuery !== undefined &&
        gl.beginQuery !== undefined &&
        gl.endQuery !== undefined &&
        gl.getQueryParameter !== undefined &&
        gl.QUERY_RESULT !== undefined &&
        gl.QUERY_RESULT_AVAILABLE !== undefined
    );
}

function webgl2Api(gl: GpuTimerContext, extension: Webgl2TimerExtension): QueryApi | undefined {
    if (!hasWebgl2Queries(gl)) {
        return undefined;
    }
    return {
        method: GPU_TIMER_EXTENSION_WEBGL2,
        create: () => gl.createQuery(),
        delete: (query) => gl.deleteQuery(query),
        begin: (query) => gl.beginQuery(extension.TIME_ELAPSED_EXT, query),
        end: () => gl.endQuery(extension.TIME_ELAPSED_EXT),
        isAvailable: (query) => Boolean(gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)),
        result: (query) => gl.getQueryParameter(query, gl.QUERY_RESULT),
        isDisjoint: () => Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT)),
    };
}

function webgl1Api(gl: GpuTimerContext, extension: Webgl1TimerExtension): QueryApi {
    return {
        method: GPU_TIMER_EXTENSION_WEBGL1,
        create: () => extension.createQueryEXT(),
        delete: (query) => extension.deleteQueryEXT(query),
        begin: (query) => extension.beginQueryEXT(extension.TIME_ELAPSED_EXT, query),
        end: () => extension.endQueryEXT(extension.TIME_ELAPSED_EXT),
        isAvailable: (query) => Boolean(extension.getQueryObjectEXT(query, extension.QUERY_RESULT_AVAILABLE_EXT)),
        result: (query) => extension.getQueryObjectEXT(query, extension.QUERY_RESULT_EXT),
        isDisjoint: () => Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT)),
    };
}

function findQueryApi(gl: GpuTimerContext): QueryApi | undefined {
    const extension2 = gl.getExtension(GPU_TIMER_EXTENSION_WEBGL2) as Webgl2TimerExtension | null | undefined;
    if (extension2) {
        const api = webgl2Api(gl, extension2);
        if (api) {
            return api;
        }
    }
    const extension1 = gl.getExtension(GPU_TIMER_EXTENSION_WEBGL1) as Webgl1TimerExtension | null | undefined;
    return extension1 ? webgl1Api(gl, extension1) : undefined;
}

export interface GpuTimingResult {
    /** GPU time of each measured frame, in milliseconds, in the order they were resolved. */
    samples: Float64Array;
    /**
     * Rendered frames that produced no usable sample: disjoint, unresolved at stop, no free query, a result that was
     * not a number, or a full sample buffer. A frame that did not render is not counted: it has nothing to measure.
     */
    dropped: number;
    disjointFrames: number;
}

/**
 * Where samples go when the caller wants them one by one (a rolling window) instead of in one array at finish().
 * `dropped` is called with the number of rendered frames that produced no usable sample.
 */
export interface GpuSampleSink {
    sample(gpuMs: number): void;
    dropped(count: number): void;
}

export interface GpuFrameTimer {
    /** Which extension is measuring. */
    readonly method: GpuTimerMethod;
    /** Starts timing the GPU commands issued from now until end(). */
    readonly pendingCount: number;
    begin(): void;
    end(): void;
    /** Collects every result the GPU has finished. Call once per frame; it never waits. */
    poll(): void;
    /** Collects what is ready, releases every GL object and returns the samples. The timer is unusable after. */
    finish(): GpuTimingResult;
}

export type GpuFrameTimerCreation =
    | { timer: GpuFrameTimer; unavailable?: undefined }
    | { timer?: undefined; unavailable: GpuTimerUnavailableReason };

// Queries in flight at once, which also caps the live query objects. The GPU runs a few frames behind the CPU.
const QUERY_POOL_SIZE = 8;
const NANOSECONDS_PER_MILLISECOND = 1e6;

/**
 * A timer on this context, or the reason there is none: many browsers hide the extension. With a `sink`, samples go to
 * it as they resolve and `capacity` is not used; without one they are kept, up to `capacity`, and returned by finish().
 */
export function createGpuFrameTimer(
    gl: GpuTimerContext | null | undefined,
    capacity: number,
    sink?: GpuSampleSink,
): GpuFrameTimerCreation {
    if (!gl) {
        return { unavailable: "no-webgl-context" };
    }
    const api = findQueryApi(gl);
    if (!api) {
        return { unavailable: "extension-missing" };
    }

    const free: unknown[] = [];
    for (let i = 0; i < QUERY_POOL_SIZE; i++) {
        const query = api.create();
        if (!query) {
            // A lost context hands out null queries: beginning one would throw inside a render listener
            for (const created of free) {
                api.delete(created);
            }
            return { unavailable: "query-creation-failed" };
        }
        free.push(query);
    }
    // The flag clears when read: a stale one from before the recording must not cost its first frame
    api.isDisjoint();

    const samples = new Float64Array(sink ? 0 : capacity);
    let sampleCount = 0;
    let dropped = 0;
    let disjointFrames = 0;
    const drop = (count: number) => {
        dropped += count;
        sink?.dropped(count);
    };
    // Ended queries waiting for their result, oldest first
    const pending: unknown[] = [];
    let active: unknown | undefined;
    let skipped = false;

    const replaceQuery = () => {
        const query = api.create();
        if (query) {
            free.push(query);
        }
    };

    const dropPending = () => {
        // A dropped query is deleted and replaced rather than reused: its state is unknown
        for (const query of pending.splice(0)) {
            api.delete(query);
            replaceQuery();
            drop(1);
        }
    };

    const poll = () => {
        if (pending.length === 0 || !api.isAvailable(pending[0])) {
            return;
        }
        // The flag clears when read and covers every query ended before it, so it is read once and applied to all
        if (api.isDisjoint()) {
            disjointFrames += pending.length;
            dropPending();
            return;
        }
        while (pending.length > 0 && api.isAvailable(pending[0])) {
            const query = pending.shift();
            const nanoseconds = api.result(query);
            if (typeof nanoseconds === "number" && Number.isFinite(nanoseconds) && nanoseconds >= 0) {
                if (sink) {
                    sink.sample(nanoseconds / NANOSECONDS_PER_MILLISECOND);
                } else if (sampleCount < samples.length) {
                    samples[sampleCount++] = nanoseconds / NANOSECONDS_PER_MILLISECOND;
                } else {
                    drop(1);
                }
            } else {
                // A failed read (null after an error or a lost context) is not a 0 ms frame
                drop(1);
            }
            free.push(query);
        }
    };

    // A frame that updated but did not render leaves its query open: it measures nothing, so it is discarded
    const discardActive = () => {
        if (active !== undefined) {
            api.end();
            api.delete(active);
            replaceQuery();
            active = undefined;
        }
    };

    return {
        timer: {
            method: api.method,
            get pendingCount() {
                return pending.length;
            },
            begin() {
                discardActive();
                skipped = false;
                active = free.pop();
                if (active === undefined) {
                    skipped = true;
                    return;
                }
                api.begin(active);
            },
            end() {
                if (active !== undefined) {
                    api.end();
                    pending.push(active);
                    active = undefined;
                } else if (skipped) {
                    // Every query was in flight: this frame goes unmeasured rather than stalling to wait for one
                    drop(1);
                    skipped = false;
                }
            },
            poll,
            finish() {
                discardActive();
                poll();
                // The GPU runs behind the CPU: what is still unresolved cannot be waited for without stalling it
                for (const query of pending.splice(0)) {
                    api.delete(query);
                    drop(1);
                }
                for (const query of free.splice(0)) {
                    api.delete(query);
                }
                return { samples: samples.slice(0, sampleCount), dropped, disjointFrames };
            },
        },
    };
}
