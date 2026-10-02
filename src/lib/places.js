import GWeather from 'gi://GWeather?version=4.0';

// GWeather's city list, gathered on the first search (a few tens of ms). Prefs only.

let cities = null;

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
            // There are several Dublins in the United States alone.
            const parent = child.get_parent();
            const region = parent?.get_level() === GWeather.LocationLevel.ADM1 ? parent.get_name() : '';
            cities.push({ name, region, country, latitude, longitude, key: fold(name) });
        }
    };
    walk(GWeather.Location.get_world());
    return cities;
}

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
