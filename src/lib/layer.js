export const TAU = Math.PI * 2;

export const num = x => x.toFixed(4);
export const vec3 = xs => `vec3(${xs.map(num).join(', ')})`;

// `call(s)` for each of `most` slots, `designed` of them at Amount 1, the last of those and
// every extra fading in with it. Each test is on a uniform, so the code stays straight-line.
export const slots = (call, designed, most) => Array.from({ length: most }, (_, s) => {
    const fade = ` * clamp(${designed}.0 * u_density - ${s}.0, 0.0, 1.0)`;
    if (s < designed) return `c += ${call(s)}${s === designed - 1 ? fade : ''};`;
    return `if (${designed}.0 * u_density > ${s}.0) c += ${call(s)}${fade};`;
}).join('\n');

// Seeded PRNG (mulberry32), so a layout is the same on every monitor and reload.
export function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// For the React patterns: a mark every `step` px along the pointer's path, newest first,
// each with its index along the whole path (so it stays put as the trail grows), its
// place and its age, at most `most` of them and none older than `life` seconds.
export function pathMarks(trail, step, life, most) {
    const marks = [];
    for (let i = 0; i + 1 < trail.length && marks.length < most; i++) {
        const [a, b] = [trail[i], trail[i + 1]];
        if (a.age > life) break;
        for (let k = Math.floor(a.odometer / step); k * step > b.odometer && marks.length < most; k--) {
            const f = (a.odometer - k * step) / (a.odometer - b.odometer);
            const age = a.age + (b.age - a.age) * f;
            if (age > life) return marks;
            marks.push({ k, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, age });
        }
    }
    return marks;
}

// The box around `points` ([x, y] pairs) grown by `pad`, for a shader to leave early
// outside it; nothing at all is a box no pixel is in.
export function around(points, pad) {
    if (points.length === 0) return [0, 0, -1, -1];
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}
