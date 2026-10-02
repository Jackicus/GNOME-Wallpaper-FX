import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// A scene is the values of these keys. Frame rate, pausing and spanning are about
// the machine, not the look, so they are left out.
export const SCENE_KEYS = [
    'enabled-effects',
    'pattern-tuning',
    'background-mode',
    'color-palette',
    'custom-image',
    'speed',
    'opacity',
];

// Sorted, so the same look compares equal however it is listed.
function canonical(key, variant) {
    const sort = v => (v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]))
        : Array.isArray(v) ? v.map(sort) : v);
    const value = variant.recursiveUnpack();
    return JSON.stringify(key === 'enabled-effects' ? [...value].sort() : sort(value));
}

// A settings object of its own: delay() has no way back, so on the shared one
// every later edit in the window would sit unapplied.
export function applyScene(settings, scene) {
    const batch = new Gio.Settings({ settings_schema: settings.settings_schema, backend: settings.backend });
    batch.delay();
    for (const key of SCENE_KEYS) {
        if (scene.values[key]) batch.set_value(key, scene.values[key]);
        else if (key !== 'custom-image') batch.reset(key);
    }
    batch.set_boolean('weather', false);
    batch.apply();
}

export function isCurrent(settings, scene) {
    if (settings.get_boolean('weather')) return false;
    return SCENE_KEYS.every(key => {
        const want = scene.values[key];
        if (key === 'custom-image' && !want) return true;
        return canonical(key, settings.get_value(key)) === canonical(key, want ?? settings.get_default_value(key));
    });
}

export function savedScenes(settings) {
    return settings.get_value('saved-scenes').deepUnpack().map(({ name, ...values }) => ({
        name: name.unpack(),
        values,
    }));
}

export function saveScene(settings, name) {
    const values = Object.fromEntries(SCENE_KEYS.map(key => [key, settings.get_value(key)]));
    const others = savedScenes(settings).filter(s => s.name !== name);
    writeSaved(settings, [...others, { name, values }]);
}

export function deleteScene(settings, name) {
    writeSaved(settings, savedScenes(settings).filter(s => s.name !== name));
}

function writeSaved(settings, scenes) {
    settings.set_value('saved-scenes', new GLib.Variant('aa{sv}',
        scenes.map(({ name, values }) => ({ name: new GLib.Variant('s', name), ...values }))));
}
