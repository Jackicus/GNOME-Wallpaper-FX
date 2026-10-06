import { num, seeded } from '../layer.js';

// Fireflies circling where the pointer was a moment ago, each a little further behind,
// so they string out after it when it moves, spread when it is quick and close in
// around it as it rests. Without a pointer they circle low in the middle.
const MOST = 18;
const DESIGNED = 9;
const ORBIT = 80;
const REACH = 40;

const FLIES = (() => {
    const rand = seeded(5150);
    return Array.from({ length: MOST }, () => ({
        lag: 0.25 + 0.9 * rand(),
        orbit: 0.3 + 0.7 * rand(),
        spin: (0.4 + 0.7 * rand()) * (rand() < 0.5 ? -1 : 1),
        phase: rand() * Math.PI * 2,
        bob: 0.5 + rand(),
        cycle: 1.6 + 1.4 * rand(),
        size: rand(),
    }));
})();

export const density = [0.5, 2];

export const glsl = `
uniform vec4 swarm_flies[${MOST}];

vec4 swarm(vec2 p) {
    vec4 c = vec4(0.0);
    for (int i = 0; i < ${MOST}; i++) {
        vec4 f = swarm_flies[i];
        if (f.z <= 0.0) continue;
        vec2 o = p - f.xy;
        float d2 = dot(o, o);
        float reach = ${num(REACH)} * U;
        if (d2 > reach * reach) continue;

        vec4 g = glow(sqrt(d2), (8.0 + 6.0 * f.w) * U, vec3(0.784, 1.0, 0.627), 0.3);
        g.rgb *= vec3(1.0, 0.98, 0.75);
        float b = 1.0 - d2 / (reach * reach);
        float bloom = 0.24 * b * b * b;
        g += vec4(vec3(0.784, 0.98, 0.47) * bloom, bloom) * (1.0 - g.a);
        c += g * f.z;
    }
    return c;
}
`;

// Where the pointer was `age` seconds ago, between its samples.
function pointerAt(pointer, age) {
    let newer = { x: pointer.x, y: pointer.y, age: 0 };
    for (const s of pointer.trail) {
        if (s.age >= age) {
            const f = (age - newer.age) / Math.max(s.age - newer.age, 1e-6);
            return [newer.x + (s.x - newer.x) * f, newer.y + (s.y - newer.y) * f];
        }
        newer = s;
    }
    return [newer.x, newer.y];
}

export class State {
    constructor({ width, height, unit }) {
        this._home = [width / 2, height * 0.62];
        this._unit = unit;
        this._flies = new Float32Array(MOST * 4);
    }

    uniforms(t, amount, pointer) {
        const u = this._unit;
        // Quick over the last half second spreads them; a long rest draws them in.
        let spread = 1;
        if (pointer) {
            const [x, y] = pointerAt(pointer, 0.5);
            const speed = Math.hypot(pointer.x - x, pointer.y - y) / 0.5 / u;
            spread = (1 + Math.min(speed / 600, 2)) * (1 - 0.4 * Math.min(1, Math.max(0, (pointer.idle - 1) / 3)));
        }

        FLIES.forEach((fly, i) => {
            const [cx, cy] = pointer ? pointerAt(pointer, fly.lag) : this._home;
            const a = fly.spin * t + fly.phase;
            const r = ORBIT * fly.orbit * spread * u;
            const blink = (t / fly.cycle + fly.phase) % 1;
            const level = Math.sin(Math.min(1, blink / 0.45) * Math.PI) ** 2;
            const present = Math.min(1, Math.max(0, DESIGNED * amount - i));
            this._flies.set([
                cx + Math.cos(a) * r,
                cy + Math.sin(a * fly.bob) * r * 0.7,
                (0.35 + 0.65 * level) * present,
                fly.size,
            ], i * 4);
        });
        return [['swarm_flies', 4, this._flies]];
    }
}
