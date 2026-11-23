/**
 * The contention canary of Gate 1: a fixed GPU pass in a context of its own, timed by the disjoint timer query, run
 * before and after each 300-frame window and never inside it.
 *
 * Why it exists. The GPU time of a frame is not the cost of the frame alone: another process drawing on the same GPU
 * (a screen recorder, a video encoder, a second browser) makes the game's frames collide with its work, and the clocks
 * move with the load. In the 2026-11-23 investigation (shading on and off alike) a foreign pass was enough to give 100
 * to 200 frame episodes of 18 to 36 ms GPU frames with a LOWER median, which is the signature of the two failing night
 * windows of that day. The canary costs the same thing every time it runs, so its time says what the GPU was doing to
 * work that is not ours: a window whose canary read far from the session's own baseline was measured on a different
 * machine than the rest, and is not compared with them.
 *
 * The numbers: a 256x256 pass, `CANARY.frames` frames per run. The shader's loop is a dependent chain of
 * transcendental functions, which a compiler cannot fold or unroll away; its cost on a GPU is not tuned here, and does
 * not need to be, because every judgement is a ratio to the session's own median.
 */

export const CANARY = {
    /** Frames drawn in one run (about two seconds at 60 Hz). */
    frames: 120,
    /** The pass's size in pixels, each side. */
    size: 256,
    /** Fewer samples than this share of the frames and the run says nothing: a dropped query is where the GPU fell behind. */
    minSampleShare: 0.6,
    /**
     * A run read outside these multiples of the session's baseline marks its window as measured under other load.
     *
     * PROVISIONAL, taken from the game itself on 2026-11-23 (M1 Max, headless Chrome on ANGLE Metal, the QA stack, 999
     * players, machine load average 25 to 60): 27 windows of 4 unstressed sessions, and 9 windows of a session with a
     * foreign pass drawing beside it (the investigation's stress.mjs, 800 iterations at 960x540).
     *  - unstressed, the canary reads 0.38 to 1.35 ms (session baselines 0.77 to 1.10), ratios to the session's own
     *    baseline 0.42 to 1.49. The game's frames share the GPU with the canary, so under the game it reads about twice
     *    what it does on the idle login page (0.43 ms) and moves up to 1.5x between windows with nothing foreign running.
     *  - stressed, 7 of 9 windows read 2.2 to 3.9x their baseline (the baseline itself was already raised).
     *  - the opposite signature, the canary running 2.4x FASTER (0.38 ms against 0.91), is in the unstressed night window
     *    that peaked at 14 ms GPU.
     * So the high edge sits between 1.49 and 2.2, set at 2.0, and the low edge at 0.5: under the quietest ordinary ratio
     * (0.60) and over the fast-GPU episode (0.42). The first values, 0.7 to 1.4, left out 4 of those 27 windows with no
     * foreign load. Re-derive both from more runs before reading them as a promise. A session that is loaded the whole
     * time has a loaded baseline and passes: the canary sees a load that changes within a session, not one that stays.
     */
    minRatio: 0.5,
    maxRatio: 2.0,
} as const;

/** What one run of the canary reports, as the page returns it. */
export interface CanaryRun {
    /** Median GPU time of the pass in ms; null when the browser offers no timer or the run produced too few samples. */
    readonly medianMs: number | null;
    /** Samples that resolved, and frames whose query was dropped (disjoint or never resolved). */
    readonly samples: number;
    readonly dropped: number;
    /** Why there is no figure, when there is none. */
    readonly reason?: string;
}

/** The canary read before and after a window; `null` for a run that was not made. */
export interface CanaryWindow {
    readonly before: CanaryRun | null;
    readonly after: CanaryRun | null;
}

/** Checks the object the page returned for one run, naming the field that changed shape. */
export function parseCanaryRun(value: unknown, path = "canary"): CanaryRun {
    if (typeof value !== "object" || value === null) {
        throw new Error(`gate 1: ${path} is missing`);
    }
    const run = value as Record<string, unknown>;
    const count = (name: string): number => {
        const field = run[name];
        if (typeof field !== "number" || !Number.isFinite(field) || field < 0) {
            throw new Error(`gate 1: ${path}.${name} is not a finite count`);
        }
        return field;
    };
    const medianMs = run.medianMs;
    if (medianMs !== null && (typeof medianMs !== "number" || !Number.isFinite(medianMs) || medianMs <= 0)) {
        throw new Error(`gate 1: ${path}.medianMs is neither null nor a positive number`);
    }
    const samples = count("samples");
    const dropped = count("dropped");
    const usable = medianMs !== null && samples >= CANARY.frames * CANARY.minSampleShare;
    const reason = typeof run.reason === "string" ? run.reason : undefined;
    return {
        medianMs: usable ? medianMs : null,
        samples,
        dropped,
        ...(usable
            ? {}
            : {
                  reason:
                      reason ??
                      `only ${samples} of ${CANARY.frames} canary frames have a GPU sample (${dropped} dropped)`,
              }),
    };
}

/** The median of the finite values, or null for none. */
export function medianOf(values: readonly number[]): number | null {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const middle = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function usableMedians(window: CanaryWindow): number[] {
    return [window.before, window.after].flatMap((run) => (run?.medianMs != null ? [run.medianMs] : []));
}

/** The session's baseline: the median of every usable run of every window. Null when no run produced a figure. */
export function canaryBaseline(windows: readonly (CanaryWindow | undefined)[]): number | null {
    return medianOf(windows.flatMap((window) => (window ? usableMedians(window) : [])));
}

/** How far one window's runs are from the baseline: the ratio furthest from 1 (in log), or null when it has no usable run. */
export function canaryRatio(window: CanaryWindow, baseline: number): number | null {
    const ratios = usableMedians(window).map((median) => median / baseline);
    if (ratios.length === 0) return null;
    return ratios.reduce((far, ratio) => (Math.abs(Math.log(ratio)) > Math.abs(Math.log(far)) ? ratio : far));
}

/**
 * Whether a window was measured under the load the session's baseline was. A window with no usable canary, or a session
 * with no baseline, is not flagged: nothing says it was disturbed (the report says the canary was not available).
 */
export function canaryComparable(window: CanaryWindow | undefined, baseline: number | null): boolean {
    if (!window || baseline === null) return true;
    const ratio = canaryRatio(window, baseline);
    return ratio === null || (ratio >= CANARY.minRatio && ratio <= CANARY.maxRatio);
}

/** The members of the two timer extensions the canary uses: the WebGL 1 one has the functions, the WebGL 2 one the constants. */
interface TimerExtension {
    readonly TIME_ELAPSED_EXT: number;
    readonly GPU_DISJOINT_EXT: number;
    readonly QUERY_RESULT_AVAILABLE_EXT: number;
    readonly QUERY_RESULT_EXT: number;
    createQueryEXT(): unknown;
    beginQueryEXT(target: number, query: unknown): void;
    endQueryEXT(target: number): void;
    getQueryObjectEXT(query: unknown, name: number): unknown;
    deleteQueryEXT(query: unknown): void;
}

/**
 * One run of the canary, written to be sent to the page as source text (`canaryExpression`): it uses only what the page
 * has (document, requestAnimationFrame, setTimeout, performance) and nothing of this module. It draws on a canvas of
 * its own that is never shown, so it does not touch the game's context, and it releases that context at the end.
 */
export async function canaryInPage(frames: number, size: number): Promise<unknown> {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const webgl2 = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false });
    const context = webgl2 ?? canvas.getContext("webgl", { antialias: false, depth: false, stencil: false });
    if (!context) return { medianMs: null, samples: 0, dropped: frames, reason: "no WebGL context for the canary" };
    // The two flavours of the extension differ in where the query functions live
    const two = webgl2 !== null;
    const gl = context as WebGL2RenderingContext;
    const ext: unknown = two
        ? gl.getExtension("EXT_disjoint_timer_query_webgl2")
        : context.getExtension("EXT_disjoint_timer_query");
    if (!ext) {
        return { medianMs: null, samples: 0, dropped: frames, reason: "no EXT_disjoint_timer_query for the canary" };
    }
    const timer = ext as unknown as TimerExtension;
    const compile = (type: number, source: string): WebGLShader => {
        const shader = gl.createShader(type) as WebGLShader;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(`canary shader: ${String(gl.getShaderInfoLog(shader))}`);
        }
        return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(
        program,
        compile(gl.VERTEX_SHADER, "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }"),
    );
    gl.attachShader(
        program,
        compile(
            gl.FRAGMENT_SHADER,
            "precision highp float;" +
                "void main() {" +
                "  float x = gl_FragCoord.x * 0.0039 + gl_FragCoord.y * 0.0071;" +
                "  for (int i = 0; i < 400; i++) { x = fract(sin(x) * 43758.5453 + 0.37); }" +
                "  gl_FragColor = vec4(x, x, x, 1.0);" +
                "}",
        ),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`canary program: ${String(gl.getProgramInfoLog(program))}`);
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, size, size);

    const create = (): unknown => (two ? gl.createQuery() : timer.createQueryEXT());
    const begin = (query: unknown): void =>
        two
            ? gl.beginQuery(timer.TIME_ELAPSED_EXT, query as WebGLQuery)
            : timer.beginQueryEXT(timer.TIME_ELAPSED_EXT, query);
    const end = (): void => (two ? gl.endQuery(timer.TIME_ELAPSED_EXT) : timer.endQueryEXT(timer.TIME_ELAPSED_EXT));
    const available = (query: unknown): boolean =>
        Boolean(
            two
                ? gl.getQueryParameter(query as WebGLQuery, gl.QUERY_RESULT_AVAILABLE)
                : timer.getQueryObjectEXT(query, timer.QUERY_RESULT_AVAILABLE_EXT),
        );
    const result = (query: unknown): number =>
        Number(
            two
                ? gl.getQueryParameter(query as WebGLQuery, gl.QUERY_RESULT)
                : timer.getQueryObjectEXT(query, timer.QUERY_RESULT_EXT),
        );
    const remove = (query: unknown): void => (two ? gl.deleteQuery(query as WebGLQuery) : timer.deleteQueryEXT(query));

    const samples: number[] = [];
    let dropped = 0;
    let pending: unknown[] = [];
    // A disjoint event (the GPU was reset or throttled) invalidates every query still in flight
    const poll = (): void => {
        const disjoint = Boolean(gl.getParameter(timer.GPU_DISJOINT_EXT));
        const still: unknown[] = [];
        for (const query of pending) {
            if (disjoint) {
                dropped += 1;
                remove(query);
            } else if (available(query)) {
                samples.push(result(query) / 1e6);
                remove(query);
            } else {
                still.push(query);
            }
        }
        pending = still;
    };
    const nextFrame = (): Promise<void> =>
        new Promise<void>((resolve) => {
            // A hidden tab never fires requestAnimationFrame: the timeout keeps the run moving
            const fallback = setTimeout(resolve, 100);
            requestAnimationFrame(() => {
                clearTimeout(fallback);
                resolve();
            });
        });
    try {
        for (let frame = 0; frame < frames; frame++) {
            await nextFrame();
            const query = create();
            begin(query);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            end();
            pending.push(query);
            poll();
        }
        const until = performance.now() + 2000;
        while (pending.length > 0 && performance.now() < until) {
            await nextFrame();
            poll();
        }
    } finally {
        for (const query of pending) remove(query);
        dropped += pending.length;
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    samples.sort((a, b) => a - b);
    const middle = samples.length >> 1;
    const medianMs =
        samples.length === 0
            ? null
            : samples.length % 2 === 1
              ? samples[middle]
              : (samples[middle - 1] + samples[middle]) / 2;
    return { medianMs: medianMs !== null && medianMs > 0 ? medianMs : null, samples: samples.length, dropped };
}

/** The source text that runs one canary in the page and resolves to its report (sent with page.evaluate(text)). */
export function canaryExpression(frames: number = CANARY.frames, size: number = CANARY.size): string {
    return `(${canaryInPage.toString()})(${JSON.stringify(frames)}, ${JSON.stringify(size)})`;
}
