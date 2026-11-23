/**
 * The Phaser probe of the shader lab (`--phaser`): what the lab's bare WebGL context cannot say. It builds a real
 * `Phaser.Game` (4.2.1, WebGL1 by default, WebGL2 with --webgl2), attaches the real `POST_SHADED` through the real
 * `addPostFilter`, marks avatars with the real `registerPeopleBlend`, and reads back:
 *
 *  - the draw calls of a frame with the marks on and off, for a crowd of 0, 24 and 80 avatars interleaved with props;
 *  - the alpha the avatars leave in the colour buffer before the pass (0 on their opaque pixels, 1 elsewhere), and a prop
 *    drawn after an avatar giving alpha 1 back (the occlusion);
 *  - the final canvas alpha, which must be 255 everywhere;
 *  - the blend mode as the renderer holds it, and that two games' registrations do not collide;
 *  - the row order of the cast texture through POST_SHADED (one marked pixel must land on its map row);
 *  - the pixels the pass changes with the mark off against on, and a camera at half a pixel against a whole one;
 *  - the whole frame's GPU time (`EXT_disjoint_timer_query`) and the CPU time of the render call, marks on and off.
 *
 * It needs no built map and no server: the scene is coloured rectangles, depth-sorted as the office's are. It is a probe, not a
 * gate: Gate 1 (benchmark/frame-probe) measures the real office.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadPlaywright } from "../frame-probe/browser";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const AMBIENCE = join(REPO, "play", "src", "front", "Konclui", "Ambience");
const UTILS = join(REPO, "play", "src", "front", "Utils");

/** The page's entry: the probe runs in the browser and returns plain JSON. */
function entry(): string {
    return `
import * as Phaser from "phaser";
import { addPostFilter } from ${JSON.stringify(join(AMBIENCE, "phaser", "postFilter.ts"))};
import { registerPeopleBlend } from ${JSON.stringify(join(AMBIENCE, "phaser", "peopleMark.ts"))};
import { createGpuFrameTimer } from ${JSON.stringify(join(UTILS, "GpuFrameTimer.ts"))};

const W = 200, H = 120, MW = W + 64;   // the map is 64 px wider than the view, so a scroll up to 64 stays inside it

function canvasTex(scene, key, w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")); scene.textures.addCanvas(key, c);
}

/** One run of a scene: { marked, crowd, gl2, castMarker, scrollX }. Resolves after a few frames with plain numbers. */
function run(options) {
  const { marked, crowd, gl2, castMarker, scrollX, timeFrames } = options;
  const holder = document.createElement("div"); holder.id = "g"; document.body.replaceChildren(holder);
  return new Promise((resolve, reject) => {
    let drawCalls = 0, frames = 0, game;
    const config = { type: Phaser.WEBGL, width: W, height: H, parent: "g", backgroundColor: "#0e2236",
      render: { pixelArt: true, antialias: false, antialiasGL: false, preserveDrawingBuffer: true, ...(gl2 ? { forceWebGL2: true } : {}) },
      fps: { target: 60 },
      callbacks: {},
      scene: { create() {
        const scene = this;
        const renderer = scene.renderer;
        canvasTex(scene, "bg", W, H, (g) => { g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, W, H); });
        canvasTex(scene, "masks", MW, H, (g) => { g.fillStyle = "#000"; g.fillRect(0, 0, MW, H); });
        canvasTex(scene, "av", 20, 20, (g) => { g.fillStyle = "#c06020"; g.fillRect(0, 0, 20, 20); g.clearRect(0, 0, 8, 8); });
        canvasTex(scene, "prop", 20, 40, (g) => { g.fillStyle = "#406090"; g.fillRect(0, 0, 20, 40); });
        scene.add.image(0, 0, "bg").setOrigin(0).setDepth(0);
        const av = scene.add.sprite(60, 50, "av").setOrigin(0).setDepth(5);
        scene.add.image(70, 40, "prop").setOrigin(0).setDepth(6);   // covers the avatar's right half, drawn after it
        const id = registerPeopleBlend(renderer);
        if (marked) av.setBlendMode(id);
        // the crowd: each avatar among props in depth order, as the office's people are
        for (let i = 0; i < crowd; i++) {
          const a = scene.add.sprite(100 + (i % 10) * 9, (i * 7) % 100, "av").setOrigin(0).setScale(0.4).setDepth(10 + 2 * i);
          if (marked) a.setBlendMode(id);
          scene.add.image(100 + (i % 10) * 9, (i * 7) % 100, i % 2 ? "prop" : "bg").setOrigin(0).setScale(0.2).setDepth(11 + 2 * i);
        }
        // the cast texture: a map of W x H with ONE marked pixel (B = 255: a hard contact band) on a floor that receives (A = 0),
        // at map (3, 1): the buffer row of map row y is H - 1 - y, written as the runtime writes it
        const data = new Uint8Array(MW * H * 4);
        if (castMarker) { const j = ((H - 1 - 1) * MW + 3) * 4; data[j + 2] = 255; }
        const cast = renderer.createUint8ArrayTexture(data, MW, H, false, false);
        const masks = scene.textures.get("masks").get().source.glTexture;
        const uni = { uWorld: [scrollX || 0, 0, W, H], uMap: [MW, H], uRes: [W, H], uInside: [1, 1, 1], uOutside: [1, 1, 1], uLawn: [1, 1, 1], uWall: [1, 1, 1], uVivid: [1, 1, 1], uFacade: [1, 1, 1], uWarm: [1, 1, 1], uToe: 1, uDarks: 0, uSat: 1, uNight: 0,
          "uL[0]": new Float32Array(128), "uLC[0]": new Float32Array(128), "uLClip[0]": new Float32Array(128), uLN: 0, "uEm[0]": new Float32Array(96), "uEmT[0]": new Float32Array(16), uEmN: 0, uShafts: [0, 58, 24, 0.84], uCloud: [0, 236, 0, 0], "uLock[0]": new Float32Array(24), uLockN: 0, uFrost: [0.59, 0.8, 0.76],
          "uSteps[0]": new Float32Array(128), uStepN: 0, uLime: [0.5, 0.8, 0.4], uCream: [0.9, 0.9, 0.5], "uAv[0]": new Float32Array(32), uAvN: 0, uVignette: [0, 0.62], uReveal: [0, 0, -1, 0], uInk: [0.04, 0.04, 0.12], uNormalsOn: 0,
          uShade: [2, 0.42, 0.6, 0.9], uKey: [-0.7071, 0.7071, 1.6, 1], uKeyShade: [0.5, 0.58, 0.8] };
        scene.cameras.main.setScroll(scrollX || 0, 0);
        const filter = addPostFilter(renderer, scene.cameras.main, { postUniforms: () => uni, masksTexture: () => masks, castTexture: () => cast }, false, true);
        filter.controller.active = true;
        const gl = renderer.gl;
        const original = gl.drawElements.bind(gl);
        gl.drawElements = (...a) => { drawCalls += 1; return original(...a); };
        let timer = null;
        const samples = [];
        if (timeFrames) {
          const made = createGpuFrameTimer(gl, 0, { sample: (ms) => samples.push(ms), dropped: () => undefined });
          if (made.timer) timer = made.timer;
        }
        let cpu = 0, cpuFrames = 0, started = 0;
        renderer.on(Phaser.Renderer.Events.PRE_RENDER, () => { started = performance.now(); if (timer) timer.begin(); });
        renderer.on(Phaser.Renderer.Events.POST_RENDER, () => {
          if (timer) { timer.end(); timer.poll(); }
          if (frames > 20) { cpu += performance.now() - started; cpuFrames += 1; }
        });
        const finish = () => {
          const out = document.createElement("canvas"); out.width = W; out.height = H;
          const g = out.getContext("2d", { willReadFrequently: true });
          g.drawImage(game.canvas, 0, 0);
          const px = g.getImageData(0, 0, W, H).data;
          // the colour buffer before the pass: the same scene with the pass off, read from the canvas
          resolve({ id, table: renderer.blendModes.length, blend: renderer.blendModes[id] && { func: Array.from(renderer.blendModes[id].func), equation: Array.from(renderer.blendModes[id].equation) },
            px: Array.from(px), calls: drawCalls, version: gl.getParameter(gl.VERSION), renderer: (() => { const e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown"; })(),
            gpu: samples.slice(), gpuMethod: timer ? timer.method : null, cpuMs: cpuFrames ? cpu / cpuFrames : null });
        };
        scene.events.on("postupdate", () => {
          frames += 1;
          if (frames === 6) drawCalls = 0;
          if (frames === (timeFrames ? 160 : 8)) {
            if (timer) {
              // let the last queries resolve
              let waits = 0;
              const wait = () => { timer.poll(); if (timer.pendingCount > 0 && waits++ < 30) requestAnimationFrame(wait); else { timer.finish(); finish(); } };
              wait();
            } else finish();
          }
        });
      } } };
    try { game = new Phaser.Game(config); } catch (e) { reject(e); }
  });
}
window.runPhaserProbe = run;
`;
}

interface Run {
    readonly id: number;
    readonly table: number;
    readonly blend: { func: number[]; equation: number[] } | null;
    readonly px: number[];
    readonly calls: number;
    readonly version: string;
    readonly renderer: string;
    readonly gpu: number[];
    readonly gpuMethod: string | null;
    readonly cpuMs: number | null;
}

function summarize(values: readonly number[]): Record<string, number> | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
        n: sorted.length,
        mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
        p50: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        max: sorted[sorted.length - 1],
    };
}

const pixelAt = (r: Run, x: number, y: number): number[] => r.px.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 4);

/** Runs the probe and writes `phaser-probe.json` into `out`. Returns the process exit code. */
export async function runPhaserProbe(out: string, gl2: boolean, channel: "chrome" | "chromium"): Promise<number> {
    const built = await build({
        stdin: { contents: entry(), resolveDir: join(REPO, "play"), loader: "js", sourcefile: "phaser-probe-entry.js" },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "es2022",
        logLevel: "silent",
        define: { "process.env.NODE_ENV": '"production"' },
    });
    const playwright = await loadPlaywright(undefined);
    const browser = await playwright.chromium.launch({
        headless: true,
        channel,
        args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
    });
    let code = 0;
    try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => console.error(`[page error] ${error.message}`));
        await page.setContent("<html><body></body></html>");
        await page.addScriptTag({ content: built.outputFiles[0].text });
        const go = (options: Record<string, unknown>): Promise<Run> =>
            page.evaluate(
                (o) => (window as unknown as { runPhaserProbe: (q: unknown) => Promise<unknown> }).runPhaserProbe(o),
                { gl2, ...options },
            ) as Promise<Run>;
        const unmarked = await go({ marked: false, crowd: 0 });
        const marked = await go({ marked: true, crowd: 0 });
        const second = await go({ marked: true, crowd: 0 });
        const calls: Record<string, unknown> = {};
        for (const n of [0, 24, 80]) {
            const a = n === 0 ? unmarked : await go({ marked: false, crowd: n });
            const b = n === 0 ? marked : await go({ marked: true, crowd: n });
            calls[String(n)] = { unmarked: a.calls, marked: b.calls, extra: b.calls - a.calls };
        }
        const markerOn = await go({ marked: false, crowd: 0, castMarker: true });
        const markerOff = unmarked;
        // a camera at half a map pixel: the world-keyed lookups (the cast, the masks) take whole map pixels, so the marked pixel
        // of the cast appears where a camera at the next whole pixel puts it, never between two screen pixels
        const marker = async (scrollX: number): Promise<[number, number][]> => {
            const a = await go({ marked: false, crowd: 0, castMarker: false, scrollX });
            const b = await go({ marked: false, crowd: 0, castMarker: true, scrollX });
            const found: [number, number][] = [];
            for (let y = 0; y < 120; y++)
                for (let x = 0; x < 200; x++)
                    if (pixelAt(a, x, y).some((v, k) => Math.abs(v - pixelAt(b, x, y)[k]) > 2)) found.push([x, y]);
            return found;
        };
        const atZero = await marker(0);
        const atHalf = await marker(0.5);
        const atOne = await marker(1);
        const timedOff = await go({ marked: false, crowd: 80, timeFrames: true });
        const timedOn = await go({ marked: true, crowd: 80, timeFrames: true });
        const probes: Record<string, [number, number]> = {
            background: [10, 10],
            "avatar body": [62, 60],
            "avatar transparent corner": [62, 52],
            "avatar under the prop": [75, 60],
            prop: [80, 60],
        };
        const pixels: Record<string, unknown> = {};
        for (const [name, [x, y]] of Object.entries(probes))
            pixels[name] = { unmarked: pixelAt(unmarked, x, y), marked: pixelAt(marked, x, y) };
        let minAlpha = 255;
        for (let i = 3; i < marked.px.length; i += 4) minAlpha = Math.min(minAlpha, marked.px[i]);
        let differs = 0;
        const box = [999, 999, -1, -1];
        for (let y = 0; y < 120; y++)
            for (let x = 0; x < 200; x++) {
                const a = pixelAt(unmarked, x, y);
                const b = pixelAt(marked, x, y);
                if (a.some((v, k) => v !== b[k])) {
                    differs += 1;
                    box[0] = Math.min(box[0], x);
                    box[1] = Math.min(box[1], y);
                    box[2] = Math.max(box[2], x);
                    box[3] = Math.max(box[3], y);
                }
            }
        // the cast marker: the one marked pixel must be darkened where the map row says (3, 1) and nowhere else
        const darkened: [number, number][] = [];
        for (let y = 0; y < 120; y++)
            for (let x = 0; x < 200; x++) {
                const a = pixelAt(markerOff, x, y);
                const b = pixelAt(markerOn, x, y);
                if (a.some((v, k) => Math.abs(v - b[k]) > 2)) darkened.push([x, y]);
            }
        const avatarOnly = (r: Run, x: number, y: number) => pixelAt(r, x, y);
        const result = {
            gl: marked.version,
            renderer: marked.renderer,
            blend: {
                id: marked.id,
                tableLength: marked.table,
                registeredAs: marked.blend,
                expectFunc: "ONE, ONE_MINUS_SRC_ALPHA, ZERO, ONE_MINUS_SRC_ALPHA",
                secondRegistrationSameId: second.id === marked.id,
            },
            drawCallsPerFrame: calls,
            finalCanvasMinAlpha: minAlpha,
            pixelsThatDifferMarkedVsUnmarked: { count: differs, box },
            pixels,
            avatarPixelAfterProp: avatarOnly(marked, 75, 60),
            castMarker: {
                expectedMapPixel: [3, 1],
                darkenedPixels: darkened.length,
                darkenedAt: darkened.slice(0, 5),
                rowOrderOk: darkened.length === 1 && darkened[0][0] === 3 && darkened[0][1] === 1,
            },
            camera: {
                markerAtScroll: { "0": atZero, "0.5": atHalf, "1": atOne },
                halfPixelScrollPutsTheMarkerWhereTheNextWholePixelDoes:
                    atHalf.length === 1 &&
                    atOne.length === 1 &&
                    atHalf[0][0] === atOne[0][0] &&
                    atHalf[0][0] !== atZero[0]?.[0],
                note: "the cast marker is at map (3, 1); the pass samples the world on whole map pixels, so a scroll of 0.5 puts it on the screen pixel a scroll of 1 does, one pixel left of where scroll 0 puts it",
            },
            frame: {
                note: "80 avatars among props, 200x120, whole frame of the real Phaser renderer; CPU is the render call, GPU is the timer query around it",
                marksOff: { gpuMs: summarize(timedOff.gpu), gpuMethod: timedOff.gpuMethod, cpuMs: timedOff.cpuMs },
                marksOn: { gpuMs: summarize(timedOn.gpu), gpuMethod: timedOn.gpuMethod, cpuMs: timedOn.cpuMs },
            },
        };
        mkdirSync(resolve(out), { recursive: true });
        const file = join(resolve(out), "phaser-probe.json");
        writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
        console.log(`phaser probe: ${file}`);
        console.log(
            `  ${marked.version} on ${marked.renderer}; blend id ${marked.id} (table ${marked.table}); final canvas alpha min ${minAlpha}`,
        );
        console.log(`  draw calls a frame, 0 / 24 / 80 avatars: ${JSON.stringify(calls)}`);
        console.log(
            `  cast row order ok: ${result.castMarker.rowOrderOk} (darkened ${JSON.stringify(darkened.slice(0, 3))})`,
        );
        console.log(
            `  camera: marker at scroll 0 / 0.5 / 1: ${JSON.stringify([atZero[0], atHalf[0], atOne[0]])}; half a pixel lands as the next whole pixel: ${result.camera.halfPixelScrollPutsTheMarkerWhereTheNextWholePixelDoes}`,
        );
        if (
            !result.castMarker.rowOrderOk ||
            minAlpha !== 255 ||
            !result.camera.halfPixelScrollPutsTheMarkerWhereTheNextWholePixelDoes
        )
            code = 2;
    } finally {
        await browser.close();
    }
    return code;
}

export function phaserProbeAvailable(): boolean {
    return existsSync(join(AMBIENCE, "phaser", "peopleMark.ts"));
}
