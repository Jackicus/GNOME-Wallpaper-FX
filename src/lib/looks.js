// The look for the weather: which patterns, tuned how, over which sky, for
// what the sky is doing and the time of day. It is the same shape as a scene's
// values, so the weather is simply a scene that changes by itself.
//
// The conditions are plain values, worked out from the report in weather.js:
//
//   sky            'clear', 'few', 'scattered', 'broken' or 'overcast', or null
//   precipitation  'drizzle', 'rain', 'snow' or 'sleet', or null
//   intensity      how heavily it falls: 0.5 light, 1 moderate, 1.6 heavy
//   thunder        whether there is a thunderstorm
//   fog            0, 0.6 for mist or haze, 1 for fog
//   wind           metres a second, or null
//
// and the time of day is one of sun.js's phases.

// How much of the sky is cloud, as the Clouds pattern's Amount.
const COVER = { clear: 0, few: 0.35, scattered: 0.7, broken: 1.2, overcast: 2 };

const clamp = (v, low, high) => Math.max(low, Math.min(high, v));

/** The scene values for `conditions` at `phase`. */
export function weatherLook(conditions, phase) {
    const c = { sky: null, precipitation: null, intensity: 1, thunder: false, fog: 0, wind: null, ...conditions };
    const sky = skyOf(c, phase);
    const tuning = {};
    const show = (id, values = {}) => (tuning[id] = { ...tuning[id], ...values });

    showLight(show, sky);
    showAir(show, c, sky);
    showFalling(show, tuning, c, sky);
    if (c.wind !== null) showWind(show, tuning, c.wind);

    return {
        'enabled-effects': Object.keys(tuning),
        'pattern-tuning': tidy(tuning),
        'background-mode': 'color',
        'color-palette': paletteOf(c, sky),
    };
}

// The time of day, and how much of the sky is hidden. Anything falling comes
// out of a sky full of cloud, whatever the report says of the sky; and under a
// full one, or in fog, there is no sun and there are no stars.
function skyOf(c, phase) {
    const falling = c.precipitation !== null || c.thunder;
    const cover = Math.max(COVER[c.sky] ?? 0, falling ? 1.6 : 0);
    return {
        phase,
        night: phase === 'night',
        twilight: phase === 'dawn' || phase === 'dusk',
        falling,
        cover,
        hidden: cover >= 1.6 || c.fog >= 1,
    };
}

// The sun by day, the stars by night, dimmed by what cloud there is.
function showLight(show, sky) {
    if (sky.hidden) return;
    if (sky.night)
        show('starfield', { brightness: 1 - 0.35 * sky.cover, density: 1 - 0.4 * sky.cover });
    else
        show('sunbeams', { brightness: (sky.twilight ? 0.75 : 1) * (1 - 0.4 * sky.cover) });
}

// Cloud, lit by the day or the moon, and fog or mist.
function showAir(show, c, sky) {
    const light = sky.night ? 0.4 : c.thunder ? 0.6 : sky.twilight ? 0.7 : 0.9;
    if (sky.cover > 0) show('clouds', { density: sky.cover, brightness: light });
    if (c.fog > 0) show('fog', { density: c.fog >= 1 ? 1.4 : 0.7, brightness: sky.night ? 0.5 : 1 });
}

function showFalling(show, tuning, c, sky) {
    switch (c.precipitation) {
    case 'drizzle':
        // Drizzle is half mist.
        show('rain', { density: 0.35 });
        if (c.fog === 0) show('fog', { density: 0.5, brightness: sky.night ? 0.5 : 0.8 });
        break;
    case 'rain':
        show('rain', { density: c.intensity });
        break;
    case 'snow':
        show('snow', { density: c.intensity });
        break;
    case 'sleet':
        show('rain', { density: 0.6 * c.intensity });
        show('snow', { density: 0.6 * c.intensity });
        break;
    }
    if (c.thunder) {
        show('lightning', { density: c.intensity });
        if (!tuning.rain && !tuning.snow) show('rain', { density: c.intensity });
    }
}

// The wind carries the clouds and the fog along, and hurries what falls.
function showWind(show, tuning, wind) {
    const pace = clamp(0.4 + wind / 6, 0.4, 2.5);
    for (const id of ['clouds', 'fog']) if (tuning[id]) show(id, { speed: pace });
    const hurry = clamp(0.9 + wind / 20, 0.9, 1.6);
    for (const id of ['rain', 'snow']) if (tuning[id]) show(id, { speed: hurry });
}

// A storm is dark at any hour, and so is a grey sky out of daylight; a grey
// one by day is overcast; a clear one follows the sun.
function paletteOf(c, sky) {
    const grey = sky.hidden || sky.falling;
    if (c.thunder || grey && (sky.night || sky.twilight)) return 'Dark';
    if (grey) return 'Overcast';
    return { night: 'Classic Blue', dawn: 'Dawn', dusk: 'Dusk' }[sky.phase] ?? 'Day Sky';
}

// Every value rounded to a percent, and left out at 1, as prefs writes them.
function tidy(tuning) {
    const out = {};
    for (const [id, values] of Object.entries(tuning)) {
        const kept = Object.entries(values)
            .map(([key, v]) => [key, Math.round(v * 100) / 100])
            .filter(([, v]) => v !== 1);
        if (kept.length) out[id] = Object.fromEntries(kept);
    }
    return out;
}
