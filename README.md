# Life Goals PWA (v1)

Plain HTML/CSS/JS, no build step, no dependencies.

- `index.html`, `styles.css`, `app.js`: the app
- `data.json`: seed data. `targets`, `split`, `checklist`, and `plan` are real (from the Daily Goals, Fitness, Career Progression, and Personal Finance bots, Nov 14 2026). Everything under `sample` is placeholder data and shows a "sample" tag in the UI. Replace it with live pulls later.
- `manifest.webmanifest`, `service-worker.js`, `icons/`: install and offline support
- Logs are saved in localStorage (`lg.logs.v1`). Use Export/Import for a JSON backup.

Run locally: `python3 -m http.server 8787` in this folder, then open http://localhost:8787/

Service workers need HTTPS (or localhost), so a phone has to open it from an HTTPS host.

## Install
- iPhone (Safari only): open the HTTPS URL, tap Share, tap "Add to Home Screen", then tap Add.
- Android (Chrome): open the URL, tap "Install app" in the page or ⋮ > "Install app" / "Add to Home screen".
