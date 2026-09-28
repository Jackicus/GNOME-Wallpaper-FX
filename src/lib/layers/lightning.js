import { seeded } from '../layer.js';

// A storm some way off: now and then the clouds light up from inside, the
// light swelling and flickering as the strokes follow one another, and more
// often than not a forked bolt comes down through it.
//
// Strikes are rare enough to be decided here, once a frame, and handed over as
// a glow and a list of segments: one chance of a strike to each slot of a few
// seconds, decided and shaped by a hash of the slot, so every monitor of a
// spanned sky agrees on it without sharing anything. A bolt is a jagged path
// from the flash down towards the ground, made by displacing midpoints, with
// two branches forking off it. The shader draws the glow and, near the bolt,
// the distance to its nearest segment; with nothing in the sky it draws
// nothing, and costs next to nothing.
//
// The light is kept soft on purpose: the flash is a glow, not the whole screen
// turning white, and its flickers overlap rather than strobe.

const EVERY = 5;            // seconds: one chance of a strike to each slot
const CHANCE = 0.55;        // of a strike in a slot, at an Amount of 1
const BOLT = 0.7;           // of a strike having a visible bolt
const LIFE = 1.4;           // seconds a strike lasts, glow and all
const LEVELS = 5;           // halvings of the bolt: 32 segments
const TWIG = 3;             // of each branch: 8, the first half nearer the bolt
const MAIN = 2 ** LEVELS;
const HALF = 2 ** TWIG / 2;

// More or fewer strikes: a quarter as many, up to one in almost every slot.
export const density = [0.25, 2];

// The nearest of `count` segments from `from` on, four at a time.
const nearest = (name, from, count) => Array.from({ length: count / 4 }, (_, g) =>
    `${name} = min(${name}, lightningNearest(p, ` +
    `${[0, 1, 2, 3].map(k => `lightning_seg[${from + g * 4 + k}]`).join(', ')}));`).join('\n    ');

export const glsl = `
// The bolt, then the halves of both branches nearer it, then the far halves;
// each segment's ends, in canvas pixels.
uniform vec4 lightning_seg[${MAIN + 4 * HALF}];
uniform vec2 lightning_light;               // the bolt's brightness, and the flash's
uniform vec4 lightning_flash;               // the glow's centre, its radius, and the wash over the rest
uniform vec4 lightning_box;                 // the bolt's reach: left, top, right, bottom

float lightningNearest(vec2 p, vec4 a, vec4 b, vec4 c, vec4 d) {
    return min(min(segmentDistance(p, a.xy, a.zw), segmentDistance(p, b.xy, b.zw)),
               min(segmentDistance(p, c.xy, c.zw), segmentDistance(p, d.xy, d.zw)));
}

vec4 lightning(vec2 p) {
    float flash = lightning_light.y;
    if (flash <= 0.0) return vec4(0.0);

    // The clouds lit from inside, and a little light over everything.
    vec2 g = (p - lightning_flash.xy) / lightning_flash.z;
    float lit = 0.32 * exp(-2.2 * dot(g, g)) + lightning_flash.w;
    vec4 c = vec4(0.76, 0.78, 1.0, 1.0) * lit * flash;

    float bolt = lightning_light.x;
    if (bolt <= 0.0 || p.x < lightning_box.x || p.y < lightning_box.y ||
        p.x > lightning_box.z || p.y > lightning_box.w) return c;

    float main = 1e6;
    float near = 1e6;
    float far = 1e6;
    ${nearest('main', 0, MAIN)}
    ${nearest('near', MAIN, 2 * HALF)}
    ${nearest('far', MAIN + 2 * HALF, 2 * HALF)}

    // A white-hot channel in a violet glow, the branches thinner, and dimmer
    // towards their tips.
    float core = max(line(main, 2.2 * U), max(0.65 * line(near, 1.5 * U), 0.35 * line(far, 1.2 * U)));
    float halo = max(exp(-main / (9.0 * U)), max(0.5 * exp(-near / (6.0 * U)), 0.3 * exp(-far / (5.0 * U))));
    float a = 0.55 * halo * bolt;
    return c * (1.0 - a) + vec4(0.7, 0.72, 1.0, 1.0) * a + vec4(1.0) * core * bolt * (1.0 - a);
}
`;

// A jagged path from a to b: each midpoint pushed aside by a share of its
// segment's length, `levels` times over, so it zigzags at every scale.
function jagged(rand, a, b, levels, roughness) {
    let points = [a, b];
    for (let l = 0; l < levels; l++) {
        const next = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const [x0, y0] = points[i - 1];
            const [x1, y1] = points[i];
            const push = (rand() - 0.5) * 2 * roughness;
            // Aside, across the segment, by a share of its length.
            next.push([(x0 + x1) / 2 + push * (y1 - y0), (y0 + y1) / 2 - push * (x1 - x0)], points[i]);
        }
        points = next;
    }
    return points;
}

// A path's segments, as the shader takes them.
const segments = path => path.slice(1).flatMap((to, i) => [...path[i], ...to]);

export class State {
    constructor({ width, height, unit, seed }) {
        this._width = width;
        this._height = height;
        this._unit = unit;
        this._seed = Math.round(seed * 100);
        this._slot = null;
    }

    uniforms(t, amount) {
        const s = this._strike(t, amount);
        const age = t - s?.start;
        if (!s || age < 0 || age >= LIFE) return [['lightning_light', 2, [0, 0]]];

        // Strokes one after another, each lighting up fast and dying away,
        // the glow in the clouds lingering longer than the bolt.
        let flash = 0;
        let bolt = 0;
        for (const [at, strength] of s.strokes) {
            const since = age - at;
            if (since < 0) continue;
            const rise = Math.min(1, since / 0.02);
            flash += strength * rise * Math.exp(-since / 0.28);
            bolt += strength * rise * Math.exp(-since / 0.09);
        }
        flash = Math.min(1, flash);
        bolt = s.segments ? Math.min(1, bolt + 0.15 * flash) : 0;

        const uniforms = [
            ['lightning_light', 2, [bolt, flash]],
            ['lightning_flash', 4, [s.x, s.y, 0.45 * this._height, 0.05]],
        ];
        if (s.segments) uniforms.push(['lightning_box', 4, s.box], ['lightning_seg', 4, s.segments]);
        return uniforms;
    }

    // The strike of the slot t falls in, if there is one. It depends on
    // nothing but the slot, so it is kept while the slot lasts rather than
    // worked out again every frame.
    _strike(t, amount) {
        const slot = Math.floor(t / EVERY);
        if (this._slot?.slot !== slot || this._slot.amount !== amount)
            this._slot = { slot, amount, strike: this._shape(slot, amount) };
        return this._slot.strike;
    }

    _shape(slot, amount) {
        const rand = seeded(slot * 7919 + this._seed * 104729 + 3);
        // The first draw alone decides whether there is one, so a higher
        // Amount adds strikes and leaves the others as they were.
        if (rand() > CHANCE * amount) return null;
        const start = slot * EVERY + rand() * (EVERY - LIFE);
        const x = (0.08 + rand() * 0.84) * this._width;
        const y = (0.06 + rand() * 0.22) * this._height;
        const strokes = [[0, 1]];
        const more = Math.floor(rand() * 3);
        for (let i = 0, at = 0; i < more; i++) {
            at += 0.07 + rand() * 0.12;
            strokes.push([at, 0.45 + rand() * 0.45]);
        }
        if (rand() > BOLT) return { start, x, y, strokes };

        // Down from the flash, leaning to one side, and forking twice on the
        // way: each branch off at an angle, shorter and more crooked.
        const u = 1080 * this._unit;
        const end = [x + (rand() - 0.5) * 0.4 * u, y + (0.45 + rand() * 0.5) * this._height];
        const main = jagged(rand, [x, y], end, LEVELS, 0.24);
        const branches = [0, 1].map(() => {
            const from = main[Math.floor(MAIN * (0.2 + rand() * 0.45))];
            const angle = (0.45 + rand() * 0.6) * (rand() < 0.5 ? -1 : 1);
            const len = (0.1 + rand() * 0.18) * u;
            return jagged(rand, from, [from[0] + Math.sin(angle) * len, from[1] + Math.cos(angle) * len], TWIG, 0.3);
        });
        const near = branches.map(b => b.slice(0, HALF + 1));
        const far = branches.map(b => b.slice(HALF));

        // Far enough past the bolt for its glow to have faded.
        const reach = 50 * this._unit;
        const points = [main, ...branches].flat();
        const xs = points.map(pt => pt[0]);
        const ys = points.map(pt => pt[1]);
        return {
            start, x, y, strokes,
            segments: [main, ...near, ...far].flatMap(segments),
            box: [Math.min(...xs) - reach, Math.min(...ys) - reach, Math.max(...xs) + reach, Math.max(...ys) + reach],
        };
    }
}
