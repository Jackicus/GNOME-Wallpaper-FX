import GWeather from 'gi://GWeather?version=4.0';

// Finding a place by name, for the weather: GWeather's own list of cities, the
// one the shell's weather and GNOME Weather choose from. Used only by prefs.
//
// The list is a tree of regions, countries and states; its four thousand-odd
// cities are gathered once, the first time a search is made, which takes a few
// tens of milliseconds.

let cities = null;

// Lower case, without accents, so "zurich" finds Zürich.
const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function allCities() {
    if (cities) return cities;
    cities = [];
    const walk = location => {
        for (let child = location.next_child(null); child; child = location.next_child(child)) {
            if (child.get_level() !== GWeather.LocationLevel.CITY) {
                walk(child);
                continue;
            }
            const [latitude, longitude] = child.get_coords();
            const name = child.get_name();
            const country = child.get_country_name() ?? '';
            // The state or province too, where there is one: there are
            // several Dublins in the United States alone.
            const parent = child.get_parent();
            const region = parent?.get_level() === GWeather.LocationLevel.ADM1 ? parent.get_name() : '';
            cities.push({ name, region, country, latitude, longitude, key: fold(name) });
        }
    };
    walk(GWeather.Location.get_world());
    return cities;
}

/**
 * Cities whose name starts with `query`, shortest first, then those with it
 * anywhere in their name; at most `limit` of them.
 */
export function searchPlaces(query, limit = 8) {
    const q = fold(query.trim());
    if (q.length < 2) return [];
    const starts = [];
    const within = [];
    for (const city of allCities()) {
        if (city.key.startsWith(q)) starts.push(city);
        else if (city.key.includes(q)) within.push(city);
    }
    starts.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    return [...starts, ...within].slice(0, limit);
}
