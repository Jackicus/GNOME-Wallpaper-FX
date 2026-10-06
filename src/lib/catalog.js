import * as nebula from './layers/nebula.js';
import * as aurora from './layers/aurora.js';
import * as contours from './layers/contours.js';
import * as starfield from './layers/starfield.js';
import * as wave from './layers/wave.js';
import * as constellation from './layers/constellation.js';
import * as sparkles from './layers/sparkles.js';
import * as embers from './layers/embers.js';
import * as fireflies from './layers/fireflies.js';
import * as bokeh from './layers/bokeh.js';
import * as clouds from './layers/clouds.js';
import * as sunbeams from './layers/sunbeams.js';
import * as lightning from './layers/lightning.js';
import * as fog from './layers/fog.js';
import * as snow from './layers/snow.js';
import * as rain from './layers/rain.js';
import * as swarm from './layers/swarm.js';
import * as ripples from './layers/ripples.js';
import * as stardust from './layers/stardust.js';

// In the order they are drawn, each over the ones before; docs/patterns.md has a layer's exports.
// `weather` marks the ones the weather scene draws, and `react` the ones that answer the
// pointer, which prefs lists apart. With parallax,
// a pattern pans `depth` times as far as the wallpaper: further back is nearer 1.
export const EFFECTS = [
    { id: 'nebula', title: 'Nebula', desc: 'Slow clouds of violet, teal and magenta light turning over each other', depth: 1.3, ...nebula },
    { id: 'aurora', title: 'Aurora', desc: 'Green and violet curtains of polar light drifting across the sky', depth: 1.4, ...aurora },
    { id: 'contours', title: 'Contours', desc: 'Topographic lines of a slowly shifting landscape, drawn in faint light', depth: 1.6, ...contours },
    { id: 'starfield', title: 'Starfield', desc: 'Deep night sky with layered stars, galactic band and meteors', depth: 1.2, ...starfield },
    { id: 'wave', title: 'Wave', desc: 'Folded sheets of light with bright crest glints', depth: 2, ...wave },
    { id: 'constellation', title: 'Constellation', desc: 'Drifting points that dynamically weave into a connected mesh', depth: 2.2, ...constellation },
    { id: 'sparkles', title: 'Sparkles', desc: 'Drifting, depth-scaled specks with a soft flare', depth: 3, ...sparkles },
    { id: 'embers', title: 'Embers', desc: 'Rising sparks cooling from white through orange to red', depth: 3.2, ...embers },
    { id: 'fireflies', title: 'Fireflies', desc: 'Warm yellow-green lights wandering low and blinking on slow rhythms', depth: 3, ...fireflies },
    { id: 'bokeh', title: 'Bokeh', desc: 'Large out-of-focus lights rising softly through the frame', depth: 3.6, ...bokeh },
    { id: 'clouds', title: 'Clouds', desc: 'Soft clouds drifting overhead, lit from above and flattening towards the horizon', depth: 1.8, weather: true, ...clouds },
    { id: 'sunbeams', title: 'Sunbeams', desc: 'Shafts of warm sunlight fanning down from above, with dust turning in the light', depth: 2.4, weather: true, ...sunbeams },
    { id: 'lightning', title: 'Lightning', desc: 'A distant storm: flashes deep in the clouds and now and then a forked bolt', depth: 1.3, weather: true, ...lightning },
    { id: 'fog', title: 'Fog', desc: 'Low banks of mist rolling slowly past, thickest near the ground', depth: 2.6, weather: true, ...fog },
    { id: 'snow', title: 'Snow', desc: 'Snowflakes drifting down at several depths, swaying in a light wind', depth: 3, weather: true, ...snow },
    { id: 'rain', title: 'Rain', desc: 'Fine streaks of rain falling at a slant, near drops longer and faster', depth: 3.4, weather: true, ...rain },
    { id: 'swarm', title: 'Firefly Swarm', desc: 'Fireflies that follow the pointer, string out behind it and gather where it rests', depth: 3, react: true, ...swarm },
    { id: 'ripples', title: 'Ripples', desc: 'Rings spreading from where the pointer passes, as on still water', depth: 2.4, react: true, ...ripples },
    { id: 'stardust', title: 'Stardust', desc: 'Fine sparkles left along the pointer’s path, settling and fading', depth: 3.2, react: true, ...stardust },
];
