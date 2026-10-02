// The base is handed to the shell's own BackgroundSource instead of painted, so it
// shows wherever a wallpaper does. Every private reach is in docs/private-api.md.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GDesktopEnums from 'gi://GDesktopEnums';
import Clutter from 'gi://Clutter';
import cairo from 'cairo';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { accentStops, paintGradient, paletteStops } from './palettes.js';

const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';

const FALLBACK_SIZE = [1920, 1080];

export class ShellBackground {
    constructor() {
        this._settings = Gio.Settings.new_with_backend(
            BACKGROUND_SCHEMA, Gio.memory_settings_backend_new());

        // A manager of our own keeps the shared source alive; its actor is never shown.
        this._holder = null;
        this._holderContainer = null;
        this._source = null;
        this._shellSettings = null;
        this._destroyWrap = null;
        this._applied = null;
        this._retakeId = 0;

        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'wallpaper-fx']);
    }

    get active() {
        return this._shellSettings !== null;
    }

    update(state) {
        const base = this._describe(state);
        if (!base) {
            this.release();
            return;
        }

        // Every write makes the shell crossfade, so an unchanged base is left alone.
        const key = JSON.stringify(base);
        if (this.active && key === this._applied) return;
        this._applied = key;

        // One apply, so a change of mode and picture costs one crossfade.
        this._settings.delay();
        this._settings.set_string('picture-uri', base.uri);
        this._settings.set_string('picture-uri-dark', base.uri);
        this._settings.set_enum('picture-options', base.style);
        this._settings.set_string('primary-color', base.color);
        this._settings.set_string('secondary-color', base.color);
        this._settings.set_enum('color-shading-type', GDesktopEnums.BackgroundShading.SOLID);
        this._settings.apply();

        this._attach();
    }

    release() {
        const source = this._source;
        const shellSettings = this._shellSettings;

        this._source = null;
        this._shellSettings = null;
        this._applied = null;

        if (this._retakeId) {
            GLib.source_remove(this._retakeId);
            this._retakeId = 0;
        }

        if (source && shellSettings) {
            // Another extension may have wrapped it since; ours then stays inside
            // theirs, and does nothing once the source is no longer held.
            if (source.destroy === this._destroyWrap) delete source.destroy;
            source._settings = shellSettings;
            reloadBackgrounds(source);
        }

        if (this._holder) {
            this._holder.destroy();
            this._holder = null;
            this._holderContainer.destroy();
            this._holderContainer = null;
        }
    }

    destroy() {
        this.release();
        this._settings = null;
    }

    _describe(state) {
        const stops = state.mode === 'color' ? paletteStops(state.colorPalette)
            : state.mode === 'accent' ? accentStops(state.accent) : null;
        if (stops) {
            const [width, height] = state.span ? spannedSize() : largestSize();
            const file = this._gradientFile(stops, width, height);
            if (!file) return null;
            const [, r, g, b] = stops[Math.floor(stops.length / 2)];
            return {
                uri: file,
                // Rendered at the size it is shown, so stretching is exact.
                style: state.span ? GDesktopEnums.BackgroundStyle.SPANNED : GDesktopEnums.BackgroundStyle.STRETCHED,
                color: `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`,
            };
        }

        // A missing picture would be a black desktop; the user's wallpaper shows instead.
        if (state.mode === 'image' && state.customImage &&
            GLib.file_test(state.customImage, GLib.FileTest.EXISTS)) {
            return {
                uri: Gio.File.new_for_path(state.customImage).get_uri(),
                style: GDesktopEnums.BackgroundStyle.ZOOM,
                color: '#000000',
            };
        }

        return null;
    }

    // Four stops are more than Meta.Background's gradients, hence a PNG. Named by a
    // digest, since the shell reloads the wallpaper on any change to its file.
    _gradientFile(stops, width, height) {
        const digest = GLib.compute_checksum_for_string(
            GLib.ChecksumType.SHA256, JSON.stringify([stops, width, height]), -1).slice(0, 12);
        const path = GLib.build_filenamev([this._cacheDir, `palette-${digest}.png`]);

        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
            try {
                GLib.mkdir_with_parents(this._cacheDir, 0o755);
                const surface = new cairo.ImageSurface(cairo.Format.RGB24, width, height);
                const cr = new cairo.Context(surface);
                paintGradient(cr, stops, width, height);
                cr.$dispose();
                surface.writeToPNG(path);
                surface.finish();
            } catch (e) {
                console.error(`[WallpaperFx] Could not render a gradient: ${e}`);
                return null;
            }
        }
        return Gio.File.new_for_path(path).get_uri();
    }

    _attach() {
        if (this.active) return;

        const source = this._obtainSource();
        if (!source?._settings) {
            console.warn('[WallpaperFx] No background source to take over; the base will not change');
            return;
        }

        this._shellSettings = source._settings;
        this._source = source;
        source._settings = this._settings;
        reloadBackgrounds(source);
        adoptStranded(source);

        // An extension that destroys a BackgroundManager twice can destroy the
        // source we hold; then take the new one (docs/private-api.md).
        const destroy = source.destroy;
        this._destroyWrap = (...args) => {
            destroy.apply(source, args);
            if (this._source === source) this._sourceLost();
        };
        source.destroy = this._destroyWrap;
    }

    _sourceLost() {
        this._source = null;
        this._shellSettings = null;

        // The holder's claim died with the source; releasing it would take one off the next.
        this._holder = null;
        this._holderContainer?.destroy();
        this._holderContainer = null;

        this._retakeId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._retakeId = 0;
            this._attach();
            return GLib.SOURCE_REMOVE;
        });
    }

    _obtainSource() {
        if (!this._holder) {
            this._holderContainer = new Clutter.Actor();
            try {
                this._holder = new Background.BackgroundManager({
                    container: this._holderContainer,
                    monitorIndex: 0,
                    controlPosition: false,
                });
            } catch (e) {
                console.error(`[WallpaperFx] Could not reach the shell's backgrounds: ${e}`);
                this._holderContainer.destroy();
                this._holderContainer = null;
                return null;
            }
        }
        return this._holder._backgroundSource;
    }
}

// What the shell does when the wallpaper setting changes: every manager rebuilds.
function reloadBackgrounds(source) {
    const backgrounds = source._backgrounds;
    if (!backgrounds) return;

    for (const key of Object.keys(backgrounds))
        backgrounds[key]?._emitChangedSignal?.();
}

// Moves the desktop's managers off a destroyed source, each with the claim its
// eventual release will take (docs/private-api.md, "Why source._useCount++").
function adoptStranded(source) {
    for (const manager of Main.layoutManager._bgManagers ?? []) {
        const old = manager._backgroundSource;
        if (!old || old === source || old._backgrounds || !manager._updateBackgroundActor)
            continue;

        manager._backgroundSource = source;
        source._useCount++;
        manager._updateBackgroundActor();
    }
}

function largestSize() {
    const monitors = global.display.get_n_monitors();
    let width = 0;
    let height = 0;

    for (let i = 0; i < monitors; i++) {
        const rect = global.display.get_monitor_geometry(i);
        width = Math.max(width, rect.width);
        height = Math.max(height, rect.height);
    }

    if (width < 1 || height < 1) return FALLBACK_SIZE;
    return [width, height];
}

function spannedSize() {
    const monitors = global.display.get_n_monitors();
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < monitors; i++) {
        const rect = global.display.get_monitor_geometry(i);
        x0 = Math.min(x0, rect.x);
        y0 = Math.min(y0, rect.y);
        x1 = Math.max(x1, rect.x + rect.width);
        y1 = Math.max(y1, rect.y + rect.height);
    }
    return x1 > x0 && y1 > y0 ? [x1 - x0, y1 - y0] : FALLBACK_SIZE;
}
