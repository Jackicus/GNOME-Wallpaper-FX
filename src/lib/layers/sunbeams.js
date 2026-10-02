import { num } from '../layer.js';

// Shafts are noise along the angle from the sun; the dust is lit only in a shaft.

// Fractions of the canvas: just above the top edge, so the angle never wraps.
const SUN = [0.32, -0.08];
const MOTES = 420;
const OCCUPIED = 0.5;
const REPEAT = 64;

export const density = [0.25, 2];

const CELL = Math.sqrt(1920 * 1080 * OCCUPIED / MOTES);

export const glsl = `
const vec3 SUNBEAMS_RGB = vec3(1.0, 0.85, 0.6);

vec4 sunbeamsDust(vec2 p) {
    float cell = ${num(CELL)};
    vec2 q = p / U - scroll(vec2(6.0, 3.0), cell * ${REPEAT}.0);
    vec2 id = floor(q / cell);
    vec4 h = hash42(mod(id, ${REPEAT}.0) + vec2(u_seed * 5.3, 71.0));
    if (h.x > ${num(OCCUPIED)}) return vec4(0.0);
    float margin = 10.0;
    vec2 at = id * cell + margin + h.zw * (cell - 2.0 * margin);
    at += 6.0 * vec2(sin(wphase(0.3 + 0.4 * h.y) + h.z * TAU), cos(wphase(0.23 + 0.3 * h.x) + h.w * TAU));
    float d = length(q - at);
    if (d > margin) return vec4(0.0);
    float r = 1.2 + 1.6 * h.y * h.y;
    float twinkle = 0.55 + 0.45 * sin(wphase(0.7 + 0.9 * h.w) + h.y * TAU);
    return glow(d * U, r * U, SUNBEAMS_RGB, 0.3) * twinkle;
}

vec4 sunbeams(vec2 p) {
    vec2 sun = u_canvas * vec2(${num(SUN[0])}, ${num(SUN[1])});
    sun.x += 0.03 * DESIGN_W * sin(wphase(0.021));
    vec2 v = p - sun;
    float dist = length(v) / u_canvas.y;
    float angle = atan(v.y, v.x);

    float broad = vnoise(vec2(angle * 7.0 + u_seed * 9.1, drift(0.03)));
    float fine = vnoise(vec2(angle * 17.0 + 40.0 + u_seed * 3.7, drift(0.05)));
    float n = 0.7 * broad + 0.3 * fine;
    float open = 0.55 - 0.1 * (u_density - 1.0);
    float shaft = smoothstep(open, open + 0.4, n);
    float reach = 0.5 + 0.7 * shaft;
    float beam = shaft * smoothstep(reach, 0.05, dist) * smoothstep(0.0, 0.25, dist);
    float breathe = 0.85 + 0.15 * sin(wphase(0.09) + angle * 3.0);

    float glare = exp(-dist * dist * 14.0);
    float a = 0.2 * beam * breathe + 0.3 * glare + 0.04 * smoothstep(1.1, 0.0, dist);
    vec4 c = vec4(mix(SUNBEAMS_RGB, vec3(1.0, 0.95, 0.82), glare), 1.0) * min(a, 1.0);

    float lit = beam + 0.5 * glare;
    if (lit > 0.03) c += sunbeamsDust(p) * min(1.0, 1.5 * lit) * 0.8;
    return c;
}
`;
