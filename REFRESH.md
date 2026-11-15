# Morning refresh (run daily, ~3:45 AM America/Los_Angeles, before Harrison wakes at 4:30)

Goal: rebuild `data.json` from real sources and push it; GitHub Pages redeploys in ~1 min.
All steps are **read-only** except the final `git push` of this repo. Don't message other bots,
send email, or change any external data.

`DATE` = today in America/Los_Angeles (`TZ=America/Los_Angeles date +%F`). Harrison lives in Mission Viejo, CA;
every date in the pipeline and the app (today, day-of-plan, split weekday, spend today/week, calendar week,
stale age) is computed in America/Los_Angeles.
`PULLS` = `/workspace/life-goals-pulls/$DATE` (outside the repo; raw pulls never get committed).

## 1. Save connector pulls into `$PULLS`
Call each connector with `write_to_file: true`, then `cp` the result file to the name below.
Wrapper text around the JSON is fine; `build_data.py` extracts the first JSON object.

| File | Connector call | Feeds |
|---|---|---|
| `workout_tracker.txt` | `user-Google-drive` · `read_file_content` `{fileId: "1svCNDySK1Dq60f_Oy5ksorZ1JU8YXioIRk4WdhJlR1E"}` | `split` (today's training) |
| `workout_meta.txt` | `user-Google-drive` · `get_file_metadata` same fileId (optional) | split note (sheet last edited) |
| `finance_accounts.txt` | `user-Finance-xai` · `finance_list_accounts` `{}` | `debt_total`, `invest_total` |
| `finance_connections.txt` | `user-Finance-xai` · `finance_list_connections` `{}` | as-of dates, stale loan link |
| `finance_card_tx.txt` | `user-Finance-xai` · `finance_query_liability_transactions` `{date_from: <1st of month>, date_to: DATE, limit: 200}` | `spend_today/week/month` |
| `finance_bank_tx.txt` | `user-Finance-xai` · `finance_query_account_transactions` same range | `spend_*` |
| `calendar_events.txt` | `user-Google-calendar` · `list_events` `{calendarId: "primary", startTime: <Monday>T00:00:00<offset>, endTime: <next Monday>T00:00:00<offset>}` with the Pacific offset (`-08:00` PST Nov–Mar, `-07:00` PDT; `TZ=America/Los_Angeles date +%:z`) | `dates_week`, `enjoy_cal_today` |

If a month started less than 7 days ago, start the transaction range at that Monday instead so the
week total is complete. If `next_cursor` is not null, page and concatenate the CSV rows.

Google Health needs no connector: `scripts/pull_health.py` runs the `ghealth` CLI on the box
(`/workspace/google-health-cli`, token at `~/.config/ghealth/credentials.json`). `refresh.sh` runs it.
Before checking auth, the script runs `ghealth auth refresh` so an expired access token does not
fail the 3:45 AM run. The connected account already includes `nutrition.readonly`.

## 2. Build, check, push
```bash
cd /workspace/life-goals-pwa && scripts/refresh.sh "$DATE"
```
This runs `pull_health.py` → `build_data.py` → `check_public.py` (fails if any account mask,
institution, merchant or raw balance would be published) → commits `data.json` → pushes `main`.

## 3. Verify
```bash
sleep 60; curl -s https://harrisonbloom.github.io/life-goals/data.json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['date'],d['generated'])"
```
`date` must equal `$DATE`. Optional UI check: `node /tmp/pt/test.js https://harrisonbloom.github.io/life-goals/`
(puppeteer-core script; reports JS errors, unlock, offline).

## Field map
Status: **live** = measured (UI shows `live · as of <date>`, plus a red `stale` badge when as_of is
more than 3 days old) · **config** = target/plan from a bot · **missing** = "No data yet" (never guessed).
🔒 = encrypted in `data.json.private`.

| Field | Source | Status today |
|---|---|---|
| plan, targets, checklist | `scripts/config.json` (Career Progression, Daily Goals, Personal Finance, Fitness bots, Nov 14) | config |
| split | Drive Workout tracker sheet | config |
| career_task | `config.json` career.tasks (Career Progression days 31–60 examples), rotates daily | config |
| 🔒 sleep (duration, efficiency, stages, bed/wake) | Google Health · Fitbit Air | live, stale |
| 🔒 rhr, hrv | Google Health · Fitbit Air | live, stale |
| 🔒 tracker (battery, last sync) | Google Health paired-devices | live |
| 🔒 steps, steps_7d, steps_series | Google Health · Apple Health (iPhone) | live |
| 🔒 zone2_week | Google Health exercise sessions, moderate-HR minutes | missing until Fitbit syncs |
| 🔒 calories_in, calories_in_yesterday | Google Health `nutrition-log` daily-rollup (`energy.kcalSum`). Today and yesterday only; a missing day is not treated as 0. Food names are never stored. | missing (last food log 2026-08-21) |
| 🔒 protein | Google Health `nutrition-log` (`nutrients.PROTEIN.gramsSum`) for today, when present. Higher-confidence than the quick-log: identified food entries with a nutrient breakdown. The app uses Health for today when this field is live, and falls back to the on-device quick-log otherwise. The two are never added together (that would double-count). | missing (same last log date); quick-log is the fallback |
| 🔒 calories_burned, calories_burned_yesterday | Google Health `total-calories` daily-rollup (`kcalSum`; basal + active). 14-day API cap. Missing days are not zeros. | live |
| 🔒 exercise_sessions | Google Health `exercise` list this week: type, duration, date (and session kcal when present). No IDs or free-text notes. | live, empty this week (last session 2026-10-18) |
| 🔒 spend_today/week/month | Finance (Plaid): out-flows minus card payments, transfers, returned payments | live |
| 🔒 debt_total, invest_total | Finance (Plaid) balances, rounded to $100 | live (debt stale: loan link broken) |
| surplus_month | none (needs income + spend target) | missing |
| 🔒 dates_week, enjoy_cal_today | Google Calendar primary, keyword match on titles | live |
| weight, creatine, dating, enjoyment, career win | Harrison's quick-logs (on-device) | logged |
| protein (fallback) | On-device quick-log, used only when Google Health has no protein for today | logged |
| cert_minutes | none yet | missing |

## Privacy rules (repo is public)
- Never commit `$PULLS`, `data.private.local.json`, or the passphrase (`~/.config/life-goals/passphrase`).
- Only totals go into `data.json`, and only inside the encrypted `private` block.
- Body weight from Google Health is not published (only the last weigh-in date).
- To rotate the passphrase: write a new one to the passphrase file, rerun step 2, tell Harrison.

## Known fixes Harrison can make
- Fitbit Air: battery 4%, last sync Nov 3; sleep/RHR/HRV stop at Oct 18. Charge it, wear it overnight, open the Fitbit app.
- TD Auto loan: Plaid connection in error since Oct 3. Re-link it in Finance.
- If `pull_health.py` reports `auth_ok: false`: re-run `ghealth auth login` on the box with Harrison.
  The script already runs `ghealth auth refresh` first; this is only needed if the refresh token itself is revoked.
- Calories in / protein: no food has been logged in Google Health since 2026-08-21. Log meals in the Google Health app (or Fitbit) and they will show on the Body card after the next morning refresh. No extra OAuth scope is needed (`nutrition.readonly` is already granted). There is no calorie-in target in `config.json` yet, so the card shows kcal without a "/ target".
- Workouts this week stay empty until a session is logged in Google Health (or the Fitbit syncs). Last session was 2026-10-18.
