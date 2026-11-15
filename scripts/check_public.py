#!/usr/bin/env python3
"""Fail if data.json (public) contains anything identifying from the pulled finance files:
account masks, account/institution names, merchant names, or raw balances.
Usage: python3 scripts/check_public.py --pulls <dir> [--data data.json]"""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build_data import load_any, csv_rows

ap = argparse.ArgumentParser(); ap.add_argument("--pulls", required=True, type=Path)
ap.add_argument("--data", default=str(Path(__file__).resolve().parent.parent / "data.json"))
a = ap.parse_args()
pub = Path(a.data).read_text()
d = json.loads(pub)
assert "private" in d and "ct" in d["private"], "private block missing/unencrypted"
bad = set()
for a_ in (load_any(a.pulls / "finance_accounts.txt") or {}).get("accounts", []):
    bad |= {a_.get("mask") or "", a_.get("name") or "", (a_.get("current_balance") or "").rstrip("0").rstrip(".")}
for c in (load_any(a.pulls / "finance_connections.txt") or {}).get("connections", []):
    bad.add(c.get("institution_name") or "")
for f in ("finance_card_tx.txt", "finance_bank_tx.txt"):
    for r in csv_rows(load_any(a.pulls / f)) or []:
        bad |= {r.get("merchant_name") or "", r.get("name") or ""}
bad = {b for b in bad if len(b) >= 4 and b not in ("0", "Individual", "Investment")}
# the plaintext fields block must not hold private keys
leak = [b for b in bad if b in pub]
leak += [k for k in d.get("private_keys", []) if k in d.get("fields", {})]
if leak:
    print("PUBLIC LEAK:", leak); sys.exit(1)
print(f"public check ok ({len(bad)} sensitive strings checked)")
