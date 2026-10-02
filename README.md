# Z4 Log

A personal garage log, fault/warning tracker and to-do list for a 2008 BMW Z4 3.0i (E85).
It runs as an app on your iPhone's Home Screen and your Mac's Dock, works with no
signal, and keeps the phone and Mac in sync through a private GitHub project.

**Live app:** https://davyrockett.github.io/z4-log/ (open in Safari on iPhone → Share → Add to Home Screen)

## What's in here

| File | What it does |
|---|---|
| `index.html` | The page itself: header, screens, bottom tabs |
| `styles.css` | Colors, sizes, light/dark themes |
| `app.js` | The app's behavior |
| `db.js` | Saves data on the device (IndexedDB): garage, faults & warnings, to-dos |
| `sync.js` | Keeps devices matched through the private GitHub project |
| `sw.js` | The "service worker": saves the app on the phone so it works offline |
| `manifest.webmanifest` | Tells the phone the app's name, icon, and to open full-screen |
| `icons/` | App icons (redraw with `python3 tools/make-icons.py`) |
| `private/` | **Your data files. Never uploaded** (listed in `.gitignore`) |
| `Start Z4 Log.command` | Double-click to run a local test copy on this Mac |

## Using it

- **iPhone:** open the live app in Safari → Share → **Add to Home Screen**.
- **Mac:** open the live app in Safari → **File → Add to Dock**.
- **First time on each device:** Settings → **Sync** → paste your access key → Connect.

`Start Z4 Log.command` runs a local copy for testing changes before publishing.
Its data is separate from the live app.

## Publishing a change

1. Edit the files.
2. **In `sw.js`, bump `VERSION`** (v1 → v2 …). Without this, phones keep the old copy.
3. Commit and push (`git add -A && git commit -m "…" && git push`).
4. GitHub Pages updates within a minute or two. On the phone, open the app and
   an **Update** banner appears. Tap it.

## Your data and sync

Your data is stored on each device **and** in the private GitHub project
`davyrockett/z4-log-data` (file `data.json`). Each device syncs when the app
opens, a moment after you save something, when the connection comes back, and
every couple of minutes while it's on screen. With no signal, everything is
saved on the device and syncs later.

- If the same item is edited on two devices, the most recent edit wins.
- Deletions sync too, so deleted items don't come back.
- GitHub keeps every sync as a version, so earlier versions of `data.json` can
  be recovered from the project's history.
- The access key is stored only in that device's browser storage, and only
  allows reading and writing that one private project.

Backup files are still available in Settings:

- **Save backup (.json)**: a full copy. On iPhone this opens the Share sheet.
- **Import backup**: replaces everything, on every synced device. Use it only
  when something has gone wrong.
- **Garage log / Faults & warnings (.csv)**: for Numbers, Excel or Google Sheets.
