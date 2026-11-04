# Fuel – Calorie Tracker

A web app you install on your iPhone's home screen. No build step: plain HTML/CSS/JS.
All data is stored on the device (IndexedDB).

## Files
| File | Purpose |
|---|---|
| `index.html` | Page layout and dialogs |
| `app.js` | App logic: goals, logging, progress bars |
| `db.js` | On-device storage (goals history, foods, log entries) |
| `stats.js` | Dates, daily totals, goal check and streak math |
| `charts.js` | Small SVG charts (calorie bars, weight line) |
| `styles.css` | Styling (follows iPhone light/dark mode) |
| `sw.js` | Offline support. **Bump `VERSION` whenever you change app files.** |
| `manifest.webmanifest`, `icons/` | Home-screen app name and icon |
| `scripts/fetch_menus.py` | Pulls Traditions at Scott & Morrill menus from Nutrislice into `data/menus/` |
| `.github/workflows/menus.yml` | Runs the menu fetch twice daily (and on demand: Actions → Update dining menus → Run) |
| `data/menus/YYYY-MM-DD.json` | One file per day (yesterday through 6 days ahead); old days pruned |
| `tools/serve.ps1` | Local preview server |
| `tools/make-icons.ps1` | Regenerates icons |

## Preview on your PC
```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```
Then open http://localhost:8080 in Chrome.

## Put it on your iPhone
The app has to be hosted on an HTTPS site (free with GitHub Pages):
1. Create a GitHub repo and upload these files.
2. Repo → Settings → Pages → deploy from the `main` branch.
3. On your iPhone, open the Pages URL in **Safari** → Share → **Add to Home Screen**.

Always open it from the home-screen icon. iOS protects home-screen apps' data
from being auto-cleared, but not data from sites opened in a regular Safari tab.

## Roadmap
- [x] Phase 1 – goals, manual logging, progress bars, installable/offline
- [x] Phase 2 – streak, favorites & recent, history
- [x] Phase 3 – Traditions at Scott & Morrill menus via Nutrislice (nightly GitHub Action)
- [x] Phase 4 – barcode scanner (html5-qrcode + Open Food Facts), weight tracking, charts

## Releasing a change
Bump the version in four places so phones never mix old and new files:
`?v=N` in `index.html` (CSS + app.js) and in the imports at the top of `app.js` / `charts.js`,
`VERSION` in `sw.js`, and the "App version N" label in `index.html`.
