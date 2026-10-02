import { num, vec3 } from '../layer.js';

// Three banks of noise warped by a slower one; the rows above a bank cost nothing.

const STRETCH = 2.6;            // billows are this much wider than tall

// top and ramp in heights, size in screen widths, wind in widths a second.
const BANKS = [
    { top: 0.42, ramp: 0.28, size: 0.05, wind: 0.0035, alpha: 0.20, rgb: [150, 162, 184] },
    { top: 0.54, ramp: 0.30, size: 0.09, wind: 0.0070, alpha: 0.28, rgb: [178, 188, 204] },
    { top: 0.68, ramp: 0.32, size: 0.16, wind: 0.0120, alpha: 0.38, rgb: [204, 211, 222] },
];

export const density = [0.25, 2];

const bank = (b, i) => `c = fogOver(c, fogBank(p, ${i}.0, ${num(b.top)}, ${num(b.ramp)}, ` +
    `${num(b.size)}, ${num(b.wind / (b.size * STRETCH))}, ${num(b.alpha)}), ` +
    `${vec3(b.rgb.map(v => v / 255))});`;

export const glsl = `
float fogBank(vec2 p, float bank, float top, float ramp, float size, float wind, float alpha) {
    float reach = top - 0.12 * (u_density - 1.0);
    float row = p.y / u_canvas.y;
    if (row < reach) return 0.0;
    float rise = smoothstep(reach, reach + ramp, row);

    vec2 w = p / DESIGN_W / size * vec2(${num(1 / STRETCH)}, 1.0);
    vec2 o = vec2(bank * 37.1 + u_seed * 11.3, bank * 13.7);
    float roll = vnoise(w * vec2(0.35, 0.5) + o + vec2(drift(0.4 * wind), drift(0.015)));
    vec2 q = w + o + vec2(1.6 * roll - drift(wind), 0.8 * roll);
    float n = 0.55 * vnoise(q) +
              0.30 * vnoise(q * 2.1 + vec2(drift(0.6 * wind), -drift(0.025)) + 19.1) +
              0.15 * vnoise(q * 4.3 + vec2(-drift(0.9 * wind), drift(0.04)) + 41.7);

    float thick = n + 0.3 * rise + 0.12 * (u_density - 1.0);
    return alpha * rise * smoothstep(0.4, 0.95, thick);
}

vec4 fogOver(vec4 c, float a, vec3 rgb) {
    return vec4(rgb, 1.0) * a + c * (1.0 - a);
}

vec4 fog(vec2 p) {
    vec4 c = vec4(0.0);
    ${BANKS.map(bank).join('\n    ')}
    return c;
}
`;
