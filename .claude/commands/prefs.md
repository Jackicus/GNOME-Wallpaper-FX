---
description: Open the Libadwaita preferences dialog
allowed-tools: Bash(make prefs), Bash(./scripts/dev.sh prefs)
---

Run `make prefs` to open the settings dialog on the user's desktop, and say it's
open. It backgrounds itself, so don't wait on it.

Changes made there land in GSettings, and the running extension repaints on the
key change — no reload needed. If the dialog doesn't appear or shows an error, a
`prefs.js` exception is reported by the Extensions app in its own window and its
own process's journal, not the shell's (`./scripts/dev.sh logs` reads only the
shell's), and usually means a schema key the dialog binds to is missing
(`glib-compile-schemas src/schemas` after editing the gschema).

To check the dialog's *layout* without putting a window on the user's desktop,
use the `drive-extension` skill and open it inside the nested shell instead.
