# Life Goals PWA (v2)

Plain HTML/CSS/JS, no build step, no dependencies.

- `index.html`, `styles.css`, `app.js`: the app
- `data.json`: generated each morning by `scripts/build_data.py` (see `REFRESH.md`). Every field carries a source and as-of date. Health, money and calendar numbers are AES-GCM encrypted in `private` and unlock on the device with Harrison's passphrase.
- `scripts/`: `refresh.sh` (daily entry point), `pull_health.py`, `build_data.py`, `check_public.py`, `config.json` (targets/plan).
- `manifest.webmanifest`, `service-worker.js`, `icons/`: install and offline support
- Logs are saved in localStorage (`lg.logs.v1`). Use Export/Import for a JSON backup.

Run locally: `python3 -m http.server 8787` in this folder, then open http://localhost:8787/

Service workers need HTTPS (or localhost), so a phone has to open it from an HTTPS host.

## Install
- iPhone (Safari only): open the HTTPS URL, tap Share, tap "Add to Home Screen", then tap Add.
- Android (Chrome): open the URL, tap "Install app" in the page or ⋮ > "Install app" / "Add to Home screen".
