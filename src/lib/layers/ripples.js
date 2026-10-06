import { around, num, pathMarks } from '../layer.js';

// A ring from each SPACING U of the pointer's path, spreading at SPEED U a second and
// gone in LIFE seconds: lit on its crests, shaded in its troughs.
const DROPS = 16;
const SPACING = 56;
const SPEED = 170;
const LIFE = 2.6;
const WAVE = 13;

export const glsl = `
uniform vec4 ripples_drops[${DROPS}];
uniform vec4 ripples_box;

vec4 ripples(vec2 p) {
    if (any(lessThan(p, ripples_box.xy)) || any(greaterThan(p, ripples_box.zw))) return vec4(0.0);
    float h = 0.0;
    for (int i = 0; i < ${DROPS}; i++) {
        vec4 d = ripples_drops[i];
        if (d.w <= 0.0) break;
        float r = d.z * ${num(SPEED)} * U;
        float w = (length(p - d.xy) - r) / (${num(WAVE)} * U);
        if (abs(w) > 2.5) continue;
        float left = 1.0 - d.z / ${num(LIFE)};
        // Wider rings spread their height thinner.
        h += sin(w * TAU) * exp(-0.6 * w * w) * left * left * smoothstep(0.0, 0.15, d.z) /
            (1.0 + r / (240.0 * U));
    }
    float lit = clamp(h, 0.0, 1.0) * 0.45;
    float shade = clamp(-h, 0.0, 1.0) * 0.28;
    return vec4(vec3(0.78, 0.92, 1.0) * lit, lit) + vec4(0.0, 0.0, 0.0, shade) * (1.0 - lit);
}
`;

export class State {
    constructor({ unit }) {
        this._unit = unit;
        this._drops = new Float32Array(DROPS * 4);
    }

    uniforms(t, _amount, pointer) {
        const u = this._unit;
        this._drops.fill(0);
        const drops = pathMarks(pointer?.trail ?? [], SPACING * u, LIFE, DROPS);
        drops.forEach((m, i) => this._drops.set([m.x, m.y, m.age, 1], i * 4));
        const widest = Math.max(0, ...drops.map(m => m.age)) * SPEED * u + 2.5 * WAVE * u;
        return [['ripples_drops', 4, this._drops], ['ripples_box', 4, around(drops.map(m => [m.x, m.y]), widest)]];
    }
}
