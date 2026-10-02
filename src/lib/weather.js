// The weather for the Weather scene; CLAUDE.md, "The weather is a scene".

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';

import { weatherLook } from './looks.js';
import { phaseOfDay } from './sun.js';

// MET Norway's terms ask every client to name itself.
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

const INTENSITY = {
    [Q.LIGHT]: 0.5,
    [Q.VICINITY]: 0.5,
    [Q.HEAVY]: 1.6,
};

const THIN = new Set([Q.SHALLOW, Q.PATCHES, Q.PARTIAL]);

function distance([lat1, lon1], [lat2, lon2]) {
    const x = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return 111.2 * Math.hypot(lat2 - lat1, x);
}

const now = () => Math.floor(Date.now() / 1000);

// The first place in GNOME Weather's list, which the shell copies into its own settings
// for the calendar's weather (docs/private-api.md, "GNOME Weather's place").
export function weatherPlace(shellWeather) {
    const [serialized] = shellWeather.get_value('locations').deepUnpack();
    const place = serialized ? GWeather.Location.get_world().deserialize(serialized) : null;
    return place?.has_coords() ? place : null;
}

const says = report => report.get_value_sky()[0] || report.get_value_conditions()[0];

function currentReport(info) {
    const t = now();
    if (says(info) && t - info.get_value_update()[1] < OBSERVED_S) return info;
    return info.get_forecast_list().find(f => {
        const [ok, at] = f.get_value_update();
        return ok && at > t - 3600 && at < t + 2 * 3600 && says(f);
    }) ?? null;
}

// Poor visibility is fog even where the report has no word for it.
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
    // `onChanged` is set last: whoever builds one reads `look` straight after.
    constructor(settings, onChanged) {
        this._settings = settings;
        this._onChanged = null;
        this._fetching = false;
        this._nextTry = 0;
        this._written = null;

        this._info = new GWeather.Info({
            application_id: APPLICATION_ID,
            contact_info: CONTACT,
            enabled_providers: GWeather.Provider.METAR | GWeather.Provider.MET_NO,
        });
        this._info.connectObject('updated', () => this._onReport(), this);

        const saved = settings.get_value('weather-status').recursiveUnpack();
        this._status = saved;
        this._reportedAt = saved.coords ?? null;
        this._conditions = null;
        if (saved.conditions && now() - (saved.updated ?? 0) < KEEP_S) {
            try {
                this._conditions = JSON.parse(saved.conditions);
            } catch {
                // Written by something else: asked again.
            }
        }

        this._shellWeather = new Gio.Settings({ schema_id: 'org.gnome.shell.weather' });
        this._shellWeather.connectObject('changed::locations', () => this._locate(), this);

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TICK_S, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });

        this._locate();
        this._onChanged = onChanged;
    }

    get look() {
        if (!this._conditions || !this._phase) return null;
        return weatherLook(this._conditions, this._phase);
    }

    destroy() {
        if (this._tickId) GLib.source_remove(this._tickId);
        this._tickId = 0;
        this._info.disconnectObject(this);
        this._info.abort();
        this._shellWeather.disconnectObject(this);
    }

    _locate() {
        const place = weatherPlace(this._shellWeather);
        if (!place) {
            this._place = null;
            this._coords = null;
            this._conditions = null;
            this._phase = null;
            this._reportedAt = null;
            this._write({ state: 'no-place', place: '' });
            this._onChanged?.();
            return;
        }
        const coords = place.get_coords();
        this._place = place;
        this._coords = coords;
        this._write({ place: place.get_name() });
        // The old sky stays until the answer comes, but is not called this place's.
        if (!this._reportedAt || distance(this._reportedAt, coords) > MOVED_KM) {
            this._write({ state: 'fetching', summary: '', temperature: '', icon: '' });
            this._fetch();
        }
        this._tick();
    }

    _tick() {
        if (!this._coords) return;
        const phase = phaseOfDay(Date.now(), ...this._coords);
        if (phase !== this._phase) {
            this._phase = phase;
            this._write({ phase });
            this._onChanged?.();
        }
        const age = now() - (this._status.updated ?? 0);
        if (age > KEEP_S && this._conditions) {
            this._conditions = null;
            this._onChanged?.();
        }
        if (age > REFRESH_S && now() >= this._nextTry) this._fetch();
    }

    _fetch() {
        if (!this._coords || this._fetching && this._fetchingFor === this._coords) return;
        this._fetching = true;
        this._fetchingFor = this._coords;
        if (!this._conditions) this._write({ state: 'fetching' });
        this._info.abort();
        this._info.set_location(this._place);
        this._info.update();
    }

    _onReport() {
        this._fetching = false;
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
        this._onChanged?.();
    }

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
