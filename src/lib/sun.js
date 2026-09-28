// Where the sun is, and what part of the day that makes it: worked out here
// rather than asked of the weather service, so the sky turns with the day
// between reports, and without a network at all.
//
// The Astronomical Almanac's low-precision solar position: good to about a
// hundredth of a degree for decades either side of 2000, far finer than a
// wallpaper needs.

const RAD = Math.PI / 180;

/**
 * The sun's elevation above the horizon, in degrees, at `time` (milliseconds
 * since the epoch) seen from a place, and whether it is on its way up.
 */
export function sunPosition(time, latitude, longitude) {
    const d = time / 86400000 - 10957.5;                 // days since J2000.0
    const g = (357.529 + 0.98560028 * d) * RAD;          // mean anomaly
    const q = 280.459 + 0.98564736 * d;                  // mean longitude
    const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
    const e = (23.439 - 0.00000036 * d) * RAD;           // tilt of the axis
    const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
    const dec = Math.asin(Math.sin(e) * Math.sin(l));
    const sidereal = 18.697374558 + 24.06570982441908 * d; // hours at Greenwich
    const hourAngle = (sidereal * 15 + longitude) * RAD - ra;
    const lat = latitude * RAD;
    const elevation = Math.asin(Math.sin(lat) * Math.sin(dec) +
        Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle)) / RAD;
    // East of the meridian, before noon, the hour angle's sine is negative.
    return { elevation, rising: Math.sin(hourAngle) < 0 };
}

/**
 * 'night' once civil twilight is over, 'dawn' or 'dusk' while the sun is
 * within six degrees of the horizon, and 'day' above that.
 */
export function phaseOfDay(time, latitude, longitude) {
    const { elevation, rising } = sunPosition(time, latitude, longitude);
    if (elevation < -6) return 'night';
    if (elevation < 6) return rising ? 'dawn' : 'dusk';
    return 'day';
}
