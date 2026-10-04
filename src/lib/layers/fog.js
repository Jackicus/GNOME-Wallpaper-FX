import { num, vec3 } from '../layer.js';

// Three banks, far to near, each a soft top broken by billows over fog that thickens
// towards the ground. The rows above a bank's highest billow cost nothing.

const STRETCH = 2.6;            // billows are this much wider than tall
const GROW = 2.03;              // each octave this much finer than the last
const TURN = 0.2838;            // and turned this far, in radians

// Octave k carried at "speed" bank winds, plus "churn" a second upwards. drift() jumps by
// whole periods of the noise, so it is added after the octave is scaled and turned.
const flow = (k, speed, churn) => {
    const v = speed * GROW ** k;
    return `vec2(drift(${num(-v * Math.cos(k * TURN))} * wind), ` +
        `drift(${num(v * Math.sin(k * TURN))} * wind + ${num(churn)}))`;
};

// top and ramp in heights, size in screen widths, wind in widths a second.
const BANKS = [
    { top: 0.46, ramp: 0.30, size: 0.06, wind: 0.0035, alpha: 0.20, rgb: [158, 170, 192] },
    { top: 0.58, ramp: 0.32, size: 0.10, wind: 0.0070, alpha: 0.27, rgb: [192, 201, 216] },
    { top: 0.72, ramp: 0.34, size: 0.17, wind: 0.0120, alpha: 0.36, rgb: [222, 227, 235] },
];

export const density = [0.25, 2];

const bank = (b, i) => `c = fogOver(c, fogBank(p, ${i}.0, ${num(b.top)}, ${num(b.ramp)}, ` +
    `${num(b.size)}, ${num(b.wind / (b.size * STRETCH))}, ${num(b.alpha)}, ` +
    `${vec3(b.rgb.map(v => v / 255))}));`;

export const glsl = `
// Each octave turned against the last, so value noise's grid never lines up.
const mat2 fogTurn = mat2(${num(Math.cos(TURN))}, ${num(-Math.sin(TURN))}, ${num(Math.sin(TURN))}, ${num(Math.cos(TURN))});

vec4 fogBank(vec2 p, float bank, float top, float ramp, float size, float wind, float alpha, vec3 rgb) {
    float h = (p.y / u_canvas.y - top + 0.12 * (u_density - 1.0)) / ramp;
    if (h < -0.4) return vec4(0.0);

    vec2 w = p / DESIGN_W / size * vec2(${num(1 / STRETCH)}, 1.0);
    w += vec2(bank * 37.1 + u_seed * 11.3, bank * 13.7);
    float broad = vnoise(w + ${flow(0, 0.7, 0.012)});
    // The finer octaves ride on the broad one, which rolls them over each other.
    vec2 q = fogTurn * w * ${num(GROW)} + 0.9 * broad;
    float n = 0.55 * broad +
              0.30 * vnoise(q + 19.1 + ${flow(1, 1.0, 0.02)}) +
              0.15 * vnoise(fogTurn * q * ${num(GROW)} + 41.7 + ${flow(2, 1.3, -0.035)});

    float body = smoothstep(-0.15, 1.0, h + 0.9 * (n - 0.5));
    float a = alpha * (0.6 + 0.4 * u_density) * body * body * (0.3 + n);
    return vec4(rgb * (0.7 + 0.6 * n), 1.0) * min(a, 1.0);
}

vec4 fogOver(vec4 c, vec4 f) {
    return f + c * (1.0 - f.a);
}

vec4 fog(vec2 p) {
    vec4 c = vec4(0.0);
    ${BANKS.map(bank).join('\n    ')}
    // A thin gradient over the wallpaper bands in 8 bits; a pixel's worth of dither hides it.
    return c * (1.0 + (hash12(p + u_seed) - 0.5) / (96.0 * max(c.a, 0.04)));
}
`;
