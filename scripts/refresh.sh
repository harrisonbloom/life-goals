#!/usr/bin/env bash
# Morning refresh: pull Google Health, build data.json from today's pulls, check, commit, push.
# Connector pulls (Drive, Finance, Calendar) must already be saved in $PULLS — see REFRESH.md.
set -euo pipefail
cd "$(dirname "$0")/.."
DATE="${1:-$(TZ=America/Phoenix date +%F)}"
PULLS="/workspace/life-goals-pulls/$DATE"
mkdir -p "$PULLS"
python3 scripts/pull_health.py --out "$PULLS/health.json" --date "$DATE" || echo "WARN: Google Health pull failed/unauthenticated; health fields will be 'No data yet'"
for f in workout_tracker.txt finance_accounts.txt finance_connections.txt finance_card_tx.txt finance_bank_tx.txt calendar_events.txt; do
  [ -s "$PULLS/$f" ] || echo "WARN: missing $PULLS/$f (its fields will show 'No data yet')"
done
python3 scripts/build_data.py --pulls "$PULLS" --date "$DATE"
python3 scripts/check_public.py --pulls "$PULLS"
git add data.json
if git diff --cached --quiet; then echo "data.json unchanged"; exit 0; fi
git commit -q -m "data: morning refresh $DATE"
git push -q origin main
echo "pushed $(git rev-parse --short HEAD)"
