import { around, num, pathMarks } from '../layer.js';

// A drop every SPACING U of the pointer's path, its ring spreading at SPEED U a second
// and gone in LIFE seconds: one crest WAVE U across, lit and shaded by its slope as water is.
const DROPS = 12;
const SPACING = 120;
const SPEED = 95;
const LIFE = 3.0;
const WAVE = 30;

export const glsl = `
uniform vec4 ripples_drops[${DROPS}];
uniform vec4 ripples_box;

vec4 ripples(vec2 p) {
    if (any(lessThan(p, ripples_box.xy)) || any(greaterThan(p, ripples_box.zw))) return vec4(0.0);
    vec2 g = vec2(0.0);
    for (int i = 0; i < ${DROPS}; i++) {
        vec4 d = ripples_drops[i];
        if (d.w <= 0.0) break;
        vec2 o = p - d.xy;
        float l = length(o);
        float r = d.z * ${num(SPEED)} * U;
        float w = (l - r) / (${num(WAVE)} * U);
        if (abs(w) > 1.2) continue;
        // The slope of a crest cos(TAU w) exp(-2.5 w^2) across the ring; wider rings spread it thinner.
        float slope = -(TAU * sin(w * TAU) + 5.0 * w * cos(w * TAU)) * exp(-2.5 * w * w);
        g += o / max(l, 1.0) * slope * d.w * d.w * smoothstep(0.0, 0.4, d.z) / (1.0 + r / (160.0 * U));
    }
    // Lit where the surface tilts towards a light above and to the left.
    float s = dot(g, vec2(-0.45, -0.89)) * 0.15;
    float lit = clamp(s, 0.0, 1.0) * 0.45;
    float shade = clamp(-s, 0.0, 1.0) * 0.25;
    return vec4(vec3(0.8, 0.92, 1.0) * lit, lit) + vec4(0.0, 0.0, 0.0, shade) * (1.0 - lit);
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
        // A fast sweep fills every slot before the oldest dies, so the last few fade by rank.
        drops.forEach((m, i) => this._drops.set([m.x, m.y, m.age, Math.min(1 - m.age / LIFE, (DROPS - i) / DROPS)], i * 4));
        const widest = Math.max(0, ...drops.map(m => m.age)) * SPEED * u + 1.2 * WAVE * u;
        return [['ripples_drops', 4, this._drops], ['ripples_box', 4, around(drops.map(m => [m.x, m.y]), widest)]];
    }
}
