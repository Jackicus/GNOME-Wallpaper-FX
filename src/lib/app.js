import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { MonitorRenderer, SceneClock } from './engine.js';
import { SystemState } from './system.js';
import { OverviewCanvas } from './overview.js';
import { ShellBackground } from './background.js';
import { WeatherWatcher } from './weather.js';
import { ParallaxManager } from './parallax.js';

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

        this._parallax = new ParallaxManager(() => this._renderers);
        this._parallax.enable(this._state());

        this._overview = new OverviewCanvas(index => this._renderers.get(index)?.actor ?? null, this._parallax);
        this._overview.enable();

        Main.layoutManager.connectObject('monitors-changed', () => this._rebuild(), this);

        this._settings.connectObject('changed', (_s, key) => {
            // Written by the weather itself, which says when its look changes.
            if (key === 'weather-status') return;
            if (key === 'weather') this._followWeather();
            if (key === 'span-monitors') {
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

        this._parallax?.destroy();
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
            parallax: s.get_boolean('parallax'),
            parallaxAmount: s.get_double('parallax-amount'),
            onBattery: this._system.onBattery,
            powerSaver: this._system.powerSaver,
            animations: this._system.animations,
        };
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
    _views() {
        const monitors = Main.layoutManager.monitors;
        if (!this._spanning()) {
            return monitors.map(m => ({
                canvas: { x: m.x, y: m.y, width: m.width, height: m.height },
                unit: m.height / 1080,
                seed: m.index * 17.31,
            }));
        }

        const canvas = canvasAround(monitors);
        const unit = Main.layoutManager.primaryMonitor.height / 1080;
        return monitors.map(() => ({ canvas, unit, seed: 0 }));
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
        this._overview.invalidate();
        this._parallax?.update(this._state());
    }

    _push(state) {
        this._tuneClock(state);
        for (const renderer of this._renderers.values())
            renderer.setState(state);
        this._parallax?.update(state);
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
