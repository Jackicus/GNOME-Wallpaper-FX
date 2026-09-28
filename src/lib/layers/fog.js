// Banks of fog rolling slowly past, lying low: three depths of it, the far one
// a thin haze along the horizon, the near one thick, billowing and faster.
//
// Each bank is three octaves of noise stretched wide, sliding with the wind and
// warped by a slower one, so it rolls and trails wisps rather than sliding past
// as a picture; its octaves drift apart from each other, so it keeps changing
// shape. A bank thickens downwards from its top, and the rows above its reach
// cost nothing.

// Billows are this much wider than they are tall.
const STRETCH = 2.6;

// The top of each bank and the depth it thickens over, as fractions of the
// height; the height of its billows, in screen widths; its drift, in screen
// widths a second; and its alpha where thickest.
const BANKS = [
    { top: 0.42, ramp: 0.28, size: 0.05, wind: 0.0035, alpha: 0.20, rgb: [150, 162, 184] },
    { top: 0.54, ramp: 0.30, size: 0.09, wind: 0.0070, alpha: 0.28, rgb: [178, 188, 204] },
    { top: 0.68, ramp: 0.32, size: 0.16, wind: 0.0120, alpha: 0.38, rgb: [204, 211, 222] },
];

// Thin wisps to a thick pea-souper: more of each bank is fog, and it reaches
// higher up the screen.
export const density = [0.25, 2];

const num = x => x.toFixed(4);

// The wind, in noise units a second along x.
const bank = (b, i) => `c = fogOver(c, fogBank(p, ${i}.0, ${num(b.top)}, ${num(b.ramp)}, ` +
    `${num(b.size)}, ${num(b.wind / (b.size * STRETCH))}, ${num(b.alpha)}), ` +
    `vec3(${b.rgb.map(v => num(v / 255)).join(', ')}));`;

export const glsl = `
// How thick one bank is at p, 0 to 1.
float fogBank(vec2 p, float bank, float top, float ramp, float size, float wind, float alpha) {
    // Higher with more fog, never quite to the top of the screen.
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

    // More of the noise is fog as the Amount rises, and lower down.
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
