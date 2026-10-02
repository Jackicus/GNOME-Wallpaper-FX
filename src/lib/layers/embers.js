import { slots } from '../layer.js';

// Sparks rising from a glow below the frame, a few to each narrow column.

const COLUMN = 52;          // in U: ~37 columns across a 1920-wide screen
const SLOTS = 3;            // sparks per column at any moment, as designed
const MOST = 6;             // and at the most Amount allows

export const density = [1 / SLOTS, MOST / SLOTS];

export const glsl = `
vec4 emberSpark(vec2 p, float column, float slot) {
    vec4 life = hash42(vec2(column + u_seed * 5.3, slot * 13.7));
    float period = 4.0 + life.x * 5.0;
    vec2 lc = lifecycle(period, life.y);
    float f = lc.y;

    vec4 h = hash42(vec2(column * 3.1 + slot + u_seed, lc.x));
    float rise = 0.035 + h.y * 0.07;
    float size = 2.0 + h.z * h.z * 5.0;
    float r = size * (1.2 - 0.5 * f) * U;

    // Culled before anything else is worked out (docs/patterns.md).
    float y = (1.02 + h.w * 0.06 - rise * period * (1.3 * f - 0.3 * f * f)) * u_canvas.y;
    float x = ((column + 0.5) * ${COLUMN}.0 + (h.x - 0.5) * ${COLUMN / 2}.0) * U;
    if (abs(p.y - y) > 1.2 * r || abs(p.x - x) > 1.2 * r + 14.0 * U) return vec4(0.0);

    vec4 k = hash42(vec2(lc.x * 1.7 + slot, column + 41.0));
    x += 14.0 * U * (vnoise(vec2(k.x * 40.0, (lc.x + f) * 1.5)) - 0.5) * 2.0;

    float flicker = 0.7 + 0.3 * sin(wphase(6.0 + k.y * 10.0) + k.z * TAU);
    float alpha = pow(1.0 - f, 0.7) * flicker * 0.9;
    vec3 rgb = mix(vec3(1.0, 0.941, 0.784), vec3(1.0, 0.627, 0.235), smoothstep(0.2, 0.4, f));
    rgb = mix(rgb, vec3(1.0, 0.353, 0.118), smoothstep(0.6, 0.8, f));
    return glow(length(p - vec2(x, y)), r, rgb, 0.25) * alpha;
}

vec4 embers(vec2 p) {
    float heat = 0.5 + 0.15 * sin(wphase(0.7)) + 0.08 * sin(wphase(2.3));
    float band = (p.y - u_canvas.y * 0.72) / (u_canvas.y * 0.28);
    vec4 c = vec4(1.0, 0.471, 0.157, 1.0) * 0.28 * clamp(band, 0.0, 1.0) * heat;

    float column = floor(p.x / (${COLUMN}.0 * U));
    for (int dc = -1; dc <= 1; dc++) {
        float col = column + float(dc);
        ${slots(s => `emberSpark(p, col, ${s}.0)`, SLOTS, MOST)}
    }
    return c;
}
`;
