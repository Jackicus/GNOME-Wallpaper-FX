// Each pattern's GLSL as a Shell.GLSLEffect, and the prelude they share (docs/patterns.md).

import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

export const EPOCH_S = 1024;

// U is a pixel of a 1080-line screen and DESIGN_W a 1920-wide one's width. Time is
// split in u_epoch and u_time because a float cannot hold an hour of it to a frame;
// the helpers fold the epoch in (docs/patterns.md, "Time").
//
// hash12 and hash42 are Dave Hoskins' "Hash without Sine",
// https://www.shadertoy.com/view/4djSRW, under its MIT License:
/* Copyright (c)2014 David Hoskins.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.*/
const COMMON = `
uniform vec2 u_canvas;
uniform float u_unit;
uniform float u_time;
uniform float u_epoch;
uniform float u_seed;
uniform float u_density;

#define U u_unit
#define DESIGN_W (1920.0 * u_unit)
#define TAU 6.28318530718

// The argument for sin(w * t).
float wphase(float w) {
    return mod(w * u_epoch, TAU) + w * u_time;
}

// v * t, for something that repeats every "period".
vec2 scroll(vec2 v, float period) {
    return mod(v * u_epoch, period) + v * u_time;
}

// A life that repeats every "period" seconds, offset by "phase" of one:
// x counts the lives so far, y is how far through this one it is.
vec2 lifecycle(float period, float phase) {
    float e = u_epoch / period;
    float c = fract(e) + u_time / period + phase;
    return vec2(floor(e) + floor(c), fract(c));
}

// Hashes without sine (Dave Hoskins): stable across GPUs, no bit operations.
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec4 hash42(vec2 p) {
    vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
    p4 += dot(p4, p4.wzxy + 33.33);
    return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

// Value noise in [0, 1] and three octaves of it; both repeat every 256 units, for drift().
float vnoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(mod(i, 256.0));
    float b = hash12(mod(i + vec2(1.0, 0.0), 256.0));
    float c = hash12(mod(i + vec2(0.0, 1.0), 256.0));
    float d = hash12(mod(i + vec2(1.0, 1.0), 256.0));
    return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}

float fbm(vec2 x) {
    return (vnoise(x) * 0.5 + vnoise(x * 2.0 + vec2(17.3, 9.1)) * 0.25 +
            vnoise(x * 4.0 + vec2(-31.7, 23.9)) * 0.125) / 0.875;
}

// a * t, as a distance through the noise above.
float drift(float a) {
    return mod(a * u_epoch, 256.0) + a * u_time;
}

// A halo around a white core, in pixels. Neither is narrower than a pixel (it is
// widened and dimmed instead), so a small light glides rather than flickers.
vec4 glow(float d, float r, vec3 rgb, float core) {
    float d2 = d * d;
    float hs = r * 0.33;
    float hw = max(hs, 0.6);
    float halo = 0.9 * (hs * hs) / (hw * hw) * exp(-0.5 * d2 / (hw * hw));
    float cs = r * core * 0.6;
    float cw = max(cs, 0.5);
    float hot = min(1.0, (cs * cs) / (cw * cw)) * exp(-0.5 * d2 / (cw * cw));
    float a = halo + hot * (1.0 - halo);
    return vec4(mix(rgb * halo, vec3(a), hot), a);
}

// Coverage of a line "width" wide at distance d from it, antialiased over a pixel.
float line(float d, float width) {
    return clamp(0.5 * width + 0.5 - d, 0.0, 1.0) * min(1.0, width);
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - a - ab * h);
}
`;

// Kept across disable and enable: a GType cannot be unregistered, and a class compiles
// its pipeline once. Each load of the module names its classes apart.
const LOAD = GLib.uuid_string_random().slice(0, 8);
const classes = new Map();

export function effectClass(effect) {
    if (!classes.has(effect.id)) classes.set(effect.id, buildEffectClass(effect));
    return classes.get(effect.id);
}

// Also what scripts/shaders.mjs compiles and times outside the shell.
export function shaderSource(effect) {
    return {
        declarations: `uniform vec2 u_res;\nuniform vec2 u_origin;\nuniform float u_gain;\n${COMMON}\n${effect.glsl}`,
        code: `
            vec2 p = u_origin + cogl_tex_coord_in[0].st * u_res;
            cogl_color_out = clamp(${effect.id}(p) * u_gain, 0.0, 1.0) * cogl_color_in.a;
        `,
    };
}

function buildEffectClass(effect) {
    const { declarations, code } = shaderSource(effect);

    return GObject.registerClass({
        GTypeName: `WallpaperFx_${effect.id}_${LOAD}`,
    }, class extends Shell.GLSLEffect {
        vfunc_build_pipeline() {
            this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, declarations, code, true);
        }

        // The last moment before the frame, so a pattern shows the time it is painted.
        vfunc_paint_target(node, paintContext) {
            this.onPaint?.();
            super.vfunc_paint_target(node, paintContext);
        }

        setUniform(name, components, values) {
            let location = this._locations?.get(name);
            if (location === undefined) {
                this._locations ??= new Map();
                location = this.get_uniform_location(name);
                this._locations.set(name, location);
            }
            if (location >= 0) this.set_uniform_float(location, components, values);
        }
    });
}
