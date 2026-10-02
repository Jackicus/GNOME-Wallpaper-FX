// Depth bands of sliding cells, one speck to a cell, kept clear of its edges so a
// pixel looks at one cell per band.

// z range, and the share of the specks.
const BANDS = [
    [0.0, 0.1, 0.33],
    [0.1, 0.3, 0.33],
    [0.3, 0.6, 0.245],
    [0.6, 1.0, 0.095],
];
const COUNT = 90;
const OCCUPIED = 0.75;
// Cells before the grid repeats, so the distance slid stays small.
const REPEAT = 64;

export const density = [0.25, 2];

function band([z0, z1, share], i) {
    const z = (z0 + z1) / 2;
    const cell = Math.sqrt(1920 * 1080 * OCCUPIED / (COUNT * share));
    const vx = (0.006 + 0.02 * z) * 1920;
    const vy = -(0.003 + 0.012 * z) * 1080;
    return `c += sparkleBand(p, ${i}.0, ${z0.toFixed(2)}, ${z1.toFixed(2)}, ${cell.toFixed(1)}, ` +
        `vec2(${vx.toFixed(2)}, ${vy.toFixed(2)}));`;
}

export const glsl = `
vec4 sparkleBand(vec2 p, float band, float z0, float z1, float designCell, vec2 drift) {
    float cell = designCell / sqrt(u_density);
    vec2 q = p / U - scroll(drift, cell * ${REPEAT}.0);
    vec2 id = mod(floor(q / cell), ${REPEAT}.0);
    vec2 key = id + vec2(band * 71.3 + u_seed, band * 19.7);
    vec4 h = hash42(key);
    if (h.x > ${OCCUPIED.toFixed(2)}) return vec4(0.0);

    // Culled before the rest (docs/patterns.md).
    float margin = 5.5 + 12.0 + 2.0;
    vec2 at = floor(q / cell) * cell + margin + h.zw * (cell - 2.0 * margin);
    vec2 off = q - at;
    if (abs(off.y) > 6.0 || abs(off.x) > 18.0) return vec4(0.0);

    vec4 k = hash42(key + 37.1);
    float z = mix(z0, z1, h.y);
    off.x -= 12.0 * sin(wphase(0.2 + 0.5 * k.x) + k.y * TAU);
    return glow(length(off) * U, (1.5 + 4.0 * z) * U, vec3(0.882, 0.933, 1.0), 0.12) * (0.22 + 0.5 * z);
}

vec4 sparkles(vec2 p) {
    vec4 c = vec4(0.0);
    ${BANDS.map(band).join('\n    ')}
    return c;
}
`;
