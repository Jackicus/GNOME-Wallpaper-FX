import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { phaseOfDay } from './sun.js';
import { weatherPlace } from './weather.js';

const STEP_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Without a place in GNOME Weather: the hour each period starts, local time.
const HOURS = [[6, 'dawn'], [8, 'day'], [18, 'dusk'], [20, 'night']];

// Which picture stands in for a period that has none: the nearest in look first.
export const NEAREST = {
    dawn: ['dawn', 'dusk', 'day', 'night'],
    day: ['day', 'dawn', 'dusk', 'night'],
    dusk: ['dusk', 'dawn', 'night', 'day'],
    night: ['night', 'dusk', 'dawn', 'day'],
};

function byClock(time) {
    const date = new Date(time);
    const hour = date.getHours() + date.getMinutes() / 60;
    return HOURS.findLast(([from]) => hour >= from)?.[1] ?? 'night';
}

// The period of the day now, from the sun at GNOME Weather's place or else the clock,
// with one timer to the next change. A timer does not count time asleep, so waking
// up (logind's PrepareForSleep) looks again, as does a new place.
export class Daytime {
    // `onChanged` is set last: whoever builds one reads `period` straight after.
    constructor(onChanged) {
        this.period = null;
        this._onChanged = null;
        this._timerId = 0;

        this._shellWeather = new Gio.Settings({ schema_id: 'org.gnome.shell.weather' });
        this._shellWeather.connectObject('changed::locations', () => this._update(), this);
        this._sleepId = Gio.DBus.system.signal_subscribe('org.freedesktop.login1',
            'org.freedesktop.login1.Manager', 'PrepareForSleep', '/org/freedesktop/login1', null,
            Gio.DBusSignalFlags.NONE, (...args) => {
                const [asleep] = args[5].deepUnpack();
                if (!asleep) this._update();
            });

        this._update();
        this._onChanged = onChanged;
    }

    destroy() {
        Gio.DBus.system.signal_unsubscribe(this._sleepId);
        this._shellWeather.disconnectObject(this);
        if (this._timerId) GLib.source_remove(this._timerId);
        this._timerId = 0;
    }

    _update() {
        const coords = weatherPlace(this._shellWeather)?.get_coords() ?? null;
        const at = time => (coords ? phaseOfDay(time, ...coords) : byClock(time));
        const now = Date.now();
        const period = at(now);

        // To the minute; a polar day or night is looked at again in a day.
        let next = now + STEP_MS;
        while (at(next) === period && next < now + DAY_MS) next += STEP_MS;
        if (this._timerId) GLib.source_remove(this._timerId);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, Math.ceil((next - now) / 1000), () => {
            this._timerId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });

        if (period !== this.period) {
            this.period = period;
            this._onChanged?.();
        }
    }
}
