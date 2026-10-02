// Noise on a plane seen in perspective, each octave carried a little faster.

const HORIZON = 1.6;            // in heights below the top: further is gentler perspective
const SCALE = 4.0;
const WIND = [0.03, 0.008];     // noise units a second, across and towards the viewer
const SHEAR = 1.15;             // each octave outruns the one below by this much

export const density = [0.25, 2];

const num = x => x.toFixed(4);
const octave = (k, scale, offset) => `vnoise(q * ${num(scale)} + ` +
    `vec2(${num(offset[0])}, ${num(offset[1])}) - vec2(drift(${num(WIND[0] * scale * SHEAR ** k)}), ` +
    `drift(${num(WIND[1] * scale * SHEAR ** k)})))`;

export const glsl = `
vec4 clouds(vec2 p) {
    float depth = u_canvas.y / (${num(HORIZON)} * u_canvas.y - p.y);
    vec2 q = vec2((p.x - 0.5 * u_canvas.x) / DESIGN_W, 1.0) * depth * ${num(SCALE)} + vec2(u_seed * 17.3, 0.0);

    float broad = ${octave(0, 1, [0, 0])};
    float n = (0.5 * broad + 0.25 * ${octave(1, 2.03, [13.1, 7.7])} + 0.15 * ${octave(2, 4.1, [-7.3, 29.1])} +
               0.09 * ${octave(3, 8.3, [21.9, -3.7])}) / 0.99;

    float cover = 0.57 - 0.07 * (u_density - 1.0);
    float body = smoothstep(cover, cover + 0.07, n);
    if (body <= 0.0) return vec4(0.0);

    // Lit from above, which on the plane is nearer.
    float toward = ${octave(0, 1, [0, 0]).replace('q *', '(q - vec2(0.0, 0.2)) *')};
    float lit = clamp(0.6 + 3.0 * (broad - toward), 0.0, 1.0);
    float heart = smoothstep(0.0, 0.22, n - cover);
    vec3 rgb = mix(vec3(0.42, 0.46, 0.55), vec3(0.96, 0.97, 0.99), lit * (1.0 - 0.2 * heart));

    float haze = smoothstep(${num(1 / (HORIZON - 1))}, ${num(1 / HORIZON)}, depth);
    float a = body * mix(0.3, 0.8, heart) * mix(0.85, 1.1, lit) * mix(0.3, 1.0, haze);
    return vec4(rgb, 1.0) * min(a, 1.0);
}
`;
