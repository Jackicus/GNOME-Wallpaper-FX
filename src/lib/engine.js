import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { FADE_ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/background.js';

import { EFFECTS } from './catalog.js';
import { EPOCH_S, effectClass } from './shader.js';

// A longer gap between paints is a pause: the animation picks up where it stopped.
const MAX_STEP_S = 0.1;

// Paints closer than this are one frame, so every monitor and clone shows one instant.
const SAME_FRAME_US = 1000;

// The share of a work area windows must cover to hide it, gaps between tiles allowed.
const COVERED = 0.95;

// One clock per pattern, shared by every monitor so spanned parts stay in step.
export class SceneClock {
    constructor() {
        this.speed = 1;
        this.rates = new Map(); // pattern id -> its own speed
        this._times = new Map(EFFECTS.map(e => [e.id, 0]));
        this._lastUs = 0;
    }

    tick() {
        const us = GLib.get_monotonic_time();
        const dt = (us - this._lastUs) / 1e6;
        if (this._lastUs && dt < SAME_FRAME_US / 1e6) return;
        if (this._lastUs && dt <= MAX_STEP_S) {
            for (const [id, t] of this._times)
                this._times.set(id, t + dt * this.speed * (this.rates.get(id) ?? 1));
        }
        this._lastUs = us;
    }

    time(id) {
        return this._times.get(id) ?? 0;
    }
}

// One monitor's patterns. `view.canvas` is the picture in stage coordinates (this
// monitor, or all of them spanned). Pacing: CLAUDE.md, "Pacing hangs off the paint".
export class MonitorRenderer {
    constructor(monitor, view, clock, state) {
        this.monitor = monitor;
        this._view = view;
        this._clock = clock;
        this._timerId = 0;
        this._layers = new Map(); // pattern id -> { id, actor, effect, state, rect, travel, react, density, t }
        this._at = [0, 0];

        this.actor = new Clutter.Actor({
            name: `WallpaperFx-Monitor-${monitor.index}`,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            reactive: false,
            // A shader effect paints a pixel past its actor: a bright seam between monitors.
            clip_to_allocation: true,
        });

        this.setState(state);
    }

    setState(state) {
        this._state = state;

        const wanted = EFFECTS.filter(e => state.enabledEffects.includes(e.id));
        for (const [id, layer] of this._layers) {
            if (wanted.some(e => e.id === id)) continue;
            this._layers.delete(id);
            // As long as the shell's own wallpaper crossfade, which a new base runs beside.
            layer.actor.ease({
                opacity: 0,
                duration: FADE_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                // Cut short means the monitor's actor took it already.
                onStopped: finished => finished && layer.actor.destroy(),
            });
        }

        wanted.forEach((effect, index) => {
            let layer = this._layers.get(effect.id);
            if (!layer) {
                layer = this._createLayer(effect);
                this._layers.set(effect.id, layer);
            }
            this.actor.set_child_at_index(layer.actor, index);

            const tuning = state.tuning[effect.id] ?? {};
            const [low, high] = effect.density ?? [1, 1];
            layer.density = Math.max(low, Math.min(high, tuning.density ?? 1));
            layer.effect.setUniform('u_gain', 1, [tuning.brightness ?? 1]);
            layer.effect.setUniform('u_density', 1, [layer.density]);
            // Drawn afresh even while resting, so the change shows.
            layer.t = -1;
            layer.effect.queue_repaint();
        });

        this.actor.opacity = Math.round(Math.max(0.1, Math.min(1, state.opacity)) * 255);
    }

    _createLayer(effect) {
        const { canvas, travel, unit, seed } = this._view;
        const { width, height } = this.monitor;
        const rect = { x: 0, y: 0, width, height };
        const own = travel.map(t => Math.round(t * effect.depth));
        const [canvasWidth, canvasHeight] = [canvas.width + own[0], canvas.height + own[1]];
        const Effect = effectClass(effect);
        const layer = {
            id: effect.id,
            actor: new Clutter.Actor({ width, height, reactive: false, opacity: 0 }),
            effect: new Effect(),
            state: effect.State
                ? new effect.State({ width: canvasWidth, height: canvasHeight, unit, seed, rect })
                : null,
            rect,
            travel: own,
            react: effect.react ?? false,
            density: 1,
            t: -1,
        };

        const fx = layer.effect;
        fx.setUniform('u_res', 2, [width, height]);
        this._place(layer);
        fx.setUniform('u_canvas', 2, [canvasWidth, canvasHeight]);
        fx.setUniform('u_unit', 1, [unit]);
        fx.setUniform('u_seed', 1, [seed]);
        fx.onPaint = () => this._onPaint(layer);
        layer.actor.add_effect(fx);
        this.actor.add_child(layer.actor);

        layer.actor.ease({ opacity: 255, duration: FADE_ANIMATION_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        return layer;
    }

    // Parallax: the monitor's view slides across each layer's longer canvas, 0 to 1 each way.
    pan(x, y) {
        this._at = [x, y];
        for (const layer of this._layers.values()) {
            this._place(layer);
            layer.effect.queue_repaint();
        }
    }

    // The State reads the same rect, so what it culls to follows the view.
    _place(layer) {
        const { canvas } = this._view;
        layer.rect.x = this.monitor.x - canvas.x + layer.travel[0] * this._at[0];
        layer.rect.y = this.monitor.y - canvas.y + layer.travel[1] * this._at[1];
        layer.effect.setUniform('u_origin', 2, [layer.rect.x, layer.rect.y]);
    }

    // A paint through a clone (the overview, the slide) is never covered.
    _paused(throughClone = false) {
        const state = this._state;
        if (this._layers.size === 0) return true;
        if (!state.animations || state.powerSaver) return true;
        if (state.pauseOnBattery && state.onBattery) return true;
        return state.pauseWhenCovered && !throughClone && desktopCovered(this.monitor.index);
    }

    _onPaint(layer) {
        this._clock.tick();
        const t = this._clock.time(layer.id);
        if (t !== layer.t) {
            layer.t = t;
            const epoch = Math.floor(t / EPOCH_S) * EPOCH_S;
            layer.effect.setUniform('u_epoch', 1, [epoch]);
            layer.effect.setUniform('u_time', 1, [t - epoch]);
            // A React pattern sees the pointer where its canvas has it, parallax and all.
            const pointer = layer.react && this._state.pointer
                ? this._state.pointer.view([layer.rect.x - this.monitor.x, layer.rect.y - this.monitor.y])
                : null;
            for (const [name, components, values] of layer.state?.uniforms(t, layer.density, pointer) ?? [])
                layer.effect.setUniform(name, components, values);
        }

        if (this._timerId || this._paused(layer.actor.is_in_clone_paint())) return;
        const periodMs = 1000 / this._refreshRate();
        const delay = Math.max(1, Math.round((this._divisor(1000 / periodMs) - 0.5) * periodMs));
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timerId = 0;
            for (const l of this._layers.values()) l.effect.queue_repaint();
            return GLib.SOURCE_REMOVE;
        });
    }

    // `target-fps`: 0 every frame, -N every Nth, a rate the nearest whole divisor.
    _divisor(hz) {
        const target = this._state.targetFps;
        if (target > 0) return Math.max(1, Math.round(hz / target));
        return Math.max(1, Math.min(8, -target));
    }

    _refreshRate() {
        let hz = 0;
        for (const view of this.actor.peek_stage_views())
            hz = Math.max(hz, view.get_refresh_rate());
        return hz >= 20 ? hz : 60;
    }

    destroy() {
        if (this._timerId) GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._layers.clear();
        this.actor.destroy();
    }
}

// Clutter culls a covered background, but the strip under the panel keeps it
// painting; this lets it rest.
export function desktopCovered(index) {
    if (global.display.get_monitor_in_fullscreen(index)) return true;

    const area = Main.layoutManager.getWorkAreaForMonitor(index);
    const workspace = global.workspace_manager.get_active_workspace();
    let open = [area];
    for (const actor of global.get_window_actors()) {
        const win = actor.meta_window;
        if (win.minimized || !win.located_on_workspace(workspace) ||
            win.get_window_type() === Meta.WindowType.DESKTOP)
            continue;
        const rect = win.get_frame_rect();
        open = open.flatMap(o => subtract(o, rect));
        if (open.length === 0) return true;
    }
    const left = open.reduce((sum, o) => sum + o.width * o.height, 0);
    return left <= area.width * area.height * (1 - COVERED);
}

function subtract(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x1 >= x2 || y1 >= y2) return [a];

    const pieces = [];
    if (a.y < y1) pieces.push({ x: a.x, y: a.y, width: a.width, height: y1 - a.y });
    if (y2 < a.y + a.height) pieces.push({ x: a.x, y: y2, width: a.width, height: a.y + a.height - y2 });
    if (a.x < x1) pieces.push({ x: a.x, y: y1, width: x1 - a.x, height: y2 - y1 });
    if (x2 < a.x + a.width) pieces.push({ x: x2, y: y1, width: a.x + a.width - x2, height: y2 - y1 });
    return pieces;
}

export function canvasAround(monitors) {
    const x = Math.min(...monitors.map(m => m.x));
    const y = Math.min(...monitors.map(m => m.y));
    return {
        x,
        y,
        width: Math.max(...monitors.map(m => m.x + m.width)) - x,
        height: Math.max(...monitors.map(m => m.y + m.height)) - y,
    };
}
