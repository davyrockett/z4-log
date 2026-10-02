# Z4 Log

A personal garage log and fault-code tracker for a 2008 BMW Z4 3.0i (E85).
It runs as an app on your iPhone's Home Screen, works with no signal, and keeps
all its data on the device. There's no server and no account.

## What's in here

| File | What it does |
|---|---|
| `index.html` | The page itself: header, screens, bottom tabs |
| `styles.css` | Colors, sizes, light/dark themes |
| `app.js` | The app's behavior |
| `sw.js` | The "service worker": saves the app on the phone so it works offline |
| `manifest.webmanifest` | Tells the phone the app's name, icon, and to open full-screen |
| `icons/` | App icons (redraw with `python3 tools/make-icons.py`) |
| `private/` | **Your data files. Never uploaded** (listed in `.gitignore`) |

## Try it on the Mac

```bash
cd ~/Documents/z4-log && python3 -m http.server 8765
```

Then open http://localhost:8765 in Safari or Chrome. Press Ctrl+C in Terminal to stop.

## Publishing a change

1. Edit the files.
2. **In `sw.js`, bump `VERSION`** (v1 → v2 …). Without this, phones keep the old copy.
3. Commit and push (`git add -A && git commit -m "…" && git push`).
4. GitHub Pages updates within a minute or two. On the phone, open the app and
   an **Update** banner appears. Tap it.

## Your data

Data lives in the browser's storage on each device. The iPhone and the Mac do
**not** sync. Use Settings → Export backup regularly (added in Phase 4) and keep
the file in iCloud Drive.
