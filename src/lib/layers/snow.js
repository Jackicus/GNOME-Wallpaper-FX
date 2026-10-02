// Depth bands of cells, a column at a time so neighbours never fall in step; a pixel
// looks at one cell per band.

// z range, and the share of the flakes.
const BANDS = [
    [0.00, 0.20, 0.38],
    [0.20, 0.42, 0.27],
    [0.42, 0.64, 0.18],
    [0.64, 0.84, 0.11],
    [0.84, 1.00, 0.06],
];
const COUNT = 300;
// More flakes fill more cells, so a flake fades in alone rather than the fall being dealt again.
const OCCUPIED = 0.42;
// Cells before the grid repeats, so the distance slid stays small.
const REPEAT = 64;

export const density = [0.25, 2];

function band([z0, z1, share], i) {
    const cell = Math.sqrt(1920 * 1080 * OCCUPIED / (COUNT * share));
    return `c += snowBand(p, ${i}.0, ${z0.toFixed(2)}, ${z1.toFixed(2)}, ${cell.toFixed(1)});`;
}

export const glsl = `
// By depth z, 0 the farthest: sizes in U, speeds in U a second.
float snowRadius(float z) { return 0.9 + 3.0 * z + 9.0 * z * z * z * z; }
float snowSoft(float z) { return 0.25 + 0.65 * z * z; }  // blurred edge, a share of the radius
float snowAlpha(float z) { return 0.3 + 0.5 * smoothstep(0.0, 0.6, z) - 0.35 * smoothstep(0.7, 1.0, z); }
float snowFall(float z) { return 22.0 + 34.0 * z; }
float snowWind(float z) { return 4.0 + 12.0 * z; }
float snowSway(float z) { return 4.0 + 18.0 * z; }
float snowReach(float z) { return snowRadius(z) * (1.0 + snowSoft(z)) + 2.0; }

// Never sharper than a pixel and a half (widened and dimmed instead), so a far flake glides.
float snowDisc(float d, float r, float soft) {
    float rr = max(r, 0.8);
    float w = max(rr * soft, 0.75);
    return (r * r) / (rr * rr) * (1.0 - smoothstep(rr - w, rr + w, d));
}

vec4 snowBand(vec2 p, float band, float z0, float z1, float cell) {
    float z = 0.5 * (z0 + z1);
    float period = cell * ${REPEAT}.0;

    float gust = (8.0 + 40.0 * z) * sin(wphase(0.11) + band * 0.4);
    float qx = p.x / U - scroll(vec2(snowWind(z), 0.0), period).x - gust;
    float col = floor(qx / cell);
    float cid = mod(col, ${REPEAT}.0);

    float pace = 0.82 + 0.36 * hash12(vec2(cid + u_seed * 3.7, band * 17.3 + 5.0));
    float qy = p.y / U - scroll(vec2(0.0, snowFall(z) * pace), period).y;
    float row = floor(qy / cell);

    vec2 key = vec2(cid, mod(row, ${REPEAT}.0)) + vec2(band * 71.3 + u_seed, band * 19.7);
    vec4 h = hash42(key);
    float filled = ${OCCUPIED.toFixed(2)} * u_density;
    if (h.x > filled) return vec4(0.0);

    float reach = snowReach(z1);
    vec2 margin = vec2(snowSway(z1) + reach, 0.25 * snowSway(z1) + reach);
    vec2 at = vec2(col, row) * cell + margin + h.zw * (cell - 2.0 * margin);
    vec2 off = vec2(qx, qy) - at;
    if (abs(off.x) > margin.x || abs(off.y) > margin.y) return vec4(0.0);

    vec4 k = hash42(key + 37.1);
    float f = mix(z0, z1, h.y);
    float swing = wphase(0.5 + 0.6 * k.x) + k.y * TAU;
    float sway = snowSway(f);
    off.x -= sway * (0.75 * sin(swing) + 0.25 * sin(wphase(0.17 + 0.2 * k.z) + k.w * TAU));
    off.y += 0.25 * sway * cos(2.0 * swing);

    float r = snowRadius(f);
    float a = snowDisc(length(off) * U, r * U, snowSoft(f));
    a *= clamp((filled - h.x) / (0.08 * filled), 0.0, 1.0);
    return vec4(0.922, 0.949, 1.0, 1.0) * a * snowAlpha(f);
}

vec4 snow(vec2 p) {
    vec4 c = vec4(0.0);
    ${BANDS.map(band).join('\n    ')}
    return c;
}
`;
