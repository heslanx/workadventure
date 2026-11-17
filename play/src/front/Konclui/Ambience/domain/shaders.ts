// GLSL of the office's ambience effects. Every effect works on whole art pixels (floor of the world
// position) and in palette steps or a few bands, so it stays pixel art at any zoom: no smooth gradients, no dither.
// Images are uploaded with Y flipped (Phaser 4 TextureSource flipY), hence `1.0 - v` when sampling them.

const HEAD = `#pragma phaserTemplate(shaderName)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 outTexCoord;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n + 17.17)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 imageUV(vec2 px, vec2 size) { vec2 uv = (px + 0.5) / size; return vec2(uv.x, 1.0 - uv.y); }
`;

// The pool's open water, repainted over the still floor tiles: refraction resamples the still colours (the bed's stones
// wobble by one or two pixels), the tones come out in uPal (the shader's grade of pool.WATER), caustics draw bending
// webs of light on the bed with a bright core, a halo in the shallows and white knots where two webs cross, fading to
// thin cores in the deep; glitter, sun stars, rings where koi swim and an occasional ripple twinkle on the surface.
// uTick advances with the tile animations (220 ms).
export const WATER = `${HEAD}
uniform sampler2D uWater;
uniform sampler2D uData;
uniform vec4 uRect;
uniform float uTick;
uniform float uSun;
uniform vec3 uPal[8];
uniform vec3 uHalf[8];
uniform vec3 uRing[2];
uniform vec4 uStars[5];
uniform vec3 uGlint[2];
uniform vec3 uLine;
uniform vec3 uCore;
uniform vec3 uHalo;
uniform vec3 uWhite;
uniform vec4 uRings[16];
uniform int uRingN;
vec4 water(vec2 p) { return texture2D(uWater, imageUV(p, uRect.zw)); }
vec4 data(vec2 p) { return texture2D(uData, imageUV(p, uRect.zw)); }
vec3 pal(float i) {
  vec3 c = uPal[0];
  for (int k = 1; k < 8; k++) if (float(k) == i) c = uPal[k];
  return c;
}
vec3 halfTone(float i) {                                   // the tone halfway between step i and the lighter step i - 1
  vec3 c = uHalf[0];
  for (int k = 1; k < 8; k++) if (float(k) == i) c = uHalf[k];
  return c;
}
// distance to the nearest cell edge of a drifting Voronoi web (F2 - F1), in px
float web(vec2 p, float cell, float t, float seed) {
  vec2 g = p / cell, i = floor(g), f = fract(g);
  float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = h22(i + o + seed);
    vec2 pt = o + 0.5 + 0.36 * vec2(sin(t * (0.5 + 0.4 * r.x) + 6.283 * r.y), cos(t * (0.45 + 0.35 * r.y) + 6.283 * r.x));
    float d = length(pt - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return (d2 - d1) * cell;
}
void main() {
  vec2 p = floor(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uRect.zw);
  vec4 d0 = data(p);
  if (d0.a < 0.5) { gl_FragColor = vec4(0.0); return; }
  float t = uTick * 0.22;
  float depth = d0.g * 255.0;
  vec2 q = p;
  if (depth > 4.0) {                                   // refraction: one-pixel offsets in broad drifting patches
    float nx = vnoise(p / 30.0 + vec2(t * 0.22, t * 0.08));
    float ny = vnoise(p / 28.0 + vec2(-t * 0.07, t * 0.2) + 31.0);
    vec2 o = vec2(step(0.64, nx) - step(nx, 0.36), step(0.66, ny) - step(ny, 0.34));
    if (data(p + o).a > 0.5) q = p + o;
  }
  vec4 dq = data(q);
  vec3 c = water(q).rgb;
  float stepIdx = floor(dq.r * 255.0 + 0.5);
  float flags = floor(dq.b * 255.0 + 0.5);
  bool calm = mod(flags, 2.0) > 0.5;
  bool shade = flags >= 4.0;
  bool tone = stepIdx < 8.0;
  if (tone) c = pal(stepIdx);
  bool sunny = uSun > 0.3;                             // caustics, glitter and stars are the sun's: none at night
  if (sunny && (calm || shade) && tone && depth > 1.5) {
    // caustics: a 44 px web drawn as light and a 72 px web drawn as glow, both bent by a smooth warp; brightness by
    // depth: in the shallows a pale core here and there, a one-step halo and a half-step glow; mid depth a one-step
    // core and a half-step glow; the deep a half-step line. Knots where the two webs cross.
    float shallow = 1.0 - smoothstep(10.0, 70.0, depth + 14.0 * (vnoise(p / 23.0) - 0.5));
    vec2 warp = (vec2(vnoise(p / 38.0 + t * 0.2), vnoise(p / 41.0 - t * 0.17 + 17.0)) * 2.0 - 1.0) * 13.0
              + (vec2(vnoise(p / 11.0 + t * 0.4 + 5.0), vnoise(p / 11.0 - t * 0.35 + 9.0)) * 2.0 - 1.0) * 4.5;
    vec2 pw = p + 0.5 + warp;
    float a = web(pw, 44.0, t * 0.9, 3.0), b = web(pw + 31.0, 72.0, t * 0.7, 11.0);
    float wv = vnoise(p / 19.0 + vec2(t * 0.3, -t * 0.2));
    float width = 0.9 + 0.7 * wv * shallow;
    bool knot = a < width && b < width * 1.2 && depth > 8.0 && wv > 0.5 && stepIdx >= 1.0;
    if (depth < 6.0) {                                 // by the bank: only a soft line, no core to draw a bar
      if (a < width && wv > 0.5) c = halfTone(stepIdx);
    } else if (shallow > 0.62) {                       // a 2 px core, a one-step halo, a wide half-step glow
      if (knot) c = uWhite;
      else if (a < width * 1.1 && wv > 0.4 && stepIdx >= 2.0) c = uCore;
      else if (a < width + 0.8 && stepIdx >= 1.0) c = pal(stepIdx - 1.0);
      else if ((a < width + 6.0 && wv > 0.2) || b < width + 1.0) c = halfTone(stepIdx);
    } else if (shallow > 0.3) {                        // mid water: core two steps up, halo one, glow half
      if (knot) c = pal(max(stepIdx - 2.0, 0.0));
      else if (a < 0.8 && wv > 0.55) c = pal(max(stepIdx - 2.0, 0.0));
      else if (a < 1.8) c = pal(max(stepIdx - 1.0, 0.0));
      else if (a < 5.5 && wv > 0.2) c = halfTone(stepIdx);
    } else if (a < 1.2 && wv > 0.45 && stepIdx <= 5.0) {
      c = halfTone(stepIdx);                           // the deep: a soft line, never across the darkest pools
    }
  }
  if (sunny && calm && depth > 3.0) {                  // glitter: round 1 px specks, aqua, more in the shallows
    vec2 cell = floor(p / 7.0);
    vec2 at = cell * 7.0 + floor(h22(cell + 3.0) * 6.0);
    float live = h21(cell + floor(uTick * 0.5) * 1.37);
    float lit = depth < 24.0 ? 0.25 : depth < 48.0 ? 0.22 : 0.06;
    if (p == at && live > 1.0 - lit) c = live > 1.0 - lit * 0.1 ? uWhite : depth < 24.0 ? uCore : pal(max(stepIdx - 2.0, 0.0));
  }
  if (sunny && calm) {                                 // sun stars: fixed slots over open water, staggered
    for (int i = 0; i < 5; i++) {
      vec4 st = uStars[i];
      float k = mod(uTick + st.z, 15.0);
      if (k >= 12.0) continue;
      float len = k < 1.0 ? 3.0 : k < 2.0 ? 6.0 : k < 10.0 ? 9.0 : k < 11.0 ? 6.0 : 3.0;
      vec2 rel = p - st.xy;
      float ax = abs(rel.x), ay = abs(rel.y);
      if (ax <= 1.0 && ay <= 1.0) c = vec3(1.0);
      else if ((rel.y == 0.0 && ax <= len) || (rel.x == 0.0 && ay <= len)) c = ax + ay <= len - 1.0 ? uWhite : uGlint[0];
      else if (ax + ay <= 3.0) c = pal(max(stepIdx - 1.0, 0.0));
      else if (ax + ay <= 6.0) c = halfTone(stepIdx);
    }
  }
  for (int i = 0; i < 16; i++) {                       // rings where the koi swim: aqua, opening and fading
    if (i >= uRingN || !calm) break;
    vec4 ring = uRings[i];
    float age = uTick - ring.z;
    float radius = 8.0 + age * 1.5;
    if (age < 0.0 || radius > 30.0) continue;
    vec2 rel = p + 0.5 - ring.xy;
    float d = length(vec2(rel.x, rel.y / 0.92));
    if (abs(d - radius) < 0.75) {
      float glint = h21(vec2(floor(atan(rel.y, rel.x) * radius / 3.0), ring.w));
      c = radius > 26.0 ? halfTone(stepIdx) : glint > 0.8 ? uRing[1] : uRing[0];
    }
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

// The panes of glass: a tint by the hour (sky blue by day, slate at night, so the panes read as glass) and a sheen
// sliding over them as the camera moves (a reflection is seen from where you stand): white diagonal bands with a pale
// halo and a thin streak, whole pixels, never darker than the pane, and each pane's lit inner edge. The panes' painted
// streaks (128 in the mask) stay near white when the tint darkens the glass. Costs nothing while the camera is still.
// Between the tint and the sheen, the mirror's still part (rules in mirror.ts): the pieces standing in front of the
// glass, seen from their other side, from an opaque atlas of one 64 px band per row of glass faces (its colour above,
// its strength below), cooled; the people and pets in front of the glass are pictures above this quad instead, and the
// panes they cross (uMirrorLive) are left to those pictures, which draw the pieces there too, nearest the glass on top.
export const GLASS = `${HEAD}
uniform sampler2D uGlass;
uniform vec2 uMap;
uniform vec2 uCam;
uniform float uStrength;
uniform vec4 uTint;
uniform sampler2D uMirror;
uniform vec4 uMirrorRows;                                 // each band's face row top (px), -1 unused
uniform vec2 uMirrorSize;                                 // map width x 128 per band
uniform vec3 uMirrorTint;
uniform float uMirrorOn;
uniform vec4 uMirrorLive[8];                              // panes drawn by the pictures above: x0, x1, y0, y1 (px)
uniform int uMirrorLiveN;
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }          // premultiplied
vec4 mirrorBand(vec2 p, float top, float band) {
  if (top < 0.0 || p.y < top || p.y >= top + 64.0) return vec4(0.0);
  float row = band * 64.0 + p.y - top;
  vec3 c = texture2D(uMirror, imageUV(vec2(p.x, row), uMirrorSize)).rgb;
  float s = texture2D(uMirror, imageUV(vec2(p.x, row + uMirrorSize.y * 0.5), uMirrorSize)).r;
  return vec4(c * uMirrorTint * s, s);
}
bool live(vec2 p) {
  for (int i = 0; i < 8; i++) {
    if (i >= uMirrorLiveN) break;
    vec4 r = uMirrorLive[i];
    if (p.x >= r.x && p.x < r.y && p.y >= r.z && p.y < r.w) return true;
  }
  return false;
}
void main() {
  vec2 p = floor(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uMap);
  float g = texture2D(uGlass, imageUV(p, uMap)).r;
  if (g < 0.25) { gl_FragColor = vec4(0.0); return; }
  if (g < 0.75) { float a = 0.85 * uTint.a; gl_FragColor = vec4(vec3(a), a); return; }
  bool rim = texture2D(uGlass, imageUV(p - vec2(0.0, 1.0), uMap)).r < 0.75 || texture2D(uGlass, imageUV(p - vec2(1.0, 0.0), uMap)).r < 0.75;
  if (rim) { gl_FragColor = vec4(vec3(0.55), 0.55); return; }      // a pane's lit inner edge, top and left
  float f = mod(p.x + p.y * 0.85 - uCam.x * 0.42 - uCam.y * 0.3, 290.0);
  float a = f >= 20.0 && f < 32.0 ? 0.85 : (f >= 15.0 && f < 20.0) || (f >= 32.0 && f < 37.0) ? 0.3 : f >= 41.0 && f < 43.0 ? 0.9 : 0.0;
  a *= uStrength;
  vec4 tint = vec4(uTint.rgb * uTint.a, uTint.a);
  vec4 mirror = vec4(0.0);
  if (uMirrorOn > 0.5 && !live(p)) {
    mirror = mirrorBand(p, uMirrorRows.x, 0.0) + mirrorBand(p, uMirrorRows.y, 1.0) + mirrorBand(p, uMirrorRows.z, 2.0)
           + mirrorBand(p, uMirrorRows.w, 3.0);
  }
  a *= 1.0 - mirror.a;                                       // the sheen half seen over a reflection
  gl_FragColor = over(vec4(vec3(a), a), over(mirror, tint));
}
`;

// Shade on the ground, drawn above the floor and lawn layers and below everything standing on them: walls, furniture
// and trees darken the floor around their feet (the occlusion field: red the occluders as they are, green the same
// blurred), the late sun throws that shade away from itself, and whoever stands somewhere has a small shadow under the
// feet. A navy veil in three bands; never on the walls, the facade glass or the water.
export const GROUND = `${HEAD}
uniform sampler2D uOcc;
uniform sampler2D uMasks;
uniform vec2 uMap;
uniform vec4 uShadow;
uniform vec4 uPeople[8];
uniform int uPeopleN;
void main() {
  vec2 p = floor(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uMap);
  vec4 m = texture2D(uMasks, imageUV(p, uMap));
  if (abs(m.r - 0.376) < 0.1 || abs(m.b - 0.5) < 0.1 || abs(m.g - 0.5) < 0.1) { gl_FragColor = vec4(0.0); return; }
  vec4 here = texture2D(uOcc, imageUV(floor(p * 0.5), uMap * 0.5));
  vec4 castOcc = texture2D(uOcc, imageUV(floor((p - uShadow.yz * uShadow.w) * 0.5), uMap * 0.5));
  float occ = max(here.g, castOcc.g * 0.85);          // under a sprite the shade is hidden by the sprite itself
  float ob = occ > 0.55 ? 1.0 : occ > 0.32 ? 0.62 : occ > 0.16 ? 0.3 : 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uPeopleN) break;
    vec2 d = (p + 0.5 - uPeople[i].xy) / vec2(8.0, 3.0);
    float e = dot(d, d);
    ob = max(ob, e < 0.45 ? 1.0 : e < 1.0 ? 0.6 : 0.0);
  }
  float a = uShadow.x * ob;
  gl_FragColor = vec4(vec3(0.02, 0.03, 0.09) * a, a);
}
`;

// The camera's last pass, one full-screen draw: locked rooms seen from outside (blocks on the world grid, frosted
// turquoise and kept out of the hour's grade), avatars mirrored on the polished floor, cloud shadows outside, then the
// light of the hour: an ambient for inside, walls, the lawn and the rest of the garden, the late sun's shafts on the
// floors, each lamp pulling its pool toward its colour in eight bands (kept in its room; dark things stay silhouettes),
// screens, bulbs and the brand's K keeping their own light, a toe and a navy pull on the darks and the garden's colour;
// last the focus vignette and the arrival iris. World masks are looked up through the camera's world view.
export const POST = `#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uMainSampler;
uniform sampler2D uMasks;
uniform vec3 uWarm;
uniform vec4 uWorld;
uniform vec2 uMap;
uniform vec2 uRes;
uniform vec3 uInside;
uniform vec3 uOutside;
uniform vec3 uLawn;
uniform vec3 uWall;
uniform vec3 uVivid;
uniform vec3 uFacade;
uniform float uToe;
uniform float uDarks;
uniform float uSat;
uniform float uNight;
uniform vec4 uL[32];
uniform vec4 uLC[32];
uniform vec4 uLClip[32];
uniform int uLN;
uniform vec4 uEm[24];                                     // x, y, w + tint index / 8, h
uniform vec4 uEmT[4];                                     // the tints (EMISSIVE_TINTS in lights.ts)
uniform int uEmN;
uniform vec4 uCloud;
uniform vec4 uShafts;
uniform vec4 uLock[6];
uniform int uLockN;
uniform vec3 uFrost;
uniform vec4 uAv[8];
uniform int uAvN;
uniform vec4 uSteps[32];
uniform int uStepN;
uniform vec3 uLime;
uniform vec3 uCream;
uniform vec2 uVignette;
uniform vec4 uReveal;
uniform vec3 uInk;
varying vec2 outTexCoord;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 toWorld(vec2 uv) { return uWorld.xy + vec2(uv.x, 1.0 - uv.y) * uWorld.zw; }
vec2 toScreen(vec2 w) { vec2 s = (w - uWorld.xy) / uWorld.zw; return vec2(s.x, 1.0 - s.y); }
vec2 mapUV(vec2 w, float scale) { vec2 uv = (floor(w * scale) + 0.5) / (uMap * scale); return vec2(uv.x, 1.0 - uv.y); }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float sat(vec3 c) { float mx = max(c.r, max(c.g, c.b)); return mx > 0.0 ? (mx - min(c.r, min(c.g, c.b))) / mx : 0.0; }
bool within(vec2 w, vec4 r) { return w.x >= r.x && w.y >= r.y && w.x < r.x + r.z && w.y < r.y + r.w; }
void main() {
  vec2 uv = outTexCoord;
  vec2 w = floor(toWorld(uv)) + 0.5;
  vec4 c = texture2D(uMainSampler, uv);
  vec4 m = texture2D(uMasks, mapUV(w, 1.0));
  bool outside = m.r > 0.75;
  bool wall = abs(m.r - 0.376) < 0.1;
  bool lawn = m.b > 0.9;
  bool water = abs(m.b - 0.5) < 0.1;
  bool facade = abs(m.g - 0.5) < 0.1;
  bool green = c.g > c.r * 1.08 && c.g > c.b;
  // locked rooms seen from outside: 5 px blocks on the world grid, one sample each, then frosted turquoise
  for (int i = 0; i < 6; i++) {
    if (i >= uLockN) break;
    vec4 r = uLock[i];
    if (within(w, r)) {
      vec2 b = clamp(floor(w / 5.0) * 5.0 + 2.5, r.xy + 0.5, r.xy + r.zw - 1.5);
      vec3 k = texture2D(uMainSampler, toScreen(b)).rgb;
      k = mix(vec3(lum(k)), k, 0.72);                            // frost softens contrast and colour
      vec3 f = k * vec3(0.6, 0.8, 0.84) + uFrost * 0.15;         // frosted glass: the room's colours, cooled
      if (mod(w.x + w.y * 0.85, 150.0) < 16.0) f += 0.045;       // a faint sheen across the glass
      if (w.y - r.y < 2.0) f = mix(f, uInk, 0.8);               // the frame of the glass along the top
      gl_FragColor = vec4(f, 1.0);
      return;
    }
  }
  // the polished floor mirrors who stands on it: their pixels, upside down below their feet, fading with distance
  if (m.g > 0.75) {
    for (int i = 0; i < 8; i++) {
      if (i >= uAvN) break;
      vec4 a = uAv[i];
      float dy = w.y - a.y;
      if (dy >= 0.0 && dy < a.w && abs(w.x - a.x) < a.z) {
        vec4 s = texture2D(uMainSampler, toScreen(vec2(w.x, a.y - dy - 1.0)));
        float csat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
        bool floorPixel = lum(c.rgb) > 0.86 && csat < 0.1;      // the porcelain itself, not a rug or a speck
        if (floorPixel && (lum(s.rgb) < 0.74 || sat(s.rgb) > 0.2)) c.rgb = mix(c.rgb, s.rgb, dy < a.w * 0.5 ? 0.24 : 0.14);
      }
    }
  }
  // pressed grass behind walkers: the lawn's own pixels lifted along the last steps (its specks survive), ragged edges,
  // and a blocky footprint every third step, left and right in turn, a cream core in a lime zone; older steps fade
  if (lawn && green && uStepN > 0) {
    float band = 0.0, print = 0.0;
    vec2 w2 = floor(w / 2.0) * 2.0;
    for (int i = 0; i < 32; i++) {
      if (i >= uStepN) break;
      vec4 s = uSteps[i];
      float foot = floor(s.z / 2.0), age = s.z - foot * 2.0;
      vec2 at = s.xy + vec2(0.0, 5.0);
      float fade = 1.0 - 0.65 * age;
      float r = 11.0 + 5.0 * (vnoise(vec2(w.y / 3.0, float(i))) - 0.5);
      band = max(band, (1.0 - length(w - at) / r) * fade);
      if (foot > 0.0) {
        vec2 dir = vec2(cos(s.w), sin(s.w)), n = vec2(-dir.y, dir.x);
        vec2 fc = at + n * (foot < 1.5 ? 6.0 : -6.0) + dir * (h21(vec2(float(i), 3.0)) * 4.0 - 2.0);
        vec2 l = vec2(dot(w2 - fc, dir) / 5.5, dot(w2 - fc, n) / 8.0);
        float shape = 1.0 - dot(l, l) - 0.3 * step(0.72, h21(floor((w2 - fc) / 3.0) + float(i)));
        print = max(print, shape * fade);
      }
    }
    if (print > 0.45) c.rgb = mix(c.rgb, uCream, 0.8);
    else if (print > 0.12) c.rgb = mix(c.rgb, uLime, 0.55);
    else if (band > 0.25) c.rgb = min(c.rgb + vec3(0.075, 0.05, 0.02), vec3(1.0));             // a warm lift, specks kept
  }
  // cloud shadows, outside only: big ragged masses (warped, so sunny bays open between them), a penumbra of changing
  // width and a sawtooth edge on 2 px blocks; grass goes teal, the rest neutral
  if (outside && uCloud.x > 0.0) {
    vec2 w2 = floor(w / 2.0) * 2.0;
    vec2 q = (w2 + uCloud.zw) / uCloud.y;
    q += (vec2(vnoise(q * 1.7), vnoise(q * 1.7 + 5.0)) - 0.5) * 0.9;
    float n = vnoise(q) * 0.58 + vnoise(q * 2.2 + 7.0) * 0.27 + vnoise(q * 6.0 + 3.0) * 0.1 + (vnoise(w2 / 14.0) - 0.5) * 0.12;
    float pen = 0.015 + 0.04 * vnoise(w2 / 40.0);
    float cover = n > 0.52 ? 1.0 : n > 0.52 - pen ? 0.45 : 0.0;
    vec3 shadeMul = green ? vec3(0.44, 0.58, 0.73) : vec3(0.58, 0.6, 0.7);
    c.rgb *= mix(vec3(1.0), shadeMul, cover * uCloud.x);
  }
  // the light of the hour
  vec3 amb = green ? mix(uInside, uLawn, 0.4) : uInside;         // indoor plants: a little of the garden's light
  if (outside) amb = green ? uLawn : mix(uOutside, uVivid, smoothstep(0.3, 0.7, sat(c.rgb)));
  if (wall) amb = uWall;
  if (facade) amb = uFacade;
  if (uShafts.x > 0.0) amb *= 1.0 - 0.22 * uShafts.x * smoothstep(0.45, 0.95, (1.0 - uv.x) * 0.5 + uv.y * 0.5);
  if (!outside && !wall && uWarm != vec3(1.0) && c.r > c.b * 1.12 && sat(c.rgb) < 0.45) amb = mix(amb, uWarm, 0.7);
  if (uShafts.x > 0.0 && !outside && !wall && !facade && !water) {
    // the late sun through the glass: broad and thin bands on the world grid, edges in steps
    float s1 = mod(w.y + w.x * uShafts.w, 140.0), s2 = mod(w.y + w.x * uShafts.w + 37.0, 58.0);
    float lit1 = s1 < 52.0 ? 1.0 : s1 < 58.0 ? 0.66 : s1 < 64.0 ? 0.33 : 0.0;
    float lit2 = s2 < 9.0 ? 1.0 : s2 < 12.0 ? 0.5 : 0.0;
    float lit = max(lit1, lit2 * 0.8);
    amb *= mix(vec3(1.0 - 0.17 * uShafts.x, 1.0 - 0.13 * uShafts.x, 1.0 - 0.02 * uShafts.x),
               vec3(1.0 + 0.1 * uShafts.x, 1.0 + 0.12 * uShafts.x, 1.0 + 0.04 * uShafts.x), lit);
  }
  vec3 illum = amb;
  if (uLN > 0) {
    vec3 tint = vec3(0.0), haloC = vec3(0.0); float total = 0.0, point = 0.0;
    for (int i = 0; i < 32; i++) {
      if (i >= uLN) break;
      vec4 l = uL[i]; vec4 clip = uLClip[i];
      if (clip.z > 0.0 && !within(w, clip)) continue;
      if (uLC[i].a < 0.0 && !water) continue;             // a water-only light (the pool's glow)
      if (facade && l.w != 0.0) continue;                 // the facade's glass takes only the entrance's band
      float f = 0.0;
      if (l.w < 0.0) {                                    // a carpet of light fading away from its top edge
        float into = w.y - l.y;
        if (w.x >= l.x && w.x < l.x + l.z && into >= 0.0 && into < -l.w) f = pow(1.0 - into / -l.w, 2.0);
      } else if (l.w == 0.0) {                            // a band fading only sideways
        f = pow(max(1.0 - abs(w.x - l.x) / abs(l.z), 0.0), 2.0);
      } else {
        float d = length(vec2(w.x - l.x, (w.y - l.y) / l.w)) / abs(l.z);
        if (d < 1.0) {
          f = pow(1.0 - d, 1.4); point += f * abs(uLC[i].a);
          if (l.z < 0.0) haloC += uLC[i].rgb * pow(1.0 - d, 2.0) * abs(uLC[i].a);   // a lamp's own glow (negative reach)
        }
      }
      f *= abs(uLC[i].a);
      tint += uLC[i].rgb * f; total += f;
    }
    if (total > 0.0) {
      float lit = min(total, 1.0) * smoothstep(0.2, 0.5, lum(c.rgb));    // dark things stay silhouettes
      float q = floor(sqrt(lit) * 8.0 + 0.5) / 8.0;                        // eight bands, finer where the light is faint
      float band = q * q;
      vec3 t = tint / total;
      vec3 hot = t.r > t.b ? mix(t * 1.18, vec3(1.12, 1.0, 0.5), band * band * 0.6 * point / total) : t * 1.3;   // a lamp's core goes yellow
      illum = mix(amb, hot, band * 0.88);
    }
    float hq = floor(min(max(haloC.r, max(haloC.g, haloC.b)), 1.0) * 6.0 + 0.5) / 6.0;
    vec3 haloQ = max(haloC.r, max(haloC.g, haloC.b)) > 0.0 ? haloC / max(haloC.r, max(haloC.g, haloC.b)) * hq : vec3(0.0);
    c.rgb = 1.0 - (1.0 - c.rgb) * (1.0 - haloQ * 0.42);           // screen: a lamp glows even on a bright floor
  }
  bool glow = false; vec4 glowC = vec4(1.0, 1.0, 1.0, 0.0);
  float cmax = max(c.r, max(c.g, c.b)), cmin = min(c.r, min(c.g, c.b));
  for (int i = 0; i < 24; i++) {
    if (i >= uEmN) break;
    float wq = floor(uEm[i].z);
    int ti = int(floor(fract(uEm[i].z) * 8.0 + 0.5));
    vec4 tint = uEmT[0];
    for (int k = 1; k < 4; k++) if (k == ti) tint = uEmT[k];
    if (within(w, vec4(uEm[i].xy, wq, uEm[i].w)) && (cmax > 0.45 || tint.a > 0.0)) { glow = true; glowC = tint; }
  }
  bool brand = !facade && !water && cmax > 0.8 && (cmax - cmin) / cmax > 0.6 && c.g >= c.r && c.g + 0.02 >= c.b && c.b > c.r + 0.25;
  if (glow && glowC.a > 0.0) c.rgb = mix(c.rgb, glowC.rgb, glowC.a);         // a bulb, painted lit
  else if (glow || brand) illum = max(illum, glow ? glowC.rgb : vec3(1.08));
  c.rgb = min(c.rgb * illum, vec3(1.0));
  if (brand && uNight > 0.0) { c.b = max(c.b, c.g * 0.97 * uNight + c.b * (1.0 - uNight)); c.rgb = mix(c.rgb, vec3(0.75, 1.0, 1.0), 0.45 * uNight); }
  if (wall && uShafts.x > 0.0) c.rgb = mix(vec3(lum(c.rgb)), c.rgb, 1.0 - 0.4 * uShafts.x);
  if (!glow && !brand) {
    float l = lum(c.rgb);
    if (uToe != 1.0) c.rgb = mix(c.rgb, 0.5 * pow(c.rgb * 2.0, vec3(uToe)), step(l, 0.5));   // only below mid grey
    if (uDarks > 0.0 && l < 0.38) c.rgb = mix(c.rgb, c.rgb * vec3(0.35, 0.7, 1.15) + vec3(0.0, 0.01, 0.05), uDarks * (1.0 - l / 0.38));
  }
  if (outside && uSat != 1.0) c.rgb = clamp(mix(vec3(lum(c.rgb)), c.rgb, uSat), 0.0, 1.0);
  // focus: the edges of the view darken in three bands
  if (uVignette.x > 0.0) {
    vec2 d = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float r = length(d) / uVignette.y;
    float band = r > 1.0 ? 1.0 : r > 0.86 ? 0.6 : r > 0.74 ? 0.3 : 0.0;
    c.rgb *= 1.0 - uVignette.x * band;
  }
  // arrival: an iris opening from the avatar, its edge a turquoise ring
  if (uReveal.z >= 0.0) {
    float d = length(floor(w / 2.0) * 2.0 - uReveal.xy);
    if (d > uReveal.z) c.rgb = uInk;
    else if (d > uReveal.z - 3.0) c.rgb = vec3(0.008, 0.82, 0.81);
  }
  gl_FragColor = c;
}
`;
