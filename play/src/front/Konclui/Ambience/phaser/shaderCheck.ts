import { GLASS, GROUND, POST, POST_SHADED, WATER, forProbe } from "../domain/shaders";

const PROBE_VERTEX =
    "attribute vec2 aPos; varying vec2 outTexCoord; void main(){ outTexCoord = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }";

let shadersChecked: boolean | null = null;
let shadedChecked: boolean | null = null;

/** Compiles and links one fragment shader against the probe vertex shader; the reason when it does not. */
function programProblem(gl: WebGLRenderingContext, vertex: WebGLShader, source: string): string | undefined {
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!shader) return "no shader object";
    try {
        gl.shaderSource(shader, forProbe(source));
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            return `does not compile: ${gl.getShaderInfoLog(shader) ?? ""}`;
        }
        // Linked too, with a probe vertex shader: a fragment shader over this GPU's uniform budget compiles and then
        // fails to link, and the map draws black (plans/decor/001: 221 vectors on ANGLE/D3D9, POST once used 233).
        const program = gl.createProgram();
        gl.attachShader(program, vertex);
        gl.attachShader(program, shader);
        gl.linkProgram(program);
        const problem = gl.getProgramParameter(program, gl.LINK_STATUS)
            ? undefined
            : `does not link: ${gl.getProgramInfoLog(program) ?? ""}`;
        gl.deleteProgram(program);
        return problem;
    } finally {
        gl.deleteShader(shader);
    }
}

/** Runs `check` with a scratch context and its probe vertex shader, then gives the context back. */
function inScratchContext(check: (gl: WebGLRenderingContext, vertex: WebGLShader) => boolean): boolean {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return false;
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    if (!vertex) return false;
    try {
        gl.shaderSource(vertex, PROBE_VERTEX);
        gl.compileShader(vertex);
        return check(gl, vertex);
    } finally {
        gl.deleteShader(vertex);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
}

/**
 * Compiles every fragment shader in a scratch WebGL context first: Phaser does not report a shader that fails to
 * compile, and the map then draws black (20/10/2026, a reserved word). Any failure leaves the room without effects.
 * Checked once per page.
 */
export function shadersCompile(): boolean {
    if (shadersChecked !== null) return shadersChecked;
    shadersChecked = inScratchContext((gl, vertex) => {
        let ok = true;
        for (const [name, source] of Object.entries({ water: WATER, ground: GROUND, glass: GLASS, post: POST })) {
            const problem = programProblem(gl, vertex, source);
            if (problem) {
                console.error(`[konclui] fx shader "${name}" ${problem}; effects off`);
                ok = false;
            }
        }
        return ok;
    });
    return shadersChecked;
}

/**
 * Whether the camera pass with the shading (POST_SHADED) compiles and links on this GPU. When it does not, the room keeps
 * the legacy pass and its effects: only the shading is left out, with one warning. Checked once per page.
 */
export function shadedPostCompiles(): boolean {
    if (shadedChecked !== null) return shadedChecked;
    shadedChecked = inScratchContext((gl, vertex) => {
        const problem = programProblem(gl, vertex, POST_SHADED);
        if (problem) console.warn(`[konclui] fx shaded camera pass ${problem}; the shading is left out`);
        return problem === undefined;
    });
    return shadedChecked;
}
