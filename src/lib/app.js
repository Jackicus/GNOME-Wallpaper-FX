import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { MonitorRenderer, SceneClock } from './engine.js';
import { SystemState } from './system.js';
import { OverviewCanvas } from './overview.js';
import { ShellBackground } from './background.js';
import { WeatherWatcher } from './weather.js';
import { WorkspaceParallax } from './parallax.js';

const BASE_KEYS = new Set([
    'background-mode', 'color-palette', 'custom-image', 'span-monitors', 'weather', 'weather-background',
]);

export class WallpaperFxApp {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._clock = new SceneClock();
        this._renderers = new Map(); // monitor index -> MonitorRenderer
    }

    enable() {
        this._interface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._system = new SystemState(() => this._push(this._state()));
        this._weather = null;
        this._followWeather();

        this._background = new ShellBackground();
        this._background.update(this._state());

        this._build();

        this._parallax = new WorkspaceParallax(this._renderers);
        this._parallax.update(this._parallaxAmount());

        this._overview = new OverviewCanvas(index => this._renderers.get(index)?.actor ?? null,
            index => this._parallax.wallpaperFor(index));
        this._overview.enable();

        Main.layoutManager.connectObject('monitors-changed', () => this._rebuild(), this);

        this._settings.connectObject('changed', (_s, key) => {
            // Written by the weather itself, which says when its look changes.
            if (key === 'weather-status') return;
            if (key === 'weather') this._followWeather();
            if (key === 'span-monitors' || key.startsWith('parallax')) {
                this._rebuild();
                return;
            }
            const state = this._state();
            if (BASE_KEYS.has(key)) this._background.update(state);
            this._push(state);
        }, this);

        this._interface.connectObject('changed::accent-color',
            () => this._background.update(this._state()), this);
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        this._interface = null;

        this._overview.destroy();
        this._overview = null;

        this._parallax.destroy();
        this._parallax = null;

        this._weather?.destroy();
        this._weather = null;

        this._system.destroy();
        this._system = null;

        // The wallpaper comes back before the patterns go, never a bare desktop.
        this._background.destroy();
        this._background = null;

        this._teardown();
    }

    _followWeather() {
        const on = this._settings.get_boolean('weather');
        if (on && !this._weather) {
            // Built before the background at enable, so the first base is
            // already the weather's; hence the ?. below.
            this._weather = new WeatherWatcher(this._settings, () => {
                const state = this._state();
                this._background?.update(state);
                this._push(state);
            });
        } else if (!on && this._weather) {
            this._weather.destroy();
            this._weather = null;
            this._settings.reset('weather-status');
        }
    }

    _state() {
        const s = this._settings;
        // The weather's look stands in for the user's keys, which stay as they are.
        const look = this._weather?.look ?? null;
        const sky = look && s.get_boolean('weather-background') ? look : null;
        return {
            enabledEffects: look?.['enabled-effects'] ?? s.get_strv('enabled-effects'),
            tuning: look?.['pattern-tuning'] ?? s.get_value('pattern-tuning').deepUnpack(),
            mode: sky?.['background-mode'] ?? s.get_string('background-mode'),
            colorPalette: sky?.['color-palette'] ?? s.get_string('color-palette'),
            customImage: s.get_string('custom-image'),
            accent: this._interface.get_string('accent-color'),
            span: this._spanning(),
            baseSize: this._baseSize(),
            targetFps: s.get_int('target-fps'),
            speed: s.get_double('speed'),
            opacity: s.get_double('opacity'),
            pauseWhenCovered: s.get_boolean('pause-when-covered'),
            pauseOnBattery: s.get_boolean('pause-on-battery'),
            onBattery: this._system.onBattery,
            powerSaver: this._system.powerSaver,
            animations: this._system.animations,
        };
    }

    _parallaxAmount() {
        return this._settings.get_boolean('parallax') ? this._settings.get_double('parallax-amount') : 0;
    }

    _spanning() {
        return this._settings.get_boolean('span-monitors') && Main.layoutManager.monitors.length > 1;
    }

    // One image serves every monitor: the whole canvas spanned, else the largest monitor.
    _baseSize() {
        const monitors = Main.layoutManager.monitors;
        if (!this._spanning())
            return [Math.max(...monitors.map(m => m.width)), Math.max(...monitors.map(m => m.height))];
        const { width, height } = canvasAround(monitors);
        return [width, height];
    }

    // Spanned, every monitor draws its part of one canvas, sized by the primary.
    // `travel` is what a pattern of depth 1 pans with parallax; each layer's canvas is longer by its own.
    _views() {
        const monitors = Main.layoutManager.monitors;
        const views = this._spanning()
            ? monitors.map(() => ({
                canvas: canvasAround(monitors),
                unit: Main.layoutManager.primaryMonitor.height / 1080,
                seed: 0,
            }))
            : monitors.map(m => ({
                canvas: { x: m.x, y: m.y, width: m.width, height: m.height },
                unit: m.height / 1080,
                seed: m.index * 17.31,
            }));

        const share = this._parallaxAmount() * this._settings.get_double('parallax-depth');
        const vertical = global.workspace_manager.layout_rows === -1;
        const onlyPrimary = Meta.prefs_get_workspaces_only_on_primary();
        for (const [index, view] of views.entries()) {
            const moves = share > 0 && (!onlyPrimary || index === Main.layoutManager.primaryIndex);
            const travel = moves ? Math.round(share * (vertical ? view.canvas.height : view.canvas.width)) : 0;
            view.travel = vertical ? [0, travel] : [travel, 0];
        }
        return views;
    }

    _build() {
        this._teardown();

        const state = this._state();
        this._tuneClock(state);

        // Over the wallpaper, under the windows (private: docs/private-api.md).
        const group = Main.layoutManager._backgroundGroup;
        if (!group) {
            console.warn('[WallpaperFx] No background group to draw in');
            return;
        }

        const views = this._views();
        for (const monitor of Main.layoutManager.monitors) {
            const renderer = new MonitorRenderer(monitor, views[monitor.index], this._clock, state);
            this._renderers.set(monitor.index, renderer);
            group.add_child(renderer.actor);
        }
    }

    _rebuild() {
        this._background.update(this._state());
        this._build();
        this._parallax.update(this._parallaxAmount());
        this._overview.invalidate();
    }

    _push(state) {
        this._tuneClock(state);
        for (const renderer of this._renderers.values())
            renderer.setState(state);
    }

    _tuneClock(state) {
        this._clock.speed = state.speed;
        this._clock.rates.clear();
        for (const [id, tuning] of Object.entries(state.tuning))
            this._clock.rates.set(id, tuning.speed ?? 1);
    }

    _teardown() {
        for (const renderer of this._renderers.values())
            renderer.destroy();
        this._renderers.clear();
    }
}

function canvasAround(monitors) {
    const x = Math.min(...monitors.map(m => m.x));
    const y = Math.min(...monitors.map(m => m.y));
    return {
        x,
        y,
        width: Math.max(...monitors.map(m => m.x + m.width)) - x,
        height: Math.max(...monitors.map(m => m.y + m.height)) - y,
    };
}
