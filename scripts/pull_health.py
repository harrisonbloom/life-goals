#!/usr/bin/env python3
"""Pull Google Health (Fitbit Air + Apple Health) data with the ghealth CLI.

Usage: python3 scripts/pull_health.py --out /workspace/life-goals-pulls/<date>/health.json [--date YYYY-MM-DD]
Read-only. Needs ghealth auth (`ghealth auth status --validate` -> authenticated: true).
Writes raw-but-trimmed values; build_data.py turns them into dashboard fields.
Body weight values are NOT written (privacy: the repo is public); only the latest weight date.
Food names and item-level nutrition logs are NOT written; only daily kcal/protein totals.
"""
import argparse, datetime as dt, json, os, subprocess, sys, tempfile
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Los_Angeles")
CLI_DIR = "/workspace/google-health-cli"
BIN = "/tmp/ghealth"


def ensure_bin():
    if not os.path.exists(BIN):
        subprocess.run(["go", "build", "-o", BIN, "."], cwd=CLI_DIR, check=True)


def ghealth(*args):
    ensure_bin()
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    r = subprocess.run([BIN, *args, "-o", path], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ghealth {' '.join(args)} failed: {r.stderr or r.stdout}")
    with open(path) as fh:
        out = json.load(fh)
    os.unlink(path)
    return out


def try_ghealth(*args):
    try:
        return ghealth(*args)
    except Exception as e:
        print(f"WARN: ghealth {' '.join(args)}: {e}", file=sys.stderr)
        return None


def refresh_auth():
    """Force-refresh the access token so a 3:45 AM run does not fail on expiry."""
    ensure_bin()
    r = subprocess.run([BIN, "auth", "refresh"], capture_output=True, text=True)
    info = {}
    if r.stdout:
        try:
            info = json.loads(r.stdout)
        except json.JSONDecodeError:
            info = {"stdout": r.stdout.strip()[:200]}
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "refresh failed").strip()
        return False, {"ok": False, "error": err[:300]}
    return True, {"ok": True, "new_expiry": info.get("new_expiry"), "status": info.get("status")}


def auth_ok():
    r = subprocess.run([BIN, "auth", "status", "--validate"], capture_output=True, text=True)
    try:
        return json.loads(r.stdout).get("authenticated", False)
    except Exception:
        return False


def pacific_date(ts):
    if not ts:
        return ""
    return dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(TZ).date().isoformat()


def duration_min(s):
    if not s:
        return None
    raw = str(s).strip().rstrip("sS")
    try:
        return round(float(raw) / 60)
    except ValueError:
        return None


def protein_grams(point):
    for nt in point.get("nutrients") or []:
        if nt.get("nutrient") == "PROTEIN":
            q = nt.get("quantity") or {}
            g = q.get("gramsSum")
            if g is None:
                g = q.get("grams")
            if g is not None:
                return float(g)
    return None


def nutrition_day(points, date):
    for p in points:
        if p.get("date") == date:
            kcal = (p.get("energy") or {}).get("kcalSum")
            prot = protein_grams(p)
            return {
                "date": date,
                "kcal": round(kcal) if kcal is not None else None,
                "protein_g": round(prot) if prot is not None else None,
            }
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--date", default=dt.datetime.now(TZ).date().isoformat())
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.date)
    yesterday = today - dt.timedelta(days=1)
    week_start = today - dt.timedelta(days=today.weekday())
    ensure_bin()
    refreshed, refresh_info = refresh_auth()
    out = {
        "pulled_at": dt.datetime.now(TZ).isoformat(timespec="seconds"),
        "date": a.date,
        "auth_refresh": refresh_info,
        "auth_ok": auth_ok(),
    }
    if not out["auth_ok"]:
        json.dump(out, open(a.out, "w"), indent=2)
        print("ghealth NOT authenticated; wrote auth_ok=false", file=sys.stderr)
        return 2

    frm = (today - dt.timedelta(days=60)).isoformat()
    # newest first for list endpoints
    sl = ghealth("data", "sleep", "list", "--from", frm, "--limit", "100")["dataPoints"]
    sl = [s for s in sl if s.get("sleepType") == "STAGES"] or sl
    if sl:
        s = max(sl, key=lambda x: x["end"])
        st = s.get("stageMinutes", {})
        out["sleep"] = {
            "night_of": s["start"][:10], "wake_date": s["end"][:10],
            "bedtime": s["start"], "wake": s["end"],
            "asleep_min": s.get("minutesAsleep"), "awake_min": s.get("minutesAwake"),
            "in_bed_min": s.get("totalMinutes"),
            "stages_min": {"deep": st.get("DEEP", 0), "rem": st.get("REM", 0), "light": st.get("LIGHT", 0), "awake": st.get("AWAKE", 0)},
            "source": s.get("source"),
        }
    rhr = ghealth("data", "daily-resting-heart-rate", "list", "--from", frm, "--limit", "100")["dataPoints"]
    if rhr:
        r = max(rhr, key=lambda x: x["date"])
        out["rhr"] = {"date": r["date"], "bpm": int(r["beatsPerMinute"]), "source": r.get("source")}
    hrv = ghealth("data", "daily-heart-rate-variability", "list", "--from", frm, "--limit", "100")["dataPoints"]
    if hrv:
        h = max(hrv, key=lambda x: x["date"])
        out["hrv"] = {"date": h["date"], "ms": h.get("averageHeartRateVariabilityMilliseconds"), "source": h.get("source")}
    steps = ghealth("data", "steps", "daily-rollup", "--from", (today - dt.timedelta(days=14)).isoformat(),
                    "--to", (today + dt.timedelta(days=1)).isoformat())["dataPoints"]
    out["steps_daily"] = sorted(({"date": p["date"], "steps": int(p["countSum"])} for p in steps), key=lambda x: x["date"])
    ex = ghealth("data", "exercise", "list", "--from", frm, "--limit", "100")["dataPoints"]
    mod = 0
    week_sessions = []
    last_ex = None
    for e in ex:
        start_d = pacific_date(e.get("start"))
        z = (e.get("metricsSummary") or {}).get("heartRateZoneDurations") or {}
        if start_d >= week_start.isoformat() and start_d <= a.date:
            mod += float(str(z.get("moderateTime", "0s")).rstrip("s") or 0)
            ms = e.get("metricsSummary") or {}
            week_sessions.append({
                "date": start_d,
                "type": e.get("displayName") or e.get("exerciseType") or "Workout",
                "duration_min": duration_min(e.get("activeDuration")),
                "kcal": ms.get("caloriesKcal"),
            })
        if start_d and (last_ex is None or start_d > last_ex):
            last_ex = start_d
    week_sessions.sort(key=lambda x: x["date"])
    out["exercise_week"] = {"week_start": week_start.isoformat(), "sessions": len([e for e in ex if week_start.isoformat() <= pacific_date(e.get("start")) <= a.date]), "moderate_zone_min": round(mod / 60)}
    out["exercise_sessions"] = {
        "week_start": week_start.isoformat(),
        "sessions": week_sessions,
        "last_date": last_ex,
    }
    w = ghealth("data", "weight", "list", "--from", "2025-01-01", "--limit", "5")["dataPoints"]
    if w:
        out["weight_latest_date"] = max(x["time"] for x in w)[:10]  # value intentionally not stored
    dev = ghealth("user", "paired-devices", "list").get("pairedDevices", [])
    out["devices"] = [{"device": d.get("deviceVersion"), "battery": d.get("batteryLevel"), "battery_status": d.get("batteryStatus"),
                       "last_sync": d.get("lastSyncTime")} for d in dev]

    # Nutrition: daily totals only (no food names). Rollup cap is 90 days.
    nut_from = (today - dt.timedelta(days=89)).isoformat()
    nut = try_ghealth("data", "nutrition-log", "daily-rollup", "--from", nut_from, "--to", a.date)
    nut_pts = (nut or {}).get("dataPoints") or []
    last_nut = max((p.get("date") for p in nut_pts if p.get("date")), default=None)
    out["nutrition"] = {
        "today": nutrition_day(nut_pts, a.date),
        "yesterday": nutrition_day(nut_pts, yesterday.isoformat()),
        "last_date": last_nut,
    }

    # Total calories burned (includes basal + active). Rollup cap is 14 days.
    # Missing days are not zeros — only store dates the API actually returned.
    burned_from = (today - dt.timedelta(days=13)).isoformat()
    burned = try_ghealth("data", "total-calories", "daily-rollup", "--from", burned_from, "--to", a.date)
    burned_map = {p["date"]: p.get("kcalSum") for p in (burned or {}).get("dataPoints") or [] if "date" in p}
    def burned_day(date):
        if date not in burned_map or burned_map[date] is None:
            return None
        return {"date": date, "kcal": round(float(burned_map[date]))}
    out["calories_burned"] = {
        "today": burned_day(a.date),
        "yesterday": burned_day(yesterday.isoformat()),
    }

    json.dump(out, open(a.out, "w"), indent=2)
    print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
