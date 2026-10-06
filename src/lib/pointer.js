import GLib from 'gi://GLib';

const KEEP_S = 3;
const EVERY_S = 0.02;

// Where the pointer is and has been, for the React patterns: read once for every
// layer. Times are real seconds, so a trail fades alike at any pattern speed, and
// `odometer` is the distance travelled so far, so what a pattern places along the
// path stays where it was put as the trail grows.
export class PointerTrail {
    constructor() {
        this._samples = [];
        this._odometer = 0;
        global.backend.get_cursor_tracker().connectObject('position-invalidated', () => this._sample(), this);
    }

    destroy() {
        global.backend.get_cursor_tracker().disconnectObject(this);
    }

    _sample() {
        const [x, y] = global.get_pointer();
        const time = GLib.get_monotonic_time() / 1e6;
        const last = this._samples.at(-1);
        if (last && time - last.time < EVERY_S) return;

        if (last) this._odometer += Math.hypot(x - last.x, y - last.y);
        this._samples.push({ x, y, time, odometer: this._odometer });
        while (time - this._samples[0].time > KEEP_S) this._samples.shift();
    }

    // In a layer's canvas pixels (`offset` takes the stage there), newest first: the
    // pointer now, its speed over the last tenth of a second, how long it has been
    // still (since the last sample, however long ago; before any, forever).
    view([dx, dy]) {
        const now = GLib.get_monotonic_time() / 1e6;
        const [x, y] = global.get_pointer();
        const last = this._samples.at(-1);
        const trail = this._samples
            .map(s => ({ x: s.x + dx, y: s.y + dy, age: now - s.time, odometer: s.odometer }))
            .filter(s => s.age <= KEEP_S)
            .reverse();
        const back = trail.find(s => s.age >= 0.1);
        const speed = back ? Math.hypot(x + dx - back.x, y + dy - back.y) / back.age : 0;
        return { x: x + dx, y: y + dy, speed, idle: last ? now - last.time : Infinity, trail };
    }
}
