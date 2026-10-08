---
paths:
  - "src/lib/weather.js"
  - "src/lib/looks.js"
  - "src/lib/sun.js"
  - "src/lib/daytime.js"
  - "scripts/nested.d/**"
---

# The weather and the time of day

- **The place** is the first in GNOME Weather's list, as the shell keeps it in
  `org.gnome.shell.weather` `locations` (`weatherPlace()`, which prefs shows too). The
  extension never asks for a location itself.
- **The report** is GWeather's for that place: its METAR station now, MET Norway's next
  hour where there is none, read into plain conditions. One is asked for every half hour
  (`REFRESH_S`), and on a new place more than 10 km from the last (`MOVED_KM`); a
  remembered one is shown for up to six hours (`KEEP_S`).
- **`weather-status`** is written only by `WeatherWatcher`, for prefs to show and for the
  next enable (every unlock) to start from. app.js ignores changes to it.
- **`looks.js`** turns conditions and the time of day into the same values a scene holds
  (patterns, tuning, palette). It is pure, so `node` can run it. `sun.js` gives the sun's
  elevation, and so dawn, day, dusk or night, from a place and a time.
- **`Daytime`** is kept by app.js only while the base is `daytime`: the period of the day
  from `sun.js` at GNOME Weather's place (fixed hours without one), with one timer to the
  next change, looked at again on resume and on a new place. `NEAREST` says which picture
  stands in for a period that has none.
- In the nested shell, `./scripts/nested.sh weather-place` sets a stand-in place in the
  nested settings, never a real location.
