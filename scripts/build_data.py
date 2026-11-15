#!/usr/bin/env python3
"""Build data.json for the Life Goals PWA from one morning's pulled files.

Usage:
  python3 scripts/build_data.py --pulls /workspace/life-goals-pulls/YYYY-MM-DD [--date YYYY-MM-DD] [--out data.json]

Inputs in --pulls (see REFRESH.md for the connector call behind each one). Each file may be the
raw connector output, including any wrapper text; the first {...} JSON object is extracted.
  health.json              scripts/pull_health.py
  workout_tracker.txt      Drive read_file_content on the Workout tracker sheet
  workout_meta.txt         Drive get_file_metadata on the same sheet (optional)
  finance_accounts.txt     Finance finance_list_accounts
  finance_connections.txt  Finance finance_list_connections
  finance_card_tx.txt      Finance finance_query_liability_transactions (1st of month..today)
  finance_bank_tx.txt      Finance finance_query_account_transactions  (1st of month..today)
  calendar_events.txt      Calendar list_events primary, Monday 00:00 .. next Monday 00:00

Every field in the output is {value, status, source, as_of, note}. status is one of
  live     measured, from a connector (UI flags stale when as_of is >3 days old)
  config   a target/plan confirmed by a bot (no staleness)
  missing  no real source yet; UI shows "No data yet". Never filled with a guess.

Privacy: the repo and site are PUBLIC. Measured personal data (health, money, calendar counts)
is AES-256-GCM encrypted into data.json["private"] with the passphrase in
~/.config/life-goals/passphrase (or $LG_PASSPHRASE). Only totals are computed; no account
numbers, institution names, merchants or transactions are written. A plaintext copy for local
checking goes to data.private.local.json (gitignored, never commit).
"""
import argparse, base64, csv, datetime as dt, io, json, os, re, secrets, sys
from pathlib import Path
from zoneinfo import ZoneInfo
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ROOT = Path(__file__).resolve().parent.parent
TZ = ZoneInfo("America/Los_Angeles")
PBKDF2_ITER = 310000
PASS_FILE = Path.home() / ".config/life-goals/passphrase"
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def F(value=None, status="missing", source=None, as_of=None, note=None):
    return {"value": value, "status": status, "source": source, "as_of": as_of, "note": note}


def load_any(path):
    """Read a pulled file and return its first JSON object (tolerates wrapper text)."""
    p = Path(path)
    if not p.exists():
        return None
    txt = p.read_text()
    start = txt.find("{")
    if start < 0:
        return None
    dec = json.JSONDecoder()
    while start >= 0:
        try:
            obj, _ = dec.raw_decode(txt[start:])
            return obj
        except json.JSONDecodeError:
            start = txt.find("{", start + 1)
    return None


def local_date(ts):
    """ISO timestamp (any offset, or Z) -> YYYY-MM-DD in America/Los_Angeles."""
    if not ts:
        return ""
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(TZ).date().isoformat()


# ---------------- health ----------------
def health_fields(h, today):
    out = {}
    src = "Google Health (ghealth CLI)"
    if not h or not h.get("auth_ok"):
        note = "Google Health sign-in expired; re-auth ghealth on the box"
        for k in ("sleep", "rhr", "hrv", "steps", "steps_7d", "zone2_week",
                  "calories_in", "calories_in_yesterday", "protein",
                  "calories_burned", "calories_burned_yesterday", "exercise_sessions"):
            out[k] = F(note=note)
        return out
    s = h.get("sleep")
    if s:
        eff = round(100 * s["asleep_min"] / s["in_bed_min"]) if s.get("in_bed_min") else None
        out["sleep"] = F({"duration_h": round(s["asleep_min"] / 60, 2), "efficiency_pct": eff, "stages_min": s["stages_min"],
                          "bedtime": s["bedtime"][11:16], "wake": s["wake"][11:16], "night_of": s["night_of"]},
                         "live", f"{src} · {s.get('source')}", s["wake_date"], "Most recent night synced")
    else:
        out["sleep"] = F(note="No sleep sessions in the last 60 days")
    r = h.get("rhr")
    out["rhr"] = F(r["bpm"], "live", f"{src} · {r.get('source')}", r["date"]) if r else F()
    v = h.get("hrv")
    out["hrv"] = F(v["ms"], "live", f"{src} · {v.get('source')}", v["date"]) if v else F()
    days = [d for d in h.get("steps_daily", []) if d["date"] <= today]
    if days:
        last = days[-1]
        note = "Today so far" if last["date"] == today else "Latest full day synced"
        out["steps"] = F(last["steps"], "live", f"{src} · Apple Health/Fitbit", last["date"], note)
        wk = days[-7:]
        out["steps_7d"] = F(round(sum(d["steps"] for d in wk) / len(wk)), "live", src, last["date"], f"Avg of {len(wk)} days")
        out["steps_series"] = F([d["steps"] for d in days[-14:]], "live", src, last["date"])
    else:
        out["steps"] = F()
    ex = h.get("exercise_week") or {}
    devs = h.get("devices") or []
    last_sync = local_date(max((d.get("last_sync") or "" for d in devs), default=""))
    if ex.get("sessions"):
        out["zone2_week"] = F(ex["moderate_zone_min"], "live", f"{src} · exercise moderate-HR minutes", today,
                              f"{ex['sessions']} sessions since {ex['week_start']}")
    elif last_sync and last_sync >= ex.get("week_start", today):
        out["zone2_week"] = F(0, "live", src, last_sync, "No workouts recorded this week")
    else:
        out["zone2_week"] = F(note=f"Fitbit not synced this week (last sync {last_sync or 'unknown'})")

    # Nutrition (calories in + protein) and calories burned are encrypted private fields.
    # Missing days are not treated as zero. Food names are never stored.
    src_nut = f"{src} · nutrition-log"
    nut = h.get("nutrition") or {}
    last_nut = nut.get("last_date")
    last_note = f"; last Google Health food log {last_nut}" if last_nut else "; no food logs in the last 90 days"
    td, yd = nut.get("today") or {}, nut.get("yesterday") or {}
    if td.get("kcal") is not None:
        out["calories_in"] = F(int(td["kcal"]), "live", src_nut, td["date"],
                               "Calories logged in the Google Health app today")
    else:
        out["calories_in"] = F(note="No food logged in Google Health today" + last_note)
    if yd.get("kcal") is not None:
        out["calories_in_yesterday"] = F(int(yd["kcal"]), "live", src_nut, yd["date"],
                                         "Calories logged in the Google Health app yesterday")
    else:
        out["calories_in_yesterday"] = F(note="No food logged in Google Health yesterday" + last_note)
    # Protein: Google Health is the higher-confidence source (identified food entries
    # with nutrient breakdown). The app uses this for today when present, and falls
    # back to the on-device quick-log otherwise. The two are never added together,
    # which would double-count if the same meals were logged in both places.
    if td.get("protein_g") is not None:
        out["protein"] = F(int(td["protein_g"]), "live", src_nut, td["date"],
                           "From Google Health food logs. Quick-log is used only when Health has no protein for today (not added together).")
    else:
        out["protein"] = F(note="No protein in Google Health for today" + last_note +
                           ". Quick-log is the fallback until you log food in Google Health.")

    burn = h.get("calories_burned") or {}
    bt, by_ = burn.get("today") or {}, burn.get("yesterday") or {}
    src_burn = f"{src} · total-calories"
    if bt.get("kcal") is not None:
        note = "Today so far" if bt.get("date") == today else "Latest full day synced"
        out["calories_burned"] = F(int(bt["kcal"]), "live", src_burn, bt["date"], note)
    else:
        out["calories_burned"] = F(note="No total-calories (calories burned) for today")
    if by_.get("kcal") is not None:
        out["calories_burned_yesterday"] = F(int(by_["kcal"]), "live", src_burn, by_["date"],
                                             "Calories burned yesterday")
    else:
        out["calories_burned_yesterday"] = F(note="No total-calories (calories burned) for yesterday")

    sess = h.get("exercise_sessions") or {}
    sessions = sess.get("sessions") or []
    last_sess = sess.get("last_date")
    # type, duration, date only (plus session kcal when present). No notes or IDs.
    clean = [{"date": s["date"], "type": s["type"], "duration_min": s.get("duration_min"),
              "kcal": s.get("kcal")} for s in sessions]
    if clean:
        out["exercise_sessions"] = F(clean, "live", f"{src} · exercise sessions", today,
                                     f"{len(clean)} session(s) since {sess.get('week_start', today)}")
    elif last_sess:
        out["exercise_sessions"] = F([], "live", f"{src} · exercise sessions", today,
                                     f"No workouts recorded this week (last session {last_sess})")
    else:
        out["exercise_sessions"] = F(note="No exercise sessions in the last 60 days")

    if devs:
        d = devs[0]
        out["tracker"] = F({"device": d.get("device"), "battery": d.get("battery"), "battery_status": d.get("battery_status"),
                            "last_sync": d.get("last_sync")}, "live", src, local_date(d.get("last_sync") or "") or today)
    return out


# ---------------- workout split ----------------
def split_field(txt, meta, today):
    if not txt:
        return F(note="Workout tracker not read")
    content = txt.get("fileContent", "") if isinstance(txt, dict) else ""
    split, day = {}, None
    for line in content.splitlines():
        cells = [c.strip() for c in line.split(",")]
        if len(cells) > 2 and cells[1] == "Day" and cells[2] in DAYS:
            day = cells[2][:3]
        elif day and len(cells) > 2 and cells[1] == "Focus":
            split[day] = re.sub(r"\s*/\s*", " / ", cells[2])
            day = None
    for d in ("Sat", "Sun"):
        split.setdefault(d, "Rest or Zone 2")
    mod = (meta or {}).get("modifiedTime", "")[:10]
    return F(split, "config", "Drive · Workout tracker sheet", today, f"Sheet last edited {mod}" if mod else None)


# ---------------- finance ----------------
def csv_rows(obj):
    if not obj or "csv" not in obj:
        return None
    return list(csv.DictReader(io.StringIO(obj["csv"])))


def is_spend(row):
    """Money out that counts as spending. Excludes card payments, transfers (incl. Fidelity),
    and returned/reversed payments. Fees and interest count (they are real money out)."""
    if row.get("direction") != "out" or row.get("pending") == "true":
        return False
    try:
        cat = json.loads(row.get("category") or "{}")
    except json.JSONDecodeError:
        cat = {}
    prim, det = cat.get("primary", ""), cat.get("detailed", "")
    if prim in ("TRANSFER_OUT", "TRANSFER_IN", "LOAN_PAYMENTS"):
        return False
    if det == "BANK_FEES_INSUFFICIENT_FUNDS" or "returned payment" in (row.get("name") or "").lower():
        return False
    if "fidelity" in (row.get("name") or "").lower() and "transfer" in (row.get("name") or "").lower():
        return False
    return True


def finance_fields(pulls, today):
    out = {}
    src = "Finance (Plaid)"
    accts = (load_any(pulls / "finance_accounts.txt") or {}).get("accounts")
    conns = (load_any(pulls / "finance_connections.txt") or {}).get("connections") or []
    card = csv_rows(load_any(pulls / "finance_card_tx.txt"))
    bank = csv_rows(load_any(pulls / "finance_bank_tx.txt"))
    conn_date = {c["id"]: c.get("updated_at", "")[:10] for c in conns}
    errored = {c["id"] for c in conns if c.get("status") != "active"}
    if card is None and bank is None:
        for k in ("spend_today", "spend_week", "spend_month"):
            out[k] = F(note="Finance transactions not pulled")
    else:
        rows = [r for r in (card or []) + (bank or []) if is_spend(r)]
        d = dt.date.fromisoformat(today)
        wk = (d - dt.timedelta(days=d.weekday())).isoformat()
        mo = d.replace(day=1).isoformat()
        tot = lambda f: round(sum(-float(r["amount"]) for r in rows if f(r["date"])), 2)
        note = "Linked Plaid accounts only (cards not linked to Plaid aren't counted)"
        out["spend_today"] = F(tot(lambda x: x == today), "live", src, today, note)
        out["spend_week"] = F(tot(lambda x: wk <= x <= today), "live", src, today, f"Since Mon {wk}")
        out["spend_month"] = F(tot(lambda x: mo <= x <= today), "live", src, today, f"Since {mo}")
    out["surplus_month"] = F(note="Needs income + a spend target from Personal Finance")
    if accts:
        debt = [a for a in accts if a["class"] == "liability"]
        inv = [a for a in accts if a["class"] == "investment"]
        stale_debt = [a for a in debt if a["connection_id"] in errored]
        debt_asof = min((conn_date.get(a["connection_id"], today) for a in debt), default=today)
        out["debt_total"] = F(round(sum(float(a["current_balance"] or 0) for a in debt), -2), "live", src, debt_asof,
                              "Plaid-linked accounts only, rounded to $100" + (
                                  f"; {len(stale_debt)} loan connection needs re-linking, balance from {debt_asof}" if stale_debt else ""))
        inv_asof = min((conn_date.get(a["connection_id"], today) for a in inv), default=today)
        out["invest_total"] = F(round(sum(float(a["current_balance"] or 0) for a in inv), -2), "live", src, inv_asof,
                                "Rounded to $100; brokerage + retirement")
    else:
        out["debt_total"] = F(note="Finance accounts not pulled")
        out["invest_total"] = F(note="Finance accounts not pulled")
    return out


# ---------------- calendar ----------------
DATE_RE = re.compile(r"\b(date|dinner with|drinks with|hinge)\b", re.I)
ENJOY_RE = re.compile(r"\b(enjoy|fun|guitar|hike|game|movie|concert|beach|surf|golf|read|hobby)\b", re.I)


def calendar_fields(cal, today):
    if cal is None:
        return {"dates_week": F(note="Calendar not pulled"), "enjoy_cal_today": F(note="Calendar not pulled")}
    ev = [e for e in cal.get("events", []) if e.get("status") != "cancelled"]
    title = lambda e: e.get("summary") or e.get("title") or ""
    start = lambda e: (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date") or e.get("start") or ""
    dates = [e for e in ev if DATE_RE.search(title(e))]
    enjoy = [e for e in ev if ENJOY_RE.search(title(e)) and str(start(e))[:10] == today]
    src = "Google Calendar (primary)"
    return {"dates_week": F(len(dates), "live", src, today, "Events titled date/dinner with/drinks with/Hinge this week"),
            "enjoy_cal_today": F(len(enjoy), "live", src, today, "Enjoyment-type events on today's calendar")}


# ---------------- encryption ----------------
def passphrase():
    if os.environ.get("LG_PASSPHRASE"):
        return os.environ["LG_PASSPHRASE"]
    if PASS_FILE.exists():
        return PASS_FILE.read_text().strip()
    sys.exit(f"No passphrase: create {PASS_FILE} (chmod 600) or set LG_PASSPHRASE")


def encrypt(obj, pw):
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITER).derive(pw.encode())
    ct = AESGCM(key).encrypt(iv, json.dumps(obj, separators=(",", ":")).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return {"alg": "PBKDF2-SHA256/AES-256-GCM", "iter": PBKDF2_ITER, "salt": b(salt), "iv": b(iv), "ct": b(ct)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pulls", required=True, type=Path)
    ap.add_argument("--date", default=dt.datetime.now(TZ).date().isoformat())
    ap.add_argument("--out", default=str(ROOT / "data.json"))
    a = ap.parse_args()
    today = a.date
    cfg = json.loads((ROOT / "scripts/config.json").read_text())

    public = {
        "split": split_field(load_any(a.pulls / "workout_tracker.txt"), load_any(a.pulls / "workout_meta.txt"), today),
        "career_task": F(cfg["career"]["tasks"], "config", cfg["career"]["source"], cfg["career"]["as_of"],
                         "Rotates daily; pick one, under 10 min"),
        "career_win": F(note="Log wins with the quick-log; no bot tracks them yet"),
        "cert_minutes": F(note="No cert-minutes source yet (Continuing Education bot could supply it)"),
        "weight": F(note="Log weight with the quick-log (scale data not published: repo is public)"),
        "creatine": F(note="Check off in the morning checklist"),
        "dating_today": F(note="Log with the quick-log"),
    }
    h = load_any(a.pulls / "health.json")
    private = {**health_fields(h, today), **finance_fields(a.pulls, today),
               **calendar_fields(load_any(a.pulls / "calendar_events.txt"), today)}
    if h and h.get("weight_latest_date"):
        public["weight"]["note"] += f"; Google Health last weigh-in {h['weight_latest_date']}"

    data = {
        "schema": 2,
        "generated": dt.datetime.now(TZ).isoformat(timespec="minutes"),
        "date": today,
        "timezone": cfg["timezone"],
        "plan": cfg["plan"], "targets": cfg["targets"],
        # list kept for v1 clients still running a cached app.js
        "checklist": cfg["checklist"]["items"],
        "split": public["split"]["value"] or {},  # v1 clients
        "checklist_source": {k: cfg["checklist"][k] for k in ("source", "as_of")},
        "fields": public,
        "private_keys": sorted(private),
        "private": encrypt({"fields": private}, passphrase()),
    }
    Path(a.out).write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    (ROOT / "data.private.local.json").write_text(json.dumps({"fields": private}, indent=1) + "\n")
    summary = {k: f"{v['status']}{' as of ' + v['as_of'] if v['as_of'] else ''}" for k, v in {**public, **private}.items()}
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
