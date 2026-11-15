#!/usr/bin/env python3
"""Pull Google Health (Fitbit Air + Apple Health) data with the ghealth CLI.

Usage: python3 scripts/pull_health.py --out /workspace/life-goals-pulls/<date>/health.json [--date YYYY-MM-DD]
Read-only. Needs ghealth auth (`ghealth auth status --validate` -> authenticated: true).
Writes raw-but-trimmed values; build_data.py turns them into dashboard fields.
Body weight values are NOT written (privacy: the repo is public); only the latest weight date.
"""
import argparse, datetime as dt, json, os, subprocess, sys, tempfile
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Phoenix")
CLI_DIR = "/workspace/google-health-cli"
BIN = "/tmp/ghealth"


def ghealth(*args):
    if not os.path.exists(BIN):
        subprocess.run(["go", "build", "-o", BIN, "."], cwd=CLI_DIR, check=True)
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    r = subprocess.run([BIN, *args, "-o", path], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ghealth {' '.join(args)} failed: {r.stderr or r.stdout}")
    with open(path) as fh:
        out = json.load(fh)
    os.unlink(path)
    return out


def auth_ok():
    r = subprocess.run([BIN, "auth", "status", "--validate"], capture_output=True, text=True)
    try:
        return json.loads(r.stdout).get("authenticated", False)
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--date", default=dt.datetime.now(TZ).date().isoformat())
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.date)
    week_start = today - dt.timedelta(days=today.weekday())
    if not os.path.exists(BIN):
        subprocess.run(["go", "build", "-o", BIN, "."], cwd=CLI_DIR, check=True)
    out = {"pulled_at": dt.datetime.now(TZ).isoformat(timespec="seconds"), "date": a.date, "auth_ok": auth_ok()}
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
    ex = ghealth("data", "exercise", "list", "--from", week_start.isoformat(), "--limit", "100")["dataPoints"]
    mod = 0
    for e in ex:
        z = (e.get("metricsSummary") or {}).get("heartRateZoneDurations") or {}
        mod += float(str(z.get("moderateTime", "0s")).rstrip("s") or 0)
    out["exercise_week"] = {"week_start": week_start.isoformat(), "sessions": len(ex), "moderate_zone_min": round(mod / 60)}
    w = ghealth("data", "weight", "list", "--from", "2025-01-01", "--limit", "5")["dataPoints"]
    if w:
        out["weight_latest_date"] = max(x["time"] for x in w)[:10]  # value intentionally not stored
    dev = ghealth("user", "paired-devices", "list").get("pairedDevices", [])
    out["devices"] = [{"device": d.get("deviceVersion"), "battery": d.get("batteryLevel"), "battery_status": d.get("batteryStatus"),
                       "last_sync": d.get("lastSyncTime")} for d in dev]
    json.dump(out, open(a.out, "w"), indent=2)
    print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
