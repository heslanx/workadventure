import { GLASS, GROUND, POST, WATER } from "../domain/shaders";

const PROBE_VERTEX =
    "attribute vec2 aPos; varying vec2 outTexCoord; void main(){ outTexCoord = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }";

let shadersChecked: boolean | null = null;

/**
 * Compiles every fragment shader in a scratch WebGL context first: Phaser does not report a shader that fails to
 * compile, and the map then draws black (20/10/2026, a reserved word). Any failure leaves the room without effects.
 * Checked once per page.
 */
export function shadersCompile(): boolean {
    if (shadersChecked !== null) return shadersChecked;
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return (shadersChecked = false);
    shadersChecked = true;
    // Linked too, with a probe vertex shader: a fragment shader over this GPU's uniform budget compiles and then fails
    // to link, and the map draws black (plans/decor/001: 221 vectors on ANGLE/D3D9, POST once used 233).
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    if (!vertex) return (shadersChecked = false);
    gl.shaderSource(vertex, PROBE_VERTEX);
    gl.compileShader(vertex);
    for (const [name, source] of Object.entries({ water: WATER, ground: GROUND, glass: GLASS, post: POST })) {
        const shader = gl.createShader(gl.FRAGMENT_SHADER);
        if (!shader) {
            shadersChecked = false;
            continue;
        }
        gl.shaderSource(shader, source.replace(/^#pragma phaserTemplate\(.*\)$/gm, ""));
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(`[konclui] fx shader "${name}" does not compile; effects off:`, gl.getShaderInfoLog(shader));
            shadersChecked = false;
        } else {
            const program = gl.createProgram();
            gl.attachShader(program, vertex);
            gl.attachShader(program, shader);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                console.error(
                    `[konclui] fx shader "${name}" does not link; effects off:`,
                    gl.getProgramInfoLog(program),
                );
                shadersChecked = false;
            }
            gl.deleteProgram(program);
        }
        gl.deleteShader(shader);
    }
    gl.deleteShader(vertex);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return shadersChecked;
}
