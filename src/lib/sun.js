// The Astronomical Almanac's low-precision solar position, so the sky turns between reports.

const RAD = Math.PI / 180;

// `time` in ms since the epoch. Dawn and dusk are the sun within six degrees of the horizon.
export function phaseOfDay(time, latitude, longitude) {
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
    if (elevation < -6) return 'night';
    // East of the meridian, before noon, the hour angle's sine is negative.
    if (elevation < 6) return Math.sin(hourAngle) < 0 ? 'dawn' : 'dusk';
    return 'day';
}
