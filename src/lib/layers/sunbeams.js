import { num } from '../layer.js';

// Shafts are noise along the angle from a sun well above the screen; the dust is lit
// only in a shaft.

// Fractions of the canvas: far enough above the top that the shafts fan only a little.
const SUN = [0.28, -0.3];
const MOTES = 320;
const OCCUPIED = 0.4;
const REPEAT = 64;

export const density = [0.25, 2];

const CELL = Math.sqrt(1920 * 1080 * OCCUPIED / MOTES);

export const glsl = `
const vec3 SUNBEAMS_NEAR = vec3(1.0, 0.88, 0.66);
const vec3 SUNBEAMS_FAR = vec3(1.0, 0.7, 0.36);

vec4 sunbeamsDust(vec2 p) {
    float cell = ${num(CELL)};
    vec2 q = p / U - scroll(vec2(3.0, 7.0), cell * ${REPEAT}.0);
    vec2 id = floor(q / cell);
    vec4 h = hash42(mod(id, ${REPEAT}.0) + vec2(u_seed * 5.3, 71.0));
    if (h.x > ${num(OCCUPIED)} * u_density) return vec4(0.0);
    float margin = 14.0;
    vec2 at = id * cell + margin + h.zw * (cell - 2.0 * margin);
    float turn = wphase(0.25 + 0.35 * h.y) + h.z * TAU;
    at += 8.0 * vec2(sin(turn), cos(turn * 0.8 + h.w * TAU));
    float d = length(q - at);
    if (d > margin) return vec4(0.0);
    // Nearer motes are bigger, out of focus and fainter.
    float r = mix(1.0, 5.0, h.y * h.y * h.y);
    float soft = max(1.0 / U, 0.6 * r);
    float disc = smoothstep(r + soft, r - soft, d) * mix(1.0, 0.3, h.y);
    // A flake glints as its face turns to the sun.
    float glint = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(wphase(0.6 + 0.8 * h.w) + h.y * TAU), 4.0);
    return vec4(SUNBEAMS_NEAR, 1.0) * disc * glint;
}

vec4 sunbeams(vec2 p) {
    vec2 sun = u_canvas * vec2(${num(SUN[0])}, ${num(SUN[1])});
    sun.x += 0.03 * DESIGN_W * sin(wphase(0.021));
    vec2 v = p - sun;
    float dist = length(v) / u_canvas.y - ${num(-SUN[1])};
    float angle = atan(v.y, v.x);

    float broad = vnoise(vec2(angle * 9.0 + u_seed * 9.1, drift(0.025)));
    float fine = vnoise(vec2(angle * 24.0 + 40.0 + u_seed * 3.7, drift(0.04)));
    // Stretched, since a sum of noises seldom strays far from a half.
    float n = 0.5 + 1.5 * (0.72 * broad + 0.28 * fine - 0.5);
    float open = 0.5 - 0.15 * (u_density - 1.0);
    float shaft = smoothstep(open, open + 0.45, n);
    shaft *= shaft;

    // Each shaft reaches its own length, and is broken along it by air moving through.
    float reach = 0.5 + 1.1 * fine;
    float along = vnoise(vec2(angle * 14.0 + 70.0, dist * 4.0 - drift(0.06)));
    float beam = shaft * smoothstep(reach, 0.0, dist) * (0.6 + 0.4 * along);

    float veil = exp(-dist * 3.5);
    float glare = exp(-dist * dist * 30.0);
    float light = 0.36 * beam * (0.5 + 0.5 * veil) + 0.08 * veil + 0.22 * glare;
    vec3 rgb = mix(SUNBEAMS_FAR, SUNBEAMS_NEAR, veil);
    // Light adds a little more than it covers, so shafts glow over dark and tint a
    // light wallpaper warm rather than burning it white.
    vec4 c = vec4(rgb * light * 1.25, 0.85 * light);

    if (beam > 0.02) c += sunbeamsDust(p) * min(1.0, 3.0 * beam);
    // Dithered, since faint gradients over a dark wallpaper band in 8 bits.
    c.rgb += (hash12(p + u_seed) - 0.5) / 255.0 * min(1.0, 40.0 * c.a);
    return c;
}
`;
