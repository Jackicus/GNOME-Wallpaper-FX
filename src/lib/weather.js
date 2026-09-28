// The weather where the user is, for the Weather scene: where that is, what
// the sky is doing there, and what time of day it is.
//
// The place is found by Location Services, through Geoclue, or is one the user
// chose in the preferences. The report comes from GWeather -- the library the
// shell's own weather uses -- which asks the nearest airport's METAR station
// for what it sees now and MET Norway for its forecast; the station wins when
// it has spoken in the last two hours, and the forecast's next hour stands in
// where there is none. The time of day is worked out from the sun's position
// (sun.js), so it moves on between reports.
//
// Everything worth keeping goes into `weather-status`: the preferences show it,
// and the extension, which is disabled and enabled again with every lock and
// unlock, picks up where it left off instead of asking again each time.

import Geoclue from 'gi://Geoclue';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';

import { weatherLook } from './looks.js';
import { phaseOfDay } from './sun.js';

// Who is asking, as MET Norway's terms want every client to say.
const APPLICATION_ID = 'io.github.Jackicus.WallpaperFx';
const CONTACT = 'https://github.com/Jackicus/GNOME-Wallpaper-FX';

const TICK_S = 5 * 60;          // how often the time of day is looked at
const REFRESH_S = 30 * 60;      // how old a report gets before it is asked again
const RETRY_S = 10 * 60;        // after one that failed
const OBSERVED_S = 2 * 3600;    // a station's observation older than this is not "now"
const KEEP_S = 6 * 3600;        // a report older than this is not shown at all
const MOVED_KM = 10;            // further than this from the last report asks again

const SKY = {
    [GWeather.Sky.CLEAR]: 'clear',
    [GWeather.Sky.FEW]: 'few',
    [GWeather.Sky.SCATTERED]: 'scattered',
    [GWeather.Sky.BROKEN]: 'broken',
    [GWeather.Sky.OVERCAST]: 'overcast',
};

const P = GWeather.ConditionPhenomenon;
const Q = GWeather.ConditionQualifier;

const FALLING = {
    [P.DRIZZLE]: 'drizzle',
    [P.RAIN]: 'rain',
    [P.UNKNOWN_PRECIPITATION]: 'rain',
    [P.SNOW]: 'snow',
    [P.SNOW_GRAINS]: 'snow',
    [P.ICE_CRYSTALS]: 'snow',
    [P.ICE_PELLETS]: 'sleet',
    [P.HAIL]: 'sleet',
    [P.SMALL_HAIL]: 'sleet',
};

// Anything that thickens the air, as how much fog it makes.
const MURK = {
    [P.FOG]: 1,
    [P.MIST]: 0.6,
    [P.HAZE]: 0.6,
    [P.SMOKE]: 0.6,
    [P.DUST]: 0.6,
    [P.SAND]: 0.6,
    [P.SPRAY]: 0.6,
    [P.VOLCANIC_ASH]: 0.6,
};

const STORMY = new Set([P.SQUALL, P.FUNNEL_CLOUD, P.TORNADO]);

// How hard it falls, as looks.js's intensity; anything else is moderate.
const INTENSITY = {
    [Q.LIGHT]: 0.5,
    [Q.VICINITY]: 0.5,
    [Q.HEAVY]: 1.6,
};

// Fog that is only here and there.
const THIN = new Set([Q.SHALLOW, Q.PATCHES, Q.PARTIAL]);

// Kilometres between two places, near enough at these distances.
function distance([lat1, lon1], [lat2, lon2]) {
    const x = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return 111.2 * Math.hypot(lat2 - lat1, x);
}

const now = () => Math.floor(Date.now() / 1000);

const says = report => report.get_value_sky()[0] || report.get_value_conditions()[0];

// The station's observation if it is recent, else the forecast for the coming
// hour, else nothing.
function currentReport(info) {
    const t = now();
    if (says(info) && t - info.get_value_update()[1] < OBSERVED_S) return info;
    return info.get_forecast_list().find(f => {
        const [ok, at] = f.get_value_update();
        return ok && at > t - 3600 && at < t + 2 * 3600 && says(f);
    }) ?? null;
}

// The sky, what falls from it and how hard, thunder, and fog -- which a poor
// visibility says even where the report has no word for it.
function conditionsOf(report) {
    const [skyOk, sky] = report.get_value_sky();
    const [ok, phenomenon, qualifier] = report.get_value_conditions();
    const conditions = {
        sky: skyOk ? SKY[sky] ?? null : null,
        precipitation: ok ? FALLING[phenomenon] ?? null : null,
        intensity: !ok ? 1 : INTENSITY[qualifier] ?? 1,
        thunder: ok && (qualifier === Q.THUNDERSTORM || STORMY.has(phenomenon)),
        fog: ok ? MURK[phenomenon] ?? 0 : 0,
        wind: null,
    };
    if (conditions.fog === 1 && THIN.has(qualifier)) conditions.fog = 0.6;

    const [visOk, visibility] = report.get_value_visibility(GWeather.DistanceUnit.METERS);
    if (visOk && visibility > 0 && visibility < 1000) conditions.fog = 1;
    else if (visOk && visibility > 0 && visibility < 4000) conditions.fog = Math.max(conditions.fog, 0.6);
    return conditions;
}

export class WeatherWatcher {
    /**
     * `onChanged` is called whenever the look it gives changes -- from the next
     * turn of the main loop on: whoever builds one reads `look` straight after.
     */
    constructor(settings, onChanged) {
        this._settings = settings;
        this._onChanged = null;
        this._cancellable = new Gio.Cancellable();
        this._world = GWeather.Location.get_world();
        this._geoclue = null;
        this._geoclueStarting = false;
        this._fetching = false;
        this._nextTry = 0;
        this._written = null;

        this._info = new GWeather.Info({
            application_id: APPLICATION_ID,
            contact_info: CONTACT,
            enabled_providers: GWeather.Provider.METAR | GWeather.Provider.MET_NO,
        });
        this._info.connectObject('updated', () => this._onReport(), this);

        // What was known when this last ran, if it is recent enough to show.
        const saved = settings.get_value('weather-status').recursiveUnpack();
        this._status = { state: 'locating', ...saved };
        this._coords = 'latitude' in saved ? [saved.latitude, saved.longitude] : null;
        this._reportedAt = saved.coords ?? null;
        this._conditions = null;
        if (saved.conditions && now() - (saved.updated ?? 0) < KEEP_S) {
            try {
                this._conditions = JSON.parse(saved.conditions);
            } catch {
                // Written by something else; asked again below.
            }
        }
        this._phase = this._coords ? phaseOfDay(Date.now(), ...this._coords) : null;

        this._location = new Gio.Settings({ schema_id: 'org.gnome.system.location' });
        this._location.connectObject('changed::enabled', () => this._locate(), this);
        settings.connectObject(
            'changed::weather-auto-location', () => this._locate(),
            'changed::weather-place', () => this._locate(),
            this);

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TICK_S, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });

        this._locate();
        this._onChanged = onChanged;
    }

    /** The scene values for the weather now, or null while there is no report. */
    get look() {
        if (!this._conditions || !this._phase) return null;
        return weatherLook(this._conditions, this._phase);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._tickId) GLib.source_remove(this._tickId);
        this._tickId = 0;
        this._info.disconnectObject(this);
        this._info.abort();
        this._location.disconnectObject(this);
        this._settings.disconnectObject(this);
        // Left running rather than stopped: Geoclue may hand the shell's own
        // weather the same client, and stopping it would stop that too.
        this._geoclue?.disconnectObject(this);
        this._geoclue = null;
        this._onChanged = null;
    }

    // Where to ask about: Location Services when they are on and wanted, or
    // else the place the user chose.
    _locate() {
        if (this._wantsGeoclue()) {
            this._startGeoclue();
            if (this._geoclue?.location) this._onGeoclue();
            // Where it was last time will do until Location Services answer.
            else if (this._coords) this._tick();
            else this._write({ state: 'locating' });
            return;
        }
        this._geoclue?.disconnectObject(this);
        this._geoclue = null;
        this._useChosenPlace(this._settings.get_boolean('weather-auto-location') ? 'location-off' : 'no-place');
    }

    // The place chosen in the preferences, or nowhere, with `state` saying why.
    _useChosenPlace(state) {
        const [name, latitude, longitude] = this._settings.get_value('weather-place').deepUnpack();
        if (name) {
            this._setPlace([latitude, longitude], name);
            return;
        }
        this._coords = null;
        this._conditions = null;
        this._phase = null;
        this._write({ state, place: '' });
        this._changed();
    }

    _startGeoclue() {
        if (this._geoclue || this._geoclueStarting) return;
        this._geoclueStarting = true;
        // As the shell: it is the shell asking, and the shell is the one
        // Location Services let in without a prompt. The user asked for it by
        // turning this on, and it is only ever done with Location Services on.
        Geoclue.Simple.new('org.gnome.Shell', Geoclue.AccuracyLevel.CITY, this._cancellable, (_o, result) => {
            this._geoclueStarting = false;
            let simple;
            try {
                simple = Geoclue.Simple.new_finish(result);
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                console.warn(`[WallpaperFx] No location from Location Services: ${e.message}`);
                this._useChosenPlace('location-failed');
                return;
            }
            // Turned off, or destroyed, while it was starting.
            if (this._cancellable.is_cancelled() || !this._wantsGeoclue()) return;
            this._geoclue = simple;
            simple.connectObject('notify::location', () => this._onGeoclue(), this);
            if (simple.location) this._onGeoclue();
        });
    }

    _wantsGeoclue() {
        return this._settings.get_boolean('weather-auto-location') && this._location.get_boolean('enabled');
    }

    _onGeoclue() {
        const { latitude, longitude } = this._geoclue.location;
        this._setPlace([latitude, longitude], null);
    }

    _setPlace(coords, name) {
        this._coords = coords;
        this._city = this._world.find_nearest_city(...coords);
        this._write({ place: name ?? this._city?.get_name() ?? '', latitude: coords[0], longitude: coords[1] });
        // A new place, or one far from where the last report was for, is
        // asked about now rather than when the report grows old. The sky
        // there is kept until the answer comes, but not called this place's.
        if (!this._reportedAt || distance(this._reportedAt, coords) > MOVED_KM) {
            this._write({ state: 'fetching', summary: '', temperature: '', icon: '' });
            this._fetch();
        }
        this._tick();
    }

    // Once every few minutes: the time of day, and a fresh report when the
    // last one is old or failed.
    _tick() {
        if (!this._coords) return;
        const phase = phaseOfDay(Date.now(), ...this._coords);
        if (phase !== this._phase) {
            this._phase = phase;
            this._write({ phase });
            this._changed();
        }
        const age = now() - (this._status.updated ?? 0);
        if (age > KEEP_S && this._conditions) {
            this._conditions = null;
            this._changed();
        }
        if (age > REFRESH_S && now() >= this._nextTry) this._fetch();
    }

    _fetch() {
        // One for this place is on its way already; one for somewhere else is
        // dropped for it.
        if (!this._coords || this._fetching && this._fetchingFor === this._coords) return;
        // The nearest city of GWeather's own list brings its METAR station;
        // MET Norway's forecast is for the city's coordinates.
        if (!this._city) return;
        this._fetching = true;
        this._fetchingFor = this._coords;
        if (!this._conditions) this._write({ state: 'fetching' });
        this._info.abort();
        this._info.set_location(this._city);
        this._info.update();
    }

    _onReport() {
        this._fetching = false;
        // A report for a place since left behind.
        if (this._fetchingFor !== this._coords) {
            this._fetch();
            return;
        }
        const info = this._info;
        const report = info.is_valid() ? this._read(info) : null;
        if (!report) {
            this._nextTry = now() + RETRY_S;
            this._write({ state: 'failed' });
            return;
        }
        this._nextTry = 0;
        this._conditions = report.conditions;
        this._reportedAt = this._fetchingFor;
        this._write({
            state: 'ready',
            summary: report.summary,
            temperature: report.temperature,
            icon: report.icon,
            conditions: JSON.stringify(report.conditions),
            coords: this._fetchingFor,
            updated: now(),
        });
        this._changed();
    }

    // What the report says now, as the plain conditions looks.js takes, and
    // the words and icon the preferences show for it.
    _read(info) {
        const source = currentReport(info);
        if (!source) return null;
        const conditions = conditionsOf(source);
        for (const from of [info, source]) {
            const [ok, speed] = from.get_value_wind(GWeather.SpeedUnit.MS);
            if (ok) {
                conditions.wind = speed;
                break;
            }
        }
        const words = source.get_value_conditions()[0] ? source.get_conditions() : source.get_sky();
        return {
            conditions,
            summary: words.charAt(0).toUpperCase() + words.slice(1),
            temperature: [info, source].map(f => f.get_temp_summary()).find(t => /\d/.test(t)) ?? '',
            icon: source.get_symbolic_icon_name(),
        };
    }

    _changed() {
        this._onChanged?.();
    }

    // Merged into what is already known, and written only when it differs.
    _write(changes) {
        Object.assign(this._status, changes);
        const variant = {};
        for (const [key, value] of Object.entries(this._status)) {
            if (value === null || value === undefined) continue;
            variant[key] = typeof value === 'string' ? new GLib.Variant('s', value)
                : typeof value === 'number' ? Number.isInteger(value) && key === 'updated'
                    ? new GLib.Variant('x', value) : new GLib.Variant('d', value)
                : Array.isArray(value) ? new GLib.Variant('ad', value)
                : new GLib.Variant('b', !!value);
        }
        const packed = new GLib.Variant('a{sv}', variant);
        const text = packed.print(false);
        if (text === this._written) return;
        this._written = text;
        this._settings.set_value('weather-status', packed);
    }
}
