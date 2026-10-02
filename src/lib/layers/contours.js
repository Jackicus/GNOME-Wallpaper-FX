// A relief map in light: flow noise with analytic derivatives, so every line is one
// width; lines fade where the ground levels out or they crowd.

// Levels per unit of height at Amount 1: a line every 25 px or so on a 1080-line screen.
const LEVELS = 9.0;

export const density = [0.5, 2];

// contoursPermute and the simplex lattice in contoursNoise are from the 2D simplex
// noise of webgl-noise, https://github.com/ashima/webgl-noise, under its MIT License:
/* Copyright (C) 2011 by Ashima Arts (Simplex noise)
Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.*/
export const glsl = `
const float CONTOURS_F = 0.366025404;   // (sqrt(3) - 1) / 2
const float CONTOURS_G = 0.211324865;   // (3 - sqrt(3)) / 6

// Exact in floats under 289, and cheaper than hashing each corner.
vec3 contoursPermute(vec3 x) {
    return mod((x * 34.0 + 1.0) * x, 289.0);
}

// Simplex noise with its gradient in .yz. Each corner turns at a whole multiple of one
// phase, which keeps the field seamless across the epoch.
vec3 contoursNoise(vec2 x, float rate, float seed) {
    vec2 i = floor(x + (x.x + x.y) * CONTOURS_F);
    vec2 x0 = x - i + (i.x + i.y) * CONTOURS_G;
    vec2 o = x0.x > x0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec2 x1 = x0 - o + CONTOURS_G;
    vec2 x2 = x0 - 1.0 + 2.0 * CONTOURS_G;

    i = mod(i + seed, 289.0);
    vec3 hp = contoursPermute(contoursPermute(i.y + vec3(0.0, o.y, 1.0)) + i.x + vec3(0.0, o.x, 1.0));
    vec3 turns = hp - 41.0 * floor(hp * (1.0 / 41.0)) - 20.0;
    vec3 a = hp * (TAU / 289.0) + turns * wphase(rate / 20.0);
    vec3 gx = cos(a);
    vec3 gy = sin(a);

    vec3 dx = vec3(x0.x, x1.x, x2.x);
    vec3 dy = vec3(x0.y, x1.y, x2.y);
    vec3 t = max(0.5 - dx * dx - dy * dy, 0.0);
    vec3 t2 = t * t;
    vec3 t4 = t2 * t2;
    vec3 gd = gx * dx + gy * dy;
    vec3 s = 8.0 * t2 * t * gd;
    return 70.0 * vec3(dot(t4, gd), dot(t4, gx) - dot(s, dx), dot(t4, gy) - dot(s, dy));
}

vec4 contours(vec2 p) {
    // Each octave turned against the last, so their lattices never line up.
    float seed = floor(mod(u_seed * 61.0, 289.0));
    float k = 2.6 / DESIGN_W;
    vec2 x = p * k;
    vec3 n = contoursNoise(x, 0.028, seed);
    mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
    vec3 m = contoursNoise(r * x * 2.1 + vec2(11.3, -7.9), 0.04, seed + 101.0);
    mat2 r2 = mat2(0.28, -0.96, 0.96, 0.28);
    vec3 q = contoursNoise(r2 * x * 4.7 + vec2(-5.1, 3.7), 0.055, seed + 197.0);
    float h = n.x + 0.4 * m.x + 0.12 * q.x;
    vec2 grad = (n.yz + 0.4 * 2.1 * (m.yz * r) + 0.12 * 4.7 * (q.yz * r2)) * k;

    // Index contours are offset off zero, where the first octave's lattice points sit.
    float levels = ${LEVELS.toFixed(1)} * u_density;
    float v = h * levels + 0.5;
    float level = floor(v + 0.5);
    float slope = length(grad) * levels;                // levels per pixel
    float d = abs(v - level) / max(slope, 1e-5);        // pixels to that line

    bool index = abs(mod(level + 2.5, 5.0) - 2.5) < 0.5;
    float w = (index ? 1.5 : 1.0) * U;
    float a = (index ? 0.34 : 0.17) * line(d, w);
    a *= smoothstep(1.0e-4, 3.0e-4, length(grad) * U);  // level ground
    a *= smoothstep(3.0, 7.0, 1.0 / (slope * U));       // crowding
    a *= mix(0.55, 1.3, smoothstep(-0.7, 0.7, h));      // relief
    return vec4(0.78, 0.95, 0.96, 1.0) * a;
}
`;
