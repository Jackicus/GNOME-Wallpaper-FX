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
