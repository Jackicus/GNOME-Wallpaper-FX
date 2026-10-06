import { around, num, pathMarks, seeded } from '../layer.js';

// A mote every SPACING U of the pointer's path, scattered up to SCATTER U from it and
// settling FALL U a second, gone within LIFE seconds. A mote's look comes from its
// index along the path, so it keeps it while it lives.
const MOTES = 64;
const SPACING = 18;
const SCATTER = 18;
const FALL = 20;
const LIFE = 2.2;
// The largest motes flare in a cross, fading over FLARE U, and REACH is where it has faded out.
const FLARE = 7;
const REACH = 20;

export const density = [0.5, 2];

export const glsl = `
uniform vec4 stardust_motes[${MOTES}];
uniform vec4 stardust_box;

vec4 stardust(vec2 p) {
    vec4 c = vec4(0.0);
    if (any(lessThan(p, stardust_box.xy)) || any(greaterThan(p, stardust_box.zw))) return c;
    for (int i = 0; i < ${MOTES}; i++) {
        vec4 m = stardust_motes[i];
        if (m.z <= 0.0) break;
        vec2 o = p - m.xy;
        float d2 = dot(o, o);
        if (d2 > ${num(REACH * REACH)} * U * U) continue;

        float twinkle = 0.75 + 0.25 * sin(wphase(5.0 + 4.0 * m.w) + m.w * TAU);
        float fade = m.z * m.z * (3.0 - 2.0 * m.z) * (1.0 - smoothstep(0.94, 1.0, m.z));
        vec3 tint = mix(vec3(1.0, 0.88, 0.62), vec3(0.78, 0.87, 1.0), step(0.72, m.w));
        vec4 g = glow(sqrt(d2), (4.5 + 4.5 * m.w) * U, tint, 0.4);
        if (m.w > 0.6) {
            vec2 q = abs(o) / U;
            float a = (m.w - 0.6) / 0.4;
            float len = ${num(FLARE)} * a + 1.0;
            float f = 0.45 * a * (exp(-q.y * q.y - q.x / len) + exp(-q.x * q.x - q.y / len));
            g += vec4(tint * f, f) * (1.0 - g.a);
        }
        c += g * fade * twinkle * (1.0 - c.a);
    }
    return c;
}
`;

export class State {
    constructor({ unit }) {
        this._unit = unit;
        this._motes = new Float32Array(MOTES * 4);
    }

    uniforms(t, amount, pointer) {
        const u = this._unit;
        this._motes.fill(0);
        const marks = pathMarks(pointer?.trail ?? [], SPACING * u / amount, LIFE, MOTES);
        const live = [];
        for (const m of marks) {
            const rand = seeded(m.k * 7919 + 13);
            const life = LIFE * (0.55 + 0.45 * rand());
            if (m.age >= life) continue;
            const angle = rand() * Math.PI * 2;
            const out = SCATTER * Math.sqrt(rand()) * u;
            const x = m.x + Math.cos(angle) * out + Math.sin(m.age * 2 + angle) * 3 * u;
            const y = m.y + Math.sin(angle) * out + FALL * (0.5 + rand()) * m.age * u;
            this._motes.set([x, y, 1 - m.age / life, rand()], live.length * 4);
            live.push([x, y]);
        }
        return [['stardust_motes', 4, this._motes], ['stardust_box', 4, around(live, REACH * u)]];
    }
}
