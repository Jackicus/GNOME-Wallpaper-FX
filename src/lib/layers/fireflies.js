// One firefly to a cell at most, wandering no further than the six cells a pixel looks
// at. One hash spread four ways, not hash42 (docs/patterns.md).

// Above RISE of the way down, a cell's chance thins to TOP of OCCUPIED at the top edge.
const COUNT = 53;
const OCCUPIED = 0.56;
const TOP = 0.06;
const RISE = 0.62;
const smoothstep = x => (x = Math.min(1, Math.max(0, x))) * x * (3 - 2 * x);
let WEIGHT = 0;
for (let i = 0; i < 100; i++) WEIGHT += (TOP + (1 - TOP) * smoothstep((i + 0.5) / 100 / RISE)) / 100;
const AREA = 1920 * 1080 * OCCUPIED * WEIGHT / COUNT;
const CELL_W = Math.sqrt(AREA) * 0.83;
const CELL_H = Math.sqrt(AREA) / 0.83;

// In U: home from the cell's centre, wander from home, climb in a flash, reach of the light.
const HOME_X = 20;
const HOME_Y = 34;
const WANDER_X = 98;
const WANDER_Y = 68;
const CLIMB = 10;
const REACH = 36;
if (HOME_X + WANDER_X + REACH > 1.5 * CELL_W || HOME_Y + WANDER_Y + CLIMB + REACH > CELL_H)
    throw new Error('fireflies: a firefly can wander out of reach of the cells a pixel looks at');

export const density = [0.25, 2];

const f = x => x.toFixed(2);

export const glsl = `
vec4 firefliesLight(vec2 q, vec2 cell, float share) {
    vec2 key = cell + vec2(u_seed * 7.31 + 3.7, 11.9);
    float here = (share - hash12(key)) * 30.0;
    if (here <= 0.0) return vec4(0.0);

    vec4 h = fract(hash12(key + 17.7) * vec4(1.0, 37.13, 91.71, 213.37));
    float flash = 1.5 + h.w;
    float cycle = 2.0 + 1.5 * h.y;
    vec2 lc = lifecycle(flash * cycle, h.z);
    float s = lc.y * cycle;
    if (s >= 1.0) return vec4(0.0);

    // It climbs during a flash and drops back while dark.
    vec4 k = fract(h.yzwx * vec4(13.7, 17.3, 11.9, 19.1) + h.zwxy);
    vec2 at = (cell + 0.5) * vec2(${f(CELL_W)}, ${f(CELL_H)}) +
        (k.xy - 0.5) * vec2(${f(2 * HOME_X)}, ${f(2 * HOME_Y)});
    float loop = wphase(0.3 + 0.2 * k.z) + k.w * TAU;
    at += vec2(${f(WANDER_X * 0.62)} * sin(wphase(0.1 + 0.07 * k.x) + k.y * TAU) + ${f(WANDER_X * 0.38)} * sin(loop),
               ${f(WANDER_Y * 0.62)} * sin(wphase(0.13 + 0.08 * k.y) + k.x * TAU) + ${f(WANDER_Y * 0.38)} * cos(loop) -
               ${f(CLIMB)} * s);
    vec2 off = q - at;
    float d2 = dot(off, off);
    float z = fract(h.x * 23.3 + h.y * 5.1);
    float reach = ${f(REACH)} * (0.75 + 0.25 * z);
    if (d2 > reach * reach) return vec4(0.0);

    float strength = fract(mod(lc.x, 89.0) * 0.618034 + k.z);
    float level = smoothstep(0.0, 0.2, s) * (1.0 - smoothstep(0.3, 1.0, s)) *
        smoothstep(0.06, 0.16, strength) * (0.55 + 0.45 * strength);

    // Tinted after glow() to warm its white core; the bloom reaches zero at the reach.
    vec3 warm = vec3(1.0, 0.98, 0.75);
    vec4 c = glow(sqrt(d2) * U, (8.0 + 6.0 * z) * U, vec3(0.784, 1.0, 0.627), 0.3);
    c.rgb *= warm;
    float b = 1.0 - d2 / (reach * reach);
    float bloom = 0.24 * b * b * b;
    c += vec4(vec3(0.784, 0.98, 0.47) * bloom, bloom) * (1.0 - c.a);
    return c * level * (0.65 + 0.35 * z) * min(here, 1.0);
}

vec4 fireflies(vec2 p) {
    vec2 q = p / U;
    vec2 cell = vec2(floor(q.x / ${f(CELL_W)}) - 1.0, floor(q.y / ${f(CELL_H)} - 0.5));
    vec4 c = vec4(0.0);
    for (int y = 0; y < 2; y++) {
        float row = cell.y + float(y);
        float share = ${f(OCCUPIED)} * u_density *
            mix(${f(TOP)}, 1.0, smoothstep(0.0, ${f(RISE)}, (row + 0.5) * ${f(CELL_H)} * U / u_canvas.y));
        for (int x = 0; x < 3; x++)
            c += firefliesLight(q, vec2(cell.x + float(x), row), share);
    }
    return c;
}
`;
