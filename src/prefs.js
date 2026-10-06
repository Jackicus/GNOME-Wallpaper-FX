import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';

import { EFFECTS } from './lib/catalog.js';
import { PALETTES } from './lib/palettes.js';
import { SCENE_KEYS, applyScene, deleteScene, isCurrent, saveScene, savedScenes } from './lib/scenes.js';
import { weatherPlace } from './lib/weather.js';

const tuningOf = settings => settings.get_value('pattern-tuning').deepUnpack();
const setTuning = (settings, all) => settings.set_value('pattern-tuning', new GLib.Variant('a{sa{sd}}', all));

function writeTuning(settings, id, key, value) {
    const all = tuningOf(settings);
    const mine = { ...(all[id] ?? {}) };
    if (Math.abs(value - 1) < 1e-6) delete mine[key];
    else mine[key] = value;
    if (Object.keys(mine).length) all[id] = mine;
    else delete all[id];
    setTuning(settings, all);
}

function weatherStatus(settings) {
    if (!settings.get_boolean('weather'))
        return { text: 'Off: your own patterns are showing', icon: 'weather-few-clouds-symbolic' };

    const status = settings.get_value('weather-status').recursiveUnpack();
    const place = status.place;
    const report = status.summary ? `${status.summary}${status.temperature ? `, ${status.temperature}` : ''} in ${place}` : '';
    const icon = status.icon || 'weather-few-clouds-symbolic';
    const waiting = 'content-loading-symbolic';
    switch (status.state) {
    case 'ready':
        return { text: report, icon };
    case 'failed':
        return report
            ? { text: `${report} (the weather service could not be reached since)`, icon }
            : { text: `The weather service could not be reached for ${place}; trying again shortly`, icon: 'network-offline-symbolic' };
    case 'fetching':
        return { text: `Getting the weather for ${place}…`, icon: waiting };
    case 'no-place':
        return { text: 'Choose a place in GNOME Weather', icon: 'find-location-symbolic' };
    default:
        // Nothing written yet: the extension is off, or has only just been asked.
        return { text: 'Starting…', icon: waiting };
    }
}

export default class WallpaperFxPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 700);
        window.set_search_enabled(true);

        // One handler for every row, dropped when the window closes.
        const watchers = [];
        const handlerId = settings.connect('changed', (_s, key) => {
            for (const [k, fn] of watchers) if (k === key) fn();
        });
        const shellWeather = new Gio.Settings({ schema_id: 'org.gnome.shell.weather' });
        const placeId = shellWeather.connect('changed::locations', () => {
            for (const [k, fn] of watchers) if (k === 'weather-locations') fn();
        });
        window.connect('close-request', () => {
            settings.disconnect(handlerId);
            shellWeather.disconnect(placeId);
        });

        const ui = { window, settings, shellWeather, watch: (key, fn) => watchers.push([key, fn]) };
        window.add(this._scenesPage(ui));
        window.add(this._patternsPage(ui));
        window.add(this._backgroundPage(ui));
        window.add(this._performancePage(ui));
    }

    // For what GSettings cannot bind. Showing a value fires the row's own signal, and a
    // combo row mid-update reports no selection: without the guard it writes its first.
    _follow({ watch }, key, show, onUserChange) {
        let showing = false;
        const refresh = () => {
            showing = true;
            show();
            showing = false;
        };
        refresh();
        watch(key, refresh);
        return (...args) => {
            if (!showing) onUserChange(...args);
        };
    }

    _comboRow(ui, {
        key, choices, read = (s, k) => s.get_string(k), write = (s, k, v) => s.set_string(k, v), ...props
    }) {
        const model = new Gtk.StringList();
        for (const choice of choices) model.append(choice.label);
        const row = new Adw.ComboRow({ ...props, model });

        const indexOf = value => Math.max(0, choices.findIndex(c => c.value === value));
        row.connect('notify::selected', this._follow(ui, key,
            () => row.set_selected(indexOf(read(ui.settings, key))),
            () => {
                const choice = choices[row.get_selected()];
                if (choice) write(ui.settings, key, choice.value);
            }));
        return row;
    }

    _switchRow({ settings }, key, props) {
        const row = new Adw.SwitchRow(props);
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _scenesPage(ui) {
        const page = new Adw.PreferencesPage({ title: 'Scenes', icon_name: 'view-grid-symbolic' });
        page.add(this._weatherGroup(ui));
        page.add(this._savedGroup(ui));
        return page;
    }

    _weatherGroup(ui) {
        const { settings, shellWeather } = ui;
        const group = new Adw.PreferencesGroup({
            title: 'Weather',
            description: 'Let the weather where you are choose the patterns, and the time of day the sky: ' +
                'rain, snow, fog, a storm or a clear night, as it happens there.',
        });

        const follow = this._switchRow(ui, 'weather', { title: 'Follow the Weather', subtitle_lines: 0 });
        const icon = new Gtk.Image({ icon_name: 'weather-few-clouds-symbolic' });
        follow.add_prefix(icon);
        group.add(follow);

        const showStatus = () => {
            const status = weatherStatus(settings);
            follow.subtitle = status.text;
            icon.icon_name = status.icon;
        };
        showStatus();
        for (const key of ['weather', 'weather-status'])
            ui.watch(key, showStatus);

        group.add(this._switchRow(ui, 'weather-background', {
            title: 'Weather Sets the Sky',
            subtitle: 'Draw the patterns over a sky for the time of day, instead of the Background page\'s choice',
        }));

        // The place is GNOME Weather's, as in the calendar: the extension never looks for the user.
        const app = GioUnix.DesktopAppInfo.new('org.gnome.Weather.desktop');
        const place = new Adw.ActionRow({ title: 'Place', subtitle_lines: 0, activatable: !!app });
        if (app) {
            place.add_suffix(new Gtk.Image({ icon_name: 'adw-external-link-symbolic' }));
            place.connect('activated', () => app.launch([], null));
        }
        const showPlace = () => {
            const name = weatherPlace(shellWeather)?.get_name();
            place.subtitle = name ? `${name}, from GNOME Weather`
                : app ? 'None: choose one in GNOME Weather' : 'None: install GNOME Weather and choose one there';
        };
        showPlace();
        ui.watch('weather-locations', showPlace);
        group.add(place);

        return group;
    }

    _savedGroup(ui) {
        const { settings } = ui;
        const group = new Adw.PreferencesGroup({
            title: 'Your Scenes',
            description: 'The patterns you chose, how each is tuned and what they are drawn over, kept to come ' +
                'back to in one click. Choosing one stops following the weather.',
        });

        const ticks = [];
        const refreshTicks = () => {
            for (const [scene, tick] of ticks) tick.visible = isCurrent(settings, scene);
        };
        for (const key of [...SCENE_KEYS, 'weather']) ui.watch(key, refreshTicks);

        // While the weather chooses, what shows is not the user's look.
        const save = new Adw.EntryRow({ title: 'Save Your Look As…', show_apply_button: true });
        save.connect('apply', () => {
            const name = save.text.trim();
            if (!name) return;
            saveScene(settings, name);
            save.text = '';
        });
        const showSave = () => {
            const weather = settings.get_boolean('weather');
            save.sensitive = !weather;
            save.tooltip_text = weather ? 'Stop following the weather to save a look of your own' : '';
        };
        showSave();
        ui.watch('weather', showSave);
        group.add(save);

        let rows = [];
        const showSaved = () => {
            for (const row of rows) group.remove(row);
            rows = [];
            ticks.length = 0;
            for (const scene of savedScenes(settings)) {
                const row = new Adw.ActionRow({ title: scene.name, activatable: true });
                const tick = new Gtk.Image({ icon_name: 'object-select-symbolic', visible: isCurrent(settings, scene) });
                row.add_suffix(tick);
                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: 'Delete this scene',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                remove.connect('clicked', () => deleteScene(settings, scene.name));
                row.add_suffix(remove);
                row.connect('activated', () => applyScene(settings, scene));
                ticks.push([scene, tick]);
                group.add(row);
                rows.push(row);
            }
        };
        showSaved();
        ui.watch('saved-scenes', showSaved);

        return group;
    }

    _weatherNotice(ui, what, active, keys) {
        const group = new Adw.PreferencesGroup();
        const row = new Adw.ActionRow({
            title: `The weather is choosing ${what}`,
            subtitle: 'Yours are kept, and come back when you stop following the weather',
        });
        row.add_prefix(new Gtk.Image({ icon_name: 'weather-few-clouds-symbolic' }));
        const button = new Gtk.Button({ label: 'Choose My Own', valign: Gtk.Align.CENTER });
        button.connect('clicked', () => ui.settings.set_boolean('weather', false));
        row.add_suffix(button);
        group.add(row);

        const show = () => (group.visible = active());
        show();
        for (const key of keys) ui.watch(key, show);
        return group;
    }

    _patternsPage(ui) {
        const { settings } = ui;
        const page = new Adw.PreferencesPage({ title: 'Patterns', icon_name: 'view-wrapped-symbolic' });

        const weather = () => settings.get_boolean('weather');
        page.add(this._weatherNotice(ui, 'the patterns', weather, ['weather']));

        const groups = [
            new Adw.PreferencesGroup({
                title: 'Ambient',
                description: 'Any combination can be on at once, drawn over each other. Open one to tune it.',
            }),
            new Adw.PreferencesGroup({
                title: 'Weather',
                description: 'The patterns the weather scene draws, which you can also switch on yourself.',
            }),
            new Adw.PreferencesGroup({
                title: 'React',
                description: 'Patterns that answer the pointer as it moves over the desktop.',
            }),
        ];
        const lock = () => groups.forEach(g => (g.sensitive = !weather()));
        for (const group of groups) page.add(group);
        lock();
        ui.watch('weather', lock);

        const enabled = () => new Set(settings.get_strv('enabled-effects'));
        for (const effect of EFFECTS) {
            const row = new Adw.ExpanderRow({ title: effect.title, subtitle: effect.desc });
            const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
            toggle.connect('notify::active', this._follow(ui, 'enabled-effects',
                () => (toggle.active = enabled().has(effect.id)),
                () => {
                    const ids = enabled();
                    if (toggle.active) ids.add(effect.id);
                    else ids.delete(effect.id);
                    settings.set_strv('enabled-effects', EFFECTS.filter(e => ids.has(e.id)).map(e => e.id));
                }));
            row.add_suffix(toggle);

            row.add_row(this._tuningRow(ui, effect, 'brightness', 'Brightness (%)', [0.1, 2]));
            row.add_row(this._tuningRow(ui, effect, 'speed', 'Speed (%)', [0.25, 3]));
            if (effect.density)
                row.add_row(this._tuningRow(ui, effect, 'density', 'Amount (%)', effect.density));

            const reset = new Adw.ActionRow({ title: 'Back to how it was designed' });
            const button = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER });
            button.connect('clicked', () => {
                const all = tuningOf(settings);
                delete all[effect.id];
                setTuning(settings, all);
            });
            reset.add_suffix(button);
            row.add_row(reset);

            groups[effect.react ? 2 : effect.weather ? 1 : 0].add(row);
        }

        const all = new Adw.PreferencesGroup({ title: 'All Patterns' });
        page.add(all);

        const speed = new Adw.SpinRow({
            title: 'Animation Speed',
            subtitle: 'How fast everything moves (0.25× – 3×)',
            digits: 2,
            adjustment: new Gtk.Adjustment({ lower: 0.25, upper: 3.0, step_increment: 0.25 }),
        });
        settings.bind('speed', speed, 'value', Gio.SettingsBindFlags.DEFAULT);
        all.add(speed);

        all.add(this._percentRow(ui, 'opacity', [10, 100, 5], {
            title: 'Pattern Opacity (%)',
            subtitle: 'How strongly the patterns show over the background',
        }));

        all.add(this._switchRow(ui, 'span-monitors', {
            title: 'Span All Monitors',
            subtitle: 'Draw one picture across every monitor, instead of one on each',
        }));

        return page;
    }

    // A picture file chosen through the portal, shown by its path, with a way to clear it.
    _pictureRow(ui, title, key, read, write) {
        const row = new Adw.ActionRow({ title });
        const show = () => (row.subtitle = read() || 'No picture selected');
        show();
        ui.watch(key, show);

        const browse = new Gtk.Button({ label: 'Browse…', valign: Gtk.Align.CENTER });
        browse.connect('clicked', () => {
            const filter = new Gtk.FileFilter({ name: 'Images' });
            for (const type of ['image/png', 'image/jpeg', 'image/webp']) filter.add_mime_type(type);
            const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filters.append(filter);

            const dialog = new Gtk.FileDialog({ title: 'Select Wallpaper Image', filters, default_filter: filter });
            if (read()) dialog.set_initial_file(Gio.File.new_for_path(read()));

            dialog.open(ui.window, null, (self, result) => {
                try {
                    const path = self.open_finish(result)?.get_path();
                    if (path) write(path);
                } catch {
                    // Dismissed, or the portal refused.
                }
            });
        });
        row.add_suffix(browse);

        const clear = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: 'Clear the chosen picture',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        clear.connect('clicked', () => write(''));
        row.add_suffix(clear);
        return row;
    }

    // A double key shown in percent.
    _percentRow(ui, key, [lower, upper, step], props) {
        const { settings } = ui;
        const row = new Adw.SpinRow({
            ...props,
            adjustment: new Gtk.Adjustment({ lower, upper, step_increment: step }),
        });
        row.connect('notify::value', this._follow(ui, key,
            () => row.set_value(Math.round(settings.get_double(key) * 100)),
            () => settings.set_double(key, row.get_value() / 100)));
        return row;
    }

    _tuningRow(ui, effect, key, title, [low, high]) {
        const { settings } = ui;
        const row = new Adw.SpinRow({
            title,
            adjustment: new Gtk.Adjustment({ lower: low * 100, upper: high * 100, step_increment: 5 }),
        });
        row.connect('notify::value', this._follow(ui, 'pattern-tuning',
            () => row.set_value(Math.round((tuningOf(settings)[effect.id]?.[key] ?? 1) * 100)),
            () => writeTuning(settings, effect.id, key, row.get_value() / 100)));
        return row;
    }

    _backgroundPage(ui) {
        const { settings } = ui;
        const page = new Adw.PreferencesPage({
            title: 'Background',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });

        const weather = () => settings.get_boolean('weather') && settings.get_boolean('weather-background');
        page.add(this._weatherNotice(ui, 'the sky', weather, ['weather', 'weather-background']));

        const group = new Adw.PreferencesGroup({
            title: 'Base Layer',
            description: 'What the patterns are drawn over. The overview and the workspace switcher show it too.',
        });
        page.add(group);
        const lock = () => (group.sensitive = !weather());
        lock();
        for (const key of ['weather', 'weather-background']) ui.watch(key, lock);

        group.add(this._comboRow(ui, {
            key: 'background-mode',
            title: 'Background',
            choices: [
                { value: 'desktop', label: 'Desktop Wallpaper' },
                { value: 'accent', label: 'Accent Color' },
                { value: 'color', label: 'Color Gradient' },
                { value: 'image', label: 'Custom Picture' },
                { value: 'daytime', label: 'Time of Day' },
            ],
        }));

        const palette = this._comboRow(ui, {
            key: 'color-palette',
            title: 'Color Palette',
            choices: Object.keys(PALETTES).map(name => ({ value: name, label: name })),
        });
        group.add(palette);

        const image = this._pictureRow(ui, 'Custom Picture', 'custom-image',
            () => settings.get_string('custom-image'),
            path => settings.set_string('custom-image', path));
        group.add(image);

        // One picture for each time of day, in the dictionary key's own place.
        const daytime = new Adw.ExpanderRow({
            title: 'Time of Day Pictures',
            subtitle: 'The time of day follows the sun at GNOME Weather’s place, or the clock without one',
        });
        const pictures = () => settings.get_value('daytime-images').deepUnpack();
        for (const [period, title] of [['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']]) {
            daytime.add_row(this._pictureRow(ui, title, 'daytime-images',
                () => pictures()[period] ?? '',
                path => {
                    const all = { ...pictures(), [period]: path };
                    if (!path) delete all[period];
                    settings.set_value('daytime-images', new GLib.Variant('a{ss}', all));
                }));
        }
        group.add(daytime);

        const applyMode = () => {
            const mode = settings.get_string('background-mode');
            palette.sensitive = mode === 'color';
            image.sensitive = mode === 'image';
            daytime.sensitive = mode === 'daytime';
        };
        applyMode();
        ui.watch('background-mode', applyMode);

        const parallax = new Adw.PreferencesGroup({ title: 'Parallax' });
        page.add(parallax);

        parallax.add(this._switchRow(ui, 'parallax', {
            title: 'Workspace Parallax',
            subtitle: 'The background slides a little as you change workspace, as if far away',
        }));

        const travel = this._percentRow(ui, 'parallax-amount', [2, 100, 1], {
            title: 'Travel (%)',
            subtitle: 'How far the wallpaper moves from the first workspace to the last',
        });
        parallax.add(travel);

        parallax.add(this._switchRow(ui, 'pointer-tilt', {
            title: 'Pointer Tilt',
            subtitle: 'The background leans away from the pointer on the desktop',
        }));
        const reach = this._percentRow(ui, 'pointer-tilt-amount', [1, 5, 1], {
            title: 'Tilt (%)',
            subtitle: 'How far the wallpaper moves either side of centre',
        });
        parallax.add(reach);

        const depth = this._percentRow(ui, 'parallax-depth', [0, 200, 10], {
            title: 'Pattern Depth (%)',
            subtitle: 'How much further the patterns move, each by its own distance',
        });
        parallax.add(depth);

        const syncParallax = () => {
            travel.sensitive = settings.get_boolean('parallax');
            reach.sensitive = settings.get_boolean('pointer-tilt');
            depth.sensitive = travel.sensitive || reach.sensitive;
        };
        syncParallax();
        ui.watch('parallax', syncParallax);
        ui.watch('pointer-tilt', syncParallax);

        return page;
    }

    _performancePage(ui) {
        const page = new Adw.PreferencesPage({ title: 'Performance', icon_name: 'utilities-system-monitor-symbolic' });
        const group = new Adw.PreferencesGroup({
            title: 'Frame Rate and Power',
            description: 'The patterns are drawn by the GPU, in step with each display. They also rest while ' +
                'the power saver mode is on, or animations are turned off, since those are choices made for ' +
                'the whole system.',
        });
        page.add(group);

        group.add(this._comboRow(ui, {
            key: 'target-fps',
            title: 'Frame Rate',
            subtitle: 'Counted in frames each display actually shows, so motion stays even at any refresh rate',
            subtitle_lines: 0,
            choices: [
                { value: 0, label: 'Every frame' },
                { value: -2, label: 'Every other frame' },
                { value: 60, label: 'About 60 per second' },
                { value: 30, label: 'About 30 per second' },
            ],
            read: (s, k) => {
                const value = s.get_int(k);
                if (value <= 0) return value <= -2 ? -2 : 0;
                return value >= 45 ? 60 : 30;
            },
            write: (s, k, v) => s.set_int(k, v),
        }));

        group.add(this._switchRow(ui, 'pause-when-covered', {
            title: 'Pause While Covered',
            subtitle: 'Stops the animation on a monitor while fullscreen, maximized or tiled windows hide its desktop',
        }));
        group.add(this._switchRow(ui, 'pause-on-battery', {
            title: 'Pause on Battery Power',
            subtitle: 'Stops the animation while the device runs on battery',
        }));

        return page;
    }
}
